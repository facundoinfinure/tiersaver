import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { decidingCountry } from "../markets";

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

/**
 * One read of the shop's profile for two things: its time zone (dates) and its country (app/markets.ts).
 *
 * Verified on 2026-11-27 at https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Shop and
 * .../2026-10/objects/ShopAddress: `Shop.ianaTimezone` (String!), `Shop.shopAddress` (ShopAddress!, "The shop's
 * address information as it will appear to buyers") and `Shop.billingAddress` (ShopAddress!, marked deprecated
 * in 2026-10 with no replacement named); `ShopAddress.countryCodeV2` (CountryCode, "for example, US"). The
 * pages name no access scope for these fields; `ianaTimezone` was already read with the app's current scopes
 * (read_orders), so no scope is added. Both addresses are asked: the billing country was the owner's choice and
 * the shop address is the one Shopify keeps. When the API version is upgraded, check that `billingAddress` still
 * exists, or the whole query fails (and every store would read as "country unknown", which is allowed).
 */
export const SHOP_PROFILE_QUERY = `#graphql
  query TierSaverShopProfile {
    shop {
      ianaTimezone
      shopAddress {
        countryCodeV2
      }
      billingAddress {
        countryCodeV2
      }
    }
  }`;

/** A known country is asked again after this long (a store that moves is noticed within a week). */
export const COUNTRY_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

type ShopProfileBody = {
  data?: { shop?: { ianaTimezone?: string | null; shopAddress?: { countryCodeV2?: string | null } | null; billingAddress?: { countryCodeV2?: string | null } | null } | null };
};

/**
 * Stores the shop's time zone and country (Admin GraphQL `Shop`, no extra scope), on install and lazily from
 * the app's layout loader. Asks Shopify only while the zone is unknown or the country was not checked in the
 * last `COUNTRY_RECHECK_MS`. A country Shopify does not give is stored as unknown (allowed) and logged.
 * Never throws: until it succeeds, dates are shown in UTC and say so, and the country is unknown.
 */
export async function rememberShopProfile(
  db: Db,
  shop: string,
  graphql: (query: string) => Promise<Response>,
  now: Date = new Date(),
): Promise<void> {
  try {
    const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { ianaTimezone: true, countryCheckedAt: true } });
    if (!row) return;
    const countryFresh = Boolean(row.countryCheckedAt && now.getTime() - row.countryCheckedAt.getTime() < COUNTRY_RECHECK_MS);
    if (row.ianaTimezone && countryFresh) return;
    const response = await graphql(SHOP_PROFILE_QUERY);
    const body = (await response.json()) as ShopProfileBody;
    const data = body.data?.shop;
    if (!data) return;
    const update: Partial<typeof schema.shops.$inferInsert> = {};
    const zone = data.ianaTimezone;
    if (!row.ianaTimezone && zone && safeTimeZone(zone) === zone) update.ianaTimezone = zone;
    if (!countryFresh) {
      const country = decidingCountry(data.billingAddress?.countryCodeV2, data.shopAddress?.countryCodeV2);
      // Unknown is allowed (the app does not block on missing data), but it is worth knowing about.
      if (!country) console.warn(`shop country not returned by Shopify for ${shop}; treated as allowed`);
      // A country already known is not erased by an answer without one.
      if (country) update.countryCode = country;
      update.countryCheckedAt = now;
    }
    if (Object.keys(update).length > 0) await db.update(schema.shops).set(update).where(eq(schema.shops.shop, shop));
  } catch {
    // Dates stay in UTC; the country stays as it was.
  }
}
