import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db.server";
import { getSuppressionJob, type SuppressionJob } from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";
import type { RuleSettings } from "@tiersaver/core";
import { isKlaviyoRecommended } from "../settings/settings";
import { NO_JOB_ID } from "./gateway.server";
import { MAYBE_CHANGED_SQL, renewalSince } from "./engine";
import { chargedWithoutWindow } from "../billing/unpaid";
import { CHARGE_HOLD_HOURS } from "./labels";

/** What the history and run screens show. Ids, counts and dates only: no profile data. */
export interface RunListItem {
  id: string;
  kind: "suppress" | "undo";
  origin: "manual" | "scheduled";
  status: (typeof schema.RUN_STATUSES)[number];
  createdAt: string;
  finishedAt: string | null;
  total: number;
  submitted: number;
  skipped: number;
  failed: number;
  /** Sent to Klaviyo without a confirmed outcome: possibly suppressed (or restored). Included in undo. */
  unknown: number;
  error: string | null;
  /** "Stop cleanup" was pressed and the run has not closed yet. */
  stopping: boolean;
}

/** The rule windows of a simulation, in days. null = "ever". */
export type RuleWindows = Pick<RuleSettings, "purchaseDays" | "clickDays" | "openDays" | "siteActivityDays">;

type RunRow = typeof schema.runs.$inferSelect;

const toItem = (r: RunRow): RunListItem => ({
  id: r.id,
  kind: r.kind,
  origin: r.origin,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  total: r.totalCount,
  submitted: r.processedCount,
  skipped: r.skippedCount,
  failed: r.failedCount,
  unknown: r.unknownCount,
  error: r.lastError,
  stopping: Boolean(r.stopRequestedAt) && (r.status === "queued" || r.status === "running"),
});

export async function listRuns(shop: string, limit = 30): Promise<RunListItem[]> {
  const rows = await db.query.runs.findMany({ where: eq(schema.runs.shop, shop), orderBy: desc(schema.runs.createdAt), limit });
  return rows.map(toItem);
}

export interface RunDetail {
  run: RunListItem & { createdBy: string; undoOfRunId: string | null };
  /** Live progress while the run is going: profiles by state. */
  progress: Record<string, number>;
  /** Why profiles were left untouched, most frequent first. Codes are translated with SKIP_REASON_LABELS. */
  skipReasons: { reason: string; count: number }[];
  /** Cleanups only. `canStop`: the "Stop cleanup" action is available. `requestedAt`: it was pressed. */
  stop: { canStop: boolean; requestedAt: string | null; requestedBy: string | null } | null;
  /**
   * Cleanups: what a restore would do. `restorable`: profiles a restore started now would send. `leftAlone`:
   * profiles the latest restore checked and left as they are, with the reasons; they are not offered again.
   * `fullyRestored`: no profile Klaviyo accepted is left unrestored, which is what makes a pending charge void
   * (same condition as billing/billing.ts).
   */
  undo: {
    restorable: number;
    restored: number;
    leftAlone: number;
    leftAloneReasons: { reason: string; count: number }[];
    fullyRestored: boolean;
    renewal: "yes" | "no" | "unknown";
    inProgress: boolean;
  } | null;
  undoRuns: RunListItem[];
  /** `sendAt`: when a charge that is not out yet goes to Shopify (end of the restore window). */
  charge: { status: string; feeCents: number; reason: string | null; chargedAt: string | null; sendAt: string | null } | null;
  /** Cleanups: who approved the simulation, when, and with which rules. Null when the simulation is gone. */
  approval: { by: string | null; automatic: boolean; at: string | null; recommendedRules: boolean; windows: RuleWindows } | null;
  /** Cleanups: profiles by the reason they were candidates (CandidateReason). */
  candidateReasons: { reason: string; count: number }[];
  /** Number of Klaviyo bulk jobs the run created. */
  jobCount: number;
}

export async function loadRunDetail(shop: string, runId: string, now = new Date()): Promise<RunDetail | null> {
  const run = await db.query.runs.findFirst({ where: and(eq(schema.runs.id, runId), eq(schema.runs.shop, shop)) });
  if (!run) return null;

  const counts = await db
    .select({ status: schema.runProfiles.status, n: sql<number>`COUNT(*)`, restored: sql<number>`SUM(CASE WHEN ${schema.runProfiles.reactivatedAt} IS NOT NULL THEN 1 ELSE 0 END)` })
    .from(schema.runProfiles)
    .where(eq(schema.runProfiles.runId, runId))
    .groupBy(schema.runProfiles.status);
  const progress: Record<string, number> = {};
  for (const c of counts) progress[c.status] = c.n;

  const skipRows = await db
    .select({ reason: sql<string>`COALESCE(${schema.runProfiles.errorCode}, 'skipped')`, n: sql<number>`COUNT(*)` })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.status, "skipped")))
    .groupBy(sql`COALESCE(${schema.runProfiles.errorCode}, 'skipped')`);
  const skipReasons = skipRows.map((r) => ({ reason: r.reason, count: r.n })).sort((a, b) => b.count - a.count);
  const open = run.status === "queued" || run.status === "running";
  const stop: RunDetail["stop"] =
    run.kind === "suppress" ? { canStop: open && !run.stopRequestedAt, requestedAt: run.stopRequestedAt?.toISOString() ?? null, requestedBy: run.stopRequestedBy } : null;

  const [jobs] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${schema.runProfiles.klaviyoJobId})` })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, runId), sql`${schema.runProfiles.klaviyoJobId} IS NOT NULL AND ${schema.runProfiles.klaviyoJobId} <> ${NO_JOB_ID}`));

  let undo: RunDetail["undo"] = null;
  let undoRuns: RunListItem[] = [];
  let charge: RunDetail["charge"] = null;
  let approval: RunDetail["approval"] = null;
  let candidateReasons: RunDetail["candidateReasons"] = [];
  if (run.kind === "suppress") {
    const simulation = run.simulationId
      ? await db.query.simulations.findFirst({ where: and(eq(schema.simulations.id, run.simulationId), eq(schema.simulations.shop, shop)), columns: { approvedAt: true, approvedBy: true, ruleSettings: true } })
      : null;
    if (simulation) {
      const rules = simulation.ruleSettings as RuleSettings;
      approval = {
        by: simulation.approvedBy && simulation.approvedBy !== "automatic" ? simulation.approvedBy.replace(/^user:/, "") : null,
        automatic: simulation.approvedBy === "automatic",
        at: simulation.approvedAt?.toISOString() ?? null,
        recommendedRules: isKlaviyoRecommended(rules),
        windows: { purchaseDays: rules.purchaseDays ?? null, clickDays: rules.clickDays ?? null, openDays: rules.openDays ?? null, siteActivityDays: rules.siteActivityDays ?? null },
      };
    }
    const reasonRows = await db
      .select({ reason: schema.runProfiles.reason, n: sql<number>`COUNT(*)` })
      .from(schema.runProfiles)
      .where(eq(schema.runProfiles.runId, runId))
      .groupBy(schema.runProfiles.reason);
    candidateReasons = reasonRows.map((r) => ({ reason: r.reason, count: r.n })).sort((a, b) => b.count - a.count);

    // Everything the cleanup may have changed in Klaviyo: accepted, or sent without a confirmed outcome.
    const [changed] = await db
      .select({ n: sql<number>`COUNT(*)`, restored: sql<number>`COALESCE(SUM(CASE WHEN ${schema.runProfiles.reactivatedAt} IS NOT NULL THEN 1 ELSE 0 END), 0)` })
      .from(schema.runProfiles)
      .where(and(eq(schema.runProfiles.runId, runId), sql.raw(MAYBE_CHANGED_SQL)));
    const restored = changed?.restored ?? 0;
    const [settings, audits, children, chargeRow] = await Promise.all([
      db.query.settings.findFirst({ where: eq(schema.settings.shop, shop), columns: { billingDay: true } }),
      db.query.audits.findMany({ where: eq(schema.audits.shop, shop), columns: { periodEnd: true }, orderBy: desc(schema.audits.createdAt), limit: 24 }),
      db.query.runs.findMany({ where: and(eq(schema.runs.undoOfRunId, runId), eq(schema.runs.shop, shop)), orderBy: desc(schema.runs.createdAt), limit: 10 }),
      db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) }),
    ]);
    undoRuns = children.map(toItem);
    // Profiles the latest finished restore checked and left as they are (provably not this cleanup's suppression,
    // gone from Klaviyo, erased on request). Every restore takes all that is still unrestored, so the latest one
    // speaks for all of them. They are not counted as restorable: offering them again would promise nothing.
    const lastRestore = children.find((c) => c.status !== "queued" && c.status !== "running");
    const leftRows = lastRestore
      ? await db
          .select({ reason: sql<string>`COALESCE(${schema.runProfiles.errorCode}, 'skipped')`, n: sql<number>`COUNT(*)` })
          .from(schema.runProfiles)
          .where(and(eq(schema.runProfiles.runId, lastRestore.id), eq(schema.runProfiles.status, "skipped")))
          .groupBy(sql`COALESCE(${schema.runProfiles.errorCode}, 'skipped')`)
      : [];
    const leftAloneReasons = leftRows.map((r) => ({ reason: r.reason, count: r.n })).sort((a, b) => b.count - a.count);
    const leftAlone = Math.min(leftAloneReasons.reduce((n, r) => n + r.count, 0), (changed?.n ?? 0) - restored);
    const [accepted] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.runProfiles)
      .where(and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.status, "submitted"), sql`${schema.runProfiles.reactivatedAt} IS NULL`));
    undo = {
      restorable: (changed?.n ?? 0) - restored - leftAlone,
      restored,
      leftAlone,
      leftAloneReasons,
      fullyRestored: restored > 0 && (accepted?.n ?? 0) === 0,
      renewal: renewalSince(run.finishedAt ?? run.createdAt, now, {
        periodEnds: audits.flatMap((a) => (a.periodEnd ? [a.periodEnd] : [])),
        billingDay: settings?.billingDay ?? null,
      }),
      inProgress: children.some((c) => c.status === "queued" || c.status === "running"),
    };
    const noWindow = chargeRow ? await chargedWithoutWindow(db, shop) : false;
    charge = chargeRow
      ? {
          status: chargeRow.status,
          feeCents: chargeRow.feeCents,
          reason: chargeRow.noChargeReason,
          chargedAt: chargeRow.chargedAt?.toISOString() ?? null,
          // Same instant as billing/billing.ts: the end of the restore window.
          sendAt:
            chargeRow.status === "pending" || chargeRow.status === "failed"
              ? new Date((run.finishedAt ?? chargeRow.createdAt).getTime() + (noWindow ? 0 : CHARGE_HOLD_HOURS) * 60 * 60 * 1000).toISOString()
              : null,
        }
      : null;
  }

  return { run: { ...toItem(run), createdBy: run.createdBy, undoOfRunId: run.undoOfRunId }, progress, skipReasons, stop, undo, undoRuns, charge, approval, candidateReasons, jobCount: jobs?.n ?? 0 };
}

/** Jobs read from Klaviyo per request: one page of the run's jobs, inside a Worker invocation's subrequest budget. */
export const JOBS_PER_CHECK = 25;

export interface JobsCheck {
  page: number;
  pages: number;
  jobs: { id: string; status: SuppressionJob["status"]; total: number | null; completed: number | null; skipped: number | null; completedAt: string | null }[];
  /** Jobs that could not be read (for example older than Klaviyo keeps them). */
  unreadable: number;
}

/** Asks Klaviyo for the state of one page of a run's bulk jobs. Read-only. */
export async function checkRunJobs(client: KlaviyoClient, args: { shop: string; runId: string; page: number }): Promise<JobsCheck | null> {
  const run = await db.query.runs.findFirst({ where: and(eq(schema.runs.id, args.runId), eq(schema.runs.shop, args.shop)), columns: { kind: true } });
  if (!run) return null;
  const rows = await db
    .selectDistinct({ jobId: schema.runProfiles.klaviyoJobId })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, args.runId), sql`${schema.runProfiles.klaviyoJobId} IS NOT NULL AND ${schema.runProfiles.klaviyoJobId} <> ${NO_JOB_ID}`))
    .orderBy(schema.runProfiles.klaviyoJobId);
  const ids = rows.flatMap((r) => (r.jobId ? [r.jobId] : []));
  const pages = Math.max(1, Math.ceil(ids.length / JOBS_PER_CHECK));
  const page = Math.min(Math.max(1, Math.trunc(args.page) || 1), pages);
  const jobs: JobsCheck["jobs"] = [];
  let unreadable = 0;
  for (const id of ids.slice((page - 1) * JOBS_PER_CHECK, page * JOBS_PER_CHECK)) {
    try {
      const job = await getSuppressionJob(client, run.kind === "undo" ? "unsuppress" : "suppress", id);
      jobs.push({ id: job.id, status: job.status, total: job.totalCount, completed: job.completedCount, skipped: job.skippedCount, completedAt: job.completedAt?.toISOString() ?? null });
    } catch {
      unreadable++;
    }
  }
  return { page, pages, jobs, unreadable };
}
