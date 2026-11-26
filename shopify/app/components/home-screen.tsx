import type { ReactNode } from "react";

/**
 * The home screen, as a pure function of its data: no loaders, no router.
 * The route passes the forms in (`renderForm`), so the same component renders
 * in the app and in the local preview (scripts/preview-ui.tsx).
 */

export type Notice = "connected" | "declined" | "failed" | "disconnected" | null;

export interface HomeView {
  notice: Notice;
  /** False while the deployment has no Klaviyo OAuth credentials. */
  configured: boolean;
  startUrl: string | null;
  connection: { status: "connected" | "needs_reauth" | "disconnected"; klaviyoAccountId: string; connectedAt: string } | null;
  scan: { status: "queued" | "running" | "completed" | "failed"; error: string | null; membersRead: number } | null;
  result: {
    finishedAt: string;
    activeProfiles: number;
    activeProfilesSource: string | null;
    matchingKlaviyoCriteria: number;
    candidates: number;
    keptActive: { label: string; count: number }[];
    note: string | null;
    price: string | null;
    seededTestAccount: boolean;
    resurfaced: number;
  } | null;
  /** The latest simulation, as the merchant has to deal with it. */
  simulation: { state: "open" | "approved" | "expired" | "superseded" | "executed"; candidates: number; expiresAt: string } | null;
  lastCleanup: { id: string; status: string; finishedAt: string | null; submitted: number; restored: boolean } | null;
  schedule: { enabled: boolean; automatic: boolean; nextAuditOn: string | null };
}

const NOTICES: Record<Exclude<Notice, null>, { tone: "success" | "warning" | "info"; text: string }> = {
  connected: { tone: "success", text: "Klaviyo is connected. Nothing has changed in your Klaviyo account." },
  declined: { tone: "info", text: "Klaviyo was not connected because the request was declined on Klaviyo." },
  failed: { tone: "warning", text: "Klaviyo could not be connected. Please try again." },
  disconnected: { tone: "info", text: "Klaviyo is disconnected. TierSaver no longer has access to your Klaviyo account." },
};

const SCAN_ERRORS: Record<string, string> = {
  klaviyo_needs_reauth: "TierSaver's access to Klaviyo has ended. Reconnect Klaviyo and run the audit again.",
  candidate_segment_changed: "The TierSaver segment in Klaviyo was edited while the audit was running. Run the audit again.",
  candidate_segment_unusable: "The TierSaver segment in Klaviyo was deactivated or edited. Run the audit again to restore it.",
  candidate_segment_still_processing: "Klaviyo is still preparing the data. Run the audit again in a few minutes.",
  too_many_segment_members: "This list is larger than the audit can read right now. Contact support and we will sort it out.",
};

const number = (n: number) => n.toLocaleString("en-US");
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Boolean attributes for Polaris web components. React 18 writes `false` on a
 * custom element as the string "false", which some components read as set
 * (seen with `loading`): only the flags that are on are passed.
 */
export function flags<T extends Record<string, boolean | null | undefined>>(values: T): { [K in keyof T]?: true } {
  const out: { [K in keyof T]?: true } = {};
  for (const key of Object.keys(values) as (keyof T)[]) if (values[key]) out[key] = true;
  return out;
}

/** One big number with its caption. */
export function Metric({ value, label, detail, emphasis }: { value: string; label: string; detail?: string; emphasis?: boolean }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background={emphasis ? "subdued" : "transparent"}>
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <span style={{ fontSize: "1.75rem", fontWeight: 650, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {detail ? <s-text color="subdued">{detail}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

type StepState = "done" | "current" | "todo";

function Step({ index, state, title, children, action }: { index: number; state: StepState; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background={state === "current" ? "subdued" : "transparent"}>
      <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
        {state === "done" ? <s-icon type="check-circle-filled" tone="success" /> : <s-badge tone={state === "current" ? "info" : "neutral"}>{String(index)}</s-badge>}
        <s-stack gap="small-300">
          <s-heading>{title}</s-heading>
          {children ? <s-text color="subdued">{children}</s-text> : null}
        </s-stack>
        <div>{action ?? null}</div>
      </s-grid>
    </s-box>
  );
}

export function HomeScreen({
  view,
  busy,
  renderForm,
}: {
  view: HomeView;
  busy: boolean;
  /** Wraps a submit button in the form that posts `intent` to the home route. */
  renderForm: (intent: "scan" | "disconnect", button: ReactNode) => ReactNode;
}) {
  const { connection, result, scan, simulation, lastCleanup, schedule } = view;
  const connected = connection?.status === "connected";
  const scanning = scan?.status === "queued" || scan?.status === "running";
  const audited = Boolean(result);
  const pending = simulation && (simulation.state === "open" || simulation.state === "approved") && simulation.candidates > 0 ? simulation : null;
  const cleaned = Boolean(lastCleanup && lastCleanup.submitted > 0);

  const connectButton = view.startUrl ? (
    <s-button variant="primary" href={view.startUrl} target="_top">
      {connection ? "Reconnect Klaviyo" : "Connect Klaviyo"}
    </s-button>
  ) : null;
  const scanButton = (label: string, variant: "primary" | "secondary") =>
    renderForm(
      "scan",
      <s-button type="submit" variant={variant} {...flags({ disabled: busy || scanning, loading: scanning })}>
        {label}
      </s-button>,
    );

  const stepStates: StepState[] = (() => {
    const done = [connected, audited, simulation?.state === "approved" || simulation?.state === "executed" || cleaned, cleaned];
    const first = done.findIndex((d) => !d);
    return done.map((d, i) => (d ? "done" : i === first ? "current" : "todo"));
  })();

  return (
    <s-page heading="TierSaver">
      {view.notice ? <s-banner tone={NOTICES[view.notice].tone}>{NOTICES[view.notice].text}</s-banner> : null}
      {connection && !connected ? (
        <s-banner tone="warning" heading="Reconnect Klaviyo">
          TierSaver's access to Klaviyo account {connection.klaviyoAccountId} has ended or was removed in Klaviyo. Cleanups are paused until
          you connect again.
        </s-banner>
      ) : null}
      {result && result.resurfaced > 0 ? (
        <s-banner tone="warning" heading="Profiles from an earlier cleanup are active again">
          {number(result.resurfaced)} profiles that a TierSaver cleanup suppressed have been unsuppressed in Klaviyo outside TierSaver. They
          were kept active and TierSaver will not suppress them again for 365 days. Your monthly schedule was paused; turn it back on in
          Settings once you have checked what happened.
        </s-banner>
      ) : null}
      {pending && connected ? (
        <s-banner tone="info" heading={pending.state === "approved" ? "Your approved cleanup is ready to start" : `${number(pending.candidates)} profiles are waiting for your review`}>
          <s-stack gap="base">
            <s-text>
              {pending.state === "approved" ? "Nothing has been suppressed yet." : "Nothing is suppressed until you approve."} This simulation can
              be used until {dateTime(pending.expiresAt)}.
            </s-text>
            <s-button href="/app/simulation" variant="primary">
              {pending.state === "approved" ? "Go to the cleanup" : "Review and approve"}
            </s-button>
          </s-stack>
        </s-banner>
      ) : null}

      {!cleaned || !connected ? (
        <s-section heading="Get started">
          <s-stack gap="small">
            <Step index={1} state={stepStates[0]!} title="Connect Klaviyo" action={!connected ? connectButton : null}>
              {connected
                ? `Connected to account ${connection!.klaviyoAccountId}.`
                : view.configured
                  ? "TierSaver reads your list to find profiles that never engaged. Nothing changes in Klaviyo until you approve a cleanup."
                  : "Connecting to Klaviyo is not available yet."}
            </Step>
            <Step
              index={2}
              state={stepStates[1]!}
              title="Run the free audit"
              action={connected && !audited ? scanButton("Run the free audit", "primary") : null}
            >
              {audited
                ? `Last run ${dateTime(result!.finishedAt)}.`
                : scanning
                  ? `Klaviyo is working through your list${scan!.membersRead > 0 ? ` (${number(scan!.membersRead)} profiles read so far)` : ""}. You can leave this page.`
                  : "Read-only. Counts the profiles that meet Klaviyo's own criteria for long-term inactive profiles."}
            </Step>
            <Step
              index={3}
              state={stepStates[2]!}
              title="Review and approve"
              action={pending?.state === "open" ? <s-button href="/app/simulation">Review</s-button> : null}
            >
              See exactly which profiles would be suppressed, download the list, and approve it yourself.
            </Step>
            <Step index={4} state={stepStates[3]!} title="Run the cleanup" action={pending?.state === "approved" ? <s-button href="/app/simulation">Start</s-button> : null}>
              Profiles are suppressed, never deleted, and every cleanup can be undone.
            </Step>
          </s-stack>
        </s-section>
      ) : null}

      {connected && (result || scan) ? (
        <s-section heading="Your list">
          <s-stack gap="base">
            {scanning && audited ? (
              <s-banner tone="info">
                A new audit is in progress{scan!.membersRead > 0 ? ` (${number(scan!.membersRead)} profiles read so far)` : ""}. The numbers below are from the
                previous one.
              </s-banner>
            ) : null}
            {scan?.status === "failed" ? (
              <s-banner tone="warning" heading="The last audit could not finish">
                {SCAN_ERRORS[scan.error ?? ""] ?? "Something went wrong while reading from Klaviyo. Nothing was changed. Please run the audit again."}
              </s-banner>
            ) : null}
            {result ? (
              <>
                {result.seededTestAccount ? <s-banner tone="info">Test account: this audit reads seeded sample data.</s-banner> : null}
                {result.note ? <s-banner tone="info">{result.note}</s-banner> : null}
                <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
                  <Metric
                    label="Active profiles"
                    value={number(result.activeProfiles)}
                    detail={result.activeProfilesSource === "klaviyo_usage" ? "Klaviyo's own count" : "Counted by TierSaver"}
                  />
                  <Metric label="Meet Klaviyo's inactive criteria" value={number(result.matchingKlaviyoCriteria)} detail="Never opened, clicked, visited or bought" />
                  <Metric label="A cleanup would suppress" value={number(result.candidates)} detail={`Leaves ${number(Math.max(0, result.activeProfiles - result.candidates))} active`} emphasis />
                </s-grid>
                {result.keptActive.length > 0 ? (
                  <s-stack gap="small-200">
                    <s-heading>Kept active even though they meet the criteria</s-heading>
                    {result.keptActive.map((row) => (
                      <s-stack key={row.label} direction="inline" justifyContent="space-between" gap="base">
                        <s-text color="subdued">{row.label}</s-text>
                        <s-text>{number(row.count)}</s-text>
                      </s-stack>
                    ))}
                    {result.keptActive.length > 1 ? <s-text color="subdued">A profile can be kept for more than one reason, so these can overlap.</s-text> : null}
                  </s-stack>
                ) : null}
                {result.candidates === 0 && !result.note ? (
                  <s-paragraph>Your list is already clean. No profiles match the cleanup criteria, so there is nothing to suppress and nothing to charge.</s-paragraph>
                ) : null}
                <s-stack direction="inline" gap="base" alignItems="center">
                  {scanButton("Run the audit again", "secondary")}
                  <s-text color="subdued">As of {dateTime(result.finishedAt)}</s-text>
                </s-stack>
              </>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {lastCleanup ? (
        <s-section heading="Last cleanup">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text>
              {lastCleanup.finishedAt ? `${dateTime(lastCleanup.finishedAt)}: ` : ""}
              {number(lastCleanup.submitted)} profiles suppressed{lastCleanup.restored ? ", restored later" : ""}.
            </s-text>
            <s-stack direction="inline" gap="base">
              <s-button href={`/app/runs/${lastCleanup.id}`}>Details</s-button>
              <s-button href="/app/runs" variant="tertiary">
                History
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Monthly schedule">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={schedule.enabled ? "success" : "neutral"}>{schedule.enabled ? "On" : "Off"}</s-badge>
            {schedule.enabled ? <s-text color="subdued">{schedule.automatic ? "Runs automatically" : "Waits for your approval"}</s-text> : null}
          </s-stack>
          <s-text color="subdued">
            {schedule.enabled
              ? schedule.nextAuditOn
                ? `Next audit on ${date(schedule.nextAuditOn)}, a few days before your Klaviyo plan renews.`
                : "Add your Klaviyo renewal day in Settings so the audit can be scheduled."
              : "Run the audit every month, a few days before your Klaviyo plan renews, so Klaviyo's count is up to date."}
          </s-text>
          <s-button href="/app/settings">Settings</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Pricing">
        <s-stack gap="small">
          <s-text>
            {result
              ? result.price
                ? `${result.price} per month for a list of this size.`
                : "Lists above 150,000 active profiles are priced by agreement."
              : "A flat monthly price by list size, from $15."}
          </s-text>
          <s-text color="subdued">Charged only in a month when a cleanup suppresses profiles. The audit is free.</s-text>
        </s-stack>
      </s-section>

      {connected ? (
        <s-section slot="aside" heading="Klaviyo connection">
          <s-stack gap="base">
            <s-text>
              Account <s-text type="strong">{connection!.klaviyoAccountId}</s-text>, connected {date(connection!.connectedAt)}.
            </s-text>
            <s-text color="subdued">Disconnecting removes TierSaver's access. Suppressed profiles stay suppressed and nothing is deleted.</s-text>
            {renderForm(
              "disconnect",
              <s-button type="submit" tone="critical" {...flags({ disabled: busy })}>
                Disconnect Klaviyo
              </s-button>,
            )}
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Good to know">
        <s-text color="subdued">
          Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, you can move to a lower plan in Klaviyo's
          billing settings. Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo. TierSaver is not
          affiliated with or endorsed by Klaviyo.
        </s-text>
      </s-section>
    </s-page>
  );
}
