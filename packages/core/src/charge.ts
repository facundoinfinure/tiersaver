/**
 * TierSaver's own price: a flat MONTHLY plan by list size.
 *
 * Decided by the owner on 2026-11-26 (docs/04-PRECIO-Y-COBRO.md); replaces the per-cleanup charge of 2026-11-25:
 * - free until the first cleanup: connecting, the audit and the simulation need no plan;
 * - the plan starts when the merchant approves their first cleanup and is then charged by Shopify every
 *   30 days, whether or not a cleanup runs that month, until the merchant cancels;
 * - a cleanup may start only with an active plan whose monthly price is at least the price of the tier of the
 *   list size shown in the simulation being approved;
 * - above the last tier the product is not sold automatically.
 *
 * The price never depends on the merchant's Klaviyo invoice or on any saving
 * (docs/12-CUMPLIMIENTO-KLAVIYO.md). All money in integer US cents.
 */

export interface FlatPriceTier {
  /** Largest active-profile count this tier covers. */
  maxProfiles: number;
  monthlyCents: number;
}

/**
 * Monthly prices and list-size boundaries, decided by the owner on 2026-11-26.
 * Above the last tier there is no public price.
 */
export const FLAT_PRICE_TIERS: readonly FlatPriceTier[] = Object.freeze([
  { maxProfiles: 10_000, monthlyCents: 900 },
  { maxProfiles: 25_000, monthlyCents: 1_900 },
  { maxProfiles: 75_000, monthlyCents: 3_900 },
  { maxProfiles: 150_000, monthlyCents: 7_900 },
]);

export interface FeePolicy {
  tiers: readonly FlatPriceTier[];
  /** Days between two charges of the plan (Shopify's EVERY_30_DAYS interval). */
  billingIntervalDays: number;
}

export const DEFAULT_FEE_POLICY: FeePolicy = Object.freeze({
  tiers: FLAT_PRICE_TIERS,
  billingIntervalDays: 30,
});

/** The price tier for a list size, or null when the list is larger than every tier. */
export function flatTierFor(activeProfiles: number, tiers: readonly FlatPriceTier[] = FLAT_PRICE_TIERS): FlatPriceTier | null {
  const n = Math.max(0, Math.ceil(activeProfiles));
  return tiers.find((t) => n <= t.maxProfiles) ?? null;
}

/** The tier whose monthly price is exactly `monthlyCents`, or null (a plan that is not one of ours). */
export function flatTierForPrice(monthlyCents: number, tiers: readonly FlatPriceTier[] = FLAT_PRICE_TIERS): FlatPriceTier | null {
  return tiers.find((t) => t.monthlyCents === monthlyCents) ?? null;
}

export interface PlanQuote {
  /** List size the plan is chosen for. */
  activeProfiles: number;
  /** Null above the public tiers: not sold automatically. */
  tier: FlatPriceTier | null;
  /** The tier's monthly price; 0 when there is no tier. */
  monthlyCents: number;
}

/** The monthly plan a list of this size needs. */
export function quotePlan(activeProfiles: number, policy: FeePolicy = DEFAULT_FEE_POLICY): PlanQuote {
  const n = Math.max(0, Math.ceil(activeProfiles));
  const tier = flatTierFor(n, policy.tiers);
  return { activeProfiles: n, tier, monthlyCents: tier?.monthlyCents ?? 0 };
}

export type PlanCoverage =
  /** The active plan is the one for this list size. */
  | { covered: true; overpaying: false; requiredCents: number }
  /** The active plan costs more than this list size needs: the merchant must be told and offered the lower plan. */
  | { covered: true; overpaying: true; requiredCents: number }
  | { covered: false; reason: "no_plan" | "plan_price_too_low"; requiredCents: number }
  /** List larger than the public tiers: no plan covers it. */
  | { covered: false; reason: "above_price_tiers"; requiredCents: null };

/**
 * Whether a plan of `planMonthlyCents` (null: no active plan) allows a cleanup of a list of `activeProfiles`.
 * The rule: the plan's monthly price must be at least the price of the list's tier.
 */
export function planCoverage(planMonthlyCents: number | null, activeProfiles: number, policy: FeePolicy = DEFAULT_FEE_POLICY): PlanCoverage {
  const tier = flatTierFor(activeProfiles, policy.tiers);
  if (!tier) return { covered: false, reason: "above_price_tiers", requiredCents: null };
  const requiredCents = tier.monthlyCents;
  if (planMonthlyCents === null || !Number.isFinite(planMonthlyCents)) return { covered: false, reason: "no_plan", requiredCents };
  if (planMonthlyCents < requiredCents) return { covered: false, reason: "plan_price_too_low", requiredCents };
  return planMonthlyCents > requiredCents ? { covered: true, overpaying: true, requiredCents } : { covered: true, overpaying: false, requiredCents };
}

/** "$1,234.50" style formatting for cents. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  return rest === 0 ? `${sign}$${dollarsStr}` : `${sign}$${dollarsStr}.${String(rest).padStart(2, "0")}`;
}
