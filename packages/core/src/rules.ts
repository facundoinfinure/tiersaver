/**
 * Inactivity and protection rules.
 *
 * Product rule: when in doubt, a profile stays active. Every path that lacks
 * data ends in "protected", never in "candidate".
 */

/** A time window in days, or null for "at any time in the profile's history". */
export type Window = number | null;

export interface RuleSettings {
  /** Protect anyone who purchased in the last N days. null: anyone who ever purchased. */
  purchaseDays: Window;
  /** Protect anyone who clicked an email in the last N days. null: anyone who ever clicked. */
  clickDays: Window;
  /** Protect anyone who opened an email in the last N days. null: anyone who ever opened. */
  openDays: Window;
  /** Protect anyone active on site or in checkout in the last N days. null: ever. */
  siteActivityDays: Window;
  /** Protect profiles created / subscribed less than N days ago. */
  newProfileDays: number;
  /**
   * Protect profiles that received fewer than N emails in the last
   * EMAILS_RECEIVED_WINDOW_DAYS days: nobody is inactive if they were never written to.
   */
  minEmailsReceived: number;
  /** A profile that was unsuppressed (undo, or by anyone) is not a candidate again for N days. */
  reactivationLockDays: number;
  /**
   * When true, opens flagged as machine/privacy opens (Apple MPP) still protect.
   * Default true (conservative). Only an explicit merchant choice turns it off.
   */
  countMachineOpens: boolean;
}

/** Klaviyo's suppression recommendations look at "roughly the last 72 weeks" of sends. */
export const EMAILS_RECEIVED_WINDOW_DAYS = 504;

/**
 * Defaults = Klaviyo's own published criteria for suppression recommendations
 * (help.klaviyo.com/hc/en-us/articles/24312135764251, read 2026-11-25 and again
 * 2026-11-26): created at least 365 days ago, received 5 or more emails in
 * ~72 weeks, and never opened, clicked, visited, started a checkout or
 * purchased. A different Klaviyo article (…/24263920096027) describes a manual
 * inactivity segment with a 180-day age; we follow the 365 of the
 * recommendations, which is also the more conservative of the two.
 */
export const DEFAULT_RULE_SETTINGS: RuleSettings = Object.freeze({
  purchaseDays: null,
  clickDays: null,
  openDays: null,
  siteActivityDays: null,
  newProfileDays: 365,
  minEmailsReceived: 5,
  reactivationLockDays: 365,
  countMachineOpens: true,
});

/**
 * Bounds for the opt-in wider mode. The lower bounds are a floor that cannot
 * be configured away: 182 days is the floor Klaviyo's own bulk suppression
 * dialog uses for clicks and orders; buyers are never suppressed inside a year.
 */
export const RULE_LIMITS: Record<keyof Omit<RuleSettings, "countMachineOpens">, { min: number; max: number }> = {
  purchaseDays: { min: 365, max: 1095 },
  clickDays: { min: 182, max: 1095 },
  openDays: { min: 182, max: 1095 },
  siteActivityDays: { min: 182, max: 1095 },
  newProfileDays: { min: 180, max: 1095 },
  minEmailsReceived: { min: 5, max: 50 },
  reactivationLockDays: { min: 365, max: 1095 },
};

const WINDOW_KEYS = ["purchaseDays", "clickDays", "openDays", "siteActivityDays"] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];
type NumberKey = Exclude<keyof typeof RULE_LIMITS, WindowKey>;

export function validateRuleSettings(input: Partial<RuleSettings>): { settings: RuleSettings; errors: string[] } {
  const settings: RuleSettings = { ...DEFAULT_RULE_SETTINGS };
  const errors: string[] = [];
  for (const key of Object.keys(RULE_LIMITS) as (keyof typeof RULE_LIMITS)[]) {
    const value = input[key];
    if (value === undefined) continue;
    const isWindow = (WINDOW_KEYS as readonly string[]).includes(key);
    if (value === null && isWindow) {
      settings[key as WindowKey] = null;
      continue;
    }
    const { min, max } = RULE_LIMITS[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be a whole number between ${min} and ${max}${isWindow ? ", or empty for any time" : ""}`);
      continue;
    }
    if (isWindow) settings[key as WindowKey] = value;
    else settings[key as NumberKey] = value;
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
  /** Most recent "Started Checkout" / "Active on Site" / product view. */
  lastSiteActivityAt?: Date | null;
  /**
   * Marketing emails received in the last EMAILS_RECEIVED_WINDOW_DAYS days.
   * null or undefined = unknown, which protects.
   */
  emailsReceived?: number | null;
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
  /**
   * Instant up to which purchase data is complete: the last successful read of
   * the store's orders. Purchase history is only "sufficient" when this is no
   * older than PURCHASE_DATA_MAX_AGE_HOURS at evaluation time. null or
   * undefined = unknown, which protects: order data that stopped being
   * refreshed must never turn a later buyer into a candidate.
   */
  purchasesUntil?: Date | null;
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
  | "not_enough_emails_received"
  | "unknown_send_history"
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

/**
 * How old the purchase data may be when a profile is evaluated. Orders are
 * re-read hourly and again inside every scan, so healthy data is minutes old;
 * six hours tolerates a few failed reads and nothing more. Beyond it the
 * purchase rule protects everyone (insufficient_purchase_history).
 */
export const PURCHASE_DATA_MAX_AGE_HOURS = 6;

/** True when purchase data was refreshed recently enough to trust the absence of an order. */
export function purchaseDataIsFresh(until: Date | null | undefined, now: Date): boolean {
  if (!until || Number.isNaN(until.getTime())) return false;
  return now.getTime() - until.getTime() <= PURCHASE_DATA_MAX_AGE_HOURS * 60 * 60 * 1000;
}

/** True when `date` falls inside the window; a null window means any time at all. */
function within(date: Date | null | undefined, days: Window, now: Date): boolean {
  if (!date) return false;
  if (days === null) return true;
  return now.getTime() - date.getTime() < days * DAY_MS;
}

/**
 * True when our data is complete for the whole window. For a null window
 * ("ever") the data must reach back to before the profile existed.
 */
function covers(since: Date | null | undefined, days: Window, createdAt: Date | null, now: Date): boolean {
  if (!since) return false;
  if (days === null) return createdAt !== null && since.getTime() <= createdAt.getTime();
  return now.getTime() - since.getTime() >= days * DAY_MS;
}

/** The wider of two windows; null ("ever") is wider than any number. */
function widest(a: Window, b: Window): Window {
  return a === null || b === null ? null : Math.max(a, b);
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
  else if (
    !purchaseDataIsFresh(coverage.purchasesUntil, now) ||
    !covers(coverage.purchasesSince, settings.purchaseDays, profile.createdAt, now)
  ) {
    reasons.push("insufficient_purchase_history");
  }

  if (within(profile.lastClickAt, settings.clickDays, now)) reasons.push("recent_click");

  // Ignoring machine opens needs to know the last human open. If that is
  // unknown (undefined, as opposed to a known "none" = null), the open still protects.
  const openDate =
    settings.countMachineOpens || !profile.lastOpenIsMachine || profile.lastHumanOpenAt === undefined
      ? profile.lastOpenAt
      : profile.lastHumanOpenAt;
  if (within(openDate, settings.openDays, now)) reasons.push("recent_open");

  const engagementWindow = widest(settings.clickDays, settings.openDays);
  if (
    !reasons.includes("recent_click") &&
    !reasons.includes("recent_open") &&
    !covers(coverage.engagementSince, engagementWindow, profile.createdAt, now)
  ) {
    reasons.push("insufficient_engagement_history");
  }

  if (profile.emailsReceived == null || !Number.isFinite(profile.emailsReceived)) reasons.push("unknown_send_history");
  else if (profile.emailsReceived < settings.minEmailsReceived) reasons.push("not_enough_emails_received");

  if (within(profile.lastSiteActivityAt, settings.siteActivityDays, now)) reasons.push("recent_site_activity");

  if (reasons.length > 0) return { kind: "protected", reasons };

  const everEngaged = Boolean(
    profile.lastOpenAt || profile.lastClickAt || profile.lastPurchaseAt || profile.lastSiteActivityAt,
  );
  return { kind: "candidate", reason: everEngaged ? "lapsed" : "never_engaged" };
}
