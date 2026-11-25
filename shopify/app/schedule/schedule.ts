import { DEFAULT_SCHEDULE, formatCalendarDate, planNextCleanup, todayInTimeZone } from "@tiersaver/core";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * Monthly schedule (Cron Trigger, hourly). For every shop that turned it on,
 * starts ONE scan a few days before the Klaviyo plan renews, so that Klaviyo's
 * profile count is up to date at renewal (its count can lag up to 72 hours).
 *
 * The schedule only ever starts a scan, which is read-only. What happens with
 * the simulation it produces depends on `settings.mode`: "approval" waits for
 * the merchant; "automatic" is handled in automatic.ts under its own conditions.
 */

export type Db = DrizzleD1Database<typeof schema> & { $client: D1Database };

const DAY_MS = 24 * 60 * 60 * 1000;
/** No second scheduled scan inside this many days: one per billing cycle, even on the shortest month. */
export const SCHEDULE_COOLDOWN_DAYS = 20;

interface ShopRow {
  shop: string;
  iana_timezone: string | null;
  billing_day: number | null;
  lead_days: number;
  period_end: number | null;
  last_scheduled: number | null;
}

/** The renewal day used for scheduling: the merchant's, or else the one Klaviyo reported in the latest audit. */
export function effectiveBillingDay(billingDay: number | null, lastPeriodEnd: Date | null): number | null {
  if (billingDay && billingDay >= 1 && billingDay <= 31) return billingDay;
  return lastPeriodEnd ? lastPeriodEnd.getUTCDate() : null;
}

export interface ScheduleDecision {
  shop: string;
  due: boolean;
  reason: "due" | "no_billing_day" | "not_today" | "already_scheduled_this_cycle";
  billingDate?: string;
  runOn?: string;
}

export function decideSchedule(row: { shop: string; timezone: string | null; billingDay: number | null; leadDays: number; lastPeriodEnd: Date | null; lastScheduledScanAt: Date | null }, now: Date): ScheduleDecision {
  const billingDay = effectiveBillingDay(row.billingDay, row.lastPeriodEnd);
  if (!billingDay) return { shop: row.shop, due: false, reason: "no_billing_day" };
  let today: Date;
  try {
    today = todayInTimeZone(now, row.timezone || "UTC");
  } catch {
    today = todayInTimeZone(now, "UTC");
  }
  const plan = planNextCleanup(today, { billingDay, leadDays: Math.max(row.leadDays, DEFAULT_SCHEDULE.minLeadDays), minLeadDays: DEFAULT_SCHEDULE.minLeadDays });
  const detail = { billingDate: formatCalendarDate(plan.billingDate), runOn: formatCalendarDate(plan.runOn) };
  if (!plan.runToday) return { shop: row.shop, due: false, reason: "not_today", ...detail };
  if (row.lastScheduledScanAt && now.getTime() - row.lastScheduledScanAt.getTime() < SCHEDULE_COOLDOWN_DAYS * DAY_MS) {
    return { shop: row.shop, due: false, reason: "already_scheduled_this_cycle", ...detail };
  }
  return { shop: row.shop, due: true, reason: "due", ...detail };
}

/** Shops with the schedule on, installed and connected to Klaviyo, each with what the decision needs. */
export async function scheduleDecisions(db: Db, now = new Date()): Promise<ScheduleDecision[]> {
  const { results } = await db.$client
    .prepare(
      `SELECT s.shop, sh.iana_timezone, s.billing_day, s.lead_days,
              (SELECT a.period_end FROM audits a WHERE a.shop = s.shop AND a.period_end IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) AS period_end,
              (SELECT MAX(sc.created_at) FROM scans sc WHERE sc.shop = s.shop AND sc.origin = 'scheduled') AS last_scheduled
       FROM settings s
       JOIN shops sh ON sh.shop = s.shop AND sh.status = 'installed'
       JOIN klaviyo_connections k ON k.shop = s.shop AND k.status = 'connected'
       WHERE s.schedule_enabled = 1
       LIMIT 500`,
    )
    .all<ShopRow>();
  return results.map((r) =>
    decideSchedule(
      {
        shop: r.shop,
        timezone: r.iana_timezone,
        billingDay: r.billing_day,
        leadDays: r.lead_days,
        lastPeriodEnd: r.period_end !== null ? new Date(r.period_end) : null,
        lastScheduledScanAt: r.last_scheduled !== null ? new Date(r.last_scheduled) : null,
      },
      now,
    ),
  );
}

/** One cron tick. `startScan` is injected so the same code runs in tests. Returns the shops a scan was started for. */
export async function runScheduleTick(deps: {
  db: Db;
  startScan: (args: { shop: string; createdBy: string; origin: "scheduled" }) => Promise<{ scanId: string; started: boolean }>;
  now?: Date;
  /** Scans started per tick, to stay inside one invocation's limits; the rest are picked up an hour later. */
  maxStarts?: number;
}): Promise<{ started: string[]; due: number }> {
  const now = deps.now ?? new Date();
  const due = (await scheduleDecisions(deps.db, now)).filter((d) => d.due);
  const started: string[] = [];
  for (const decision of due.slice(0, deps.maxStarts ?? 20)) {
    try {
      const result = await deps.startScan({ shop: decision.shop, createdBy: "schedule", origin: "scheduled" });
      if (result.started) started.push(decision.shop);
    } catch {
      // One shop failing must not stop the others; it is retried on the next tick.
    }
  }
  return { started, due: due.length };
}
