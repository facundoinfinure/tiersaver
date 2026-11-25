/**
 * Product facts the site states that have no counterpart in @tiersaver/core.
 * Everything else (TierSaver's prices, the cleanup criteria, Klaviyo's plan
 * sizes) is read from core in src/data.ts, so the site cannot drift from the app.
 */

/** Klaviyo's waiting period before an unsuppressed profile can be manually suppressed again (Klaviyo help center). */
export const KLAVIYO_RESUPPRESS_WAIT_DAYS = 90;
