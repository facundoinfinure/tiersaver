import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

/**
 * Dates as the merchant reads them. Every date and time is formatted on the
 * server, in the shop's time zone, and travels to the browser as text with the
 * zone in it. The browser never formats a date itself: its time zone differs
 * from the Worker's (UTC), which made React throw the server HTML away, and a
 * time without a zone cannot be acted on (a simulation expires at a given hour).
 *
 * No Cloudflare imports: the same code runs in routes and in tests.
 */

type Db = DrizzleD1Database<typeof schema>;

/** A moment, ready to render: `<time dateTime={iso}>{text}</time>`. */
export interface Stamp {
  iso: string;
  text: string;
}

export const FALLBACK_TIME_ZONE = "UTC";

/** The zone if `Intl` knows it, else UTC. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** "Nov 25, 2026, 5:36 PM PST". The zone is always part of the text. */
export function formatDateTime(value: Date | string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(value));
}

/** "Nov 25, 2026": the calendar day of a moment in the given zone. */
export function formatDate(value: Date | string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: safeTimeZone(timeZone) }).format(new Date(value));
}

/** A calendar date ("2026-12-05", as the schedule computes it) as "Dec 5, 2026". It has no time and no zone. */
export function formatCalendarDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

export function stamp(value: Date | string, timeZone?: string | null): Stamp {
  const date = new Date(value);
  return { iso: date.toISOString(), text: formatDateTime(date, timeZone) };
}

export function dayStamp(value: Date | string, timeZone?: string | null): Stamp {
  const date = new Date(value);
  return { iso: date.toISOString(), text: formatDate(date, timeZone) };
}

/** The shop's IANA time zone (`shops.iana_timezone`), or UTC while it is not known. */
export async function shopTimeZone(db: Db, shop: string): Promise<string> {
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { ianaTimezone: true } });
  return safeTimeZone(row?.ianaTimezone);
}

export const SHOP_TIME_ZONE_QUERY = `#graphql
  query TierSaverShopTimeZone {
    shop {
      ianaTimezone
    }
  }`;

/**
 * Stores the shop's time zone the first time it is seen (Admin GraphQL `Shop.ianaTimezone`, no extra scope).
 * Never throws: until it succeeds, dates are shown in UTC and say so.
 */
export async function rememberShopTimeZone(
  db: Db,
  shop: string,
  graphql: (query: string) => Promise<Response>,
): Promise<void> {
  try {
    const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { ianaTimezone: true } });
    if (!row || row.ianaTimezone) return;
    const response = await graphql(SHOP_TIME_ZONE_QUERY);
    const body = (await response.json()) as { data?: { shop?: { ianaTimezone?: string | null } } };
    const zone = body.data?.shop?.ianaTimezone;
    if (!zone || safeTimeZone(zone) !== zone) return;
    await db.update(schema.shops).set({ ianaTimezone: zone }).where(eq(schema.shops.shop, shop));
  } catch {
    // Dates stay in UTC.
  }
}
