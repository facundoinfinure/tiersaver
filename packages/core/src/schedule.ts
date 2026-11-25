/**
 * Cleanup scheduling against the merchant's Klaviyo billing date.
 *
 * Dates are calendar dates (YYYY-MM-DD) in the shop's time zone, represented
 * as UTC-midnight Date objects so arithmetic is free of DST surprises.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleSettings {
  /** Day of month the Klaviyo billing cycle renews (1–31). */
  billingDay: number;
  /** Preferred days before the billing date to run. Default 5. */
  leadDays: number;
  /** Never run closer than this to the billing date (Klaviyo count lag up to 72 h). Default 4. */
  minLeadDays: number;
}

export const DEFAULT_SCHEDULE: Omit<ScheduleSettings, "billingDay"> = Object.freeze({
  leadDays: 5,
  minLeadDays: 4,
});

export function toCalendarDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseCalendarDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Invalid calendar date ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function formatCalendarDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Billing date in a given month; day 31 falls back to the month's last day. */
export function billingDateInMonth(year: number, monthIndex: number, billingDay: number): Date {
  const day = Math.min(billingDay, daysInMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, day));
}

/** The next billing date strictly after `today`. */
export function nextBillingDate(today: Date, billingDay: number): Date {
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
    throw new RangeError(`billingDay must be 1–31, got ${billingDay}`);
  }
  const t = toCalendarDate(today);
  const thisMonth = billingDateInMonth(t.getUTCFullYear(), t.getUTCMonth(), billingDay);
  if (thisMonth.getTime() > t.getTime()) return thisMonth;
  const y = t.getUTCMonth() === 11 ? t.getUTCFullYear() + 1 : t.getUTCFullYear();
  const m = (t.getUTCMonth() + 1) % 12;
  return billingDateInMonth(y, m, billingDay);
}

export interface PlannedCleanup {
  /** Date the cleanup should run (shop calendar). */
  runOn: Date;
  /** Billing date this cleanup targets. */
  billingDate: Date;
  /** True when we are already inside the preferred window and should run today. */
  runToday: boolean;
}

/**
 * Plans the next cleanup. If the preferred run date for the upcoming billing
 * date has passed but we are still at least `minLeadDays` before it, run today.
 * Otherwise target the following cycle.
 */
export function planNextCleanup(today: Date, settings: ScheduleSettings): PlannedCleanup {
  const t = toCalendarDate(today);
  let billing = nextBillingDate(t, settings.billingDay);
  for (let i = 0; i < 2; i++) {
    const preferred = new Date(billing.getTime() - settings.leadDays * DAY_MS);
    const latest = new Date(billing.getTime() - settings.minLeadDays * DAY_MS);
    if (preferred.getTime() >= t.getTime()) {
      return { runOn: preferred, billingDate: billing, runToday: preferred.getTime() === t.getTime() };
    }
    if (latest.getTime() >= t.getTime()) {
      return { runOn: t, billingDate: billing, runToday: true };
    }
    billing = nextBillingDate(billing, settings.billingDay);
  }
  /* c8 ignore next */
  throw new Error("unreachable: could not plan cleanup");
}

/** Date in a given IANA time zone, as a calendar date. */
export function todayInTimeZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseCalendarDate(parts);
}
