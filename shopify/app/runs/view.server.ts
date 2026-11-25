import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db.server";
import { getSuppressionJob, type SuppressionJob } from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";
import { NO_JOB_ID } from "./gateway.server";
import { renewalSince } from "./engine";

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
  error: string | null;
}

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
  error: r.lastError,
});

export async function listRuns(shop: string, limit = 30): Promise<RunListItem[]> {
  const rows = await db.query.runs.findMany({ where: eq(schema.runs.shop, shop), orderBy: desc(schema.runs.createdAt), limit });
  return rows.map(toItem);
}

export interface RunDetail {
  run: RunListItem & { createdBy: string; undoOfRunId: string | null };
  /** Live progress while the run is going: profiles by state. */
  progress: Record<string, number>;
  /** Suppress runs: how many profiles an undo would restore, and whether it needs the renewal confirmation. */
  undo: { restorable: number; restored: number; renewal: "yes" | "no" | "unknown"; inProgress: boolean } | null;
  undoRuns: RunListItem[];
  charge: { status: string; feeCents: number; reason: string | null; chargedAt: string | null } | null;
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

  const [jobs] = await db
    .select({ n: sql<number>`COUNT(DISTINCT ${schema.runProfiles.klaviyoJobId})` })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, runId), sql`${schema.runProfiles.klaviyoJobId} IS NOT NULL AND ${schema.runProfiles.klaviyoJobId} <> ${NO_JOB_ID}`));

  let undo: RunDetail["undo"] = null;
  let undoRuns: RunListItem[] = [];
  let charge: RunDetail["charge"] = null;
  if (run.kind === "suppress") {
    const submitted = counts.find((c) => c.status === "submitted");
    const restored = submitted?.restored ?? 0;
    const [settings, audits, children, chargeRow] = await Promise.all([
      db.query.settings.findFirst({ where: eq(schema.settings.shop, shop), columns: { billingDay: true } }),
      db.query.audits.findMany({ where: eq(schema.audits.shop, shop), columns: { periodEnd: true }, orderBy: desc(schema.audits.createdAt), limit: 24 }),
      db.query.runs.findMany({ where: and(eq(schema.runs.undoOfRunId, runId), eq(schema.runs.shop, shop)), orderBy: desc(schema.runs.createdAt), limit: 10 }),
      db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) }),
    ]);
    undoRuns = children.map(toItem);
    undo = {
      restorable: (submitted?.n ?? 0) - restored,
      restored,
      renewal: renewalSince(run.finishedAt ?? run.createdAt, now, {
        periodEnds: audits.flatMap((a) => (a.periodEnd ? [a.periodEnd] : [])),
        billingDay: settings?.billingDay ?? null,
      }),
      inProgress: children.some((c) => c.status === "queued" || c.status === "running"),
    };
    charge = chargeRow
      ? { status: chargeRow.status, feeCents: chargeRow.feeCents, reason: chargeRow.noChargeReason, chargedAt: chargeRow.chargedAt?.toISOString() ?? null }
      : null;
  }

  return { run: { ...toItem(run), createdBy: run.createdBy, undoOfRunId: run.undoOfRunId }, progress, undo, undoRuns, charge, jobCount: jobs?.n ?? 0 };
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
