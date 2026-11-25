import { type PriceTable, type PriceTier, tierFor } from "./pricing.js";

export type SavingsUnavailableReason =
  | "free_plan"
  | "above_known_tiers"
  | "no_change";

export interface SavingsEstimate {
  priceTableId: string;
  profilesBefore: number;
  profilesAfter: number;
  tierBefore: PriceTier | null;
  tierAfter: PriceTier | null;
  /** Monthly savings in cents. Always >= 0. 0 when unavailable. */
  monthlySavingsCents: number;
  /** Why there are no savings, when monthlySavingsCents is 0. */
  unavailableReason: SavingsUnavailableReason | null;
  /** Always true: savings come from list prices, not the merchant's real invoice. */
  isEstimate: true;
}

export interface SavingsInput {
  /** Active (billable) profiles the account would have without the cleanup. */
  profilesBefore: number;
  /** Profiles suppressed (or to be suppressed) by the cleanup. */
  profilesRemoved: number;
  table: PriceTable;
  /** Accounts on Klaviyo's free plan can't save anything. */
  onFreePlan?: boolean;
}

/**
 * Savings = price of the tier the account would be in without the cleanup
 *         − price of the tier it lands in after the cleanup.
 *
 * Conservative: if either side falls outside the known table, savings are 0.
 */
export function estimateSavings(input: SavingsInput): SavingsEstimate {
  const { table } = input;
  const profilesBefore = Math.max(0, Math.ceil(input.profilesBefore));
  const removed = Math.max(0, Math.floor(input.profilesRemoved));
  const profilesAfter = Math.max(0, profilesBefore - removed);

  const base = {
    priceTableId: table.id,
    profilesBefore,
    profilesAfter,
    isEstimate: true as const,
  };

  if (input.onFreePlan) {
    return { ...base, tierBefore: null, tierAfter: null, monthlySavingsCents: 0, unavailableReason: "free_plan" };
  }

  const before = tierFor(profilesBefore, table);
  const after = tierFor(profilesAfter, table);
  if (!before || !after) {
    return {
      ...base,
      tierBefore: before?.tier ?? null,
      tierAfter: after?.tier ?? null,
      monthlySavingsCents: 0,
      unavailableReason: "above_known_tiers",
    };
  }

  const savings = before.tier.monthlyCents - after.tier.monthlyCents;
  return {
    ...base,
    tierBefore: before.tier,
    tierAfter: after.tier,
    monthlySavingsCents: Math.max(0, savings),
    unavailableReason: savings > 0 ? null : "no_change",
  };
}

/**
 * How many profiles must be removed to drop exactly one tier (or to a target
 * tier). Useful for the audit: "remove 1,240 more to drop to the next tier".
 * Returns null when already in the lowest tier.
 */
export function profilesToDropOneTier(activeProfiles: number, table: PriceTable): number | null {
  const current = tierFor(activeProfiles, table);
  if (!current || current.index === 0) return null;
  const lower = table.tiers[current.index - 1]!;
  return Math.ceil(activeProfiles) - lower.maxProfiles;
}
