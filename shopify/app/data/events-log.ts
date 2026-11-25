import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

type Db = DrizzleD1Database<typeof schema>;

export interface LogEntry {
  shop: string;
  /** "user:<shopify user id>", "schedule", "webhook" or "system". */
  actor: string;
  /** For example klaviyo.connected, simulation.approved, run.started. */
  action: string;
  runId?: string | null;
  simulationId?: string | null;
  /** Ids, counts and codes only. Never an email, a name or a token. */
  detail?: Record<string, unknown> | null;
}

/**
 * Appends to the audit trail (product rule 3: who, when, what). The `shops`
 * row must exist. A failed write is swallowed: the trail must never be the
 * reason a merchant action fails, and the action itself is recorded in its
 * own table.
 */
export async function logEvent(db: Db, entry: LogEntry, now = new Date()): Promise<void> {
  try {
    await db.insert(schema.eventsLog).values({
      id: crypto.randomUUID(),
      shop: entry.shop,
      at: now,
      actor: entry.actor,
      action: entry.action,
      runId: entry.runId ?? null,
      simulationId: entry.simulationId ?? null,
      detail: entry.detail ?? null,
    });
  } catch {
    // See above.
  }
}

/**
 * Actor string for an embedded request. The app uses offline sessions, which
 * carry no user; the Shopify user id is the `sub` claim of the session token
 * that App Bridge sends with every embedded request.
 */
export function sessionActor(sessionToken: { sub?: string | null } | null | undefined): string {
  const sub = sessionToken?.sub;
  return typeof sub === "string" && /^[0-9]{1,20}$/.test(sub) ? `user:${sub}` : "system";
}
