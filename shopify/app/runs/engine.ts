import { SIMULATION_TTL_MS, whyNotExecutable, type NotExecutableReason } from "@tiersaver/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * Run engine: creates a suppression run from an approved simulation and
 * executes it batch by batch. It has no Cloudflare or Klaviyo imports so the
 * same code runs inside a Workflow (durable steps) and in tests (fake steps).
 *
 * Guarantees:
 * - A run can only be created from a simulation that is approved, fresh
 *   (< 24 h), not superseded and not executed. The check is a single atomic
 *   SQL transaction, not just an in-memory test.
 * - Each profile belongs to exactly one batch, fixed at creation. A batch step
 *   only touches rows that are not finished, so a resumed run never skips a
 *   profile and never submits a finished batch twice.
 * - When anything is uncertain (gate fails, a batch keeps failing, the run is
 *   cancelled) the run stops and the remaining profiles stay untouched.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

/** Klaviyo accepts at most 100 emails per bulk suppression request. */
export const RUN_BATCH_SIZE = 100;

/** D1 allows at most 100 bound parameters per statement. */
const ID_CHUNK = 50;

export type RunKind = (typeof schema.RUN_KINDS)[number];
export type RunStatus = (typeof schema.RUN_STATUSES)[number];

export interface StepConfig {
  retries?: { limit: number; delay: string | number; backoff?: "constant" | "linear" | "exponential" };
  timeout?: string | number;
}

/** The part of Cloudflare's WorkflowStep the engine needs. */
export interface StepRunner {
  do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T>;
}

export interface BatchRequest {
  shop: string;
  runId: string;
  kind: RunKind;
  batchIndex: number;
  /** Klaviyo profile ids, at most RUN_BATCH_SIZE. */
  profileIds: string[];
}

export interface BatchResult {
  /** Klaviyo bulk job id that carried the batch. */
  jobId: string;
  /** Profiles the gateway deliberately left untouched (for example they no longer exist). */
  skippedProfileIds?: string[];
}

/**
 * The side-effecting part of a run. Implementations resolve profile ids to
 * emails at call time (emails are never stored) and call Klaviyo's bulk
 * suppress / unsuppress endpoints.
 *
 * `submitBatch` MUST be safe to call again with the same batch: a retry after
 * a lost response repeats the request. Klaviyo's bulk suppression is
 * idempotent per email, which is what makes that safe.
 */
export interface SuppressionGateway {
  submitBatch(request: BatchRequest): Promise<BatchResult>;
}

export const BATCH_STEP_CONFIG: StepConfig = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const DB_STEP_CONFIG: StepConfig = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "1 minute",
};

export type CreateRunResult =
  | { ok: true; runId: string; totalCount: number; batchCount: number }
  | { ok: false; reason: NotExecutableReason | "not_found" | "no_candidates" };

/**
 * Creates the run for an approved simulation and freezes its profile set.
 * This is the only way a suppression run comes into existence.
 */
export async function createSuppressionRun(
  db: Db,
  args: { shop: string; simulationId: string; createdBy: string; origin?: "manual" | "scheduled"; runId?: string; now?: Date },
): Promise<CreateRunResult> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const runId = args.runId ?? crypto.randomUUID();
  const origin = args.origin ?? "manual";

  const sim = await db.query.simulations.findFirst({
    where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)),
  });
  if (!sim) return { ok: false, reason: "not_found" };

  const settingsRow = await db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop) });
  // Settings changed (or are missing) since the simulation was computed: its result no longer applies.
  const superseded = Boolean(sim.supersededAt) || !settingsRow || settingsRow.version !== sim.settingsVersion;
  const notExecutable = whyNotExecutable(
    { createdAt: sim.createdAt, approvedAt: sim.approvedAt, executedAt: sim.executedAt, superseded },
    now,
  );
  if (notExecutable) return { ok: false, reason: notExecutable };
  if (sim.candidateCount <= 0) return { ok: false, reason: "no_candidates" };

  // The real gate. All statements run in one transaction; every statement after
  // the first only takes effect if the first one claimed the simulation.
  const d1 = db.$client;
  await d1.batch([
    d1
      .prepare(
        `UPDATE simulations SET executed_at = ?1
         WHERE id = ?2 AND shop = ?3
           AND executed_at IS NULL
           AND superseded_at IS NULL
           AND approved_at IS NOT NULL AND approved_by IS NOT NULL
           AND approved_at >= created_at
           AND created_at > ?4
           AND settings_version = (SELECT version FROM settings WHERE shop = ?3)
           AND NOT EXISTS (SELECT 1 FROM runs WHERE simulation_id = ?2)`,
      )
      .bind(nowMs, sim.id, args.shop, nowMs - SIMULATION_TTL_MS),
    d1
      .prepare(
        `INSERT INTO runs (id, shop, kind, simulation_id, origin, status, created_by, created_at)
         SELECT ?1, shop, 'suppress', id, ?2, 'queued', ?3, ?4
         FROM simulations
         WHERE id = ?5 AND executed_at = ?4
           AND NOT EXISTS (SELECT 1 FROM runs WHERE simulation_id = ?5)`,
      )
      .bind(runId, origin, args.createdBy, nowMs, sim.id),
    d1
      .prepare(
        `INSERT INTO run_profiles (run_id, profile_id, shop, batch_index, reason, email_hash, status, updated_at)
         SELECT ?1, profile_id, ?2, (ROW_NUMBER() OVER (ORDER BY profile_id) - 1) / CAST(?3 AS INTEGER), reason, email_hash, 'pending', ?4
         FROM simulation_candidates
         WHERE simulation_id = ?5 AND EXISTS (SELECT 1 FROM runs WHERE id = ?1)`,
      )
      .bind(runId, args.shop, RUN_BATCH_SIZE, nowMs, sim.id),
    d1
      .prepare(
        `UPDATE runs SET
           total_count = (SELECT COUNT(*) FROM run_profiles WHERE run_id = ?1),
           batch_count = (SELECT COALESCE(MAX(batch_index) + 1, 0) FROM run_profiles WHERE run_id = ?1)
         WHERE id = ?1`,
      )
      .bind(runId),
    d1
      .prepare(
        `INSERT INTO events_log (id, shop, at, actor, action, run_id, simulation_id, detail)
         SELECT ?1, ?2, ?3, ?4, 'run.created', ?5, ?6, json_object('origin', ?7)
         WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?5)`,
      )
      .bind(`run:${runId}:created`, args.shop, nowMs, args.createdBy, runId, sim.id, origin),
  ]);

  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) {
    // Lost a race with another request, or the simulation changed in between.
    const fresh = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, sim.id) });
    if (fresh?.executedAt) return { ok: false, reason: "already_executed" };
    return { ok: false, reason: "superseded" };
  }
  return { ok: true, runId, totalCount: run.totalCount, batchCount: run.batchCount };
}

export interface RunOutcome {
  runId: string;
  status: RunStatus | "not_found";
  submitted: number;
  skipped: number;
  failed: number;
  /** Profiles the run never reached. They were not touched. */
  untouched: number;
  error: string | null;
}

type StartResult =
  | { proceed: true; shop: string; kind: RunKind; batchCount: number }
  | { proceed: false; error: string | null };

type BatchStepResult = { state: "done"; submitted: number; skipped: number } | { state: "cancelled" };

const TERMINAL: readonly RunStatus[] = ["completed", "completed_with_errors", "failed", "cancelled"];

/** Machine-readable, PII-free error label for `runs.last_error`. */
export function errorCode(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : "unknown_error";
  const code = raw
    // The Workflows engine prefixes the message with the error class name.
    .replace(/^\w*Error:\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return code || "unknown_error";
}

/**
 * Executes a run. Safe to call again for the same run at any point: finished
 * steps are replayed from the step runner's cache, and batch steps skip rows
 * that are already done.
 */
export async function executeRun(
  deps: { db: Db; gateway: SuppressionGateway; step: StepRunner; now?: () => Date },
  runId: string,
): Promise<RunOutcome> {
  const { db, gateway, step } = deps;
  const now = deps.now ?? (() => new Date());

  const start = await step.do<StartResult>("start run", DB_STEP_CONFIG, async () => {
    const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
    if (!run) return { proceed: false, error: "run_not_found" };
    if (TERMINAL.includes(run.status)) return { proceed: false, error: null };

    if (run.kind === "suppress") {
      const gateError = await suppressGateError(db, run, now());
      if (gateError) {
        await db
          .update(schema.runs)
          .set({ status: "failed", lastError: gateError, finishedAt: now() })
          .where(eq(schema.runs.id, runId));
        return { proceed: false, error: gateError };
      }
    }

    await db
      .update(schema.runs)
      .set({ status: "running", startedAt: run.startedAt ?? now() })
      .where(eq(schema.runs.id, runId));
    return { proceed: true, shop: run.shop, kind: run.kind, batchCount: run.batchCount };
  });

  let runError: string | null = start.proceed ? null : start.error;
  let cancelled = false;

  if (start.proceed) {
    for (let batchIndex = 0; batchIndex < start.batchCount; batchIndex++) {
      try {
        const result = await step.do<BatchStepResult>(`batch ${batchIndex}`, BATCH_STEP_CONFIG, () =>
          runBatch(db, gateway, { runId, shop: start.shop, kind: start.kind, batchIndex, now: now() }),
        );
        if (result.state === "cancelled") {
          cancelled = true;
          break;
        }
      } catch (err) {
        // Retries are exhausted (or the error is not retryable). Stop here: the
        // rest of the run stays untouched rather than pushing through a failure.
        runError = errorCode(err);
        await step.do("record failed batch", DB_STEP_CONFIG, async () => {
          await db
            .update(schema.runProfiles)
            .set({ status: "failed", errorCode: runError, updatedAt: now() })
            .where(
              and(
                eq(schema.runProfiles.runId, runId),
                eq(schema.runProfiles.batchIndex, batchIndex),
                inArray(schema.runProfiles.status, ["pending", "submitting"]),
              ),
            );
          return true;
        });
        break;
      }
    }
  }

  return step.do<RunOutcome>("finalize run", DB_STEP_CONFIG, () => finalizeRun(db, runId, { runError, cancelled, now: now() }));
}

/** Re-checks the simulation gate when the run starts. Returns an error code, or null when clear. */
async function suppressGateError(db: Db, run: typeof schema.runs.$inferSelect, now: Date): Promise<string | null> {
  if (!run.simulationId) return "simulation_missing";
  const sim = await db.query.simulations.findFirst({ where: eq(schema.simulations.id, run.simulationId) });
  if (!sim || sim.shop !== run.shop) return "simulation_missing";
  const settingsRow = await db.query.settings.findFirst({ where: eq(schema.settings.shop, run.shop) });
  const superseded = Boolean(sim.supersededAt) || !settingsRow || settingsRow.version !== sim.settingsVersion;
  // `executedAt` was set by this run's own creation, so it is not a reason to stop here.
  const reason = whyNotExecutable(
    { createdAt: sim.createdAt, approvedAt: sim.approvedAt, executedAt: null, superseded },
    now,
  );
  return reason ? `simulation_${reason}` : null;
}

async function runBatch(
  db: Db,
  gateway: SuppressionGateway,
  args: { runId: string; shop: string; kind: RunKind; batchIndex: number; now: Date },
): Promise<BatchStepResult> {
  const { runId, batchIndex } = args;
  const inBatch = and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.batchIndex, batchIndex));

  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId), columns: { status: true } });
  if (!run || run.status !== "running") return { state: "cancelled" };

  // Rows left in "submitting" come from an attempt that died mid-flight; they are sent again.
  const open = and(inBatch, inArray(schema.runProfiles.status, ["pending", "submitting"]));
  const rows = await db
    .select({ profileId: schema.runProfiles.profileId })
    .from(schema.runProfiles)
    .where(open)
    .orderBy(asc(schema.runProfiles.profileId));
  if (rows.length === 0) return { state: "done", submitted: 0, skipped: 0 };
  if (rows.length > RUN_BATCH_SIZE) throw new Error("batch_too_large");

  await db.update(schema.runProfiles).set({ status: "submitting", updatedAt: args.now }).where(open);

  const profileIds = rows.map((r) => r.profileId);
  const result = await gateway.submitBatch({ shop: args.shop, runId, kind: args.kind, batchIndex, profileIds });

  const known = new Set(profileIds);
  const skipped = [...new Set(result.skippedProfileIds ?? [])].filter((id) => known.has(id));
  for (let i = 0; i < skipped.length; i += ID_CHUNK) {
    await db
      .update(schema.runProfiles)
      .set({ status: "skipped", klaviyoJobId: result.jobId, updatedAt: args.now })
      .where(and(inBatch, inArray(schema.runProfiles.profileId, skipped.slice(i, i + ID_CHUNK))));
  }
  await db
    .update(schema.runProfiles)
    .set({ status: "submitted", klaviyoJobId: result.jobId, updatedAt: args.now })
    .where(and(inBatch, eq(schema.runProfiles.status, "submitting")));

  return { state: "done", submitted: profileIds.length - skipped.length, skipped: skipped.length };
}

async function finalizeRun(
  db: Db,
  runId: string,
  args: { runError: string | null; cancelled: boolean; now: Date },
): Promise<RunOutcome> {
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) {
    return { runId, status: "not_found", submitted: 0, skipped: 0, failed: 0, untouched: 0, error: "run_not_found" };
  }

  const counts = await db
    .select({ status: schema.runProfiles.status, n: sql<number>`COUNT(*)` })
    .from(schema.runProfiles)
    .where(eq(schema.runProfiles.runId, runId))
    .groupBy(schema.runProfiles.status);
  const count = (s: (typeof schema.RUN_PROFILE_STATUSES)[number]) => counts.find((c) => c.status === s)?.n ?? 0;
  const submitted = count("submitted");
  const skipped = count("skipped");
  const failed = count("failed");
  const untouched = count("pending") + count("submitting");

  let status: RunStatus;
  if (TERMINAL.includes(run.status)) status = run.status;
  else if (args.cancelled) status = "cancelled";
  else if (args.runError && submitted === 0) status = "failed";
  else if (args.runError || failed > 0 || untouched > 0) status = "completed_with_errors";
  else status = "completed";

  const error = args.runError ?? run.lastError ?? null;
  if (run.kind === "undo" && run.undoOfRunId) {
    // What the undo sent to Klaviyo is now restored: stamp the original rows. The scan reads this stamp
    // (by email hash) to keep restored profiles out of every cleanup for `reactivationLockDays`.
    await db.$client
      .prepare(
        `UPDATE run_profiles SET reactivated_at = ?1, updated_at = ?1
         WHERE run_id = ?2 AND reactivated_at IS NULL
           AND profile_id IN (SELECT profile_id FROM run_profiles WHERE run_id = ?3 AND status = 'submitted')`,
      )
      .bind(args.now.getTime(), run.undoOfRunId, runId)
      .run();
  }
  await db.batch([
    db
      .update(schema.runs)
      .set({
        status,
        processedCount: submitted,
        skippedCount: skipped,
        failedCount: failed,
        lastError: error,
        finishedAt: run.finishedAt ?? args.now,
      })
      .where(eq(schema.runs.id, runId)),
    db
      .insert(schema.eventsLog)
      .values({
        id: `run:${runId}:finished`,
        shop: run.shop,
        at: args.now,
        actor: "system",
        action: `run.${status}`,
        runId,
        simulationId: run.simulationId,
        detail: { submitted, skipped, failed, untouched, error },
      })
      .onConflictDoNothing(),
  ]);

  return { runId, status, submitted, skipped, failed, untouched, error };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a finished cleanup has already been through a Klaviyo plan renewal.
 * "unknown" is treated like "yes" by the caller: the merchant is warned.
 *
 * Sources, best first: a billing period end reported by Klaviyo (stored with
 * each audit), the billing day the merchant entered, and finally elapsed time
 * (a monthly plan renews at least once in 31 days).
 */
export function renewalSince(
  finishedAt: Date,
  now: Date,
  known: { periodEnds: readonly Date[]; billingDay: number | null },
): "yes" | "no" | "unknown" {
  const after = known.periodEnds.filter((d) => d.getTime() >= finishedAt.getTime()).sort((a, b) => a.getTime() - b.getTime());
  if (after[0]) return after[0].getTime() <= now.getTime() ? "yes" : "no";
  if (known.billingDay) {
    const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    // First billing date strictly after the day the run finished.
    const y = finishedAt.getUTCFullYear();
    const m = finishedAt.getUTCMonth();
    const inMonth = (yy: number, mm: number) => Date.UTC(yy, mm, Math.min(known.billingDay!, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()));
    const next = inMonth(y, m) > day(finishedAt) ? inMonth(y, m) : inMonth(y, m + 1);
    return next <= day(now) ? "yes" : "no";
  }
  if (now.getTime() - finishedAt.getTime() >= 31 * DAY_MS) return "yes";
  return "unknown";
}

export type CreateUndoResult =
  | { ok: true; runId: string; totalCount: number; batchCount: number }
  | {
      ok: false;
      reason: "not_found" | "not_a_cleanup" | "still_running" | "nothing_to_restore" | "undo_in_progress" | "needs_renewal_confirmation";
      renewal?: "yes" | "unknown";
    };

/**
 * Creates the run that unsuppresses what a cleanup suppressed. Always
 * available (product rule 3) and independent of SUPPRESSION_ENABLED.
 *
 * Guardrail 5 (docs/12-CUMPLIMIENTO-KLAVIYO.md 3.1): when the cleanup has
 * already been counted in a plan renewal, or that cannot be ruled out, the
 * caller must pass `confirmAfterRenewal` after showing the warning. Restored
 * profiles stay out of every cleanup for `reactivationLockDays` (365).
 */
export async function createUndoRun(
  db: Db,
  args: { shop: string; runId: string; createdBy: string; confirmAfterRenewal?: boolean; undoRunId?: string; now?: Date },
): Promise<CreateUndoResult> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const original = await db.query.runs.findFirst({ where: and(eq(schema.runs.id, args.runId), eq(schema.runs.shop, args.shop)) });
  if (!original) return { ok: false, reason: "not_found" };
  if (original.kind !== "suppress") return { ok: false, reason: "not_a_cleanup" };
  if (!TERMINAL.includes(original.status)) return { ok: false, reason: "still_running" };

  const open = await db.query.runs.findFirst({
    where: and(eq(schema.runs.undoOfRunId, original.id), inArray(schema.runs.status, ["queued", "running"])),
    columns: { id: true },
  });
  if (open) return { ok: false, reason: "undo_in_progress" };

  const [restorable] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.runProfiles)
    .where(and(eq(schema.runProfiles.runId, original.id), eq(schema.runProfiles.status, "submitted"), sql`${schema.runProfiles.reactivatedAt} IS NULL`));
  if (!restorable || restorable.n === 0) return { ok: false, reason: "nothing_to_restore" };

  const [settingsRow, audits] = await Promise.all([
    db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop), columns: { billingDay: true } }),
    db.query.audits.findMany({ where: eq(schema.audits.shop, args.shop), columns: { periodEnd: true }, orderBy: (a, { desc }) => desc(a.createdAt), limit: 24 }),
  ]);
  const renewal = renewalSince(original.finishedAt ?? original.createdAt, now, {
    periodEnds: audits.flatMap((a) => (a.periodEnd ? [a.periodEnd] : [])),
    billingDay: settingsRow?.billingDay ?? null,
  });
  if (renewal !== "no" && !args.confirmAfterRenewal) return { ok: false, reason: "needs_renewal_confirmation", renewal };

  const undoRunId = args.undoRunId ?? crypto.randomUUID();
  const d1 = db.$client;
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO runs (id, shop, kind, undo_of_run_id, origin, status, created_by, created_at)
         SELECT ?1, shop, 'undo', id, 'manual', 'queued', ?2, ?3
         FROM runs
         WHERE id = ?4 AND shop = ?5 AND kind = 'suppress'
           AND status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')
           AND NOT EXISTS (SELECT 1 FROM runs WHERE undo_of_run_id = ?4 AND status IN ('queued', 'running'))`,
      )
      .bind(undoRunId, args.createdBy, nowMs, original.id, args.shop),
    d1
      .prepare(
        `INSERT INTO run_profiles (run_id, profile_id, shop, batch_index, reason, email_hash, status, updated_at)
         SELECT ?1, profile_id, shop, (ROW_NUMBER() OVER (ORDER BY profile_id) - 1) / CAST(?2 AS INTEGER), reason, email_hash, 'pending', ?3
         FROM run_profiles
         WHERE run_id = ?4 AND status = 'submitted' AND reactivated_at IS NULL
           AND EXISTS (SELECT 1 FROM runs WHERE id = ?1)`,
      )
      .bind(undoRunId, RUN_BATCH_SIZE, nowMs, original.id),
    d1
      .prepare(
        `UPDATE runs SET
           total_count = (SELECT COUNT(*) FROM run_profiles WHERE run_id = ?1),
           batch_count = (SELECT COALESCE(MAX(batch_index) + 1, 0) FROM run_profiles WHERE run_id = ?1)
         WHERE id = ?1`,
      )
      .bind(undoRunId),
    d1
      .prepare(
        `INSERT INTO events_log (id, shop, at, actor, action, run_id, detail)
         SELECT ?1, ?2, ?3, ?4, 'undo.created', ?5, json_object('undoOfRunId', ?6, 'renewal', ?7, 'confirmedAfterRenewal', json(?8))
         WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?5)`,
      )
      .bind(`run:${undoRunId}:created`, args.shop, nowMs, args.createdBy, undoRunId, original.id, renewal, args.confirmAfterRenewal ? "true" : "false"),
  ]);

  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, undoRunId) });
  if (!run) return { ok: false, reason: "undo_in_progress" };
  return { ok: true, runId: undoRunId, totalCount: run.totalCount, batchCount: run.batchCount };
}
