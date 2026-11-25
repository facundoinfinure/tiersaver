import { SIMULATION_TTL_MS, type CandidateReason } from "@tiersaver/core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { getProfileEmails } from "../klaviyo/api";
import type { KlaviyoClient } from "../klaviyo/client";
import { LIMITS } from "../klaviyo/config";

/**
 * Reviewing and approving a simulation. No Cloudflare imports: the same code
 * runs in routes and in tests.
 *
 * Product rules enforced here:
 * - Nothing is suppressed without a simulation a person approved (rule 1).
 *   A manual approval needs an identified Shopify user and an explicit
 *   acknowledgement of the notices shown on the review screen.
 * - The candidate CSV exists to review candidates BEFORE approving
 *   (docs/12-CUMPLIMIENTO-KLAVIYO.md 3.1, guardrail 7). It is refused once the
 *   simulation is approved, executed, superseded or expired, so it can never
 *   serve as an export of suppressed profiles.
 * - Emails are read from Klaviyo for the download and never stored or logged.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

export type SimulationState = "open" | "approved" | "expired" | "superseded" | "executed";

type SimulationRow = typeof schema.simulations.$inferSelect;

/** State of a simulation as the merchant sees it. `settingsVersion` is the shop's current settings version. */
export function simulationState(sim: Pick<SimulationRow, "createdAt" | "approvedAt" | "executedAt" | "supersededAt" | "settingsVersion">, settingsVersion: number | null, now: Date): SimulationState {
  if (sim.executedAt) return "executed";
  if (sim.supersededAt || settingsVersion === null || settingsVersion !== sim.settingsVersion) return "superseded";
  if (now.getTime() - sim.createdAt.getTime() >= SIMULATION_TTL_MS) return "expired";
  return sim.approvedAt ? "approved" : "open";
}

/** The shop's most recent simulation with its state, or null when no audit has finished yet. */
export async function latestSimulation(db: Db, shop: string, now = new Date()): Promise<{ simulation: SimulationRow; state: SimulationState } | null> {
  const [simulation, settings] = await Promise.all([
    db.query.simulations.findFirst({ where: eq(schema.simulations.shop, shop), orderBy: desc(schema.simulations.createdAt) }),
    db.query.settings.findFirst({ where: eq(schema.settings.shop, shop), columns: { version: true } }),
  ]);
  if (!simulation) return null;
  return { simulation, state: simulationState(simulation, settings?.version ?? null, now) };
}

export type ApproveResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_acknowledged" | "approver_unknown" | "no_candidates" | "already_approved" | "expired" | "superseded" | "executed" };

/**
 * Records the merchant's approval. One atomic UPDATE repeats every condition,
 * so two tabs, a stale page or a settings change in between cannot approve
 * something other than what was shown.
 */
export async function approveSimulation(
  db: Db,
  args: { shop: string; simulationId: string; approvedBy: string; acknowledged: boolean; now?: Date },
): Promise<ApproveResult> {
  const now = args.now ?? new Date();
  if (!args.acknowledged) return { ok: false, reason: "not_acknowledged" };
  // A manual approval is a person's decision; "automatic" is written only by the schedule (app/schedule/automatic.ts).
  if (!/^user:[0-9]{1,20}$/.test(args.approvedBy)) return { ok: false, reason: "approver_unknown" };

  const sim = await db.query.simulations.findFirst({
    where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)),
  });
  if (!sim) return { ok: false, reason: "not_found" };
  const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop), columns: { version: true } });
  const state = simulationState(sim, settings?.version ?? null, now);
  if (state === "approved") return { ok: false, reason: "already_approved" };
  if (state !== "open") return { ok: false, reason: state };
  if (sim.candidateCount <= 0) return { ok: false, reason: "no_candidates" };

  const nowMs = now.getTime();
  const d1 = db.$client;
  const [update] = await d1.batch([
    d1
      .prepare(
        `UPDATE simulations SET approved_at = ?1, approved_by = ?2
         WHERE id = ?3 AND shop = ?4
           AND approved_at IS NULL AND executed_at IS NULL AND superseded_at IS NULL
           AND candidate_count > 0
           AND created_at > ?5 AND created_at <= ?1
           AND settings_version = (SELECT version FROM settings WHERE shop = ?4)`,
      )
      .bind(nowMs, args.approvedBy, sim.id, args.shop, nowMs - SIMULATION_TTL_MS),
    d1
      .prepare(
        `INSERT INTO events_log (id, shop, at, actor, action, simulation_id, detail)
         SELECT ?1, ?2, ?3, ?4, 'simulation.approved', id,
                json_object('candidates', candidate_count, 'activeProfiles', active_profiles, 'settingsVersion', settings_version, 'rules', json(rule_settings))
         FROM simulations WHERE id = ?5 AND approved_at = ?3 AND approved_by = ?4`,
      )
      .bind(`simulation:${sim.id}:approved`, args.shop, nowMs, args.approvedBy, sim.id),
  ]);
  if (!update || update.meta.changes !== 1) return { ok: false, reason: "superseded" };
  return { ok: true };
}

/** Rows per CSV file: 30 Klaviyo lookups of 50 ids, inside one Worker invocation's subrequest budget. */
export const CSV_PART_SIZE = 1500;

export const CANDIDATE_REASON_LABELS: Record<CandidateReason, string> = {
  never_engaged: "Never opened, clicked, visited or purchased",
  lapsed: "No activity inside your chosen windows",
};

/** Quotes a CSV cell and neutralises spreadsheet formulas (a value starting with = + - @ is prefixed with '). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export type CsvResult =
  | { ok: true; csv: string; part: number; parts: number; rows: number }
  | { ok: false; reason: "not_found" | "not_reviewable" | "no_such_part" };

/**
 * One part of the candidate list as CSV, for review before approval.
 * Columns: Klaviyo profile id, email as Klaviyo holds it right now, reason,
 * link to the profile in Klaviyo. A profile that no longer exists or has no
 * email is listed with an empty email: it would be skipped by a cleanup.
 */
export async function candidatesCsvPart(
  db: Db,
  client: KlaviyoClient,
  args: { shop: string; simulationId: string; part: number; now?: Date },
): Promise<CsvResult> {
  const found = await db.query.simulations.findFirst({
    where: and(eq(schema.simulations.id, args.simulationId), eq(schema.simulations.shop, args.shop)),
  });
  if (!found) return { ok: false, reason: "not_found" };
  const settings = await db.query.settings.findFirst({ where: eq(schema.settings.shop, args.shop), columns: { version: true } });
  if (simulationState(found, settings?.version ?? null, args.now ?? new Date()) !== "open") return { ok: false, reason: "not_reviewable" };

  const parts = Math.max(1, Math.ceil(found.candidateCount / CSV_PART_SIZE));
  if (!Number.isInteger(args.part) || args.part < 1 || args.part > parts) return { ok: false, reason: "no_such_part" };

  // Keyset paging would need the previous part's last id; offsets are fine at this size and keep the URL stateless.
  const rows = await db
    .select({ profileId: schema.simulationCandidates.profileId, reason: schema.simulationCandidates.reason })
    .from(schema.simulationCandidates)
    .where(eq(schema.simulationCandidates.simulationId, found.id))
    .orderBy(asc(schema.simulationCandidates.profileId))
    .limit(CSV_PART_SIZE)
    .offset((args.part - 1) * CSV_PART_SIZE);

  const emails = new Map<string, string | null>();
  for (let i = 0; i < rows.length; i += LIMITS.profileIdsPerLookup) {
    const ids = rows.slice(i, i + LIMITS.profileIdsPerLookup).map((r) => r.profileId);
    for (const [id, email] of await getProfileEmails(client, ids)) emails.set(id, email);
  }

  const lines = ["klaviyo_profile_id,email,reason,klaviyo_profile_url"];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.profileId),
        csvCell(emails.get(row.profileId) ?? ""),
        csvCell(CANDIDATE_REASON_LABELS[row.reason as CandidateReason] ?? row.reason),
        csvCell(`https://www.klaviyo.com/profile/${encodeURIComponent(row.profileId)}`),
      ].join(","),
    );
  }
  return { ok: true, csv: `${lines.join("\r\n")}\r\n`, part: args.part, parts, rows: rows.length };
}
