import { env } from "cloudflare:workers";
import { formatUsd, RULE_LIMITS, type CandidateReason } from "@tiersaver/core";
import { eq } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { flags } from "../components/home-screen";
import { errorFocus, number, Row, Time, useRevealError } from "../components/ui";
import { db, schema } from "../db.server";
import { sessionActor } from "../data/events-log";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { legalUrls } from "../legal";
import { CHARGE_HOLD_HOURS, NO_CHARGE_LABELS, OTHER_RUN_ERROR_LABEL, OTHER_SKIP_LABEL, RUN_ERROR_LABELS, SKIP_REASON_LABELS, statusLabel } from "../runs/labels";
import { confirmRunJobs } from "../runs/confirm";
import { requestStopRun } from "../runs/engine";
import { startUndoRun } from "../runs/start.server";
import { checkRunJobs, loadRunDetail, type JobsCheck, type RuleWindows } from "../runs/view.server";
import { shopTimeZone, stamp } from "../settings/timezone";
import { CANDIDATE_REASON_LABELS } from "../simulations/review";
import { authenticate } from "../shopify.server";

/** "user:1001" -> "Shopify user 1001". Only the id is stored, so only the id is shown. */
function actorText(actor: string | null | undefined): string | null {
  if (!actor) return null;
  if (actor === "schedule") return "your monthly schedule";
  const id = actor.replace(/^user:/, "");
  return /^\d+$/.test(id) ? `Shopify user ${id}` : null;
}

function rulesText(recommended: boolean, w: RuleWindows): string {
  if (recommended) return "Klaviyo's published criteria";
  const days = (n: number | null) => (n === null ? "ever" : `in the last ${number(n)} days`);
  return `Your wider windows: no purchase ${days(w.purchaseDays)}, no click ${days(w.clickDays)}, no open ${days(w.openDays)}, no site activity ${days(w.siteActivityDays)}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const detail = await loadRunDetail(session.shop, params.runId ?? "");
  if (!detail) throw new Response("Not found", { status: 404 });
  const [zone, settings] = await Promise.all([
    shopTimeZone(db, session.shop),
    db.query.settings.findFirst({ where: eq(schema.settings.shop, session.shop), columns: { reactivationLockDays: true } }),
  ]);
  // Every date is formatted here, in the shop's time zone: the browser never formats one (see settings/timezone.ts).
  const at = (iso: string | null | undefined) => (iso ? stamp(iso, zone) : null);
  const { run, charge, approval } = detail;
  const legal = legalUrls(env);
  return {
    run: {
      id: run.id,
      kind: run.kind,
      origin: run.origin,
      status: run.status,
      total: run.total,
      submitted: run.submitted,
      skipped: run.skipped,
      failed: run.failed,
      unknown: run.unknown,
      error: run.error,
      stopping: run.stopping,
      undoOfRunId: run.undoOfRunId,
      createdAt: stamp(run.createdAt, zone),
      finishedAt: at(run.finishedAt),
      startedBy: actorText(run.createdBy),
    },
    progress: detail.progress,
    skipReasons: detail.skipReasons.map((s) => ({ ...s, label: SKIP_REASON_LABELS[s.reason] ?? OTHER_SKIP_LABEL })),
    stop: detail.stop ? { canStop: detail.stop.canStop } : null,
    undo: detail.undo
      ? { ...detail.undo, leftAloneReasons: detail.undo.leftAloneReasons.map((s) => ({ ...s, label: SKIP_REASON_LABELS[s.reason] ?? OTHER_SKIP_LABEL })) }
      : null,
    undoRuns: detail.undoRuns.map((u) => ({ id: u.id, createdAt: stamp(u.createdAt, zone), ...statusLabel(u), submitted: u.submitted, skipped: u.skipped })),
    charge: charge
      ? {
          status: charge.status,
          fee: formatUsd(charge.feeCents),
          reason: charge.reason,
          chargedAt: at(charge.chargedAt),
          sendAt: at(charge.sendAt),
          // The restore window is still open. Decided here: the browser's clock is not used for anything shown.
          windowOpen: Boolean(charge.sendAt && Date.parse(charge.sendAt) > Date.now()),
        }
      : null,
    approval: approval
      ? { by: actorText(approval.by), automatic: approval.automatic, at: at(approval.at), rules: rulesText(approval.recommendedRules, approval.windows) }
      : null,
    candidateReasons: detail.candidateReasons.map((r) => ({ label: CANDIDATE_REASON_LABELS[r.reason as CandidateReason] ?? r.reason, count: r.count })),
    jobCount: detail.jobCount,
    restoreLockDays: settings?.reactivationLockDays ?? RULE_LIMITS.reactivationLockDays.min,
    holdHours: CHARGE_HOLD_HOURS,
    help: { undo: legal.articles.undo, support: legal.support, supportEmail: legal.supportEmail },
  };
};

type ActionData = { error?: string; needsConfirmation?: "yes" | "unknown"; jobs?: JobsCheck };

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionData | Response> => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const runId = params.runId ?? "";

  if (intent === "jobs") {
    const connection = await getConnection(db, session.shop);
    if (connection?.status !== "connected") return { error: "klaviyo_not_connected" };
    try {
      const client = createKlaviyoClient({ db, env }, session.shop, { subrequestBudget: 40 });
      const jobs = await checkRunJobs(client, { shop: session.shop, runId, page: Number(form.get("page") ?? "1") });
      return jobs ? { jobs } : { error: "not_found" };
    } catch {
      return { error: "klaviyo_unavailable" };
    }
  }

  if (intent === "stop") {
    const result = await requestStopRun(db, { shop: session.shop, runId, requestedBy: sessionActor(sessionToken) });
    return result.ok ? {} : { error: result.reason };
  }

  if (intent === "undo") {
    // The run id comes from the URL: it must be this shop's before anything is read for it or sent to Klaviyo.
    const owned = await loadRunDetail(session.shop, runId);
    if (!owned) return { error: "not_found" };
    // Klaviyo applies bulk jobs in the background and in no guaranteed order. Restoring while the cleanup's own
    // jobs are still being applied could leave profiles suppressed after a "successful" restore, so wait for them.
    // If Klaviyo cannot be asked, the restore is not held back: undo must stay available.
    try {
      const connection = await getConnection(db, session.shop);
      if (connection?.status === "connected") {
        const client = createKlaviyoClient({ db, env }, session.shop, { subrequestBudget: 40 });
        const jobs = await confirmRunJobs(db, client, runId, 35, session.shop);
        if (jobs && !jobs.done) return { error: "klaviyo_still_processing" };
        if (!jobs && owned.run.finishedAt && Date.now() - Date.parse(owned.run.finishedAt) < 10 * 60_000) return { error: "klaviyo_still_processing" };
      }
    } catch {
      // See above.
    }
    const result = await startUndoRun({
      shop: session.shop,
      runId,
      createdBy: sessionActor(sessionToken),
      confirmAfterRenewal: form.get("confirmAfterRenewal") === "yes",
    });
    if (result.ok) return redirect(`/app/runs/${result.runId}`);
    if (result.reason === "needs_renewal_confirmation") return { needsConfirmation: result.renewal ?? "unknown" };
    return { error: result.reason };
  }
  return new Response(null, { status: 400 });
};

const ERRORS: Record<string, string> = {
  klaviyo_not_connected: "Klaviyo is not connected. Reconnect it from the home page.",
  klaviyo_unavailable: "Klaviyo could not be reached. Nothing was changed. Please try again.",
  klaviyo_still_processing: "Klaviyo is still applying this cleanup, so nothing was restored yet. Try again in a minute or two.",
  nothing_to_restore: "There is nothing left to restore from this cleanup.",
  undo_in_progress: "A restore of this cleanup is already in progress.",
  still_running: "This cleanup is still running. You can restore it once it has finished.",
  not_a_cleanup: "Only a cleanup can be stopped or restored.",
  already_finished: "This cleanup had already finished, so there was nothing to stop.",
  not_found: "This cleanup no longer exists.",
};

const RENEWAL_ERROR = "Tick this box to confirm before restoring.";
const RESTORE_MODAL = "restore-cleanup";

export default function Run() {
  const { run, progress, skipReasons, stop, undo, undoRuns, charge, approval, candidateReasons, jobCount, restoreLockDays, holdHours, help } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pending = busy ? navigation.formData?.get("intent") : null;
  const running = run.status === "queued" || run.status === "running";
  const revalidator = useRevalidator();
  // A restore of this cleanup that is still going changes what this page says when it ends.
  const live = running || Boolean(undo?.inProgress);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  const isUndo = run.kind === "undo";
  const noun = isUndo ? "restore" : "cleanup";
  const verb = isUndo ? "restored" : "suppressed";
  const done = running ? (progress.submitted ?? 0) : run.submitted;
  const skipped = running ? (progress.skipped ?? 0) : run.skipped;
  const notProcessed = running ? 0 : Math.max(0, run.total - run.submitted - run.skipped - run.unknown);
  const badge = statusLabel(run);

  const needsConfirmation = result?.needsConfirmation ?? (undo && undo.renewal !== "no" ? undo.renewal : null);
  // Set when "Restore profiles" is pressed without the tick, or when the server refused for lack of it.
  const [confirmMissing, setConfirmMissing] = useState(false);
  const refusedForTick = Boolean(result?.needsConfirmation);
  useEffect(() => {
    if (refusedForTick) setConfirmMissing(true);
  }, [result, refusedForTick]);
  const tickError = confirmMissing;
  useRevealError(result, Boolean(result?.error));
  useEffect(() => {
    // The explanation and the tick live in the dialog: if the server asks for the tick, the dialog is shown again.
    if (!refusedForTick) return;
    const modal = document.getElementById(RESTORE_MODAL) as (HTMLElement & { showOverlay?: () => void }) | null;
    modal?.showOverlay?.();
  }, [result, refusedForTick]);

  const chargeLine = !isUndo && charge ? chargeText(charge, Boolean(undo?.fullyRestored), holdHours) : null;

  return (
    <s-page heading={isUndo ? "Restore" : "Cleanup"}>
      <s-link slot="breadcrumb-actions" href="/app/runs">
        History
      </s-link>
      {result?.error ? (
        <s-banner tone="warning" heading={isUndo ? "That did not work" : "Nothing was changed"} {...errorFocus(true)}>
          {ERRORS[result.error] ?? "That did not work. Nothing was changed. Please try again."}{" "}
          {result.error === "klaviyo_unavailable" || !ERRORS[result.error] ? (
            <>
              If it keeps happening, write to <s-link href={help.support}>{help.supportEmail}</s-link>.
            </>
          ) : null}
        </s-banner>
      ) : null}

      <s-section heading="Summary">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={badge.tone}>{badge.label}</s-badge>
            <s-text>
              Started <Time at={run.createdAt} />
              {run.finishedAt ? (
                <>
                  , finished <Time at={run.finishedAt} />
                </>
              ) : null}
            </s-text>
          </s-stack>

          {running ? (
            <s-banner tone="info" heading={run.stopping ? "Stopping this cleanup" : isUndo ? "Restore in progress" : "Cleanup in progress"}>
              {run.stopping
                ? `No more profiles will be sent. ${number(done)} of ${number(run.total)} were sent to Klaviyo before you stopped it. You can restore them once the cleanup has closed, usually within a few minutes.`
                : `${number(done)} of ${number(run.total)} profiles sent to Klaviyo so far. It keeps going if you leave this page.`}
            </s-banner>
          ) : null}
          {stop?.canStop ? (
            <Form method="post">
              <input type="hidden" name="intent" value="stop" />
              <s-button tone="critical" commandFor="stop-cleanup" command="--show" {...flags({ disabled: busy })}>
                Stop cleanup
              </s-button>
              <s-modal id="stop-cleanup" heading="Stop this cleanup?">
                <s-stack gap="base">
                  <s-paragraph>
                    TierSaver stops sending profiles to Klaviyo. Profiles it has not reached stay as they are. The batch being sent
                    right now (up to 100 profiles) still goes through.
                  </s-paragraph>
                  <s-paragraph>
                    Profiles already sent stay suppressed. Once the cleanup has closed you can restore them from this page.
                  </s-paragraph>
                </s-stack>
                <s-button slot="primary-action" type="submit" variant="primary" tone="critical" {...flags({ disabled: busy, loading: pending === "stop" })}>
                  Stop cleanup
                </s-button>
                <s-button slot="secondary-actions" commandFor="stop-cleanup" command="--hide">
                  Keep running
                </s-button>
              </s-modal>
            </Form>
          ) : null}

          {!running && (run.error || notProcessed > 0) ? (
            <s-banner
              tone="warning"
              heading={
                run.error
                  ? done + run.unknown > 0
                    ? `This ${noun} stopped early`
                    : `This ${noun} did not run`
                  : `${number(notProcessed)} ${notProcessed === 1 ? "profile was" : "profiles were"} not processed`
              }
            >
              <s-stack gap="base">
                <s-text>
                  {run.error ? `${RUN_ERROR_LABELS[run.error] ?? OTHER_RUN_ERROR_LABEL} ` : ""}
                  {notProcessed > 0
                    ? isUndo
                      ? `${number(notProcessed)} ${notProcessed === 1 ? "profile was" : "profiles were"} not reached and ${notProcessed === 1 ? "is" : "are"} still suppressed. Go back to the cleanup to restore ${notProcessed === 1 ? "it" : "them"}.`
                      : `${number(notProcessed)} ${notProcessed === 1 ? "profile was" : "profiles were"} not reached and ${notProcessed === 1 ? "was" : "were"} left untouched in Klaviyo. Run a new audit to include ${notProcessed === 1 ? "it" : "them"} in the next cleanup.`
                    : ""}
                </s-text>
                {isUndo ? (
                  run.undoOfRunId ? (
                    <s-stack direction="inline" gap="base">
                      <s-button href={`/app/runs/${run.undoOfRunId}`}>View the cleanup</s-button>
                    </s-stack>
                  ) : null
                ) : (
                  <Form method="post" action="/app/simulation">
                    <input type="hidden" name="intent" value="scan" />
                    <s-button type="submit" {...flags({ disabled: busy, loading: pending === "scan" })}>
                      Run the audit again
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-banner>
          ) : null}

          <s-stack gap="small">
            <Row strong label={`Profiles in this ${noun}`} value={number(run.total)} />
            <Row label={`Sent to Klaviyo to be ${verb}`} value={number(done)} />
            {skipped > 0 || !isUndo ? (
              <Row label={isUndo ? "Left as they are: checked right before sending, and not restored" : "Left untouched: checked again right before sending, and no longer a candidate"} value={number(skipped)} />
            ) : null}
            {skipReasons.map((s) => (
              <Row key={s.reason} indent label={s.label} value={number(s.count)} />
            ))}
            {!running && run.unknown > 0 ? (
              <Row
                label={`Result unknown: sent to Klaviyo, but its answer never arrived. They may have been ${verb}.${isUndo ? "" : " A restore includes them."}`}
                value={number(run.unknown)}
              />
            ) : null}
            {notProcessed > 0 ? <Row label={isUndo ? "Not reached: still suppressed" : "Not reached: left untouched"} value={number(notProcessed)} /> : null}
            {undo && undo.restored > 0 ? <Row label="Restored since" value={number(undo.restored)} /> : null}
          </s-stack>

          {!isUndo ? (
            <s-stack gap="small-200">
              {approval ? (
                <s-text color="subdued">
                  {approval.automatic ? (
                    "Approved automatically by your monthly schedule"
                  ) : approval.by ? (
                    `Approved by ${approval.by}`
                  ) : (
                    "Approved in the app"
                  )}
                  {approval.at ? (
                    <>
                      {" "}
                      on <Time at={approval.at} />
                    </>
                  ) : null}
                  .
                </s-text>
              ) : null}
              <s-text color="subdued">
                Started {run.origin === "scheduled" ? "by your monthly schedule" : run.startedBy ? `manually by ${run.startedBy}` : "manually"}.
              </s-text>
              {approval ? <s-text color="subdued">Rules: {approval.rules}.</s-text> : null}
              {candidateReasons.map((r) => (
                <s-text key={r.label} color="subdued">
                  Reason: {r.label} ({number(r.count)}).
                </s-text>
              ))}
            </s-stack>
          ) : run.startedBy ? (
            <s-text color="subdued">Started by {run.startedBy}.</s-text>
          ) : null}

          {chargeLine ? <s-paragraph>{chargeLine}</s-paragraph> : null}
          {!isUndo && !running && run.submitted > 0 && !undo?.fullyRestored ? (
            <s-paragraph>
              Suppressed profiles don't count toward your Klaviyo plan. Klaviyo's count can take up to 72 hours to update. To move to
              a lower plan, an Owner or Admin can do it in Klaviyo under Billing, then Preferences. Your Klaviyo plan does not change
              automatically unless you enabled auto-downgrade.
            </s-paragraph>
          ) : null}
          {isUndo && run.undoOfRunId ? (
            <s-paragraph>
              This restores the profiles of <s-link href={`/app/runs/${run.undoOfRunId}`}>this cleanup</s-link>. Only the suppression
              TierSaver added is removed: profiles that unsubscribed or bounced stay as they are. Restored profiles are left out of
              TierSaver cleanups for {number(restoreLockDays)} days.{" "}
              <s-link href={help.undo} target="_blank">
                How restoring works
              </s-link>
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {jobCount > 0 ? (
        <s-section heading="Klaviyo batches">
          <s-stack gap="base">
            <s-paragraph>
              Klaviyo applies this {noun} in {number(jobCount)} {jobCount === 1 ? "batch" : "batches"}, in the background. You can ask
              Klaviyo how far it is.
            </s-paragraph>
            {result?.jobs ? (
              <s-stack gap="base">
                <s-banner tone={result.jobs.jobs.every((j) => j.status === "complete") && result.jobs.unreadable === 0 ? "success" : "info"}>
                  {result.jobs.jobs.filter((j) => j.status === "complete").length} of {result.jobs.jobs.length} batches
                  {result.jobs.pages > 1 ? " on this page" : ""} are complete: {number(result.jobs.jobs.reduce((n, j) => n + (j.completed ?? 0), 0))}{" "}
                  profiles processed, {number(result.jobs.jobs.reduce((n, j) => n + (j.skipped ?? 0), 0))} skipped by Klaviyo.
                  {result.jobs.unreadable > 0 ? ` ${number(result.jobs.unreadable)} could not be read from Klaviyo right now.` : ""}
                  {result.jobs.pages > 1 ? ` Page ${result.jobs.page} of ${result.jobs.pages}.` : ""}
                </s-banner>
                <details>
                  <summary style={{ cursor: "pointer" }}>Show batches</summary>
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Batch (Klaviyo job)</s-table-header>
                      <s-table-header>Status in Klaviyo</s-table-header>
                      <s-table-header format="numeric">Processed</s-table-header>
                      <s-table-header format="numeric">Skipped by Klaviyo</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {result.jobs.jobs.map((job) => (
                        <s-table-row key={job.id}>
                          <s-table-cell>{job.id}</s-table-cell>
                          <s-table-cell>{JOB_STATUS[job.status] ?? "Unknown"}</s-table-cell>
                          <s-table-cell>{job.completed === null ? "–" : `${number(job.completed)}${job.total ? ` of ${number(job.total)}` : ""}`}</s-table-cell>
                          <s-table-cell>{job.skipped === null ? "–" : number(job.skipped)}</s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                </details>
              </s-stack>
            ) : null}
            <Form method="post" preventScrollReset>
              <input type="hidden" name="intent" value="jobs" />
              <input type="hidden" name="page" value={result?.jobs && result.jobs.page < result.jobs.pages ? result.jobs.page + 1 : 1} />
              <s-button type="submit" variant="secondary" {...flags({ disabled: busy, loading: pending === "jobs" })}>
                {result?.jobs ? (result.jobs.page < result.jobs.pages ? "Check next page" : "Check again") : "Check progress in Klaviyo"}
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : null}

      {undo ? (
        <s-section heading="Restore this cleanup">
          <s-stack gap="base">
            {undoRuns.length > 0 ? (
              <s-stack gap="small-200">
                {undoRuns.map((u) => (
                  <s-text key={u.id}>
                    <s-link href={`/app/runs/${u.id}`}>
                      Restore of <Time at={u.createdAt} />
                    </s-link>
                    : {u.label.toLowerCase()}, {number(u.submitted)} restored{u.skipped > 0 ? `, ${number(u.skipped)} left as they are` : ""}.
                  </s-text>
                ))}
              </s-stack>
            ) : null}
            {undo.leftAlone > 0 && !undo.inProgress ? (
              <s-stack gap="small">
                <s-text>
                  The last restore left {number(undo.leftAlone)} {undo.leftAlone === 1 ? "profile" : "profiles"} as{" "}
                  {undo.leftAlone === 1 ? "it is" : "they are"}, so {undo.leftAlone === 1 ? "it is" : "they are"} not offered again:
                </s-text>
                {undo.leftAloneReasons.map((s) => (
                  <Row key={s.reason} indent label={s.label} value={number(s.count)} />
                ))}
                <s-text color="subdued">You can still unsuppress any of them yourself in Klaviyo.</s-text>
              </s-stack>
            ) : null}
            {running || undo.inProgress ? (
              <s-paragraph>
                {undo.inProgress ? "A restore of this cleanup is in progress. This page updates when it ends." : "You can restore this cleanup once it has finished."}
              </s-paragraph>
            ) : undo.restorable === 0 ? (
              <s-paragraph>
                {undo.restored > 0 ? "Nothing is left to restore from this cleanup." : "This cleanup changed nothing in Klaviyo, so there is nothing to restore."}
              </s-paragraph>
            ) : (
              <>
                <s-paragraph>
                  Restoring is for correcting a mistake. It removes the suppression TierSaver added to the {number(undo.restorable)}{" "}
                  {undo.restorable === 1 ? "profile" : "profiles"} this cleanup suppressed{run.unknown > 0 ? " or may have suppressed" : ""}.{" "}
                  <s-link href={help.undo} target="_blank">
                    How restoring works
                  </s-link>
                </s-paragraph>
                <div>
                  <s-button tone="critical" commandFor={RESTORE_MODAL} command="--show" {...flags({ disabled: busy })}>
                    Restore {number(undo.restorable)} {undo.restorable === 1 ? "profile" : "profiles"}
                  </s-button>
                </div>
                <Form
                  method="post"
                  preventScrollReset
                  onSubmit={(event) => {
                    // The tick is required: say so next to it instead of sending a request that will be refused.
                    const box = event.currentTarget.querySelector<HTMLElement & { checked?: boolean }>('s-checkbox[name="confirmAfterRenewal"]');
                    if (box && !box.checked) {
                      event.preventDefault();
                      setConfirmMissing(true);
                    }
                  }}
                >
                  <input type="hidden" name="intent" value="undo" />
                  <s-modal id={RESTORE_MODAL} heading={`Restore ${number(undo.restorable)} ${undo.restorable === 1 ? "profile" : "profiles"}?`}>
                    <s-stack gap="base">
                      <s-paragraph>They can receive marketing email again and count toward your Klaviyo plan again.</s-paragraph>
                      <s-paragraph>
                        TierSaver will not suppress them again for {number(restoreLockDays)} days. Klaviyo's help center also says that a
                        profile that was unsuppressed cannot be suppressed by hand again until 90 days after its last suppression.
                      </s-paragraph>
                      <s-paragraph>
                        Only the suppression TierSaver added is removed: profiles that unsubscribed or bounced stay as they are. A
                        profile that Klaviyo shows as suppressed since more than a day before this cleanup, or suppressed again more than
                        a day after it, is left as it is. Before you send to these profiles again, check that you may lawfully email them.
                      </s-paragraph>
                      {charge ? <s-paragraph>{restoreChargeText(charge)}</s-paragraph> : null}
                      {needsConfirmation ? (
                        <s-banner tone="warning" heading={needsConfirmation === "yes" ? "Your Klaviyo plan has renewed since this cleanup" : "Your Klaviyo plan may have renewed since this cleanup"}>
                          <s-stack gap="base">
                            <s-paragraph>
                              Restoring these profiles now raises your active profile count after Klaviyo has already counted the lower
                              one. Restore only to correct a mistake. Suppressing profiles before a renewal and restoring them afterwards
                              is against TierSaver's terms and may breach Klaviyo's.
                            </s-paragraph>
                            <ConfirmBox error={tickError ? RENEWAL_ERROR : undefined} onChange={(checked) => checked && setConfirmMissing(false)} />
                          </s-stack>
                        </s-banner>
                      ) : null}
                      <s-link href={help.undo} target="_blank">
                        How restoring works
                      </s-link>
                    </s-stack>
                    <s-button slot="primary-action" type="submit" variant="primary" tone="critical" {...flags({ disabled: busy, loading: pending === "undo" })}>
                      Restore profiles
                    </s-button>
                    <s-button slot="secondary-actions" commandFor={RESTORE_MODAL} command="--hide">
                      Cancel
                    </s-button>
                  </s-modal>
                </Form>
              </>
            )}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

const JOB_STATUS: Record<string, string> = { queued: "Waiting", processing: "In progress", complete: "Complete", cancelled: "Cancelled by Klaviyo" };

/** The renewal confirmation. A custom element: React 18 does not deliver its `change` event through props, so it is listened to directly. */
function ConfirmBox({ error, onChange }: { error: string | undefined; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = () => latest.current(Boolean((el as HTMLElement & { checked?: boolean }).checked));
    el.addEventListener("change", listener);
    return () => el.removeEventListener("change", listener);
  }, []);
  return (
    <s-checkbox
      ref={ref as never}
      name="confirmAfterRenewal"
      value="yes"
      label="I understand, and I am restoring these profiles to correct a mistake."
      error={error}
      {...errorFocus(Boolean(error))}
    />
  );
}

type ChargeView = { status: string; fee: string; reason: string | null; chargedAt: { iso: string; text: string } | null; sendAt: { iso: string; text: string } | null; windowOpen: boolean };

/** What the cleanup page says about the charge. Facts from billing/billing.ts: sent `holdHours` after the cleanup finished, once Klaviyo confirmed; a full restore before that voids it. */
function chargeText(charge: ChargeView, fullyRestored: boolean, holdHours: number) {
  if (charge.status === "charged") {
    return (
      <>
        Charged {charge.fee} through Shopify
        {charge.chargedAt ? (
          <>
            {" "}
            on <Time at={charge.chargedAt} />
          </>
        ) : null}
        .{fullyRestored ? " It had already been charged when you restored this cleanup; restoring does not refund it." : ""}
      </>
    );
  }
  if (charge.status === "not_charged") return NO_CHARGE_LABELS[charge.reason ?? ""] ?? "Not charged.";
  // Not out yet (pending, or a try that failed).
  if (fullyRestored) return "Not charged: you restored this cleanup before the charge was sent.";
  if (charge.status === "failed") return `The charge of ${charge.fee} could not be sent to Shopify yet. TierSaver will try again; you do not need to do anything.`;
  if (charge.sendAt && charge.windowOpen) {
    return (
      <>
        Estimated charge: {charge.fee}. It is sent to Shopify on <Time at={charge.sendAt} /> ({holdHours} hours after the cleanup finished), once
        Klaviyo has confirmed the suppressed profiles, unless you restore the whole cleanup first. If Klaviyo confirms none, nothing is charged.
      </>
    );
  }
  return `Estimated charge: ${charge.fee}. It is sent to Shopify as soon as Klaviyo has confirmed the suppressed profiles. If Klaviyo confirms none, nothing is charged.`;
}

/** What restoring does to the charge, for the confirmation dialog. */
function restoreChargeText(charge: ChargeView) {
  if (charge.status === "charged") return "This cleanup was already charged. Restoring does not refund it.";
  if (charge.status === "not_charged") return "This cleanup was not charged, and restoring it does not change that.";
  if (charge.sendAt && charge.windowOpen) {
    return (
      <>
        This cleanup has not been charged yet. If you restore all of it before <Time at={charge.sendAt} />, it is not charged. Restoring only
        part of a cleanup does not change its charge.
      </>
    );
  }
  return "This cleanup has not been charged yet, but its charge can be sent to Shopify at any moment. It is not charged only if the whole cleanup is restored before that. Once charged, restoring does not refund it.";
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
