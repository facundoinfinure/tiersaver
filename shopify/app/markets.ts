import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./db/schema";

/**
 * Where TierSaver is offered. Owner's decision of 2026-11-27 (docs/16-LEGALES.md §2.4): for now the app is
 * not offered to stores located in the European Union / EEA, the United Kingdom or Switzerland, so that the
 * EU and UK GDPR obligation to appoint a local representative (Art. 27) does not arise.
 *
 * Location of a store = the country of its address in Shopify (`shops.country_code`, read once by
 * `rememberShopProfile` in settings/timezone.ts). Unknown country = allowed: the app never blocks on missing data.
 *
 * An excluded store cannot connect Klaviyo, run an audit, approve a simulation, request a plan or start a
 * cleanup (each path checks `isShopExcluded`; the run gateway checks again before any suppress request).
 * Restoring an earlier cleanup stays possible: reversal never depends on this rule (product rule 3).
 *
 * No Cloudflare imports: the same code runs in routes, Workflows and tests.
 */

type Db = DrizzleD1Database<typeof schema>;

/** ISO 3166-1 alpha-2 codes, as Shopify's `CountryCode` enum spells them. */
export const EXCLUDED_COUNTRY_CODES: readonly string[] = [
  // The 27 EU member states.
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // Parts of the EU that Shopify lists as countries of their own (GDPR applies there): Åland (Finland) and the
  // French outermost regions.
  "AX", "GF", "GP", "MQ", "RE", "YT", "MF",
  // The rest of the EEA (GDPR applies through the EEA Agreement).
  "IS", "LI", "NO",
  // The United Kingdom (UK GDPR) and Switzerland (revDSG, which also requires a representative).
  "GB", "CH",
  // Conservative: Gibraltar (Gibraltar GDPR) and the Crown dependencies (Guernsey, Jersey, Isle of Man) have
  // GDPR-style laws of their own, with their own representative rules; they are excluded with the UK.
  "GI", "GG", "JE", "IM",
];

const EXCLUDED = new Set(EXCLUDED_COUNTRY_CODES);

/** Refusal code used by every blocked path, and shown through the labels of the pages. */
export const MARKET_EXCLUDED = "market_excluded" as const;

export function isExcludedCountry(code: string | null | undefined): boolean {
  return Boolean(code) && EXCLUDED.has(code!.toUpperCase());
}

/** The stored country of the shop, or null while Shopify has not told us (or did not know). */
export async function shopCountry(db: Db, shop: string): Promise<string | null> {
  const row = await db.query.shops.findFirst({ where: eq(schema.shops.shop, shop), columns: { countryCode: true } });
  return row?.countryCode ?? null;
}

/** True only for a shop whose stored country is excluded. Unknown country or no row: false. */
export async function isShopExcluded(db: Db, shop: string): Promise<boolean> {
  return isExcludedCountry(await shopCountry(db, shop));
}

/**
 * The country that decides, from the two addresses Shopify gives (Admin GraphQL 2026-10, `Shop.shopAddress`
 * and the deprecated `Shop.billingAddress`, both `ShopAddress.countryCodeV2`). If either is in an excluded
 * country, that one; otherwise the billing country, else the shop address country, else null (unknown).
 */
export function decidingCountry(billing: string | null | undefined, shopAddress: string | null | undefined): string | null {
  const codes = [billing, shopAddress].map((c) => (c ? c.toUpperCase() : null));
  return codes.find((c) => isExcludedCountry(c)) ?? codes.find((c) => Boolean(c)) ?? null;
}
