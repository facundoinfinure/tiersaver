import { env } from "cloudflare:workers";
import { DEFAULT_FEE_POLICY, flatTierFor, formatUsd, RULE_LIMITS, SIMULATION_TTL_MS, type CandidateReason, type ProtectionReason } from "@tiersaver/core";
import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags, Metric } from "../components/home-screen";
import { downloadFile, errorFocus, number, Row, Time, useRevealError } from "../components/ui";
import { CAPPED_AMOUNT_CENTS, getBillingStatus, requestSubscription, subscriptionTerms } from "../billing/billing";
import { requestAdminGraphql } from "../billing/billing.server";
import { db } from "../db.server";
import { sessionActor } from "../data/events-log";
import { getConnection } from "../klaviyo/connection.server";
import { embeddedAppUrl } from "../klaviyo/flow.server";
import { legalUrls, TERMS_VERSION } from "../legal";
import { suppressionAllowed } from "../runs/gateway.server";
import { CHARGE_HOLD_HOURS } from "../runs/labels";
import { startScan } from "../scans/start.server";
import { shopTimeZone, stamp } from "../settings/timezone";
import { startSuppressionRun } from "../runs/start.server";
import type { ScanSummary } from "../scans/engine";
import { KEPT_LABELS } from "../scans/view.server";
import { approveSimulation, CANDIDATE_REASON_LABELS, CSV_PART_SIZE, latestSimulation } from "../simulations/review";
import { authenticate } from "../shopify.server";

const isSeededAccount = (klaviyoAccountId: string | null | undefined) =>
  Boolean(env.KLAVIYO_SEEDED_ACCOUNT_ID) && klaviyoAccountId === env.KLAVIYO_SEEDED_ACCOUNT_ID;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const [found, connection] = await Promise.all([latestSimulation(db, session.shop), getConnection(db, session.shop)]);
  if (!found) return { simulation: null, connected: connection?.status === "connected" };

  const { simulation, state } = found;
  const summary = simulation.summary as ScanSummary;
  const zone = await shopTimeZone(db, session.shop);
  const run =
    state === "executed"
      ? await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.simulationId, simulation.id), columns: { id: true, status: true, processedCount: true, finishedAt: true } })
      : null;
  // Billing is only asked about when it matters: an approved simulation about to be started.
  let subscribed: boolean | null = null;
  if (state === "approved") {
    try {
      subscribed = Boolean((await getBillingStatus(requestAdminGraphql(admin))).subscription);
    } catch {
      subscribed = null;
    }
  }
  const tier = flatTierFor(simulation.activeProfiles);
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
      price: tier ? formatUsd(tier.monthlyCents) : null,
      tierMaxProfiles: tier?.maxProfiles ?? null,
      wouldCharge: simulation.estimatedFeeCents > 0 ? formatUsd(simulation.estimatedFeeCents) : null,
      run: run ? { id: run.id, status: run.status, submitted: run.processedCount, finishedAt: run.finishedAt ? stamp(run.finishedAt, zone) : null } : null,
      seededTestAccount: summary.seededTestAccount === true,
    },
    subscribed,
    terms: subscriptionTerms(),
    // Every figure about the charge comes from the code that charges, never from this page.
    charge: {
      holdHours: CHARGE_HOLD_HOURS,
      cap: formatUsd(CAPPED_AMOUNT_CENTS),
      minDaysBetweenCharges: DEFAULT_FEE_POLICY.minDaysBetweenCharges,
      largestTier: number(Math.max(...DEFAULT_FEE_POLICY.tiers.map((t) => t.maxProfiles))),
    },
    restoreLockDays: RULE_LIMITS.reactivationLockDays.min,
    legal: legalUrls(env),
    cleanupsEnabled: suppressionAllowed(env, connection?.klaviyoAccountId),
    // The seeded test account can run without a Shopify subscription, so the flow can be tried before billing is set up.
    billingOptional: isSeededAccount(connection?.klaviyoAccountId),
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
  billing_required: "Accept the TierSaver pricing in Shopify before starting the cleanup.",
  billing_unavailable: "Shopify billing could not be reached. Nothing was changed. Please try again.",
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

  if (intent === "approve") {
    const result = await approveSimulation(db, { shop: session.shop, simulationId, approvedBy: actor, acknowledged: form.get("acknowledged") === "yes", termsVersion: TERMS_VERSION });
    return result.ok ? redirect("/app/simulation") : { error: result.reason };
  }

  if (intent === "subscribe") {
    try {
      const graphql = requestAdminGraphql(admin);
      const billing = await getBillingStatus(graphql);
      if (billing.subscription) return redirect("/app/simulation");
      const requested = await requestSubscription(graphql, {
        returnUrl: embeddedAppUrl(env, session.shop, "/app/simulation"),
        // Development stores cannot be charged: Shopify only accepts test subscriptions there.
        test: billing.developmentStore,
      });
      if (!requested.ok) return { error: "billing_unavailable" };
      return redirect(requested.confirmationUrl, { target: "_top" });
    } catch (error) {
      if (error instanceof Response) throw error;
      return { error: "billing_unavailable" };
    }
  }

  if (intent === "start") {
    // Checked before the simulation is consumed: a refused start must leave it approved and usable.
    const connection = await getConnection(db, session.shop);
    if (connection?.status !== "connected") return { error: "klaviyo_not_connected" };
    if (!suppressionAllowed(env, connection.klaviyoAccountId)) return { error: "cleanups_not_enabled" };
    if (!isSeededAccount(connection.klaviyoAccountId)) {
      try {
        if (!(await getBillingStatus(requestAdminGraphql(admin))).subscription) return { error: "billing_required" };
      } catch {
        return { error: "billing_unavailable" };
      }
    }
    const started = await startSuppressionRun({ shop: session.shop, simulationId, createdBy: actor });
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

  if (!sim || !("charge" in data)) {
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

  const { charge, legal } = data;
  const stale = sim.state === "expired" || sim.state === "superseded";
  const actionable = sim.candidates > 0 && !stale && sim.state !== "executed";
  const notAcknowledged = result?.error === "not_acknowledged";
  const keptTotal = Math.max(0, sim.evaluated - sim.candidates - sim.leftOut);
  const priceLine = sim.price
    ? sim.wouldCharge
      ? `${sim.wouldCharge} for this cleanup: the monthly price for lists up to ${number(sim.tierMaxProfiles ?? 0)} active profiles.`
      : `This cleanup would not be charged, because a cleanup was already charged in the last ${charge.minDaysBetweenCharges} days. The monthly price for a list of this size is ${sim.price}.`
    : null;

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
                label="TierSaver price for this cleanup"
                value={sim.price ? (sim.wouldCharge ?? "$0") : "By agreement"}
                detail={sim.price ? (sim.wouldCharge ? `Charged through Shopify ${charge.holdHours} hours after the cleanup` : `Already charged in the last ${charge.minDaysBetweenCharges} days`) : "Nothing is charged automatically"}
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
              suppress and nothing to charge.
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
              {priceLine ? (
                <s-unordered-list>
                  <s-list-item>
                    <s-text type="strong">{priceLine}</s-text>
                  </s-list-item>
                  <s-list-item>
                    It is charged through Shopify {charge.holdHours} hours after the cleanup finishes, once Klaviyo has confirmed it.
                  </s-list-item>
                  <s-list-item>
                    If you restore the whole cleanup within those {charge.holdHours} hours, it is not charged. Restoring later, or restoring only
                    part of it, does not refund the charge.
                  </s-list-item>
                  <s-list-item>At most one charge every {charge.minDaysBetweenCharges} days. The audit is free.</s-list-item>
                  <s-list-item>
                    Shopify's approval screen shows a maximum of {charge.cap} per 30 days. That is the price for the largest list size (up to{" "}
                    {charge.largestTier} active profiles); the price for your list is the one shown here.
                  </s-list-item>
                </s-unordered-list>
              ) : (
                <s-paragraph>
                  Lists above {charge.largestTier} active profiles are priced by agreement, and nothing is charged automatically. Write to{" "}
                  <s-link href={legal.sales} target="_blank">
                    {legal.salesEmail}
                  </s-link>{" "}
                  to agree a price before your first cleanup.
                </s-paragraph>
              )}
              <s-link href={legal.articles.pricing} target="_blank">
                How pricing works
              </s-link>
            </s-stack>

            <s-text color="subdued">
              Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo. TierSaver is not affiliated with or
              endorsed by Klaviyo.
            </s-text>

            {sim.state === "open" ? (
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
                    . Approving does not suppress anything yet: you start the cleanup in the next step.
                  </s-text>
                  <div>
                    <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.connected, loading: submitting("approve") })}>
                      Approve this cleanup
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
                {data.subscribed === false ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <s-stack gap="base">
                      <s-paragraph>
                        Before the first cleanup, Shopify asks you to accept TierSaver's pricing. {data.terms} Shopify's screen shows a maximum of{" "}
                        {charge.cap} per 30 days: that is the price for the largest list size, not yours.
                        {sim.price ? ` The price for your list is ${sim.price}.` : ""} Accepting does not charge anything by itself.
                      </s-paragraph>
                      <div>
                        <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.connected, loading: submitting("subscribe") })}>
                          Review pricing in Shopify
                        </s-button>
                      </div>
                    </s-stack>
                  </Form>
                ) : null}
                {data.subscribed !== false || data.billingOptional ? (
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
