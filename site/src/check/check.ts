/**
 * List health check: pure logic.
 *
 * It answers three questions about a list: how many profiles would stay
 * active after a cleanup, which TierSaver plan covers a list of that size,
 * and (as a secondary, cited fact) which Klaviyo plan size the active count
 * corresponds to today and afterwards.
 *
 * Klaviyo plan sizes and list prices come from @tiersaver/core's price table,
 * the same data the app uses; nothing about Klaviyo's prices is typed here.
 * TierSaver's own prices come from src/site-config.ts.
 *
 * By design this module computes no saving, no difference between prices and
 * no fee derived from Klaviyo's prices.
 */
import { CURRENT_PRICE_TABLES, tierFor, type PriceTable, type PriceTier } from "@tiersaver/core";
import { TIERSAVER_PLANS, type TierSaverPlan } from "../site-config.js";

export type KlaviyoPlan = "email" | "marketing" | "free";
export type CriteriaUnit = "profiles" | "percent";

export interface CheckInput {
  /** Active profiles in the Klaviyo account today. */
  activeProfiles: number;
  /** Profiles that meet the cleanup criteria: a count, or a percentage of activeProfiles. */
  meetingCriteria: number;
  unit: CriteriaUnit;
  plan: KlaviyoPlan;
}

export interface CheckResult {
  valid: boolean;
  profilesBefore: number;
  profilesSuppressed: number;
  profilesAfter: number;
  /** TierSaver plan for the list's current size; null = larger than the largest plan (contact us). */
  tierSaverPlan: TierSaverPlan | null;
  /** Klaviyo plan size the count falls in today; null on the free plan or above the largest published size. */
  klaviyoBefore: PriceTier | null;
  klaviyoAfter: PriceTier | null;
  klaviyoPlan: KlaviyoPlan;
  /** True when a count is above the largest plan size Klaviyo publishes. */
  beforeAbovePublished: boolean;
  afterAbovePublished: boolean;
  priceTableId: string;
  /** ISO date the Klaviyo list prices were read. */
  capturedOn: string;
}

export function tableForPlan(plan: KlaviyoPlan): PriceTable {
  return plan === "marketing" ? CURRENT_PRICE_TABLES.email_sms : CURRENT_PRICE_TABLES.email;
}

/** Largest profile count Klaviyo publishes a list price for. */
export function largestPublishedPlan(table: PriceTable = CURRENT_PRICE_TABLES.email): number {
  return table.tiers[table.tiers.length - 1]!.maxProfiles;
}

/** TierSaver's flat plan for a list with this many active profiles, or null above the largest plan. */
export function tierSaverPlanFor(activeProfiles: number): TierSaverPlan | null {
  const count = Math.ceil(activeProfiles);
  return TIERSAVER_PLANS.find((p) => count <= p.maxProfiles) ?? null;
}

/** Converts the "meet the cleanup criteria" input into a whole number of profiles. */
export function criteriaCount(activeProfiles: number, value: number, unit: CriteriaUnit): number {
  const active = Math.max(0, Math.ceil(activeProfiles));
  const raw = unit === "percent" ? (active * value) / 100 : value;
  return Math.min(active, Math.max(0, Math.floor(raw)));
}

function isUsable(input: CheckInput): boolean {
  if (!Number.isFinite(input.activeProfiles) || input.activeProfiles < 0) return false;
  if (!Number.isFinite(input.meetingCriteria) || input.meetingCriteria < 0) return false;
  if (input.unit === "percent" && input.meetingCriteria > 100) return false;
  return true;
}

export function check(input: CheckInput): CheckResult {
  const table = tableForPlan(input.plan);
  const base = { klaviyoPlan: input.plan, priceTableId: table.id, capturedOn: table.capturedOn };

  if (!isUsable(input)) {
    return {
      ...base,
      valid: false,
      profilesBefore: 0,
      profilesSuppressed: 0,
      profilesAfter: 0,
      tierSaverPlan: null,
      klaviyoBefore: null,
      klaviyoAfter: null,
      beforeAbovePublished: false,
      afterAbovePublished: false,
    };
  }

  const profilesBefore = Math.ceil(input.activeProfiles);
  const profilesSuppressed = criteriaCount(profilesBefore, input.meetingCriteria, input.unit);
  const profilesAfter = profilesBefore - profilesSuppressed;
  const onFree = input.plan === "free";
  const before = onFree ? null : tierFor(profilesBefore, table);
  const after = onFree ? null : tierFor(profilesAfter, table);

  return {
    ...base,
    valid: true,
    profilesBefore,
    profilesSuppressed,
    profilesAfter,
    tierSaverPlan: tierSaverPlanFor(profilesBefore),
    klaviyoBefore: before?.tier ?? null,
    klaviyoAfter: after?.tier ?? null,
    beforeAbovePublished: !onFree && before === null,
    afterAbovePublished: !onFree && after === null,
  };
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "$29" or "$1,234.50" for an amount in US cents. */
export function formatUsd(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return `${cents < 0 ? "-" : ""}$${dollars}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}

/** Parses a whole number such as "12,500", "12 500" or "12500". NaN for anything else. */
export function parseCount(text: string): number {
  const cleaned = text.replace(/[\s,_]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** Parses a percentage such as "20", "20%" or "12.5". NaN for anything else. */
export function parsePercent(text: string): number {
  const cleaned = text.replace(/[\s%]/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export interface CheckView {
  valid: boolean;
  /** The one figure the result leads with: profiles that would stay active. */
  figure: string;
  message: string;
  /** Share of the list that stays active, 0 to 100, for the bar. */
  keptPercent: number;
  staying: string;
  leaving: string;
  tierSaverPrice: string;
  tierSaverPlan: string;
  klaviyoBefore: string;
  klaviyoAfter: string;
}

function klaviyoText(tier: PriceTier | null, above: boolean, plan: KlaviyoPlan): string {
  if (plan === "free") return "Free plan";
  if (above || !tier) return `Above ${formatCount(largestPublishedPlan())} profiles: custom pricing, not published`;
  return `Up to ${formatCount(tier.maxProfiles)} profiles (${formatUsd(tier.monthlyCents)}/mo list price)`;
}

/** Strings for the result panel. Used by the page script and by the build (static default). */
export function describe(result: CheckResult): CheckView {
  if (!result.valid) {
    return {
      valid: false,
      figure: "Check the numbers",
      message:
        "Enter whole numbers: your active profiles, and how many of them meet the cleanup criteria (or a percentage from 0 to 100).",
      keptPercent: 100,
      staying: "",
      leaving: "",
      tierSaverPrice: "",
      tierSaverPlan: "",
      klaviyoBefore: "",
      klaviyoAfter: "",
    };
  }
  const keptPercent =
    result.profilesBefore > 0 ? Math.round((result.profilesAfter / result.profilesBefore) * 1000) / 10 : 100;
  const plan = result.tierSaverPlan;
  return {
    valid: true,
    figure: formatCount(result.profilesAfter),
    message:
      result.profilesSuppressed === 0
        ? "No profiles meet the cleanup criteria, so there is nothing to suppress. A month with no cleanup is not charged."
        : `${formatCount(result.profilesSuppressed)} of ${formatCount(result.profilesBefore)} profiles meet the cleanup criteria. They would be suppressed only after you approve a simulation. None are deleted.`,
    keptPercent,
    staying: `${formatCount(result.profilesAfter)} stay active`,
    leaving: `${formatCount(result.profilesSuppressed)} meet the cleanup criteria`,
    tierSaverPrice: plan ? `${formatUsd(plan.monthlyCents)}/month` : "Contact us",
    tierSaverPlan: plan
      ? `Flat price for lists up to ${formatCount(plan.maxProfiles)} active profiles`
      : `Lists above ${formatCount(TIERSAVER_PLANS[TIERSAVER_PLANS.length - 1]!.maxProfiles)} active profiles are quoted individually`,
    klaviyoBefore: klaviyoText(result.klaviyoBefore, result.beforeAbovePublished, result.klaviyoPlan),
    klaviyoAfter: klaviyoText(result.klaviyoAfter, result.afterAbovePublished, result.klaviyoPlan),
  };
}
