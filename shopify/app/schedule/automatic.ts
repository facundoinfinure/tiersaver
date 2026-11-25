import { SIMULATION_TTL_MS } from "@tiersaver/core";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { isKlaviyoRecommended, rulesOf } from "../settings/settings";

/**
 * Automatic mode: after a SCHEDULED scan, approve its simulation on the
 * merchant's standing instruction and start the cleanup.
 *
 * Every condition must hold, and each "no" leaves the simulation waiting for
 * the merchant instead (it is never an error):
 * - the merchant chose automatic mode and the schedule is on;
 * - the rules are Klaviyo's recommended criteria (never the wider mode);
 * - product rule 1: a person approved at least one earlier cleanup of this shop, and it ran;
 * - the simulation is the scheduled one, open, and has candidates;
 * - suppression is enabled for the deployment and billing is in place (checked by the caller's `canRun`).
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

export type AutomaticDecision =
  | { run: true; simulationId: string }
  | { run: false; reason: "not_scheduled" | "mode_is_approval" | "rules_not_recommended" | "no_manual_run_yet" | "nothing_to_do" | "not_open" };

export async function decideAutomatic(db: Db, args: { shop: string; simulationId: string; now?: Date }): Promise<AutomaticDecision> {
  const now = args.now ?? new Date();
  const [simulation, settings] = await Promise.all([
    db.query.simulations.findFirst({ where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)) }),
    db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop) }),
  ]);
  if (!simulation || !settings) return { run: false, reason: "not_open" };
  if (simulation.origin !== "scheduled") return { run: false, reason: "not_scheduled" };
  if (settings.mode !== "automatic" || !settings.scheduleEnabled) return { run: false, reason: "mode_is_approval" };
  if (!isKlaviyoRecommended(rulesOf(settings))) return { run: false, reason: "rules_not_recommended" };
  if (simulation.approvedAt || simulation.executedAt || simulation.supersededAt || simulation.settingsVersion !== settings.version) return { run: false, reason: "not_open" };
  if (now.getTime() - simulation.createdAt.getTime() >= SIMULATION_TTL_MS) return { run: false, reason: "not_open" };
  if (simulation.candidateCount <= 0) return { run: false, reason: "nothing_to_do" };

  const manual = await db.$client
    .prepare(
      `SELECT 1 AS ok FROM runs r JOIN simulations s ON s.id = r.simulation_id
       WHERE r.shop = ?1 AND r.kind = 'suppress' AND r.status IN ('completed', 'completed_with_errors')
         AND r.processed_count > 0 AND s.approved_by LIKE 'user:%' LIMIT 1`,
    )
    .bind(args.shop)
    .first<{ ok: number }>();
  if (!manual) return { run: false, reason: "no_manual_run_yet" };
  return { run: true, simulationId: simulation.id };
}

/** Writes the automatic approval. Same atomic conditions as a person's approval; the approver is the literal "automatic". */
export async function approveAutomatically(db: Db, args: { shop: string; simulationId: string; now?: Date }): Promise<boolean> {
  const nowMs = (args.now ?? new Date()).getTime();
  const d1 = db.$client;
  const [update] = await d1.batch([
    d1
      .prepare(
        `UPDATE simulations SET approved_at = ?1, approved_by = 'automatic'
         WHERE id = ?2 AND shop = ?3 AND origin = 'scheduled'
           AND approved_at IS NULL AND executed_at IS NULL AND superseded_at IS NULL
           AND candidate_count > 0 AND created_at > ?4 AND created_at <= ?1
           AND settings_version = (SELECT version FROM settings WHERE shop = ?3 AND mode = 'automatic' AND schedule_enabled = 1)`,
      )
      .bind(nowMs, args.simulationId, args.shop, nowMs - SIMULATION_TTL_MS),
    d1
      .prepare(
        `INSERT INTO events_log (id, shop, at, actor, action, simulation_id, detail)
         SELECT ?1, ?2, ?3, 'schedule', 'simulation.approved', id, json_object('candidates', candidate_count, 'activeProfiles', active_profiles, 'automatic', json('true'))
         FROM simulations WHERE id = ?4 AND approved_at = ?3 AND approved_by = 'automatic'`,
      )
      .bind(`simulation:${args.simulationId}:approved`, args.shop, nowMs, args.simulationId),
  ]);
  return Boolean(update && update.meta.changes === 1);
}
