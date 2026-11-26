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
 * - A profile whose request went out but whose answer was lost is never
 *   recorded as "not processed": it is kept as "outcome unknown" (status
 *   `failed` with `attempted_at` set), counted apart and included in undo.
 * - One cleanup at a time per shop: a second one cannot be created while
 *   another is queued or running.
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
  /**
   * Profiles of this batch that an earlier attempt already sent to Klaviyo without learning the outcome.
   * Their current state in Klaviyo may be the effect of that attempt.
   */
  maybeSentProfileIds?: string[];
  /**
   * The gateway awaits this right before the request that changes Klaviyo, with the profiles that request
   * carries. It is what lets a lost answer be told apart from a batch that never left.
   */
  beforeSend?: (profileIds: string[]) => Promise<void>;
}

export interface BatchResult {
  /** Klaviyo bulk job id that carried the batch. */
  jobId: string;
  /** Profiles the gateway deliberately left untouched (for example they no longer exist). */
  skippedProfileIds?: string[];
  /** Why each skipped profile was left untouched: machine-readable code, no personal data. Stored in `run_profiles.error_code`. */
  skipReasons?: Record<string, string>;
  /**
   * Profiles of `maybeSentProfileIds` that were not sent again because Klaviyo's own state shows the earlier
   * attempt was applied. They are recorded as submitted; the job that carried them is not known.
   */
  confirmedProfileIds?: string[];
}

/** `run_profiles.error_code` (informative) of a submitted profile whose job id was lost but whose state in Klaviyo proves it was applied. */
export const CONFIRMED_BY_STATE = "confirmed_by_state";

/** `run_profiles.error_code` of a profile that was sent to Klaviyo without a confirmed outcome. */
export const OUTCOME_UNKNOWN = "outcome_unknown";

/**
 * SQL condition (on `run_profiles`) for "this run may have changed this profile in Klaviyo": Klaviyo accepted
 * it, or its request went out and the outcome is unknown. This is the set an undo restores.
 */
export const MAYBE_CHANGED_SQL = "(status = 'submitted' OR (attempted_at IS NOT NULL AND status <> 'skipped'))";

const NOT_SENT = Symbol.for("tiersaver.batch_not_sent");

/** Gateways mark an error with this when the request was certainly not applied by Klaviyo (never sent, or rejected). */
export function markNotSent<E extends Error>(error: E): E {
  (error as unknown as Record<symbol, boolean>)[NOT_SENT] = true;
  return error;
}

function isNotSent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as Record<symbol, boolean>)[NOT_SENT]);
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
  | { ok: false; reason: NotExecutableReason | "not_found" | "no_candidates" | "cleanup_in_progress" };

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
  // One cleanup at a time: a scan made while another cleanup is still sending batches sees profiles as active
  // that are about to be suppressed, and the same profile would end up in two runs.
  const openRun = () =>
    db.query.runs.findFirst({
      where: and(eq(schema.runs.shop, args.shop), eq(schema.runs.kind, "suppress"), inArray(schema.runs.status, ["queued", "running"])),
      columns: { id: true },
    });
  if (await openRun()) return { ok: false, reason: "cleanup_in_progress" };

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
           AND NOT EXISTS (SELECT 1 FROM runs WHERE simulation_id = ?2)
           AND NOT EXISTS (SELECT 1 FROM runs WHERE shop = ?3 AND kind = 'suppress' AND status IN ('queued', 'running'))`,
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
    if (await openRun()) return { ok: false, reason: "cleanup_in_progress" };
    return { ok: false, reason: "superseded" };
  }
  return { ok: true, runId, totalCount: run.totalCount, batchCount: run.batchCount };
}

export interface RunOutcome {
  runId: string;
  status: RunStatus | "not_found";
  submitted: number;
  skipped: number;
  /** Not processed, and certainly not sent to Klaviyo. */
  failed: number;
  /** Sent to Klaviyo without a confirmed outcome: possibly changed there. An undo includes them. */
  unknown: number;
  /** Profiles the run never reached. They were not touched. */
  untouched: number;
  error: string | null;
}

type StartResult =
  | { proceed: true; shop: string; kind: RunKind; batchCount: number }
  | { proceed: false; error: string | null; cancelled?: boolean };

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
    // "Stop cleanup" was pressed before the first batch: nothing is sent.
    if (run.stopRequestedAt) return { proceed: false, error: null, cancelled: true };

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
      .set({ status: "running", startedAt: run.startedAt ?? now(), lastProgressAt: now() })
      .where(eq(schema.runs.id, runId));
    return { proceed: true, shop: run.shop, kind: run.kind, batchCount: run.batchCount };
  });

  let runError: string | null = start.proceed ? null : start.error;
  let cancelled = !start.proceed && start.cancelled === true;

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
          const open = and(
            eq(schema.runProfiles.runId, runId),
            eq(schema.runProfiles.batchIndex, batchIndex),
            inArray(schema.runProfiles.status, ["pending", "submitting"]),
          );
          // Never sent: untouched for certain. Sent without an answer: Klaviyo may have applied it (M3).
          await db
            .update(schema.runProfiles)
            .set({ status: "failed", errorCode: runError, updatedAt: now() })
            .where(and(open, sql`${schema.runProfiles.attemptedAt} IS NULL`));
          await db
            .update(schema.runProfiles)
            .set({ status: "failed", errorCode: OUTCOME_UNKNOWN, updatedAt: now() })
            .where(and(open, sql`${schema.runProfiles.attemptedAt} IS NOT NULL`));
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

  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId), columns: { status: true, stopRequestedAt: true } });
  // Closed by someone else (recovery), or the merchant pressed "Stop cleanup": nothing more is sent.
  if (!run || run.status !== "running" || run.stopRequestedAt) return { state: "cancelled" };
  await db.update(schema.runs).set({ lastProgressAt: args.now }).where(eq(schema.runs.id, runId));

  // Rows left in "submitting" come from an attempt that died mid-flight; they are sent again.
  const open = and(inBatch, inArray(schema.runProfiles.status, ["pending", "submitting"]));
  const rows = await db
    .select({ profileId: schema.runProfiles.profileId, attemptedAt: schema.runProfiles.attemptedAt })
    .from(schema.runProfiles)
    .where(open)
    .orderBy(asc(schema.runProfiles.profileId));
  if (rows.length === 0) return { state: "done", submitted: 0, skipped: 0 };
  if (rows.length > RUN_BATCH_SIZE) throw new Error("batch_too_large");

  await db.update(schema.runProfiles).set({ status: "submitting", updatedAt: args.now }).where(open);

  const profileIds = rows.map((r) => r.profileId);
  const known = new Set(profileIds);
  // Sent by an earlier attempt whose answer never arrived.
  const maybeSent = new Set(rows.filter((r) => r.attemptedAt).map((r) => r.profileId));
  const stampedNow: string[] = [];
  const nowMs = args.now.getTime();
  const setAttempted = (ids: string[], value: number | null) =>
    eachChunk(ids, (part) =>
      db
        .update(schema.runProfiles)
        .set({ attemptedAt: value === null ? null : sql`COALESCE(${schema.runProfiles.attemptedAt}, ${value})` })
        .where(and(inBatch, inArray(schema.runProfiles.profileId, part))),
    );

  let result: BatchResult;
  try {
    result = await gateway.submitBatch({
      shop: args.shop,
      runId,
      kind: args.kind,
      batchIndex,
      profileIds,
      maybeSentProfileIds: [...maybeSent],
      beforeSend: async (ids) => {
        const fresh = ids.filter((id) => known.has(id) && !maybeSent.has(id));
        await setAttempted(fresh, nowMs);
        stampedNow.push(...fresh);
      },
    });
  } catch (err) {
    // Rejected or never sent: Klaviyo certainly did not apply it, so this attempt leaves no "maybe sent" mark.
    if (isNotSent(err) && stampedNow.length > 0) await setAttempted(stampedNow, null);
    throw err;
  }

  // Applied by the earlier attempt, as Klaviyo itself shows: done, although that attempt's job id was lost.
  const confirmed = [...new Set(result.confirmedProfileIds ?? [])].filter((id) => maybeSent.has(id));
  await eachChunk(confirmed, (part) =>
    db
      .update(schema.runProfiles)
      .set({ status: "submitted", errorCode: CONFIRMED_BY_STATE, updatedAt: args.now })
      .where(and(inBatch, inArray(schema.runProfiles.profileId, part))),
  );
  const skipped = [...new Set(result.skippedProfileIds ?? [])].filter((id) => known.has(id) && !confirmed.includes(id));
  const byReason = new Map<string, string[]>();
  for (const id of skipped) {
    // Left out now, but an earlier attempt sent it: what Klaviyo did with it is unknown, so it is not "untouched".
    const reason = maybeSent.has(id) ? OUTCOME_UNKNOWN : (result.skipReasons?.[id] ?? "skipped");
    byReason.set(reason, [...(byReason.get(reason) ?? []), id]);
  }
  for (const [reason, ids] of byReason) {
    await eachChunk(ids, (part) =>
      db
        .update(schema.runProfiles)
        .set({ status: reason === OUTCOME_UNKNOWN ? "failed" : "skipped", errorCode: reason, klaviyoJobId: result.jobId, updatedAt: args.now })
        .where(and(inBatch, inArray(schema.runProfiles.profileId, part))),
    );
  }
  await db
    .update(schema.runProfiles)
    .set({ status: "submitted", klaviyoJobId: result.jobId, errorCode: null, attemptedAt: sql`COALESCE(${schema.runProfiles.attemptedAt}, ${nowMs})`, updatedAt: args.now })
    .where(and(inBatch, eq(schema.runProfiles.status, "submitting")));

  return { state: "done", submitted: profileIds.length - skipped.length, skipped: skipped.length };
}

async function eachChunk(ids: readonly string[], run: (part: string[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) await run(ids.slice(i, i + ID_CHUNK));
}

/**
 * Closes a run whose Workflow is gone (see runs/recovery.ts) with what was really sent. Rows an attempt had
 * claimed are settled first: already sent -> outcome unknown; never sent -> untouched again. Idempotent, and
 * harmless if the Workflow turns out to be alive: its next batch sees the closed run and stops.
 */
export async function closeStalledRun(db: Db, runId: string, args: { error: string; now?: Date }): Promise<RunOutcome> {
  const now = args.now ?? new Date();
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId), columns: { status: true, stopRequestedAt: true } });
  if (run && !TERMINAL.includes(run.status)) {
    const claimed = and(eq(schema.runProfiles.runId, runId), eq(schema.runProfiles.status, "submitting"));
    await db
      .update(schema.runProfiles)
      .set({ status: "failed", errorCode: OUTCOME_UNKNOWN, updatedAt: now })
      .where(and(claimed, sql`${schema.runProfiles.attemptedAt} IS NOT NULL`));
    await db.update(schema.runProfiles).set({ status: "pending", updatedAt: now }).where(claimed);
  }
  return finalizeRun(db, runId, { runError: run?.stopRequestedAt ? null : args.error, cancelled: Boolean(run?.stopRequestedAt), now });
}

async function finalizeRun(
  db: Db,
  runId: string,
  args: { runError: string | null; cancelled: boolean; now: Date },
): Promise<RunOutcome> {
  const run = await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) });
  if (!run) {
    return { runId, status: "not_found", submitted: 0, skipped: 0, failed: 0, unknown: 0, untouched: 0, error: "run_not_found" };
  }

  const counts = await db
    .select({ status: schema.runProfiles.status, attempted: sql<number>`${schema.runProfiles.attemptedAt} IS NOT NULL`, n: sql<number>`COUNT(*)` })
    .from(schema.runProfiles)
    .where(eq(schema.runProfiles.runId, runId))
    .groupBy(schema.runProfiles.status, sql`${schema.runProfiles.attemptedAt} IS NOT NULL`);
  type ProfileStatus = (typeof schema.RUN_PROFILE_STATUSES)[number];
  const count = (statuses: ProfileStatus[], attempted?: boolean) =>
    counts.filter((c) => statuses.includes(c.status) && (attempted === undefined || Boolean(c.attempted) === attempted)).reduce((n, c) => n + c.n, 0);
  const submitted = count(["submitted"]);
  const skipped = count(["skipped"]);
  const failed = count(["failed"], false);
  // Sent without a confirmed outcome (same set as MAYBE_CHANGED_SQL minus the confirmed ones).
  const unknown = count(["failed", "pending", "submitting"], true);
  const untouched = count(["pending", "submitting"], false);

  let status: RunStatus;
  if (TERMINAL.includes(run.status)) status = run.status;
  else if (args.cancelled) status = "cancelled";
  else if (args.runError && submitted === 0 && unknown === 0) status = "failed";
  else if (args.runError || failed > 0 || unknown > 0 || untouched > 0) status = "completed_with_errors";
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
        unknownCount: unknown,
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
        detail: { submitted, skipped, failed, unknown, untouched, error, stopRequestedBy: run.stopRequestedBy ?? undefined },
      })
      .onConflictDoNothing(),
  ]);

  return { runId, status, submitted, skipped, failed, unknown, untouched, error };
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export type StopResult = { ok: true; state: "stopped" | "stopping" } | { ok: false; reason: "not_found" | "not_a_cleanup" | "already_finished" };

/**
 * "Stop cleanup". A queued run is closed on the spot (nothing was sent). A running one is flagged: the batch
 * in flight finishes, no further batch is sent and the run ends as `cancelled`, after which undo is available
 * for what was already sent. Profiles not reached stay untouched.
 */
export async function requestStopRun(db: Db, args: { shop: string; runId: string; requestedBy: string; now?: Date }): Promise<StopResult> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const run = await db.query.runs.findFirst({ where: and(eq(schema.runs.id, args.runId), eq(schema.runs.shop, args.shop)) });
  if (!run) return { ok: false, reason: "not_found" };
  if (run.kind !== "suppress") return { ok: false, reason: "not_a_cleanup" };
  if (TERMINAL.includes(run.status)) return { ok: false, reason: "already_finished" };

  const d1 = db.$client;
  const [flagged] = await d1.batch([
    d1
      .prepare(
        `UPDATE runs SET stop_requested_at = COALESCE(stop_requested_at, ?1), stop_requested_by = COALESCE(stop_requested_by, ?2)
         WHERE id = ?3 AND shop = ?4 AND kind = 'suppress' AND status IN ('queued', 'running')`,
      )
      .bind(nowMs, args.requestedBy, run.id, args.shop),
    d1
      .prepare(
        `INSERT OR IGNORE INTO events_log (id, shop, at, actor, action, run_id, simulation_id, detail)
         SELECT ?1, shop, ?2, ?3, 'run.stop_requested', id, simulation_id, json_object('status', status)
         FROM runs WHERE id = ?4 AND shop = ?5 AND stop_requested_at = ?2`,
      )
      .bind(`run:${run.id}:stop_requested`, nowMs, args.requestedBy, run.id, args.shop),
  ]);
  if (!flagged || flagged.meta.changes === 0) return { ok: false, reason: "already_finished" };

  // Not started yet: close it here. If its Workflow starts later, it finds a finished run and does nothing.
  const closed = await d1
    .prepare("UPDATE runs SET status = 'cancelled', finished_at = ?1 WHERE id = ?2 AND status = 'queued'")
    .bind(nowMs, run.id)
    .run();
  if (closed.meta.changes === 1) {
    await finalizeRun(db, run.id, { runError: null, cancelled: true, now });
    return { ok: true, state: "stopped" };
  }
  return { ok: true, state: "stopping" };
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
 * It covers every profile the cleanup may have changed: those Klaviyo accepted
 * and those that were sent without a confirmed outcome (MAYBE_CHANGED_SQL).
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
    .where(and(eq(schema.runProfiles.runId, original.id), sql.raw(MAYBE_CHANGED_SQL), sql`${schema.runProfiles.reactivatedAt} IS NULL`));
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
         WHERE run_id = ?4 AND ${MAYBE_CHANGED_SQL} AND reactivated_at IS NULL
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
