/**
 * TierSaver's own fee: a share of the estimated monthly savings, capped per
 * billing window, and nothing when there are no savings.
 *
 * All money in integer US cents.
 */

export interface FeePolicy {
  /** Share of savings, in basis points. 2000 = 20%. */
  rateBps: number;
  /** Maximum TierSaver charges in one Shopify 30-day billing window. */
  windowCapCents: number;
  /** Minimum days between two cleanup charges (one charge per Klaviyo billing cycle). */
  minDaysBetweenCharges: number;
}

export const DEFAULT_FEE_POLICY: FeePolicy = Object.freeze({
  rateBps: 2000,
  windowCapCents: 14_900,
  minDaysBetweenCharges: 28,
});

export type NoChargeReason =
  | "no_savings"
  | "cap_reached"
  | "already_charged_this_cycle";

export interface ChargeQuote {
  savingsCents: number;
  /** Fee before applying the cap. */
  uncappedFeeCents: number;
  /** What we would actually charge. */
  feeCents: number;
  capApplied: boolean;
  noChargeReason: NoChargeReason | null;
}

export interface ChargeInput {
  monthlySavingsCents: number;
  /** Sum of TierSaver usage charges already created in the current Shopify window. */
  chargedInWindowCents?: number;
  /** When the last cleanup charge was created, if any. */
  lastChargeAt?: Date | null;
  now?: Date;
  policy?: FeePolicy;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function quoteCharge(input: ChargeInput): ChargeQuote {
  const policy = input.policy ?? DEFAULT_FEE_POLICY;
  const savingsCents = Math.max(0, Math.floor(input.monthlySavingsCents));
  const uncappedFeeCents = Math.round((savingsCents * policy.rateBps) / 10_000);

  const result = (feeCents: number, capApplied: boolean, noChargeReason: NoChargeReason | null): ChargeQuote => ({
    savingsCents,
    uncappedFeeCents,
    feeCents,
    capApplied,
    noChargeReason,
  });

  if (savingsCents === 0 || uncappedFeeCents === 0) return result(0, false, "no_savings");

  if (input.lastChargeAt) {
    const now = input.now ?? new Date();
    const elapsedDays = (now.getTime() - input.lastChargeAt.getTime()) / DAY_MS;
    if (elapsedDays < policy.minDaysBetweenCharges) {
      return result(0, false, "already_charged_this_cycle");
    }
  }

  const remaining = Math.max(0, policy.windowCapCents - Math.max(0, input.chargedInWindowCents ?? 0));
  if (remaining === 0) return result(0, true, "cap_reached");

  const feeCents = Math.min(uncappedFeeCents, remaining);
  return result(feeCents, feeCents < uncappedFeeCents, null);
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
