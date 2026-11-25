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

export type VerifiedSavingsUnavailableReason = "unknown_tier" | "no_tier_drop";

export interface VerifiedSavings {
  priceTableId: string;
  tierMaxBefore: number;
  tierMaxAfter: number;
  monthlySavingsCents: number;
  unavailableReason: VerifiedSavingsUnavailableReason | null;
}

/**
 * Savings confirmed by Klaviyo itself: compares the plan's profile limit
 * (`usage_max` from the Billing Usage API) before and after a cleanup.
 * Both values must be exact tier boundaries in the table, otherwise we
 * cannot price them and report no savings.
 */
export function verifiedSavings(args: { tierMaxBefore: number; tierMaxAfter: number; table: PriceTable }): VerifiedSavings {
  const { tierMaxBefore, tierMaxAfter, table } = args;
  const base = { priceTableId: table.id, tierMaxBefore, tierMaxAfter };
  const before = table.tiers.find((t) => t.maxProfiles === tierMaxBefore);
  const after = table.tiers.find((t) => t.maxProfiles === tierMaxAfter);
  if (!before || !after) return { ...base, monthlySavingsCents: 0, unavailableReason: "unknown_tier" };
  const delta = before.monthlyCents - after.monthlyCents;
  if (delta <= 0) return { ...base, monthlySavingsCents: 0, unavailableReason: "no_tier_drop" };
  return { ...base, monthlySavingsCents: delta, unavailableReason: null };
}

/**
 * The amount we bill on: never more than what the merchant approved in the
 * simulation, never more than what Klaviyo confirmed, and, when the merchant
 * told us what they actually pay, never more than their real price difference.
 */
export function billableSavingsCents(args: {
  approvedEstimateCents: number;
  verifiedCents: number;
  /** Optional: merchant-reported current monthly price, for discounted legacy accounts. */
  reportedCurrentPriceCents?: number | null;
  /** List price of the tier after the cleanup. */
  listPriceAfterCents?: number | null;
}): number {
  let cents = Math.min(Math.max(0, args.approvedEstimateCents), Math.max(0, args.verifiedCents));
  if (args.reportedCurrentPriceCents != null && args.listPriceAfterCents != null) {
    cents = Math.min(cents, Math.max(0, args.reportedCurrentPriceCents - args.listPriceAfterCents));
  }
  return cents;
}
