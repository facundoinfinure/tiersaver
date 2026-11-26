import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { hashKlaviyoAccountId } from "../email-hash";

/**
 * The record that keeps the 72-hour undo window from being a way to never pay: a store that uninstalls while
 * the charge of a cleanup is still waiting cannot be charged for it any more (Shopify does not bill an
 * uninstalled app). What stays behind is one row per Klaviyo account: a keyed hash of the account id, the date
 * and the amount. No store name, no customer data. While that row exists, the next cleanup on the same
 * Klaviyo account is charged as soon as Klaviyo confirms it, without the window (decided 2026-11-26).
 */
type Db = DrizzleD1Database<typeof schema>;

/** How long the record is kept. */
export const UNPAID_CLEANUP_RETENTION_DAYS = 400;

/** Called on uninstall, BEFORE the Klaviyo connection is deleted. Idempotent. */
export async function recordUnpaidCleanups(db: Db, shop: string, now = new Date()): Promise<boolean> {
  const connection = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop), columns: { klaviyoAccountId: true } });
  if (!connection?.klaviyoAccountId) return false;
  const open = await db
    .select({ runId: schema.usageCharges.runId, feeCents: schema.usageCharges.feeCents, finishedAt: schema.runs.finishedAt })
    .from(schema.usageCharges)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.usageCharges.runId))
    .where(and(eq(schema.usageCharges.shop, shop), inArray(schema.usageCharges.status, ["pending", "failed"]), gt(schema.usageCharges.feeCents, 0)));
  let unpaid: { feeCents: number; at: Date } | null = null;
  for (const charge of open) {
    // A cleanup that was restored in full owes nothing.
    const [left] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.runProfiles)
      .where(and(eq(schema.runProfiles.runId, charge.runId), eq(schema.runProfiles.status, "submitted"), sql`${schema.runProfiles.reactivatedAt} IS NULL`));
    if ((left?.n ?? 0) === 0) continue;
    if (!unpaid || charge.feeCents > unpaid.feeCents) unpaid = { feeCents: charge.feeCents, at: charge.finishedAt ?? now };
  }
  if (!unpaid) return false;
  const accountKey = await hashKlaviyoAccountId(connection.klaviyoAccountId);
  await db
    .insert(schema.unpaidCleanups)
    .values({ accountKey, cleanedAt: unpaid.at, feeCents: unpaid.feeCents, createdAt: now })
    .onConflictDoUpdate({ target: schema.unpaidCleanups.accountKey, set: { cleanedAt: unpaid.at, feeCents: unpaid.feeCents, createdAt: now } });
  return true;
}

/** Whether the Klaviyo account this shop is connected to left a cleanup unpaid: its next cleanup has no undo window for the charge. */
export async function chargedWithoutWindow(db: Db, shop: string): Promise<boolean> {
  const connection = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop), columns: { klaviyoAccountId: true } });
  if (!connection?.klaviyoAccountId) return false;
  const row = await db.query.unpaidCleanups.findFirst({ where: eq(schema.unpaidCleanups.accountKey, await hashKlaviyoAccountId(connection.klaviyoAccountId)) });
  return Boolean(row);
}

/** A charge reached Shopify for this shop's Klaviyo account: the account is in good standing again. */
export async function clearUnpaidCleanup(db: Db, shop: string): Promise<void> {
  const connection = await db.query.klaviyoConnections.findFirst({ where: eq(schema.klaviyoConnections.shop, shop), columns: { klaviyoAccountId: true } });
  if (!connection?.klaviyoAccountId) return;
  await db.delete(schema.unpaidCleanups).where(eq(schema.unpaidCleanups.accountKey, await hashKlaviyoAccountId(connection.klaviyoAccountId)));
}
