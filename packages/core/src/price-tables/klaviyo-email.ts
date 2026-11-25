import type { PriceTable } from "../pricing.js";

/**
 * Klaviyo Email plan, monthly list prices by active profiles.
 *
 * STATUS: UNVERIFIED. Klaviyo publishes no price API and klaviyo.com/pricing
 * could not be read from the build environment. Rows come from third-party
 * blogs (see docs/09-FUENTES.md and docs/STATUS.md) and the ladder has gaps
 * (12,500–25,000 and above 50,000 are incomplete). Do not ship to merchants
 * until every row is checked against the official pricing slider and
 * `verified` is set to true.
 */
export const KLAVIYO_EMAIL_2026_11_DRAFT: PriceTable = {
  id: "klaviyo-email-2026-11-draft",
  plan: "email",
  currency: "USD",
  capturedOn: "2026-11-25",
  source: "Third-party summaries of klaviyo.com/pricing; pending official verification",
  tiers: [
    { maxProfiles: 500, monthlyCents: 2_000, verified: false },
    { maxProfiles: 1_000, monthlyCents: 3_000, verified: false },
    { maxProfiles: 1_500, monthlyCents: 4_500, verified: false },
    { maxProfiles: 2_500, monthlyCents: 6_000, verified: false },
    { maxProfiles: 5_000, monthlyCents: 10_000, verified: false },
    { maxProfiles: 10_000, monthlyCents: 15_000, verified: false },
    { maxProfiles: 12_500, monthlyCents: 27_500, verified: false },
    { maxProfiles: 25_000, monthlyCents: 40_000, verified: false },
    { maxProfiles: 50_000, monthlyCents: 72_000, verified: false },
    { maxProfiles: 100_000, monthlyCents: 138_000, verified: false },
    { maxProfiles: 150_000, monthlyCents: 195_500, verified: false },
  ],
};

export function isTableFullyVerified(table: PriceTable): boolean {
  return table.tiers.every((t) => t.verified);
}
