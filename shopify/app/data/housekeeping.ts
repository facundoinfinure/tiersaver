import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";

type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long the per-profile list of a simulation that was never run is kept. It can only be reviewed for 24 hours. */
export const UNUSED_SIMULATION_CANDIDATES_DAYS = 7;

/**
 * Shopify sends shop/redact 48 hours after an uninstall. If it never arrives (or failed), the shop's data is
 * deleted anyway this many days after the uninstall.
 */
export const UNINSTALLED_SHOP_RETENTION_DAYS = 10;
/** How long a customers/data_request row is kept. Shopify gives the merchant 30 days to answer. */
export const PRIVACY_REQUEST_RETENTION_DAYS = 90;

/**
 * Data minimisation, run by the hourly cron. What the privacy policy promises
 * about working data depends on this:
 * - working rows of an audit (`scan_profiles`) never outlive the audit by more
 *   than 24 hours, even when its Workflow died without reaching its own cleanup;
 * - the per-profile list of a simulation that was never executed is dropped
 *   after a week (the simulation's counts stay, for the history);
 * - OAuth attempt markers are dropped after a day;
 * - customer data requests are dropped after 90 days;
 * - everything of a shop that uninstalled is deleted 10 days later if Shopify's
 *   shop/redact did not already do it (a few shops per tick: the delete cascades).
 * Nothing here touches a run or anything an undo needs of an installed shop.
 */
export async function purgeStaleData(db: Db, now = new Date()): Promise<{ scans: number; scanProfiles: number; candidates: number; attempts: number; shops: number }> {
  const nowMs = now.getTime();
  const d1 = db.$client;
  const [scans, scanProfiles, candidates, attempts] = await d1.batch([
    d1
      .prepare("UPDATE scans SET status = 'failed', last_error = COALESCE(last_error, 'scan_abandoned'), finished_at = ?1 WHERE status IN ('queued', 'running') AND created_at < ?2")
      .bind(nowMs, nowMs - DAY_MS),
    d1.prepare("DELETE FROM scan_profiles WHERE scan_id IN (SELECT id FROM scans WHERE status IN ('completed', 'failed') OR created_at < ?1)").bind(nowMs - DAY_MS),
    d1
      .prepare("DELETE FROM simulation_candidates WHERE simulation_id IN (SELECT id FROM simulations WHERE executed_at IS NULL AND created_at < ?1)")
      .bind(nowMs - UNUSED_SIMULATION_CANDIDATES_DAYS * DAY_MS),
    d1.prepare("DELETE FROM klaviyo_oauth_attempts WHERE created_at < ?1").bind(nowMs - DAY_MS),
    d1.prepare("DELETE FROM privacy_requests WHERE received_at < ?1").bind(nowMs - PRIVACY_REQUEST_RETENTION_DAYS * DAY_MS),
    // Unpaid-cleanup records of the per-cleanup pricing that ended on 2026-11-26: nothing writes them any more,
    // and the ones left still expire after 400 days.
    d1.prepare("DELETE FROM unpaid_cleanups WHERE created_at < ?1").bind(nowMs - 400 * DAY_MS),
  ]);
  // One shop per statement and only a few per tick: each delete cascades through every table of that shop.
  const gone = await d1
    .prepare("SELECT shop FROM shops WHERE status = 'uninstalled' AND uninstalled_at IS NOT NULL AND uninstalled_at < ?1 LIMIT 3")
    .bind(nowMs - UNINSTALLED_SHOP_RETENTION_DAYS * DAY_MS)
    .all<{ shop: string }>();
  let shops = 0;
  for (const row of gone.results) {
    await d1.batch([d1.prepare("DELETE FROM session WHERE shop = ?1").bind(row.shop), d1.prepare("DELETE FROM shops WHERE shop = ?1 AND status = 'uninstalled'").bind(row.shop)]);
    shops += 1;
  }
  return { scans: scans?.meta.changes ?? 0, scanProfiles: scanProfiles?.meta.changes ?? 0, candidates: candidates?.meta.changes ?? 0, attempts: attempts?.meta.changes ?? 0, shops };
}
