/**
 * Klaviyo price tables and tier lookup.
 *
 * All money is handled in integer US cents.
 *
 * A price table is versioned data, never fetched live: Klaviyo does not publish
 * a consumable price API. Every figure we show a merchant that comes from this
 * table is an estimate and must be labelled as such in the UI.
 */

export interface PriceTier {
  /** Upper bound of active profiles included in this tier (inclusive). */
  maxProfiles: number;
  /** Monthly list price in US cents for this tier. */
  monthlyCents: number;
  /** True when this row was read from an official Klaviyo source. */
  verified: boolean;
}

export interface PriceTable {
  /** Stable identifier stored with every audit and simulation, e.g. "klaviyo-email-2026-11-25". */
  id: string;
  plan: "email" | "email_sms";
  currency: "USD";
  /** ISO date the prices were captured. */
  capturedOn: string;
  /** Where the prices come from. */
  source: string;
  /** Ascending by maxProfiles. */
  tiers: PriceTier[];
}

export interface TierLookup {
  tier: PriceTier;
  index: number;
}

export class PriceTableError extends Error {}

/** Validates a table: ascending, positive, non-decreasing prices. Throws on error. */
export function assertValidPriceTable(table: PriceTable): void {
  if (table.tiers.length === 0) {
    throw new PriceTableError(`Price table ${table.id} has no tiers`);
  }
  let prev: PriceTier | undefined;
  for (const tier of table.tiers) {
    if (!Number.isInteger(tier.maxProfiles) || tier.maxProfiles <= 0) {
      throw new PriceTableError(`Invalid maxProfiles ${tier.maxProfiles} in ${table.id}`);
    }
    if (!Number.isInteger(tier.monthlyCents) || tier.monthlyCents < 0) {
      throw new PriceTableError(`Invalid monthlyCents ${tier.monthlyCents} in ${table.id}`);
    }
    if (prev) {
      if (tier.maxProfiles <= prev.maxProfiles) {
        throw new PriceTableError(`Tiers not ascending at ${tier.maxProfiles} in ${table.id}`);
      }
      if (tier.monthlyCents < prev.monthlyCents) {
        throw new PriceTableError(`Price decreases at ${tier.maxProfiles} in ${table.id}`);
      }
    }
    prev = tier;
  }
}

/**
 * Returns the tier an account with `activeProfiles` falls into, or null when the
 * count is above the largest tier we have data for (custom pricing territory).
 */
export function tierFor(activeProfiles: number, table: PriceTable): TierLookup | null {
  if (!Number.isFinite(activeProfiles) || activeProfiles < 0) {
    throw new RangeError(`activeProfiles must be a non-negative number, got ${activeProfiles}`);
  }
  const count = Math.ceil(activeProfiles);
  for (let index = 0; index < table.tiers.length; index++) {
    const tier = table.tiers[index]!;
    if (count <= tier.maxProfiles) return { tier, index };
  }
  return null;
}

export interface TierProximity {
  current: TierLookup;
  /** Profiles left before crossing into the next tier. */
  headroom: number;
  /** The next tier, or null if the account is in the largest known tier. */
  next: PriceTier | null;
  /** Extra monthly cost if the account crosses into the next tier. */
  nextTierDeltaCents: number | null;
  /** True when the account is within `thresholdRatio` of the next tier boundary. */
  nearNextTier: boolean;
}

/**
 * Tier alert: is the list close to jumping into the next (more expensive) tier?
 * Default threshold: within 5% of the current tier's upper bound.
 */
export function tierProximity(
  activeProfiles: number,
  table: PriceTable,
  thresholdRatio = 0.05,
): TierProximity | null {
  const current = tierFor(activeProfiles, table);
  if (!current) return null;
  const next = table.tiers[current.index + 1] ?? null;
  const headroom = current.tier.maxProfiles - Math.ceil(activeProfiles);
  return {
    current,
    headroom,
    next,
    nextTierDeltaCents: next ? next.monthlyCents - current.tier.monthlyCents : null,
    nearNextTier: next !== null && headroom <= current.tier.maxProfiles * thresholdRatio,
  };
}
