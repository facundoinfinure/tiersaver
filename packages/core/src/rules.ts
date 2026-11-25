/**
 * Inactivity and protection rules.
 *
 * Product rule: when in doubt, a profile stays active. Every path that lacks
 * data ends in "protected", never in "candidate".
 */

export interface RuleSettings {
  /** Protect anyone who purchased in the last N days. */
  purchaseDays: number;
  /** Protect anyone who clicked an email in the last N days. */
  clickDays: number;
  /** Protect anyone who opened an email in the last N days (weak signal: Apple MPP). */
  openDays: number;
  /** Protect profiles created / subscribed less than N days ago. */
  newProfileDays: number;
  /** Protect anyone who started a checkout or was active on site in the last N days. */
  siteActivityDays: number;
  /** A profile unsuppressed in the last N days must not be suppressed again. */
  reactivationLockDays: number;
  /**
   * When true, opens flagged as machine/privacy opens (Apple MPP) still protect.
   * Default true (conservative). Only an explicit merchant choice turns it off.
   */
  countMachineOpens: boolean;
}

export const DEFAULT_RULE_SETTINGS: RuleSettings = Object.freeze({
  purchaseDays: 365,
  clickDays: 180,
  openDays: 90,
  newProfileDays: 90,
  siteActivityDays: 180,
  reactivationLockDays: 90,
  countMachineOpens: true,
});

/** Bounds the merchant can set. Lower bounds keep the defaults from being made reckless. */
export const RULE_LIMITS: Record<keyof Omit<RuleSettings, "countMachineOpens">, { min: number; max: number }> = {
  purchaseDays: { min: 90, max: 1095 },
  clickDays: { min: 60, max: 1095 },
  openDays: { min: 30, max: 1095 },
  newProfileDays: { min: 30, max: 365 },
  siteActivityDays: { min: 30, max: 1095 },
  reactivationLockDays: { min: 90, max: 365 },
};

export function validateRuleSettings(input: Partial<RuleSettings>): { settings: RuleSettings; errors: string[] } {
  const settings: RuleSettings = { ...DEFAULT_RULE_SETTINGS };
  const errors: string[] = [];
  for (const key of Object.keys(RULE_LIMITS) as (keyof typeof RULE_LIMITS)[]) {
    const value = input[key];
    if (value === undefined) continue;
    const { min, max } = RULE_LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be a whole number between ${min} and ${max}`);
      continue;
    }
    settings[key] = value;
  }
  if (input.countMachineOpens !== undefined) settings.countMachineOpens = Boolean(input.countMachineOpens);
  return { settings, errors };
}

/** What we know about a profile. All timestamps are the most recent occurrence. */
export interface ProfileSignals {
  /** Klaviyo profile id. */
  id: string;
  hasEmail: boolean;
  /** Already suppressed for email (not billable). */
  emailSuppressed: boolean;
  /** Profile creation or subscription date, whichever is later. */
  createdAt: Date | null;
  lastOpenAt: Date | null;
  /** True if the most recent open is flagged as a machine/privacy open. */
  lastOpenIsMachine?: boolean;
  /** Most recent open that is NOT a machine open, if known. */
  lastHumanOpenAt?: Date | null;
  lastClickAt: Date | null;
  /** Most recent purchase, from Shopify orders and/or Klaviyo "Placed Order". */
  lastPurchaseAt: Date | null;
  /** Most recent "Started Checkout" / "Active on Site". */
  lastSiteActivityAt?: Date | null;
  smsConsent: boolean;
  /** Member of a list/segment the merchant marked as protected. */
  inProtectedGroup: boolean;
  /** Last time this profile was unsuppressed (by anyone). */
  reactivatedAt: Date | null;
}

/**
 * How far back our data reaches. If we cannot see a full window, the
 * corresponding rule protects everyone without a known event.
 */
export interface DataCoverage {
  /** Earliest date for which email engagement events are complete. null = unknown. */
  engagementSince: Date | null;
  /** Earliest date for which purchase data is complete. null = unknown. */
  purchasesSince: Date | null;
  /** Earliest date for which site activity data is complete. null = not tracked (rule then relies on others). */
  siteActivitySince?: Date | null;
}

export type ProtectionReason =
  | "recent_purchase"
  | "recent_click"
  | "recent_open"
  | "recent_site_activity"
  | "new_profile"
  | "sms_consent"
  | "protected_group"
  | "recently_reactivated"
  | "unknown_profile_age"
  | "insufficient_engagement_history"
  | "insufficient_purchase_history";

export type SkipReason = "already_suppressed" | "no_email";

export type CandidateReason = "never_engaged" | "lapsed";

export type Decision =
  | { kind: "candidate"; reason: CandidateReason }
  | { kind: "protected"; reasons: ProtectionReason[] }
  | { kind: "skipped"; reason: SkipReason };

const DAY_MS = 24 * 60 * 60 * 1000;

function within(date: Date | null | undefined, days: number, now: Date): boolean {
  if (!date) return false;
  return now.getTime() - date.getTime() < days * DAY_MS;
}

function covers(since: Date | null | undefined, days: number, now: Date): boolean {
  if (!since) return false;
  return now.getTime() - since.getTime() >= days * DAY_MS;
}

export function evaluateProfile(
  profile: ProfileSignals,
  settings: RuleSettings,
  coverage: DataCoverage,
  now: Date,
): Decision {
  if (profile.emailSuppressed) return { kind: "skipped", reason: "already_suppressed" };
  if (!profile.hasEmail) return { kind: "skipped", reason: "no_email" };

  const reasons: ProtectionReason[] = [];

  if (profile.inProtectedGroup) reasons.push("protected_group");
  if (profile.smsConsent) reasons.push("sms_consent");
  if (within(profile.reactivatedAt, settings.reactivationLockDays, now)) reasons.push("recently_reactivated");

  if (!profile.createdAt) reasons.push("unknown_profile_age");
  else if (within(profile.createdAt, settings.newProfileDays, now)) reasons.push("new_profile");

  if (within(profile.lastPurchaseAt, settings.purchaseDays, now)) reasons.push("recent_purchase");
  else if (!covers(coverage.purchasesSince, settings.purchaseDays, now)) reasons.push("insufficient_purchase_history");

  if (within(profile.lastClickAt, settings.clickDays, now)) reasons.push("recent_click");

  const openDate = settings.countMachineOpens
    ? profile.lastOpenAt
    : profile.lastOpenIsMachine
      ? (profile.lastHumanOpenAt ?? null)
      : profile.lastOpenAt;
  if (within(openDate, settings.openDays, now)) reasons.push("recent_open");

  const engagementWindow = Math.max(settings.clickDays, settings.openDays);
  if (
    !reasons.includes("recent_click") &&
    !reasons.includes("recent_open") &&
    !covers(coverage.engagementSince, engagementWindow, now)
  ) {
    reasons.push("insufficient_engagement_history");
  }

  if (within(profile.lastSiteActivityAt, settings.siteActivityDays, now)) reasons.push("recent_site_activity");

  if (reasons.length > 0) return { kind: "protected", reasons };

  const everEngaged = Boolean(
    profile.lastOpenAt || profile.lastClickAt || profile.lastPurchaseAt || profile.lastSiteActivityAt,
  );
  return { kind: "candidate", reason: everEngaged ? "lapsed" : "never_engaged" };
}
