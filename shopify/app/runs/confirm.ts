import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { getSuppressionJob } from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";

/**
 * What Klaviyo itself reports for a cleanup's bulk jobs. A run records what it
 * SENT; the charge is only an estimate until every job is `complete` and the
 * profiles Klaviyo actually processed are known (decided 2026-11-25).
 */

type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

/** Recorded as the job id when a whole batch was skipped and no job was created (same value as gateway.server.ts). */
const NO_JOB = "none";

export interface JobsPage {
  /** Jobs of the run in total. */
  jobs: number;
  /** Jobs read in this page. */
  checked: number;
  /** False when any job in the page is not `complete` yet (or could not be read). */
  complete: boolean;
  /** Profiles Klaviyo processed in this page's jobs: completed minus skipped. */
  suppressed: number;
}

/** Reads one page of a run's jobs from Klaviyo, in a stable order. One request per job. */
export async function confirmJobsPage(db: Db, client: KlaviyoClient, args: { runId: string; offset: number; limit: number; shop?: string }): Promise<JobsPage> {
  const rows = await db
    .selectDistinct({ jobId: schema.runProfiles.klaviyoJobId })
    .from(schema.runProfiles)
    .where(
      and(
        eq(schema.runProfiles.runId, args.runId),
        // Callers that take the run id from a request pass the session's shop: another shop's jobs are never read.
        args.shop === undefined ? undefined : eq(schema.runProfiles.shop, args.shop),
        eq(schema.runProfiles.status, "submitted"),
        sql`${schema.runProfiles.klaviyoJobId} IS NOT NULL AND ${schema.runProfiles.klaviyoJobId} <> ${NO_JOB}`,
      ),
    )
    .orderBy(schema.runProfiles.klaviyoJobId);
  const ids = rows.flatMap((r) => (r.jobId ? [r.jobId] : []));
  let complete = true;
  let suppressed = 0;
  const page = ids.slice(args.offset, args.offset + args.limit);
  for (const id of page) {
    const job = await getSuppressionJob(client, "suppress", id);
    if (job.status !== "complete" || job.completedCount === null) {
      complete = false;
      continue;
    }
    suppressed += Math.max(0, job.completedCount - (job.skippedCount ?? 0));
  }
  return { jobs: ids.length, checked: page.length, complete, suppressed };
}

export interface JobsConfirmation {
  /** True when every job of the run is complete. */
  done: boolean;
  /** Profiles Klaviyo confirmed as processed. Meaningful only when `done`. */
  suppressed: number;
}

/** All jobs of a run in one go, for runs small enough for a single invocation. Null when there are more than `maxJobs`. */
export async function confirmRunJobs(db: Db, client: KlaviyoClient, runId: string, maxJobs = 40, shop?: string): Promise<JobsConfirmation | null> {
  const page = await confirmJobsPage(db, client, { runId, offset: 0, limit: maxJobs, shop });
  if (page.jobs > maxJobs) return null;
  return { done: page.complete, suppressed: page.suppressed };
}

/**
 * Confirmation of a run of any size from the hourly cron: one page of jobs per call, with the place kept on the
 * run's charge. A page counts only when every job in it is complete; otherwise the same page is read again next
 * time. Returns the confirmation once the last page is in, null while it is not (or when there is no charge row
 * yet). Also stamps the attempt, so charges that cannot be confirmed take turns instead of blocking the queue.
 */
export async function advanceChargeConfirmation(db: Db, client: KlaviyoClient, runId: string, limit = 10, now = new Date()): Promise<JobsConfirmation | null> {
  const charge = await db.query.usageCharges.findFirst({ where: eq(schema.usageCharges.runId, runId) });
  if (!charge) return null;
  await db.update(schema.usageCharges).set({ lastAttemptAt: now }).where(eq(schema.usageCharges.id, charge.id));
  const page = await confirmJobsPage(db, client, { runId, offset: charge.confirmOffset, limit });
  if (!page.complete) return { done: false, suppressed: 0 };
  const offset = charge.confirmOffset + page.checked;
  const suppressed = charge.confirmSuppressed + page.suppressed;
  await db.update(schema.usageCharges).set({ confirmOffset: offset, confirmSuppressed: suppressed }).where(eq(schema.usageCharges.id, charge.id));
  return offset >= page.jobs ? { done: true, suppressed } : { done: false, suppressed: 0 };
}
