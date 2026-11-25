import { env } from "cloudflare:workers";
import { formatUsd } from "@tiersaver/core";
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { db } from "../db.server";
import { sessionActor } from "../data/events-log";
import { createKlaviyoClient, getConnection } from "../klaviyo/connection.server";
import { STATUS_LABELS } from "../runs/labels";
import { confirmRunJobs } from "../runs/confirm";
import { startUndoRun } from "../runs/start.server";
import { checkRunJobs, loadRunDetail, type JobsCheck } from "../runs/view.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const detail = await loadRunDetail(session.shop, params.runId ?? "");
  if (!detail) throw new Response("Not found", { status: 404 });
  return detail;
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

  if (intent === "undo") {
    // Klaviyo applies bulk jobs in the background and in no guaranteed order. Restoring while the cleanup's own
    // jobs are still being applied could leave profiles suppressed after a "successful" restore, so wait for them.
    // If Klaviyo cannot be asked, the restore is not held back: undo must stay available.
    try {
      const connection = await getConnection(db, session.shop);
      if (connection?.status === "connected") {
        const client = createKlaviyoClient({ db, env }, session.shop, { subrequestBudget: 40 });
        const jobs = await confirmRunJobs(db, client, runId, 35);
        if (jobs && !jobs.done) return { error: "klaviyo_still_processing" };
        if (!jobs) {
          const detail = await loadRunDetail(session.shop, runId);
          if (detail?.run.finishedAt && Date.now() - Date.parse(detail.run.finishedAt) < 10 * 60_000) return { error: "klaviyo_still_processing" };
        }
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
  klaviyo_unavailable: "Klaviyo could not be reached. Please try again.",
  klaviyo_still_processing: "Klaviyo is still applying this cleanup. Try the restore again in a minute or two.",
  nothing_to_restore: "There is nothing left to restore from this cleanup.",
  undo_in_progress: "A restore of this cleanup is already in progress.",
  still_running: "This cleanup is still running. You can restore it once it has finished.",
  not_a_cleanup: "Only a cleanup can be restored.",
  not_found: "This cleanup no longer exists.",
};

const RUN_ERRORS: Record<string, string> = {
  suppression_disabled: "Cleanups are not switched on for this installation. Nothing was changed in Klaviyo.",
  suppression_not_allowed_for_account: "Cleanups are not switched on for this Klaviyo account. Nothing was changed in Klaviyo.",
  klaviyo_needs_reauth: "TierSaver's access to Klaviyo ended. Reconnect Klaviyo from the home page.",
  klaviyo_not_connected: "Klaviyo is not connected.",
  klaviyo_disconnected: "Klaviyo was disconnected.",
  simulation_expired: "The simulation was more than 24 hours old when the cleanup started.",
  simulation_superseded: "Your rules changed after the simulation was approved.",
};

const NO_CHARGE: Record<string, string> = {
  no_cleanup: "Not charged: no profile was suppressed.",
  already_charged_this_cycle: "Not charged: a cleanup was already charged in the last 28 days.",
  cleanup_undone: "Not charged: this cleanup was undone.",
  cap_reached: "Not charged: the monthly maximum was already reached.",
  above_price_tiers: "Not charged automatically: lists above 150,000 active profiles are priced by agreement.",
};

const number = (n: number) => n.toLocaleString("en-US");
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function Run() {
  const { run, progress, undo, undoRuns, charge, jobCount } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionData | undefined;
  const busy = useNavigation().state !== "idle";
  const running = run.status === "queued" || run.status === "running";
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [running, revalidator]);

  const isUndo = run.kind === "undo";
  const verb = isUndo ? "restored" : "suppressed";
  const done = running ? (progress.submitted ?? 0) : run.submitted;
  const needsConfirmation = result?.needsConfirmation ?? (undo && undo.renewal !== "no" ? undo.renewal : null);
  const status = STATUS_LABELS[run.status];

  return (
    <s-page heading={isUndo ? "Restore" : "Cleanup"}>
      <s-link slot="breadcrumb-actions" href="/app/runs">
        History
      </s-link>
      {result?.error ? <s-banner tone="warning">{ERRORS[result.error] ?? "That did not work. Nothing was changed. Please try again."}</s-banner> : null}

      <s-section heading="Summary">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base">
            <s-badge tone={status?.tone ?? "info"}>{status?.label ?? run.status}</s-badge>
            <s-text>
              Started {dateTime(run.createdAt)}
              {run.origin === "scheduled" ? " by your monthly schedule" : ""}
              {run.finishedAt ? `, finished ${dateTime(run.finishedAt)}` : ""}
            </s-text>
          </s-stack>
          {running ? (
            <s-banner tone="info" heading={isUndo ? "Restore in progress" : "Cleanup in progress"}>
              {number(done)} of {number(run.total)} profiles sent to Klaviyo so far. You can leave this page.
            </s-banner>
          ) : null}
          {run.error ? (
            <s-banner tone="warning" heading="This run stopped early">
              {RUN_ERRORS[run.error] ?? "Something went wrong while talking to Klaviyo."} Profiles it did not reach were left untouched.
            </s-banner>
          ) : null}
          <s-table>
            <s-table-header-row>
              <s-table-header>Profiles</s-table-header>
              <s-table-header format="numeric">Count</s-table-header>
            </s-table-header-row>
            <s-table-body>
              <s-table-row>
                <s-table-cell>In this {isUndo ? "restore" : "cleanup"}</s-table-cell>
                <s-table-cell>{number(run.total)}</s-table-cell>
              </s-table-row>
              <s-table-row>
                <s-table-cell>Sent to Klaviyo to be {verb}</s-table-cell>
                <s-table-cell>{number(done)}</s-table-cell>
              </s-table-row>
              <s-table-row>
                <s-table-cell>Left untouched: no longer in Klaviyo, no email address, or the address changed since the simulation</s-table-cell>
                <s-table-cell>{number(running ? (progress.skipped ?? 0) : run.skipped)}</s-table-cell>
              </s-table-row>
              {(running ? (progress.failed ?? 0) : run.failed) > 0 ? (
                <s-table-row>
                  <s-table-cell>Not processed because of an error</s-table-cell>
                  <s-table-cell>{number(running ? (progress.failed ?? 0) : run.failed)}</s-table-cell>
                </s-table-row>
              ) : null}
              {undo && undo.restored > 0 ? (
                <s-table-row>
                  <s-table-cell>Restored later</s-table-cell>
                  <s-table-cell>{number(undo.restored)}</s-table-cell>
                </s-table-row>
              ) : null}
            </s-table-body>
          </s-table>
          {!isUndo && charge ? (
            <s-paragraph>
              {charge.status === "charged"
                ? `Charged ${formatUsd(charge.feeCents)} through Shopify${charge.chargedAt ? ` on ${dateTime(charge.chargedAt)}` : ""}.`
                : charge.status === "not_charged"
                  ? (NO_CHARGE[charge.reason ?? ""] ?? "Not charged.")
                  : `Estimated charge: ${formatUsd(charge.feeCents)}. It becomes final, and is sent to Shopify, once Klaviyo confirms that its jobs suppressed the profiles. If Klaviyo confirms none, nothing is charged.`}
            </s-paragraph>
          ) : null}
          {!isUndo && !running && run.submitted > 0 ? (
            <s-paragraph>
              Suppressed profiles don't count toward your Klaviyo plan. Klaviyo's count can take up to 72 hours to update.
              Your Klaviyo plan does not change automatically unless you enabled auto-downgrade in Klaviyo.
            </s-paragraph>
          ) : null}
          {isUndo && run.undoOfRunId ? (
            <s-paragraph>
              This restores the profiles of <s-link href={`/app/runs/${run.undoOfRunId}`}>this cleanup</s-link>. Only the suppression
              TierSaver added is removed: profiles that unsubscribed or bounced stay as they are.
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {jobCount > 0 ? (
        <s-section heading="Klaviyo jobs">
          <s-stack gap="base">
            <s-paragraph>
              Klaviyo processes each batch as a background job. This run created {number(jobCount)} {jobCount === 1 ? "job" : "jobs"}. Check
              what Klaviyo reports for them.
            </s-paragraph>
            {result?.jobs ? (
              <s-stack gap="base">
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Job</s-table-header>
                    <s-table-header>Status in Klaviyo</s-table-header>
                    <s-table-header format="numeric">Processed</s-table-header>
                    <s-table-header format="numeric">Skipped by Klaviyo</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {result.jobs.jobs.map((job) => (
                      <s-table-row key={job.id}>
                        <s-table-cell>{job.id}</s-table-cell>
                        <s-table-cell>{job.status}</s-table-cell>
                        <s-table-cell>{job.completed === null ? "–" : `${number(job.completed)}${job.total ? ` of ${number(job.total)}` : ""}`}</s-table-cell>
                        <s-table-cell>{job.skipped === null ? "–" : number(job.skipped)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {result.jobs.unreadable > 0 ? (
                  <s-paragraph>{number(result.jobs.unreadable)} jobs could not be read from Klaviyo right now.</s-paragraph>
                ) : null}
                {result.jobs.pages > 1 ? (
                  <s-paragraph>
                    Page {result.jobs.page} of {result.jobs.pages}.
                  </s-paragraph>
                ) : null}
              </s-stack>
            ) : null}
            <Form method="post">
              <input type="hidden" name="intent" value="jobs" />
              <input type="hidden" name="page" value={result?.jobs && result.jobs.page < result.jobs.pages ? result.jobs.page + 1 : 1} />
              <s-button type="submit" variant="secondary" disabled={busy}>
                {result?.jobs ? (result.jobs.page < result.jobs.pages ? "Check next page" : "Check again") : "Check jobs in Klaviyo"}
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : null}

      {undo ? (
        <s-section heading="Undo this cleanup">
          <s-stack gap="base">
            {undoRuns.length > 0 ? (
              <s-paragraph>
                Restores of this cleanup:{" "}
                {undoRuns.map((u, i) => (
                  <span key={u.id}>
                    {i > 0 ? ", " : ""}
                    <s-link href={`/app/runs/${u.id}`}>{dateTime(u.createdAt)}</s-link>
                  </span>
                ))}
                .
              </s-paragraph>
            ) : null}
            {undo.restorable === 0 ? (
              <s-paragraph>There is nothing to restore from this cleanup.</s-paragraph>
            ) : running || undo.inProgress ? (
              <s-paragraph>You can restore this cleanup once it, and any restore already started, has finished.</s-paragraph>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="undo" />
                <s-stack gap="base">
                  <s-paragraph>
                    Undo is for correcting a mistake. It removes the suppression from the {number(undo.restorable)} profiles this
                    cleanup suppressed, so they can receive marketing email again and count toward your Klaviyo plan again.
                    Restored profiles are left out of TierSaver cleanups for 365 days.
                  </s-paragraph>
                  {needsConfirmation ? (
                    <s-banner tone="warning" heading={needsConfirmation === "yes" ? "Your Klaviyo plan has renewed since this cleanup" : "Your Klaviyo plan may have renewed since this cleanup"}>
                      <s-stack gap="base">
                        <s-paragraph>
                          Restoring these profiles now raises your active profile count after Klaviyo has already counted the
                          lower one. Use undo only to correct a mistake. Suppressing profiles before a renewal and restoring
                          them afterwards is against TierSaver's terms and may breach Klaviyo's.
                        </s-paragraph>
                        <s-checkbox name="confirmAfterRenewal" value="yes" label="I understand, and I am restoring these profiles to correct a mistake." />
                      </s-stack>
                    </s-banner>
                  ) : null}
                  <s-button type="submit" tone="critical" disabled={busy}>
                    Restore {number(undo.restorable)} profiles
                  </s-button>
                </s-stack>
              </Form>
            )}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
