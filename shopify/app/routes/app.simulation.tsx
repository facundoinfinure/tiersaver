import { env } from "cloudflare:workers";
import { flatTierFor, formatUsd, SIMULATION_TTL_MS, type CandidateReason, type ProtectionReason } from "@tiersaver/core";
import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags, Metric } from "../components/home-screen";
import { getBillingStatus, requestSubscription, subscriptionTerms } from "../billing/billing";
import { requestAdminGraphql } from "../billing/billing.server";
import { db } from "../db.server";
import { sessionActor } from "../data/events-log";
import { getConnection } from "../klaviyo/connection.server";
import { embeddedAppUrl } from "../klaviyo/flow.server";
import { suppressionAllowed } from "../runs/gateway.server";
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
  const run = state === "executed" ? await db.query.runs.findFirst({ where: (r, { eq }) => eq(r.simulationId, simulation.id), columns: { id: true } }) : null;
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
      createdAt: simulation.createdAt.toISOString(),
      expiresAt: new Date(simulation.createdAt.getTime() + SIMULATION_TTL_MS).toISOString(),
      approvedAt: simulation.approvedAt?.toISOString() ?? null,
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
      alreadySuppressed: summary.skippedByReason?.already_suppressed ?? 0,
      csvParts: Math.max(1, Math.ceil(simulation.candidateCount / CSV_PART_SIZE)),
      price: tier ? formatUsd(tier.monthlyCents) : null,
      wouldCharge: simulation.estimatedFeeCents > 0 ? formatUsd(simulation.estimatedFeeCents) : null,
      runId: run?.id ?? null,
      seededTestAccount: summary.seededTestAccount === true,
    },
    subscribed,
    terms: subscriptionTerms(),
    cleanupsEnabled: suppressionAllowed(env, connection?.klaviyoAccountId),
    // The seeded test account can run without a Shopify subscription, so the flow can be tried before billing is set up.
    billingOptional: isSeededAccount(connection?.klaviyoAccountId),
  };
};

const ERRORS: Record<string, string> = {
  not_acknowledged: "Tick the box to confirm you have read the notices before approving.",
  approver_unknown: "We could not identify your Shopify user. Reload the page and try again.",
  no_candidates: "This simulation has no profiles to suppress, so there is nothing to approve.",
  already_approved: "This simulation is already approved.",
  expired: "This simulation is more than 24 hours old. Run the audit again to get a current one.",
  superseded: "Your rules changed or a newer audit replaced this simulation. Run the audit again.",
  executed: "This simulation was already used for a cleanup.",
  already_executed: "This simulation was already used for a cleanup.",
  not_approved: "Approve the simulation before starting the cleanup.",
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

  if (intent === "approve") {
    const result = await approveSimulation(db, { shop: session.shop, simulationId, approvedBy: actor, acknowledged: form.get("acknowledged") === "yes" });
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

const number = (n: number) => n.toLocaleString("en-US");
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function CandidateDownload({ simulationId, parts }: { simulationId: string; parts: number }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const download = async (part: number) => {
    setBusy(part);
    setFailed(false);
    try {
      // App Bridge adds the session token to same-origin fetch calls.
      const response = await fetch(`/app/simulation/candidates?id=${encodeURIComponent(simulationId)}&part=${part}`);
      if (!response.ok) throw new Error("download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `tiersaver-candidates-${part}-of-${parts}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
        {parts > 1 ? ` The list comes in ${parts} files of up to ${number(CSV_PART_SIZE)} profiles.` : ""}
      </s-paragraph>
      <s-stack direction="inline" gap="base">
        {Array.from({ length: Math.min(parts, 40) }, (_, i) => i + 1).map((part) => (
          <s-button key={part} variant="secondary" {...flags({ disabled: busy !== null, loading: busy === part })} onClick={() => download(part)}>
            {parts > 1 ? `Download file ${part}` : "Download candidates (CSV)"}
          </s-button>
        ))}
      </s-stack>
      {failed ? <s-banner tone="warning">The file could not be prepared. Please try again.</s-banner> : null}
    </s-stack>
  );
}

export default function Simulation() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  const sim = data.simulation;

  if (!sim) {
    return (
      <s-page heading="Review cleanup">
        <s-section heading="No simulation yet">
          <s-paragraph>
            {data.connected
              ? "Run the free audit from the home page. It produces the simulation you review here; nothing is suppressed until you approve it."
              : "Connect Klaviyo and run the free audit from the home page first."}
          </s-paragraph>
          <s-button href="/app">Go to home</s-button>
        </s-section>
      </s-page>
    );
  }

  const stale = sim.state === "expired" || sim.state === "superseded";
  return (
    <s-page heading="Review cleanup">
      {result?.error ? <s-banner tone="warning">{ERRORS[result.error] ?? "That did not work. Nothing was changed. Please try again."}</s-banner> : null}
      {sim.seededTestAccount ? <s-banner tone="info">Test account: this simulation reads seeded sample data.</s-banner> : null}
      {sim.state === "expired" ? (
        <s-banner tone="warning" heading="This simulation has expired">
          A simulation can be approved and run for 24 hours, so a cleanup always uses current data. Run the audit again from the home page.
        </s-banner>
      ) : null}
      {sim.state === "superseded" ? (
        <s-banner tone="warning" heading="This simulation is out of date">
          Your rules or protected lists changed after it was computed. Run the audit again from the home page.
        </s-banner>
      ) : null}
      {sim.state === "executed" ? (
        <s-banner tone="info" heading="This simulation was used for a cleanup">
          {sim.runId ? <s-link href={`/app/runs/${sim.runId}`}>See the cleanup</s-link> : null}
        </s-banner>
      ) : null}

      <s-section heading="Simulation">
        <s-stack gap="base">
          <s-paragraph>
            Computed {dateTime(sim.createdAt)}
            {sim.origin === "scheduled" ? " by your monthly schedule" : ""}.{sim.state === "executed" ? "" : " Nothing has changed in Klaviyo."}
            {sim.state === "open" || sim.state === "approved" ? ` It can be approved and run until ${dateTime(sim.expiresAt)}.` : ""}
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <Metric label="Active profiles now" value={number(sim.activeProfiles)} />
            <Metric label="This cleanup would suppress" value={number(sim.candidates)} detail={sim.candidatesByReason.map((r) => r.label).join("; ") || undefined} emphasis />
            <Metric label="Active profiles after" value={number(Math.max(0, sim.activeProfiles - sim.candidates))} />
          </s-grid>
          <s-stack gap="small-200">
            <s-stack direction="inline" justifyContent="space-between" gap="base">
              <s-text color="subdued">Meet Klaviyo's long-term inactive criteria</s-text>
              <s-text>{number(sim.evaluated)}</s-text>
            </s-stack>
            {sim.keptActive.map((row) => (
              <s-stack key={row.label} direction="inline" justifyContent="space-between" gap="base">
                <s-text color="subdued">Kept active: {row.label.charAt(0).toLowerCase() + row.label.slice(1)}</s-text>
                <s-text>{number(row.count)}</s-text>
              </s-stack>
            ))}
            <s-stack direction="inline" justifyContent="space-between" gap="base">
              <s-text type="strong">Would be suppressed</s-text>
              <s-text type="strong">{number(sim.candidates)}</s-text>
            </s-stack>
          </s-stack>
          {sim.keptActive.length > 1 ? (
            <s-paragraph>A profile can be kept active for more than one reason, so those rows can overlap.</s-paragraph>
          ) : null}
          {sim.candidates === 0 ? (
            <s-paragraph>No profiles match the cleanup criteria, so there is nothing to suppress and nothing to charge.</s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {sim.state === "open" && sim.candidates > 0 ? (
        <s-section heading="Check the candidates">
          <CandidateDownload simulationId={sim.id} parts={sim.csvParts} />
        </s-section>
      ) : null}

      {sim.candidates > 0 && !stale && sim.state !== "executed" ? (
        <s-section heading="Before you approve">
          <s-stack gap="base">
            <s-unordered-list>
              <s-list-item>Suppressed profiles can no longer receive marketing email from you, even if they later buy.</s-list-item>
              <s-list-item>Profiles are suppressed, never deleted. You can undo a cleanup from its page in History.</s-list-item>
              <s-list-item>
                A profile you restore is left out of TierSaver cleanups for 365 days. Klaviyo's help center also says that
                unsuppressing a profile blocks suppressing it again for 90 days.
              </s-list-item>
              <s-list-item>Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo.</s-list-item>
              <s-list-item>TierSaver is not affiliated with or endorsed by Klaviyo.</s-list-item>
            </s-unordered-list>
            <s-paragraph>
              {sim.price
                ? sim.wouldCharge
                  ? `Price: ${sim.wouldCharge} for this cleanup (${sim.price} per month for a list of this size, charged only in a month when a cleanup suppresses profiles).`
                  : `Price: this cleanup would not be charged, because a cleanup was already charged in the last 28 days. The monthly price for a list of this size is ${sim.price}.`
                : "Lists above 150,000 active profiles are priced by agreement. Nothing is charged automatically."}
            </s-paragraph>

            {sim.state === "open" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <input type="hidden" name="simulationId" value={sim.id} />
                <s-stack gap="base">
                  <s-checkbox
                    name="acknowledged"
                    value="yes"
                    label={`I have read the notices above and I approve suppressing these ${number(sim.candidates)} profiles in Klaviyo.`}
                  />
                  <s-button type="submit" variant="primary" {...flags({ disabled: busy })}>
                    Approve simulation
                  </s-button>
                </s-stack>
              </Form>
            ) : null}

            {sim.state === "approved" ? (
              <s-stack gap="base">
                <s-banner tone="success">
                  Approved {sim.approvedAt ? dateTime(sim.approvedAt) : ""}. Nothing has been suppressed yet.
                </s-banner>
                {!data.cleanupsEnabled ? (
                  <s-banner tone="info" heading="Cleanups are not switched on yet">
                    This installation can audit and simulate, but it cannot suppress profiles until cleanups are switched on.
                  </s-banner>
                ) : null}
                {data.subscribed === false ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <s-stack gap="base">
                      <s-paragraph>
                        Before the first cleanup, Shopify asks you to accept TierSaver's pricing. {data.terms} Accepting
                        does not charge anything by itself.
                      </s-paragraph>
                      <s-button type="submit" variant="primary" {...flags({ disabled: busy })}>
                        Review pricing in Shopify
                      </s-button>
                    </s-stack>
                  </Form>
                ) : null}
                {data.subscribed !== false || data.billingOptional ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="start" />
                    <input type="hidden" name="simulationId" value={sim.id} />
                    <s-button type="submit" variant="primary" {...flags({ disabled: busy || !data.cleanupsEnabled })}>
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
