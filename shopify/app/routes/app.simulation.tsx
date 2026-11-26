import { env } from "cloudflare:workers";
import { RULE_LIMITS, SIMULATION_TTL_MS, type CandidateReason, type ProtectionReason } from "@tiersaver/core";
import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags, Metric } from "../components/home-screen";
import { downloadFile, errorFocus, number, Row, Time, useRevealError } from "../components/ui";
import { approveCleanup } from "../billing/approval";
import { LARGEST_PLAN_PROFILES, PLAN_INTERVAL_DAYS, planCoversList, planForListSize, refreshPlan, requestPlanFor, usd, type BillingStatus } from "../billing/billing";
import { requestAdminGraphql } from "../billing/billing.server";
import { db } from "../db.server";
import { sessionActor } from "../data/events-log";
import { getConnection } from "../klaviyo/connection.server";
import { embeddedAppUrl } from "../klaviyo/flow.server";
import { legalUrls, TERMS_VERSION } from "../legal";
import { suppressionAllowed } from "../runs/gateway.server";
import { startScan } from "../scans/start.server";
import { shopTimeZone, stamp } from "../settings/timezone";
import { startSuppressionRun } from "../runs/start.server";
import type { ScanSummary } from "../scans/engine";
import { KEPT_LABELS } from "../scans/view.server";
import { automaticReview } from "../schedule/automatic";
import { CANDIDATE_REASON_LABELS, CSV_PART_SIZE, latestSimulation } from "../simulations/review";
import { authenticate } from "../shopify.server";

/**
 * How the shop's plan stands against the list size of this simulation. Everything shown about the price comes
 * from billing/billing.ts; this page writes no figure by hand.
 * - "none": no plan yet (the plan starts with the first cleanup);
 * - "covers": the active plan is the one for this list size;
 * - "too_low": the list moved to a larger plan, which the merchant has to approve in Shopify;
 * - "higher": the list moved to a smaller plan; the merchant is told and offered the switch;
 * - "frozen": the plan is on hold at Shopify; "unknown": Shopify could not be asked; "above": not sold automatically.
 */
type PlanStanding = "none" | "covers" | "too_low" | "higher" | "frozen" | "unknown" | "above";

function planStanding(billing: BillingStatus | null, activeProfiles: number): PlanStanding {
  if (!planForListSize(activeProfiles)) return "above";
  if (!billing) return "unknown";
  const coverage = planCoversList(billing.plan, activeProfiles);
  if (coverage.covered) return coverage.overpaying ? "higher" : "covers";
  if (coverage.reason === "plan_price_too_low") return "too_low";
  return billing.frozen ? "frozen" : "none";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, sessionToken } = await authenticate.admin(request);
  const [found, connection] = await Promise.all([latestSimulation(db, session.shop), getConnection(db, session.shop)]);
  if (!found) return { simulation: null, connected: connection?.status === "connected" };

  const { simulation, state } = found;
  const summary = simulation.summary as ScanSummary;
  const zone = await shopTimeZone(db, session.shop);
  const run =
    state === "executed"
      ? await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.simulationId, simulation.id), columns: { id: true, status: true, processedCount: true, finishedAt: true } })
      : null;
  // Shopify is asked about the plan only while this simulation can still be approved or started. Coming back
  // from Shopify's approval page lands here too: this is where a newly approved plan is first seen and recorded.
  let billing: BillingStatus | null = null;
  const pending = (state === "open" || state === "approved") && simulation.candidateCount > 0;
  if (pending) {
    try {
      billing = await refreshPlan({ db, graphql: requestAdminGraphql(admin), actor: sessionActor(sessionToken) }, session.shop);
    } catch {
      billing = null;
    }
  }
  const required = planForListSize(simulation.activeProfiles);
  const standing = planStanding(billing, simulation.activeProfiles);
  const current = billing?.plan ?? null;
  // Why the schedule did not start this cleanup by itself (automatic mode), if it did not.
  const waiting = state === "open" && simulation.origin === "scheduled" ? await automaticReview(db, { shop: session.shop, simulationId: simulation.id }) : null;
  return {
    connected: connection?.status === "connected",
    simulation: {
      id: simulation.id,
      state,
      origin: simulation.origin,
      // Formatted here, in the shop's time zone: the browser never formats a date.
      createdAt: stamp(simulation.createdAt, zone),
      expiresAt: stamp(new Date(simulation.createdAt.getTime() + SIMULATION_TTL_MS), zone),
      approvedAt: simulation.approvedAt ? stamp(simulation.approvedAt, zone) : null,
      automatic: simulation.approvedBy === "automatic",
      activeProfiles: simulation.activeProfiles,
      evaluated: simulation.evaluatedCount,
      candidates: simulation.candidateCount,
      candidatesByReason: (Object.entries(summary.candidatesByReason ?? {}) as [CandidateReason, number][])
        .filter(([, n]) => n > 0)
        .map(([reason, count]) => ({ label: CANDIDATE_REASON_LABELS[reason] ?? reason, count })),
      keptActive: (Object.entries(summary.protectedByReason ?? {}) as [ProtectionReason, number][])
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ label: KEPT_LABELS[reason] ?? reason, count })),
      // Members of the segment that were neither candidates nor kept active: already suppressed in Klaviyo, or without an email address.
      leftOut: Object.values(summary.skippedByReason ?? {}).reduce((sum: number, n) => sum + (typeof n === "number" ? n : 0), 0),
      csvParts: Math.max(1, Math.ceil(simulation.candidateCount / CSV_PART_SIZE)),
      run: run ? { id: run.id, status: run.status, submitted: run.processedCount, finishedAt: run.finishedAt ? stamp(run.finishedAt, zone) : null } : null,
      seededTestAccount: summary.seededTestAccount === true,
    },
    plan: {
      standing,
      /** The plan a list of this size needs: "US$9/month", the list size it covers and the sentence with its terms. */
      required: required ? { price: required.price, maxProfiles: required.maxProfiles, terms: required.terms } : null,
      /** The plan the shop has now, when it has one. */
      current: current ? { price: `${usd(current.monthlyCents)}/month`, maxProfiles: current.maxProfiles, test: current.test } : null,
      developmentStore: billing?.developmentStore === true,
      intervalDays: PLAN_INTERVAL_DAYS,
      largestTier: number(LARGEST_PLAN_PROFILES),
    },
    automaticWait: waiting?.label ?? null,
    restoreLockDays: RULE_LIMITS.reactivationLockDays.min,
    legal: legalUrls(env),
    cleanupsEnabled: suppressionAllowed(env, connection?.klaviyoAccountId),
  };
};

const ERRORS: Record<string, string> = {
  not_acknowledged: "Tick this box to approve.",
  approver_unknown: "We could not identify your Shopify user. Reload the page and try again.",
  no_candidates: "This simulation has no profiles to suppress, so there is nothing to approve.",
  already_approved: "This simulation is already approved.",
  expired: "This simulation is more than 24 hours old. Run the audit again to get a current one.",
  superseded: "Your rules changed or a newer audit replaced this simulation. Run the audit again.",
  executed: "This simulation was already used for a cleanup.",
  already_executed: "This simulation was already used for a cleanup.",
  not_approved: "Approve the simulation before starting the cleanup.",
  not_connected: "Reconnect Klaviyo from the home page first.",
  not_found: "This simulation no longer exists. Run the audit again.",
  cleanups_not_enabled: "Cleanups are not switched on for this installation yet. Nothing was changed in Klaviyo.",
  plan_required: "You need an active TierSaver plan to start a cleanup. Start the plan below; Shopify asks you to approve it. Nothing was changed in Klaviyo.",
  plan_frozen: "Your TierSaver plan is on hold in Shopify because of a billing issue with your store. Cleanups can start again once Shopify reactivates it. Nothing was changed in Klaviyo.",
  plan_price_too_low: "Your list has grown into a larger plan. Approve the new monthly price in Shopify before starting this cleanup. Nothing was changed in Klaviyo.",
  above_price_tiers: "Lists this large are not sold automatically. Write to hello@tiersaver.com. Nothing was changed in Klaviyo.",
  billing_unavailable: "Shopify could not be asked about your plan. Nothing was changed. Please try again.",
  cleanup_in_progress: "Another cleanup is still in progress. Wait for it to finish.",
  klaviyo_not_connected: "Connect Klaviyo before starting a cleanup.",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken, admin, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const simulationId = String(form.get("simulationId") ?? "");
  const actor = sessionActor(sessionToken);

  if (intent === "scan") {
    // The way out of an expired or out-of-date simulation: a new audit (read-only), followed on the home page.
    const connection = await getConnection(db, session.shop);
    if (connection?.status !== "connected") return { error: "not_connected" };
    await startScan({ shop: session.shop, createdBy: actor });
    return redirect("/app");
  }

  // Where Shopify sends the merchant after its approval page: back to this review, inside the admin.
  const returnUrl = embeddedAppUrl(env, session.shop, "/app/simulation");
  const graphql = requestAdminGraphql(admin);

  if (intent === "approve") {
    // Approves the cleanup and, when the shop has no plan that covers this list size, goes on to Shopify's
    // approval page for it (billing/approval.ts). Nothing is suppressed by approving.
    const result = await approveCleanup({ db, graphql }, { shop: session.shop, simulationId, approvedBy: actor, acknowledged: form.get("acknowledged") === "yes", termsVersion: TERMS_VERSION, returnUrl });
    if (!result.ok) return { error: result.reason };
    return result.next === "approve_in_shopify" ? redirect(result.confirmationUrl, { target: "_top" }) : redirect("/app/simulation");
  }

  if (intent === "plan") {
    // From an approved simulation: start the plan, move to the larger one, or (switch=lower) to the smaller one.
    const found = await latestSimulation(db, session.shop);
    if (!found || found.simulation.id !== simulationId) return { error: "not_found" };
    const requested = await requestPlanFor({ db, graphql }, {
      shop: session.shop,
      activeProfiles: found.simulation.activeProfiles,
      returnUrl,
      actor,
      termsVersion: TERMS_VERSION,
      simulationId,
      keepLargerPlan: form.get("switch") !== "lower",
    });
    if (!requested.ok) return { error: requested.reason };
    return requested.next === "approve_in_shopify" ? redirect(requested.confirmationUrl, { target: "_top" }) : redirect("/app/simulation");
  }

  if (intent === "start") {
    // Checked before the simulation is consumed: a refused start must leave it approved and usable.
    const connection = await getConnection(db, session.shop);
    if (connection?.status !== "connected") return { error: "klaviyo_not_connected" };
    if (!suppressionAllowed(env, connection.klaviyoAccountId)) return { error: "cleanups_not_enabled" };
    // The plan is checked at Shopify inside startSuppressionRun (runs/gated.ts), not here and not from the page.
    const started = await startSuppressionRun({ shop: session.shop, simulationId, createdBy: actor, graphql });
    return started.ok ? redirect(`/app/runs/${started.runId}`) : { error: started.reason };
  }
  return new Response(null, { status: 400 });
};

/** Files offered at a time. A list of any size can be downloaded whole, a page of files at a time. */
const FILES_PER_PAGE = 8;

function CandidateDownload({ simulationId, parts }: { simulationId: string; parts: number }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(parts / FILES_PER_PAGE);
  const first = page * FILES_PER_PAGE + 1;
  const last = Math.min(parts, first + FILES_PER_PAGE - 1);
  const download = async (part: number) => {
    setBusy(part);
    setFailed(false);
    try {
      await downloadFile(`/app/simulation/candidates?id=${encodeURIComponent(simulationId)}&part=${part}`, `tiersaver-candidates-${part}-of-${parts}.csv`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <s-stack gap="base">
      <s-paragraph>
        Download the profiles this cleanup would suppress and check them before you approve. Email addresses are
        read from Klaviyo for the download and are not stored by TierSaver.
        {parts > 1 ? ` The list comes in ${number(parts)} files of up to ${number(CSV_PART_SIZE)} profiles.` : ""}
      </s-paragraph>
      {pages > 1 ? (
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button variant="tertiary" accessibilityLabel="Previous files" {...flags({ disabled: page === 0 })} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </s-button>
          <s-text>
            Files {number(first)} to {number(last)} of {number(parts)}
          </s-text>
          <s-button variant="tertiary" accessibilityLabel="Next files" {...flags({ disabled: page >= pages - 1 })} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
            Next
          </s-button>
        </s-stack>
      ) : null}
      <s-stack direction="inline" gap="base">
        {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((part) => (
          <s-button key={part} variant="secondary" {...flags({ disabled: busy !== null, loading: busy === part })} onClick={() => download(part)}>
            {parts > 1 ? `Download file ${number(part)}` : "Download candidates (CSV)"}
          </s-button>
        ))}
      </s-stack>
      {failed ? <s-banner tone="warning">The file could not be prepared. Please try again.</s-banner> : null}
    </s-stack>
  );
}

function AuditAgain({ busy, disabled }: { busy: boolean; disabled?: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="scan" />
      <s-button type="submit" variant="primary" {...flags({ disabled: busy || disabled })}>
        Run the audit again
      </s-button>
    </Form>
  );
}

export default function Simulation() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { error?: string } | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const submitting = (intent: string) => navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  const sim = data.simulation;
  useRevealError(result, Boolean(result?.error));

  if (!sim || !("plan" in data)) {
    return (
      <s-page heading="Review cleanup">
        <s-section heading="No simulation yet">
          <s-stack gap="base">
            <s-paragraph>
              {data.connected
                ? "Run the free audit from the home page. It produces the simulation you review here; nothing is suppressed until you approve it."
                : "Connect Klaviyo and run the free audit from the home page first."}
            </s-paragraph>
            <div>
              <s-button href="/app" variant="primary">
                Go to home
              </s-button>
            </div>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const { plan, legal } = data;
  const stale = sim.state === "expired" || sim.state === "superseded";
  const actionable = sim.candidates > 0 && !stale && sim.state !== "executed";
  const notAcknowledged = result?.error === "not_acknowledged";
  const keptTotal = Math.max(0, sim.evaluated - sim.candidates - sim.leftOut);
  const needsPlan = plan.standing === "none" || plan.standing === "too_low";
  // The one sentence the merchant has to have read before approving, for each way the plan can stand.
  const planLine =
    plan.standing === "above" || !plan.required
      ? null
      : plan.standing === "covers"
        ? `Included in your plan: ${plan.required.terms} Nothing extra is charged for this cleanup, and restoring a cleanup does not refund the month.`
        : plan.standing === "higher"
          ? `Included in your plan (${plan.current?.price ?? ""}). Nothing extra is charged for this cleanup, and restoring a cleanup does not refund the month.`
          : plan.standing === "too_low"
            ? `Your list now has ${number(sim.activeProfiles)} active profiles, more than your plan covers${plan.current?.maxProfiles ? ` (up to ${number(plan.current.maxProfiles)})` : ""}. To run this cleanup your plan changes from ${plan.current?.price ?? "its current price"} to ${plan.required.terms} Restoring a cleanup does not refund it.`
            : `Free until you approve your first cleanup. Then ${plan.required.terms} Restoring a cleanup does not refund it.`;
  const approveLabel =
    plan.standing === "none" && plan.required
      ? `Approve and start plan (${plan.required.price})`
      : plan.standing === "too_low" && plan.required
        ? `Approve and change plan (${plan.required.price})`
        : "Approve cleanup";
  const lowerPlanOffer =
    plan.standing === "higher" && plan.required && plan.current ? (
      <s-banner tone="info" heading="Your list now fits a smaller plan">
        <s-stack gap="base">
          <s-text>
            Your list has {number(sim.activeProfiles)} active profiles. The plan for that size is {plan.required.price} (lists up to{" "}
            {number(plan.required.maxProfiles)} active profiles); you are paying {plan.current.price}. You can switch now: Shopify asks you to
            approve the lower price and credits the difference for the rest of the current {plan.intervalDays} days.
          </s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="plan" />
            <input type="hidden" name="switch" value="lower" />
            <input type="hidden" name="simulationId" value={sim.id} />
            <s-button type="submit" {...flags({ disabled: busy || !data.connected, loading: submitting("plan") })}>
              Switch to the {plan.required.price} plan
            </s-button>
          </Form>
        </s-stack>
      </s-banner>
    ) : null;

  return (
    <s-page heading="Review cleanup">
      {!data.connected ? (
        <s-banner tone="warning" heading="Klaviyo is not connected">
          <s-stack gap="base">
            <s-text>Reconnect Klaviyo before approving or starting a cleanup. Nothing has changed in Klaviyo.</s-text>
            <div>
              <s-button href="/app">Go to home</s-button>
            </div>
          </s-stack>
        </s-banner>
      ) : result?.error && !notAcknowledged ? (
        <s-banner tone="warning" heading="That did not work" {...errorFocus(true)}>
          {ERRORS[result.error] ?? "Nothing was changed. Please try again."}
        </s-banner>
      ) : sim.state === "expired" ? (
        <s-banner tone="warning" heading="This simulation has expired">
          <s-stack gap="base">
            <s-text>
              A simulation can be approved and run for 24 hours, so a cleanup always uses current data. This one expired on <Time at={sim.expiresAt} />.
              Nothing was suppressed.
            </s-text>
            <AuditAgain busy={busy} />
          </s-stack>
        </s-banner>
      ) : sim.state === "superseded" ? (
        <s-banner tone="warning" heading="This simulation is out of date">
          <s-stack gap="base">
            <s-text>Your rules or protected lists changed after it was computed, or a newer audit replaced it. Nothing was suppressed.</s-text>
            <AuditAgain busy={busy} />
          </s-stack>
        </s-banner>
      ) : sim.state === "executed" ? (
        <s-banner tone="info" heading="This simulation was used for a cleanup">
          <s-stack gap="base">
            <s-text>
              {sim.run
                ? sim.run.status === "failed" && sim.run.submitted === 0
                  ? "The cleanup did not run and no profiles were suppressed. Run the audit again for a new simulation."
                  : `${number(sim.run.submitted)} profiles were sent to Klaviyo to be suppressed`
                : "It cannot be used again."}
              {sim.run && !(sim.run.status === "failed" && sim.run.submitted === 0) ? (
                sim.run.finishedAt ? (
                  <>
                    {" "}
                    on <Time at={sim.run.finishedAt} />.
                  </>
                ) : (
                  " so far."
                )
              ) : null}
            </s-text>
            {sim.run ? (
              <div>
                <s-button href={`/app/runs/${sim.run.id}`}>View the cleanup</s-button>
              </div>
            ) : null}
          </s-stack>
        </s-banner>
      ) : null}

      {data.automaticWait && sim.state === "open" && data.connected ? (
        <s-banner tone="info" heading="This scheduled cleanup is waiting for you">
          {data.automaticWait}
        </s-banner>
      ) : null}

      <s-section heading="Simulation">
        <s-stack gap="base">
          {sim.seededTestAccount ? <s-text color="subdued">Test account: this simulation reads seeded sample data.</s-text> : null}
          <s-paragraph>
            Computed <Time at={sim.createdAt} />
            {sim.origin === "scheduled" ? " by your monthly schedule" : ""}.{sim.state === "executed" ? "" : " Nothing has changed in Klaviyo."}
            {sim.state === "open" || sim.state === "approved" ? (
              <>
                {" "}
                It can be approved and run until <Time at={sim.expiresAt} />.
              </>
            ) : null}
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <Metric label="Active profiles now" value={number(sim.activeProfiles)} />
            <Metric label="This cleanup would suppress" value={number(sim.candidates)} detail={sim.candidatesByReason.map((r) => r.label).join("; ") || undefined} emphasis />
            <Metric label="Active profiles after" value={number(Math.max(0, sim.activeProfiles - sim.candidates))} />
            {actionable ? (
              <Metric
                label="TierSaver plan for this list size"
                value={plan.required ? plan.required.price : "Not sold automatically"}
                detail={
                  !plan.required
                    ? `Lists above ${plan.largestTier} active profiles`
                    : plan.standing === "covers"
                      ? "Your current plan. Nothing extra for this cleanup"
                      : plan.standing === "higher"
                        ? `You pay ${plan.current?.price ?? "more"} today`
                        : plan.standing === "too_low"
                          ? `You pay ${plan.current?.price ?? "less"} today`
                          : plan.standing === "none"
                            ? "Free until you approve your first cleanup"
                            : `Charged by Shopify every ${plan.intervalDays} days`
                }
              />
            ) : null}
          </s-grid>
          <s-stack gap="small-200">
            <Row label="Meet Klaviyo's inactive criteria" value={number(sim.evaluated)} />
            {keptTotal > 0 ? <Row label="Kept active in total" value={number(keptTotal)} /> : null}
            {sim.keptActive.map((row) => (
              <Row key={row.label} indent label={row.label} value={number(row.count)} />
            ))}
            {sim.leftOut > 0 ? <Row label="Left out: already suppressed in Klaviyo, or no email address" value={number(sim.leftOut)} /> : null}
            <Row strong label="Would be suppressed" value={number(sim.candidates)} />
          </s-stack>
          {sim.keptActive.length > 1 ? (
            <s-text color="subdued">A profile can be kept active for more than one reason, so the reasons can add up to more than the total.</s-text>
          ) : null}
          {sim.candidates === 0 ? (
            <s-paragraph>
              {sim.evaluated === 0 ? "No profiles match the cleanup criteria" : "Every profile that meets the criteria is kept active"}, so there is nothing to
              suppress.
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {sim.state === "open" && sim.candidates > 0 && data.connected ? (
        <s-section heading="Check the candidates">
          <CandidateDownload simulationId={sim.id} parts={sim.csvParts} />
        </s-section>
      ) : null}

      {actionable ? (
        <s-section heading="Before you approve">
          <s-stack gap="base">
            <s-stack gap="small-200">
              <s-heading>What suppressing does</s-heading>
              <s-unordered-list>
                <s-list-item>
                  Suppressed profiles stop receiving marketing email and most flow email from Klaviyo (welcome, abandoned cart, win-back and
                  similar), even if they later purchase.
                </s-list-item>
                <s-list-item>Flows that Klaviyo treats as transactional still send. SMS and push are not changed.</s-list-item>
                <s-list-item>A person who subscribes again is unsuppressed by Klaviyo.</s-list-item>
                <s-list-item>
                  TierSaver's suppression is not an unsubscribe: it does not record an opt-out, and you remain responsible for honoring
                  unsubscribe requests.
                </s-list-item>
              </s-unordered-list>
              <s-link href={legal.articles.whatSuppressMeans} target="_blank">
                What suppressing means
              </s-link>
            </s-stack>

            <s-stack gap="small-200">
              <s-heading>Restoring</s-heading>
              <s-unordered-list>
                <s-list-item>Profiles are suppressed, never deleted. You can restore the profiles of a cleanup from its page in History.</s-list-item>
                <s-list-item>
                  A profile you restore is left out of TierSaver cleanups for {data.restoreLockDays} days. Klaviyo's help center also says that
                  unsuppressing a profile blocks suppressing it again for 90 days.
                </s-list-item>
              </s-unordered-list>
              <s-link href={legal.articles.undo} target="_blank">
                How restoring works
              </s-link>
            </s-stack>

            <s-stack gap="small-200">
              <s-heading>What you pay</s-heading>
              {planLine && plan.required ? (
                <s-unordered-list>
                  <s-list-item>
                    <s-text type="strong">{planLine}</s-text>
                  </s-list-item>
                  {needsPlan ? (
                    <s-list-item>
                      {plan.standing === "none"
                        ? `The plan starts when you approve it on Shopify's screen, right after you approve this cleanup. From then on Shopify charges it every ${plan.intervalDays} days, whether or not a cleanup runs that month.`
                        : "Shopify asks you to approve the new price right after you approve this cleanup, and applies it from that moment, adjusting the current period for the difference."}
                    </s-list-item>
                  ) : null}
                  {plan.standing === "none" ? (
                    <s-list-item>You can cancel the plan at any time in Settings. Uninstalling the app also cancels it.</s-list-item>
                  ) : null}
                  {plan.standing === "frozen" ? (
                    <s-list-item>
                      Your plan is on hold in Shopify because of a billing issue with your store. You can approve this cleanup, but it can
                      only start once Shopify reactivates the plan.
                    </s-list-item>
                  ) : null}
                  {plan.standing === "unknown" ? (
                    <s-list-item>Shopify could not be asked about your plan just now. Reload the page to see how your plan stands.</s-list-item>
                  ) : null}
                  {plan.developmentStore && needsPlan ? (
                    <s-list-item>This is a development store: Shopify creates a test charge and never bills it.</s-list-item>
                  ) : null}
                  <s-list-item>The audit and the simulation are always free.</s-list-item>
                </s-unordered-list>
              ) : (
                <s-paragraph>
                  TierSaver is not sold automatically for lists above {plan.largestTier} active profiles, so this cleanup cannot be approved
                  here. Write to{" "}
                  <s-link href={legal.sales} target="_blank">
                    {legal.salesEmail}
                  </s-link>
                  .
                </s-paragraph>
              )}
              {lowerPlanOffer}
              <s-link href={legal.articles.pricing} target="_blank">
                How pricing works
              </s-link>
            </s-stack>

            <s-text color="subdued">
              Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo. TierSaver is not affiliated with or
              endorsed by Klaviyo.
            </s-text>

            {sim.state === "open" && plan.required ? (
              <Form method="post" preventScrollReset>
                <input type="hidden" name="intent" value="approve" />
                <input type="hidden" name="simulationId" value={sim.id} />
                <s-stack gap="base">
                  <s-checkbox
                    name="acknowledged"
                    value="yes"
                    label={`I have read the notices above, I accept the TierSaver Terms of Service, and I approve suppressing these ${number(sim.candidates)} profiles in Klaviyo.`}
                    error={notAcknowledged ? ERRORS.not_acknowledged : undefined}
                    {...errorFocus(notAcknowledged)}
                  />
                  <s-text color="subdued">
                    Read the{" "}
                    <s-link href={legal.terms} target="_blank">
                      Terms of Service
                    </s-link>{" "}
                    and the{" "}
                    <s-link href={legal.privacy} target="_blank">
                      Privacy Policy
                    </s-link>
                    . Approving does not suppress anything yet:{" "}
                    {needsPlan ? "Shopify asks you to approve the plan, and then you start the cleanup." : "you start the cleanup in the next step."}
                  </s-text>
                  <div>
                    <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.connected, loading: submitting("approve") })}>
                      {approveLabel}
                    </s-button>
                  </div>
                </s-stack>
              </Form>
            ) : null}

            {sim.state === "approved" ? (
              <s-stack gap="base">
                <s-banner tone="success">
                  Approved{" "}
                  {sim.approvedAt ? (
                    <>
                      <Time at={sim.approvedAt} />
                    </>
                  ) : null}
                  . Nothing has been suppressed yet.
                </s-banner>
                {!data.cleanupsEnabled ? (
                  <s-text>
                    Cleanups are not switched on yet: this installation can audit and simulate, but it cannot suppress profiles until cleanups are
                    switched on.
                  </s-text>
                ) : null}
                {needsPlan && plan.required ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="plan" />
                    <input type="hidden" name="simulationId" value={sim.id} />
                    <s-stack gap="base">
                      <s-paragraph>
                        {plan.standing === "none"
                          ? `This cleanup needs an active TierSaver plan: ${plan.required.terms} Shopify asks you to approve it; nothing is charged if you decline there, and the cleanup does not start.`
                          : `This cleanup needs the plan for your list size: ${plan.required.terms} You pay ${plan.current?.price ?? "less"} today. Shopify asks you to approve the new price; if you decline there, your plan stays as it is and the cleanup does not start.`}
                      </s-paragraph>
                      <div>
                        <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.connected, loading: submitting("plan") })}>
                          {plan.standing === "none" ? `Start plan (${plan.required.price})` : `Change plan (${plan.required.price})`}
                        </s-button>
                      </div>
                    </s-stack>
                  </Form>
                ) : null}
                {plan.standing === "frozen" ? (
                  <s-text>
                    Your TierSaver plan is on hold in Shopify because of a billing issue with your store. The cleanup can start once Shopify
                    reactivates the plan.
                  </s-text>
                ) : null}
                {plan.standing === "covers" || plan.standing === "higher" || plan.standing === "unknown" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="simulationId" value={sim.id} />
                    <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.cleanupsEnabled || !data.connected, loading: submitting("start") })}>
                      Start cleanup: suppress {number(sim.candidates)} profiles
                    </s-button>
                  </Form>
                ) : null}
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
