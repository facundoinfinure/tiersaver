import { SIMULATION_TTL_MS } from "@tiersaver/core";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { planGate, type AdminGraphql, type PlanGateRefusal } from "../billing/billing";
import { MAYBE_CHANGED_SQL } from "../runs/engine";
import { createCleanupWithPlan } from "../runs/gated";
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
 * - suppression is enabled for the deployment, and Shopify confirms an active plan that covers the list size
 *   of this simulation (`runAutomaticMode`). No plan, a plan on hold, or a list that moved to a higher tier:
 *   the cleanup waits for the merchant, with the reason recorded like a guardrail;
 * - guardrails (review finding A6): the standing instruction only covers a
 *   cleanup that looks like the one a person last approved. It does not when
 *   that cleanup was undone, when rules or protected groups changed since, or
 *   when the number of candidates is out of proportion. Those cases are
 *   recorded (`automatic.needs_review` in the events log) so the app can tell
 *   the merchant why the cleanup is waiting for them: `automaticReview`.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

/**
 * Automatic cleanups stop for review when candidates exceed this share of the active list. Klaviyo's
 * criteria describe long-term dead weight; after the first cleanup a healthy list adds a few percent per
 * month. More than one in ten at once means an import or giveaway turned a year old, or a broken signal
 * (renamed metric, integration down): a person should look.
 */
export const AUTO_MAX_CANDIDATE_SHARE = 0.1;
/**
 * ...or when they exceed this many times the candidates of the last cleanup a person approved. The first
 * cleanup is normally the largest, so a later one that is several times bigger is not routine.
 */
export const AUTO_MAX_GROWTH_FACTOR = 3;
/** The growth check does not apply below this many candidates: tiny cleanups vary by multiples without meaning anything. */
export const AUTO_GROWTH_FLOOR = 200;

export const AUTOMATIC_REVIEW_REASONS = [
  "last_manual_cleanup_undone",
  "rules_changed_since_manual_approval",
  "candidate_share_too_high",
  "candidate_jump",
  // The plan (billing/billing.ts, `planGate`): an automatic cleanup never starts a plan or accepts a new price.
  "plan_required",
  "plan_frozen",
  "plan_price_too_low",
  "above_price_tiers",
] as const;
export type AutomaticReviewReason = (typeof AUTOMATIC_REVIEW_REASONS)[number];

/** Merchant-facing text for each guardrail (English, like everything the merchant sees). */
export const AUTOMATIC_REVIEW_LABELS: Record<AutomaticReviewReason, string> = {
  last_manual_cleanup_undone: "The last cleanup you approved was restored afterwards, so this one waits for your review.",
  rules_changed_since_manual_approval: "Your rules or protected lists changed since the last cleanup you approved, so this one waits for your review.",
  candidate_share_too_high: "This cleanup would suppress an unusually large share of your list, so it waits for your review.",
  candidate_jump: "This cleanup is much larger than the last one you approved, so it waits for your review.",
  plan_required: "You have no active TierSaver plan, so this cleanup was not started automatically. Review it and start a plan to run it.",
  plan_frozen: "Your TierSaver plan is on hold in Shopify because of a billing issue with your store, so this cleanup was not started automatically.",
  plan_price_too_low: "Your list has grown into a larger plan. This cleanup waits for you to approve the new monthly price in Shopify.",
  above_price_tiers: "Your list is above the largest plan TierSaver sells automatically, so this cleanup was not started.",
};

export type AutomaticDecision =
  | { run: true; simulationId: string }
  | { run: false; reason: "not_scheduled" | "mode_is_approval" | "rules_not_recommended" | "no_manual_run_yet" | "nothing_to_do" | "not_open" | AutomaticReviewReason };

interface LastManualCleanup {
  run_id: string;
  settings_version: number;
  candidate_count: number;
  changed: number;
  restored: number;
}

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

  // The most recent cleanup a person approved that actually ran: the reference for everything below.
  const manual = await db.$client
    .prepare(
      `SELECT r.id AS run_id, s.settings_version, s.candidate_count,
              (SELECT COUNT(*) FROM run_profiles p WHERE p.run_id = r.id AND ${MAYBE_CHANGED_SQL}) AS changed,
              (SELECT COUNT(*) FROM run_profiles p WHERE p.run_id = r.id AND ${MAYBE_CHANGED_SQL} AND p.reactivated_at IS NOT NULL) AS restored
       FROM runs r JOIN simulations s ON s.id = r.simulation_id
       WHERE r.shop = ?1 AND r.kind = 'suppress' AND r.status IN ('completed', 'completed_with_errors')
         AND r.processed_count > 0 AND s.approved_by LIKE 'user:%'
       ORDER BY r.created_at DESC LIMIT 1`,
    )
    .bind(args.shop)
    .first<LastManualCleanup>();
  if (!manual) return { run: false, reason: "no_manual_run_yet" };

  const review = (reason: AutomaticReviewReason, detail: Record<string, unknown>): Promise<AutomaticDecision> =>
    recordAutomaticReview(db, { shop: args.shop, simulationId: simulation.id, reason, detail, now }).then(() => ({ run: false as const, reason }));

  // Restored in full: the merchant told us that cleanup was a mistake.
  if (manual.changed > 0 && manual.restored >= manual.changed) return review("last_manual_cleanup_undone", { runId: manual.run_id });
  // The settings version moves with every change of rules or protected groups (settings.ts), and only then.
  if (manual.settings_version !== simulation.settingsVersion) {
    return review("rules_changed_since_manual_approval", { approvedVersion: manual.settings_version, version: simulation.settingsVersion });
  }
  const numbers = { candidates: simulation.candidateCount, activeProfiles: simulation.activeProfiles, lastApprovedCandidates: manual.candidate_count };
  // An unknown list size cannot show the share is small, so it does not pass.
  if (simulation.activeProfiles <= 0 || simulation.candidateCount > simulation.activeProfiles * AUTO_MAX_CANDIDATE_SHARE) return review("candidate_share_too_high", numbers);
  if (simulation.candidateCount > Math.max(AUTO_GROWTH_FLOOR, manual.candidate_count * AUTO_MAX_GROWTH_FACTOR)) return review("candidate_jump", numbers);
  return { run: true, simulationId: simulation.id };
}

/** Records why a scheduled cleanup waits for the merchant. One reason per simulation: the first one stays. */
export async function recordAutomaticReview(db: Db, args: { shop: string; simulationId: string; reason: AutomaticReviewReason; detail?: Record<string, unknown>; now?: Date }): Promise<void> {
  await db
    .insert(schema.eventsLog)
    .values({
      id: `simulation:${args.simulationId}:automatic_review`,
      shop: args.shop,
      at: args.now ?? new Date(),
      actor: "schedule",
      action: "automatic.needs_review",
      simulationId: args.simulationId,
      detail: { reason: args.reason, ...(args.detail ?? {}) },
    })
    .onConflictDoNothing();
}

const PLAN_REFUSALS: readonly PlanGateRefusal[] = ["plan_required", "plan_frozen", "plan_price_too_low", "above_price_tiers"];

/**
 * The whole automatic step after a scheduled scan (workers/scan.ts): decide, check the plan at Shopify with the
 * shop's offline token, approve on the standing instruction and create the run. Returns "started" or the reason
 * nothing was started. The plan is asked BEFORE the simulation is approved, so a refusal leaves it open for
 * the merchant, who then sees why on the review screen (`automaticReview`).
 * Throws when Shopify cannot be asked, so the Workflow step retries.
 */
export async function runAutomaticMode(
  deps: { db: Db; graphql: AdminGraphql; suppressionAllowed: (klaviyoAccountId: string | null | undefined) => boolean; launch: (runId: string) => Promise<void>; now?: Date },
  args: { shop: string; simulationId: string },
): Promise<string> {
  const { db } = deps;
  const decision = await decideAutomatic(db, { ...args, now: deps.now });
  if (!decision.run) return decision.reason;
  const connection = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, args.shop), columns: { klaviyoAccountId: true } });
  if (!deps.suppressionAllowed(connection?.klaviyoAccountId)) return "suppression_disabled";

  // Asked twice on purpose: here so that a refusal leaves the simulation unapproved, and again inside
  // `createCleanupWithPlan`, which is the gate every cleanup goes through.
  const gate = await planGate({ db, graphql: deps.graphql, actor: "schedule", now: deps.now }, args);
  if (!gate.ok) {
    if (gate.reason === "billing_unavailable") throw new Error("billing_unavailable");
    if (PLAN_REFUSALS.includes(gate.reason)) {
      await recordAutomaticReview(db, { ...args, reason: gate.reason as AutomaticReviewReason, detail: { requiredCents: gate.requiredCents }, now: deps.now });
    }
    return gate.reason;
  }
  if (!(await approveAutomatically(db, { ...args, now: deps.now }))) return "not_open";
  const created = await createCleanupWithPlan({ db, graphql: deps.graphql, now: deps.now }, { ...args, createdBy: "schedule", origin: "scheduled" });
  if (!created.ok) return created.reason;
  await deps.launch(created.runId);
  return "started";
}

/**
 * Why a scheduled simulation was not started automatically and waits for the merchant instead, or null.
 * For the simulation and home screens: `label` is ready to show.
 */
export async function automaticReview(db: Db, args: { shop: string; simulationId: string }): Promise<{ reason: AutomaticReviewReason; label: string; at: string } | null> {
  const row = await db.query.eventsLog.findFirst({
    where: and(eq(schema.eventsLog.id, `simulation:${args.simulationId}:automatic_review`), eq(schema.eventsLog.shop, args.shop)),
  });
  const reason = (row?.detail as { reason?: string } | null)?.reason;
  if (!row || !AUTOMATIC_REVIEW_REASONS.includes(reason as AutomaticReviewReason)) return null;
  return { reason: reason as AutomaticReviewReason, label: AUTOMATIC_REVIEW_LABELS[reason as AutomaticReviewReason], at: row.at.toISOString() };
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
