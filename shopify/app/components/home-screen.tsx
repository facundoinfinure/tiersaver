import type { ReactNode } from "react";
import { STATUS_LABELS } from "../runs/labels";
import type { Stamp } from "../settings/timezone";
import { number, Row, Time } from "./ui";

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
  connection: { status: "connected" | "needs_reauth" | "disconnected"; klaviyoAccountId: string; connectedOn: Stamp } | null;
  scan: { status: "queued" | "running" | "completed" | "failed"; error: string | null; membersRead: number } | null;
  result: {
    finishedAt: Stamp;
    activeProfiles: number;
    activeProfilesSource: string | null;
    matchingKlaviyoCriteria: number;
    candidates: number;
    keptActive: { label: string; count: number }[];
    note: string | null;
    price: string | null;
    seededTestAccount: boolean;
    resurfaced: number;
    /** Meet the criteria but were restored in the last 365 days. */
    restoreLocked: number;
    /** Kept active only because the Shopify order history could not vouch for them. */
    unverifiedPurchases: number;
    purchaseDataStale: boolean;
  } | null;
  /**
   * How much of the shop's Shopify order history TierSaver holds: "loading" while the first read
   * has not finished, "partial" when Shopify has not shared the whole history, "complete" otherwise.
   */
  orderHistory: "loading" | "partial" | "complete";
  /** The latest simulation, as the merchant has to deal with it. */
  simulation: { state: "open" | "approved" | "expired" | "superseded" | "executed"; candidates: number; expiresAt: Stamp } | null;
  /** The latest cleanup (never a restore), whatever its state. */
  lastCleanup: { id: string; status: string; error: string | null; finishedAt: Stamp | null; total: number; submitted: number; restored: boolean } | null;
  /** `nextAuditOn` is a calendar day, already formatted. */
  schedule: { enabled: boolean; automatic: boolean; nextAuditOn: string | null };
  links: { help: string; support: string; supportEmail: string; sales: string; salesEmail: string; schedule: string; pricing: string };
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
  too_many_segment_members: "This list is larger than the audit can read right now. Write to support and we will sort it out.",
};

/** Why a cleanup did not run, in the merchant's words. Same codes as the cleanup page (app/routes/app.runs.$runId.tsx). */
const CLEANUP_ERRORS: Record<string, string> = {
  suppression_disabled: "Cleanups are not switched on for this installation.",
  suppression_not_allowed_for_account: "Cleanups are not switched on for this Klaviyo account.",
  klaviyo_needs_reauth: "TierSaver's access to Klaviyo ended before the cleanup could run.",
  klaviyo_not_connected: "Klaviyo was not connected when the cleanup started.",
  klaviyo_disconnected: "Klaviyo was disconnected before the cleanup could run.",
  simulation_expired: "The simulation was more than 24 hours old when the cleanup started.",
  simulation_superseded: "Your rules changed after the simulation was approved.",
};

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
      <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="start">
        {state === "done" ? <s-icon type="check-circle-filled" tone="success" /> : <s-badge tone={state === "current" ? "info" : "neutral"}>{String(index)}</s-badge>}
        <s-stack gap="small">
          <s-stack gap="small-300">
            <s-heading>{title}</s-heading>
            {children ? <s-text color="subdued">{children}</s-text> : null}
          </s-stack>
          {action ? <div>{action}</div> : null}
        </s-stack>
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
  /** Wraps its content (a submit button, or a dialog that holds one) in the form that posts `intent` to the home route. */
  renderForm: (intent: "scan" | "disconnect", content: ReactNode) => ReactNode;
}) {
  const { connection, result, scan, simulation, lastCleanup, schedule, links } = view;
  const connected = connection?.status === "connected";
  const scanning = scan?.status === "queued" || scan?.status === "running";
  const audited = Boolean(result);
  const pending = connected && simulation && (simulation.state === "open" || simulation.state === "approved") && simulation.candidates > 0 ? simulation : null;
  const expired = connected && simulation?.state === "expired" && simulation.candidates > 0 ? simulation : null;
  const cleaned = Boolean(lastCleanup && lastCleanup.submitted > 0);
  const cleanupActive = lastCleanup && (lastCleanup.status === "queued" || lastCleanup.status === "running") ? lastCleanup : null;
  // A cleanup that did not run is only news until the merchant audits again.
  const cleanupFailed = lastCleanup?.status === "failed" && simulation?.state === "executed" ? lastCleanup : null;
  const historyPending = Boolean(result && result.unverifiedPurchases > 0 && view.orderHistory !== "complete");

  // After a disconnect, or when access was lost, the way back is a banner with the button in it.
  const connectionBanner = !connected && (Boolean(connection) || cleaned || view.notice === "disconnected");

  const connectButton = view.startUrl ? (
    <s-button variant="primary" href={view.startUrl} target="_top">
      {connectionBanner ? "Reconnect Klaviyo" : "Connect Klaviyo"}
    </s-button>
  ) : null;
  const scanButton = (label: string, variant: "primary" | "secondary") =>
    renderForm(
      "scan",
      <s-button type="submit" variant={variant} {...flags({ disabled: busy || scanning })}>
        {scanning ? "Auditing…" : label}
      </s-button>,
    );

  // Each step is done only when the ones before it are: a lost connection puts the merchant back on step 1.
  const stepStates: StepState[] = (() => {
    const reached = [connected, audited, Boolean(pending?.state === "approved" || cleanupActive || cleaned), cleaned];
    let open = true;
    const done = reached.map((d) => (open = open && d));
    let first = done.findIndex((d) => !d);
    // Nothing to review (expired, out of date, used, or no candidates): the next action is a new audit, on step 2.
    if (first === 2 && !pending) first = 1;
    return done.map((d, i) => (i === first ? "current" : d && (first === -1 || i < first) ? "done" : "todo"));
  })();
  const needsNewAudit = connected && audited && !pending && !scanning && !cleanupActive;

  // One page-level banner at a time, most urgent first.
  const banner: ReactNode = (() => {
    if (connectionBanner) {
      const lost = connection?.status === "needs_reauth";
      return (
        <s-banner tone={lost ? "warning" : "info"} heading={lost ? "Reconnect Klaviyo" : "Klaviyo is not connected"}>
          <s-stack gap="base">
            <s-text>
              {view.notice === "failed" || view.notice === "declined" ? `${NOTICES[view.notice].text} ` : ""}
              {lost
                ? `TierSaver's access to Klaviyo account ${connection!.klaviyoAccountId} has ended or was removed in Klaviyo.`
                : "TierSaver no longer has access to your Klaviyo account."}{" "}
              Audits and cleanups are paused until you connect again. Suppressed profiles stay suppressed.
            </s-text>
            {connectButton}
          </s-stack>
        </s-banner>
      );
    }
    if (cleanupFailed) {
      return (
        <s-banner tone="critical" heading="Your last cleanup did not run">
          <s-stack gap="base">
            <s-text>
              {CLEANUP_ERRORS[cleanupFailed.error ?? ""] ?? "Something went wrong while talking to Klaviyo."}{" "}
              {cleanupFailed.submitted > 0
                ? `It stopped after ${number(cleanupFailed.submitted)} of ${number(cleanupFailed.total)} profiles. The rest were left untouched.`
                : "No profiles were suppressed and nothing is charged."}{" "}
              Run the audit again to get a current simulation, then approve it to try again.
            </s-text>
            <s-stack direction="inline" gap="base">
              {scanButton("Run the audit again", "primary")}
              <s-button href={`/app/runs/${cleanupFailed.id}`}>View the cleanup</s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      );
    }
    if (cleanupActive) {
      return (
        <s-banner tone="info" heading="A cleanup is in progress">
          <s-stack gap="base">
            <s-text>
              {number(cleanupActive.submitted)} of {number(cleanupActive.total)} profiles sent to Klaviyo so far. It keeps going if you leave this page.
            </s-text>
            <s-button href={`/app/runs/${cleanupActive.id}`} variant="primary">
              View progress
            </s-button>
          </s-stack>
        </s-banner>
      );
    }
    if (result && result.resurfaced > 0) {
      return (
        <s-banner tone="warning" heading="Profiles from an earlier cleanup are active again">
          {number(result.resurfaced)} profiles that a TierSaver cleanup suppressed have been unsuppressed in Klaviyo outside TierSaver. They
          were kept active and TierSaver will not suppress them again for 365 days. Your monthly schedule was paused; turn it back on in
          Settings once you have checked what happened.
        </s-banner>
      );
    }
    if (view.notice) return <s-banner tone={NOTICES[view.notice].tone}>{NOTICES[view.notice].text}</s-banner>;
    if (expired && !scanning) {
      return (
        <s-banner tone="warning" heading="Your last simulation expired">
          <s-stack gap="base">
            <s-text>
              A simulation can be approved for 24 hours, so a cleanup always uses current data. This one expired on <Time at={expired.expiresAt} />.
              Nothing was suppressed. Run the audit again to get a current one.
            </s-text>
            {scanButton("Run the audit again", "primary")}
          </s-stack>
        </s-banner>
      );
    }
    if (pending) {
      return (
        <s-banner tone="info" heading={pending.state === "approved" ? "Your approved cleanup is ready to start" : `${number(pending.candidates)} profiles are waiting for your review`}>
          <s-stack gap="base">
            <s-text>
              {pending.state === "approved" ? "Nothing has been suppressed yet." : "Nothing is suppressed until you approve."} This simulation can
              be used until <Time at={pending.expiresAt} />.
            </s-text>
            <s-button href="/app/simulation" variant="primary">
              {pending.state === "approved" ? "Go to the cleanup" : "Review and approve"}
            </s-button>
          </s-stack>
        </s-banner>
      );
    }
    return null;
  })();

  return (
    <s-page heading="TierSaver">
      {banner}

      {!cleaned ? (
        <s-section heading="Get started">
          <s-stack gap="small">
            <Step index={1} state={stepStates[0]!} title="Connect Klaviyo" action={!connected && !connectionBanner ? connectButton : null}>
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
              action={connected && (!audited || needsNewAudit) && !cleanupFailed && !expired ? scanButton(audited ? "Run the audit again" : "Run the free audit", "primary") : null}
            >
              {scanning ? (
                `Klaviyo is working through your list${scan!.membersRead > 0 ? ` (${number(scan!.membersRead)} profiles read so far)` : ""}. You can leave this page.`
              ) : audited ? (
                <>
                  Last audit <Time at={result!.finishedAt} />.
                  {needsNewAudit
                    ? historyPending
                      ? view.orderHistory === "loading"
                        ? " Your Shopify order history is still being read; run the audit again later."
                        : " Part of your Shopify order history is not available yet; see below."
                      : simulation?.state === "expired"
                        ? " Its simulation expired. Run the audit again to review a current one."
                        : simulation?.state === "superseded"
                          ? " Your rules changed since. Run the audit again to review a current simulation."
                          : simulation?.state === "executed"
                            ? " Its simulation was already used. Run the audit again for a new one."
                            : " It found nothing to suppress. Run it again whenever you like; the audit is free."
                    : ""}
                </>
              ) : (
                "It only reads. Counts the profiles that meet Klaviyo's criteria for long-term inactive profiles."
              )}
            </Step>
            <Step
              index={3}
              state={stepStates[2]!}
              title="Review and approve"
              action={pending?.state === "open" ? <s-button href="/app/simulation">Review the simulation</s-button> : null}
            >
              See exactly which profiles would be suppressed, download the list, and approve it yourself.
            </Step>
            <Step
              index={4}
              state={stepStates[3]!}
              title="Run the cleanup"
              action={
                pending?.state === "approved" ? (
                  <s-button href="/app/simulation">Go to the cleanup</s-button>
                ) : cleanupActive ? (
                  <s-button href={`/app/runs/${cleanupActive.id}`}>View progress</s-button>
                ) : null
              }
            >
              Profiles are suppressed, never deleted, and you can restore the profiles of any cleanup from History.
            </Step>
          </s-stack>
        </s-section>
      ) : null}

      {connected && (result || scan) ? (
        <s-section heading="Your list">
          <s-stack gap="base">
            {scanning && !audited ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-spinner accessibilityLabel="Audit in progress" size="base" />
                <s-text>
                  The audit is reading your list from Klaviyo{scan!.membersRead > 0 ? ` (${number(scan!.membersRead)} profiles read so far)` : ""}. Your numbers appear here when it
                  finishes. You can leave this page.
                </s-text>
              </s-stack>
            ) : null}
            {scan?.status === "failed" ? (
              <s-banner tone="warning" heading="The last audit could not finish">
                {SCAN_ERRORS[scan.error ?? ""] ?? "Something went wrong while reading from Klaviyo. Nothing was changed. Please run the audit again."}{" "}
                {scan.error === "too_many_segment_members" ? (
                  <s-link href={links.support} target="_blank">
                    {links.supportEmail}
                  </s-link>
                ) : null}
              </s-banner>
            ) : historyPending ? (
              view.orderHistory === "loading" ? (
                <s-banner tone="info" heading="Still reading your Shopify order history">
                  TierSaver checks every profile against your store's orders before calling it inactive. That history is still being read, so for
                  now everyone is kept active and nobody can be suppressed. You don't need to do anything: run the audit again later.
                </s-banner>
              ) : (
                <s-banner tone="info" heading="Part of your Shopify order history is not available yet">
                  {number(result!.unverifiedPurchases)} profiles could not be checked against your store's full order history, so they were kept
                  active. Nobody is suppressed unless their whole history can be checked. If this does not change, write to{" "}
                  <s-link href={links.support} target="_blank">
                    {links.supportEmail}
                  </s-link>
                  .
                </s-banner>
              )
            ) : result?.note ? (
              <s-banner tone="info">{result.note}</s-banner>
            ) : null}
            {result ? (
              <>
                {scanning ? (
                  <s-text color="subdued">
                    A new audit is in progress{scan!.membersRead > 0 ? ` (${number(scan!.membersRead)} profiles read so far)` : ""}. The numbers below are from the previous one.
                  </s-text>
                ) : simulation?.state === "superseded" ? (
                  <s-text color="subdued">Your rules or protected lists changed after this audit. Run the audit again to see the current numbers.</s-text>
                ) : simulation?.state === "executed" && !cleanupFailed ? (
                  <s-text color="subdued">These numbers are from before your last cleanup. Run the audit again to see your list as it is now.</s-text>
                ) : null}
                {result.seededTestAccount ? <s-text color="subdued">Test account: this audit reads seeded sample data.</s-text> : null}
                <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
                  <Metric
                    label="Active profiles"
                    value={number(result.activeProfiles)}
                    detail={result.activeProfilesSource === "klaviyo_usage" ? "Klaviyo's own count" : "Counted by TierSaver"}
                  />
                  <Metric label="Meet Klaviyo's inactive criteria" value={number(result.matchingKlaviyoCriteria)} detail="Never opened, clicked, visited or purchased" />
                  <Metric label="A cleanup would suppress" value={number(result.candidates)} detail={`Leaves ${number(Math.max(0, result.activeProfiles - result.candidates))} active`} emphasis />
                </s-grid>
                {result.keptActive.length > 0 ? (
                  <s-stack gap="small-200">
                    <s-heading>Kept active even though they meet the criteria</s-heading>
                    {result.keptActive.map((row) => (
                      <Row key={row.label} label={row.label} value={number(row.count)} />
                    ))}
                    {result.keptActive.length > 1 ? <s-text color="subdued">A profile can be kept for more than one reason, so these can overlap.</s-text> : null}
                  </s-stack>
                ) : null}
                {result.candidates === 0 && !result.note && !historyPending ? (
                  <s-paragraph>
                    {result.matchingKlaviyoCriteria === 0
                      ? "Your list is already clean. No profiles match the cleanup criteria, so there is nothing to suppress and nothing to charge."
                      : result.restoreLocked > 0
                        ? `Nothing to suppress right now. ${number(result.restoreLocked)} profiles meet the criteria but were restored in the last 365 days, so TierSaver leaves them out until 365 days have passed since their restore. Nothing is charged.`
                        : "Nothing to suppress right now: the profiles that meet the criteria are kept active for the reasons above, or are already suppressed in Klaviyo. Nothing is charged."}
                  </s-paragraph>
                ) : null}
                <s-stack direction="inline" gap="base" alignItems="center">
                  {scanButton("Run the audit again", "secondary")}
                  <s-text color="subdued">
                    As of <Time at={result.finishedAt} />
                  </s-text>
                </s-stack>
              </>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {lastCleanup ? (
        <s-section heading="Last cleanup">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={STATUS_LABELS[lastCleanup.status]?.tone ?? "info"}>{STATUS_LABELS[lastCleanup.status]?.label ?? lastCleanup.status}</s-badge>
              <s-text>
                {lastCleanup.finishedAt ? (
                  <>
                    <Time at={lastCleanup.finishedAt} />:{" "}
                  </>
                ) : null}
                {cleanupActive
                  ? `${number(lastCleanup.submitted)} of ${number(lastCleanup.total)} profiles sent to Klaviyo so far.`
                  : `${number(lastCleanup.submitted)} profiles suppressed${lastCleanup.restored ? ", restored later" : ""}.`}
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-button href={`/app/runs/${lastCleanup.id}`}>{cleanupActive ? "View progress" : "View the cleanup"}</s-button>
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
            <s-badge tone={!schedule.enabled ? "neutral" : connected ? "success" : "warning"}>{!schedule.enabled ? "Off" : connected ? "On" : "Paused"}</s-badge>
            {schedule.enabled ? <s-text color="subdued">{schedule.automatic ? "Automatic cleanups" : "Waits for your approval"}</s-text> : null}
          </s-stack>
          {schedule.enabled && !connected ? (
            <s-text color="subdued">No scheduled audit or cleanup runs while Klaviyo is not connected. The schedule picks up again when you reconnect.</s-text>
          ) : (
            <>
              <s-text color="subdued">
                {schedule.enabled
                  ? schedule.nextAuditOn
                    ? `Next audit on ${schedule.nextAuditOn}, a few days before your Klaviyo plan renews.`
                    : "Add your Klaviyo renewal day in Settings so the audit can be scheduled."
                  : "Run the audit every month, a few days before your Klaviyo plan renews, so Klaviyo's count is up to date."}
              </s-text>
              {schedule.enabled && schedule.automatic ? (
                <s-text>
                  Automatic cleanups are on: after that audit, TierSaver suppresses the profiles it finds without asking you again.{" "}
                  {result?.price ? `Price if it suppresses profiles: ${result.price}, at most one charge every 28 days. ` : ""}
                  You can turn this off in Settings at any time.
                </s-text>
              ) : null}
              {schedule.enabled && !schedule.automatic ? (
                <s-text color="subdued">
                  TierSaver does not send email. Open the app {schedule.nextAuditOn ? `on ${schedule.nextAuditOn} or the day after` : "after the audit"} to
                  review the simulation: it can be approved for 24 hours.
                </s-text>
              ) : null}
            </>
          )}
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button href="/app/settings">Settings</s-button>
            <s-link href={links.schedule} target="_blank">
              How the schedule works
            </s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Pricing">
        <s-stack gap="small">
          {result && !result.price ? (
            <s-text>
              Lists above 150,000 active profiles are priced by agreement and nothing is charged automatically. Write to{" "}
              <s-link href={links.sales} target="_blank">
                {links.salesEmail}
              </s-link>{" "}
              to agree a price.
            </s-text>
          ) : (
            <s-text>{result?.price ? `${result.price} per month for a list of this size.` : "A flat monthly price by list size, from $15."}</s-text>
          )}
          <s-text color="subdued">Charged through Shopify, only in a month when a cleanup suppresses profiles. The audit is free.</s-text>
          <s-link href={links.pricing} target="_blank">
            How pricing works
          </s-link>
        </s-stack>
      </s-section>

      {connected ? (
        <s-section slot="aside" heading="Klaviyo connection">
          <s-stack gap="base">
            <s-text>
              Account <s-text type="strong">{connection!.klaviyoAccountId}</s-text>, connected <Time at={connection!.connectedOn} />.
            </s-text>
            <s-text color="subdued">Disconnecting removes TierSaver's access. Suppressed profiles stay suppressed and nothing is deleted.</s-text>
            <div>
              <s-button tone="critical" commandFor="disconnect-klaviyo" command="--show" {...flags({ disabled: busy })}>
                Disconnect Klaviyo
              </s-button>
            </div>
            {renderForm(
              "disconnect",
              <s-modal id="disconnect-klaviyo" heading="Disconnect Klaviyo?">
                <s-stack gap="base">
                  <s-paragraph>TierSaver loses access to Klaviyo account {connection!.klaviyoAccountId}. When you disconnect:</s-paragraph>
                  <s-unordered-list>
                    <s-list-item>
                      {schedule.enabled ? "Your monthly schedule stops: no more scheduled audits or cleanups." : "No audit or cleanup can run until you connect again."}
                    </s-list-item>
                    <s-list-item>
                      {pending
                        ? `The simulation waiting for you (${number(pending.candidates)} profiles) cannot be approved or started while Klaviyo is disconnected, and it expires 24 hours after its audit.`
                        : "A simulation cannot be approved or started while Klaviyo is disconnected."}
                    </s-list-item>
                    <s-list-item>Profiles that are already suppressed stay suppressed. Nothing is deleted.</s-list-item>
                    <s-list-item>To restore the profiles of a past cleanup you will need to connect again.</s-list-item>
                  </s-unordered-list>
                </s-stack>
                <s-button slot="primary-action" type="submit" variant="primary" tone="critical" {...flags({ disabled: busy })}>
                  Disconnect
                </s-button>
                <s-button slot="secondary-actions" commandFor="disconnect-klaviyo" command="--hide">
                  Cancel
                </s-button>
              </s-modal>,
            )}
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Help">
        <s-stack gap="small">
          <s-link href={links.help} target="_blank">
            Help center
          </s-link>
          <s-text>
            Contact support:{" "}
            <s-link href={links.support} target="_blank">
              {links.supportEmail}
            </s-link>
          </s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Good to know">
        <s-text color="subdued">
          Suppressed profiles don't count toward your Klaviyo plan. If your active profile count drops, an Owner or Admin can move to a lower
          plan in Klaviyo's billing settings. Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo
          (Billing, then Preferences). TierSaver is not affiliated with or endorsed by Klaviyo.
        </s-text>
      </s-section>
    </s-page>
  );
}
