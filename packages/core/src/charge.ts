/**
 * TierSaver's own fee: a flat monthly price by list size, charged only for a
 * billing cycle in which a cleanup actually suppressed profiles.
 *
 * The fee never depends on the merchant's Klaviyo invoice or on any saving
 * (decided on 2026-11-25; see docs/12-CUMPLIMIENTO-KLAVIYO.md).
 *
 * All money in integer US cents.
 */

export interface FlatPriceTier {
  /** Largest active-profile count this tier covers. */
  maxProfiles: number;
  monthlyCents: number;
}

/**
 * Prices and list-size boundaries, confirmed by the owner on 2026-11-25.
 * Above the last tier there is no public price.
 */
export const FLAT_PRICE_TIERS: readonly FlatPriceTier[] = Object.freeze([
  { maxProfiles: 10_000, monthlyCents: 1_500 },
  { maxProfiles: 25_000, monthlyCents: 2_900 },
  { maxProfiles: 75_000, monthlyCents: 7_900 },
  { maxProfiles: 150_000, monthlyCents: 14_900 },
]);

export interface FeePolicy {
  tiers: readonly FlatPriceTier[];
  /** Maximum TierSaver charges in one Shopify 30-day billing window (the subscription's capped amount). */
  windowCapCents: number;
  /** Minimum days between two charges: at most one per Klaviyo billing cycle. */
  minDaysBetweenCharges: number;
}

export const DEFAULT_FEE_POLICY: FeePolicy = Object.freeze({
  tiers: FLAT_PRICE_TIERS,
  windowCapCents: 14_900,
  minDaysBetweenCharges: 28,
});

/** The price tier for a list size, or null when the list is larger than every tier. */
export function flatTierFor(activeProfiles: number, tiers: readonly FlatPriceTier[] = FLAT_PRICE_TIERS): FlatPriceTier | null {
  const n = Math.max(0, Math.ceil(activeProfiles));
  return tiers.find((t) => n <= t.maxProfiles) ?? null;
}

export type NoChargeReason =
  /** No cleanup ran, or it suppressed nobody: nothing is charged for that cycle. */
  | "no_cleanup"
  | "already_charged_this_cycle"
  | "cap_reached"
  /** The whole cleanup was undone before its charge went out: nothing stayed suppressed, nothing is charged. */
  | "cleanup_undone"
  /** List larger than the public tiers: priced by agreement, never charged automatically. */
  | "above_price_tiers";

export interface ChargeQuote {
  /** List size the price is based on. */
  activeProfiles: number;
  tier: FlatPriceTier | null;
  /** The tier's price, before the "no cleanup", one-per-cycle and cap rules. */
  listFeeCents: number;
  /** What we would actually charge. */
  feeCents: number;
  capApplied: boolean;
  noChargeReason: NoChargeReason | null;
}

export interface ChargeInput {
  /** Active profiles before the cleanup (from the audit behind the simulation). */
  activeProfiles: number;
  /** Profiles the cleanup suppressed (or, for a quote shown before approval, would suppress). */
  profilesSuppressed: number;
  /** Sum of TierSaver usage charges already created in the current Shopify window. */
  chargedInWindowCents?: number;
  /** When the last charge was created, if any. */
  lastChargeAt?: Date | null;
  now?: Date;
  policy?: FeePolicy;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function quoteCharge(input: ChargeInput): ChargeQuote {
  const policy = input.policy ?? DEFAULT_FEE_POLICY;
  const activeProfiles = Math.max(0, Math.ceil(input.activeProfiles));
  const tier = flatTierFor(activeProfiles, policy.tiers);
  const listFeeCents = tier?.monthlyCents ?? 0;

  const result = (feeCents: number, capApplied: boolean, noChargeReason: NoChargeReason | null): ChargeQuote => ({
    activeProfiles,
    tier,
    listFeeCents,
    feeCents,
    capApplied,
    noChargeReason,
  });

  if (!(input.profilesSuppressed > 0)) return result(0, false, "no_cleanup");
  if (!tier) return result(0, false, "above_price_tiers");

  if (input.lastChargeAt) {
    const now = input.now ?? new Date();
    const elapsedDays = (now.getTime() - input.lastChargeAt.getTime()) / DAY_MS;
    if (elapsedDays < policy.minDaysBetweenCharges) return result(0, false, "already_charged_this_cycle");
  }

  const remaining = Math.max(0, policy.windowCapCents - Math.max(0, input.chargedInWindowCents ?? 0));
  if (remaining === 0) return result(0, true, "cap_reached");

  const feeCents = Math.min(listFeeCents, remaining);
  return result(feeCents, feeCents < listFeeCents, null);
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

/**
 * Deterministic idempotency key for the usage charge of a run.
 * One run can only ever produce one charge.
 */
export function chargeIdempotencyKey(shopDomain: string, runId: string): string {
  return `tiersaver:${shopDomain}:run:${runId}`;
}
