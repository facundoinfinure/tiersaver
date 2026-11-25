/**
 * The one place for product facts the site states that do not come from
 * @tiersaver/core. Change them here; every page and the list health check
 * read from this file through src/data.ts.
 */

export interface TierSaverPlan {
  /** Largest number of active profiles this plan covers (inclusive). */
  maxProfiles: number;
  /** Flat monthly price in US cents. */
  monthlyCents: number;
}

/**
 * TierSaver's own flat monthly prices, by list size (active profiles).
 *
 * PROVISIONAL: the boundaries and prices are pending the owner's confirmation.
 * Lists larger than the last plan are "contact us". A month in which no
 * cleanup runs is not charged; the audit is free.
 */
export const TIERSAVER_PLANS: readonly TierSaverPlan[] = Object.freeze([
  { maxProfiles: 25_000, monthlyCents: 2_900 },
  { maxProfiles: 75_000, monthlyCents: 7_900 },
  { maxProfiles: 150_000, monthlyCents: 14_900 },
]);

/**
 * Default cleanup criteria and the floors of the opt-in wider mode.
 *
 * PROVISIONAL: packages/core/src/rules.ts is being changed to these values.
 * Once it is, read them from @tiersaver/core in src/data.ts and delete this
 * constant, so the site cannot drift from the app.
 */
export const CLEANUP_CRITERIA = Object.freeze({
  /** Default: the profile was created at least this many days ago. */
  minProfileAgeDays: 365,
  /** Default: the profile received at least this many emails… */
  minEmailsReceived: 5,
  /** …in roughly this many weeks. */
  emailsReceivedWeeks: 72,
  /** Wider mode: shortest window allowed for opens, clicks and site activity. */
  widerMinEngagementDays: 182,
  /** Wider mode: shortest window allowed for purchases. */
  widerMinPurchaseDays: 365,
  /** Wider mode: youngest profile age allowed. */
  widerMinProfileAgeDays: 180,
  /** Profiles restored by an undo are not eligible for cleanup again for this long. */
  undoLockDays: 365,
});

/** Klaviyo's waiting period before an unsuppressed profile can be manually suppressed again (Klaviyo help center). */
export const KLAVIYO_RESUPPRESS_WAIT_DAYS = 90;
