import { and, asc, inArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { closeStalledRun, type Db } from "./engine";

/**
 * Recovery of runs whose Workflow is gone (review finding C2). Run by the
 * hourly cron. Without it, a run whose Workflow instance died, was never
 * created, or was terminated stays `queued` / `running` forever, and a cleanup
 * that is not finished cannot be undone (product rule 3).
 *
 * What it does with a run that shows no progress (`runs.last_progress_at`):
 * - `queued`, no Workflow instance: starts the instance again with the SAME id
 *   (the run id), so two executions are impossible. The run's own start gate
 *   decides the rest: a cleanup whose simulation is no longer fresh fails
 *   there without touching anybody.
 * - `running` (or `queued`) with an instance that ended or does not exist: the
 *   run is closed with what was really sent (`closeStalledRun`). Nothing is
 *   sent again: batches Klaviyo may already have accepted are recorded as
 *   "outcome unknown" and stay inside undo; batches never sent stay untouched.
 *   The merchant can run a new simulation for the rest.
 * - an instance that is still alive is left alone, unless it has shown no
 *   progress for `ABANDON_AFTER_MINUTES`: then it is terminated and closed.
 * - when the instance cannot be asked, nothing is done until the next tick.
 *
 * The thresholds are far above the longest silence of a healthy run: one batch
 * attempt lasts at most 5 minutes and the longest pause between retries is
 * under 3 minutes (BATCH_STEP_CONFIG), and every attempt writes the heartbeat.
 */

/** A queued run should start within seconds. After this long without a Workflow it is started again. */
export const QUEUED_STALL_MINUTES = 10;
/** A running run with no heartbeat for this long is looked at. Healthy runs beat at least every ~8 minutes. */
export const RUNNING_STALL_MINUTES = 45;
/** Same, once the merchant pressed "Stop cleanup": they are waiting for the run to close so they can undo. */
export const STOP_STALL_MINUTES = 10;
/** A queued run this old is not started again (its simulation expired long ago); it is closed. */
export const RELAUNCH_MAX_AGE_HOURS = 24;
/** A run with a live instance but no heartbeat for this long is terminated and closed. */
export const ABANDON_AFTER_MINUTES = 6 * 60;

const MINUTE_MS = 60_000;

/** `alive`: queued, running, waiting or paused. `dead`: errored, terminated or complete. `missing`: no such instance. */
export type InstanceState = "alive" | "dead" | "missing" | "unknown";

export function instanceStateOf(status: string): InstanceState {
  if (["queued", "running", "waiting", "paused", "waitingForPause", "rollingBack"].includes(status)) return "alive";
  if (["errored", "terminated", "complete"].includes(status)) return "dead";
  return "unknown";
}

export interface RecoveryDeps {
  db: Db;
  now?: Date;
  /** State of the Workflow instance whose id is the run id. Must not throw. */
  instanceState: (runId: string) => Promise<InstanceState>;
  /** Creates the Workflow instance with the run id. Returns false when it could not be created. */
  launch: (runId: string) => Promise<boolean>;
  /** Terminates a live instance. Best effort. */
  terminate?: (runId: string) => Promise<void>;
  /** Runs looked at per tick, to stay inside one invocation's limits; the rest wait an hour. */
  max?: number;
}

export interface RecoveryReport {
  checked: number;
  relaunched: string[];
  closed: string[];
}

export async function recoverStalledRuns(deps: RecoveryDeps): Promise<RecoveryReport> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const silentSince = sql<number>`COALESCE(${schema.runs.lastProgressAt}, ${schema.runs.startedAt}, ${schema.runs.createdAt})`;
  const candidates = await db
    .select({
      id: schema.runs.id,
      shop: schema.runs.shop,
      status: schema.runs.status,
      createdAt: schema.runs.createdAt,
      stopRequestedAt: schema.runs.stopRequestedAt,
      silentSince,
    })
    .from(schema.runs)
    .where(and(inArray(schema.runs.status, ["queued", "running"]), sql`${silentSince} < ${nowMs - Math.min(QUEUED_STALL_MINUTES, STOP_STALL_MINUTES) * MINUTE_MS}`))
    .orderBy(asc(schema.runs.createdAt))
    .limit(deps.max ?? 20);

  const report: RecoveryReport = { checked: 0, relaunched: [], closed: [] };
  for (const run of candidates) {
    const silentMinutes = (nowMs - Number(run.silentSince)) / MINUTE_MS;
    const threshold = run.status === "queued" ? QUEUED_STALL_MINUTES : run.stopRequestedAt ? STOP_STALL_MINUTES : RUNNING_STALL_MINUTES;
    if (silentMinutes < threshold) continue;
    report.checked += 1;
    try {
      const state = await deps.instanceState(run.id);
      const abandoned = silentMinutes >= ABANDON_AFTER_MINUTES;
      if (state === "alive" && !abandoned) continue;
      if (state === "unknown" && !abandoned) continue;

      if (state === "missing" && run.status === "queued" && !run.stopRequestedAt && nowMs - run.createdAt.getTime() < RELAUNCH_MAX_AGE_HOURS * 60 * MINUTE_MS) {
        if (await deps.launch(run.id)) {
          report.relaunched.push(run.id);
          await db
            .insert(schema.eventsLog)
            .values({ id: `run:${run.id}:relaunched`, shop: run.shop, at: now, actor: "system", action: "run.relaunched", runId: run.id, detail: { silentMinutes: Math.round(silentMinutes) } })
            .onConflictDoNothing();
          await db.update(schema.runs).set({ lastProgressAt: now }).where(sql`${schema.runs.id} = ${run.id} AND ${schema.runs.status} = 'queued'`);
        }
        continue;
      }

      if (state === "alive" || state === "unknown") await deps.terminate?.(run.id).catch(() => {});
      await closeStalledRun(db, run.id, { error: run.status === "queued" ? "run_never_started" : "run_stalled", now });
      report.closed.push(run.id);
    } catch {
      // One run failing must not stop the others; it is looked at again on the next tick.
    }
  }
  return report;
}
