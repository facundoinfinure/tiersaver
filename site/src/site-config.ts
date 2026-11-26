/**
 * Product facts the site states that have no counterpart in @tiersaver/core.
 * Everything else (TierSaver's prices, the cleanup criteria, Klaviyo's plan
 * sizes) is read from core in src/data.ts, so the site cannot drift from the app.
 */

/** Klaviyo's waiting period before an unsuppressed profile can be manually suppressed again (Klaviyo help center). */
export const KLAVIYO_RESUPPRESS_WAIT_DAYS = 90;

/*
 * Facts about the app that live in shopify/app, not in core. The site cannot
 * import from there, so they are repeated here; test/site.test.ts reads the
 * app's source files and fails when one of them no longer matches.
 */

/** shopify/app/runs/labels.ts, CHARGE_HOLD_HOURS: hours between the end of a cleanup and its charge. */
export const CHARGE_HOLD_HOURS = 72;
/** shopify/app/billing/billing.ts, settleRunCharge: days of the window in which charges are added up against the maximum. */
export const CHARGE_WINDOW_DAYS = 30;
/** shopify/app/simulations/review.ts, CSV_PART_SIZE: rows per file of the candidate download. */
export const CSV_PART_SIZE = 1500;
/** shopify/app/settings/settings.ts, MAX_PROTECTED_GROUPS: lists and segments a merchant can protect. */
export const MAX_PROTECTED_GROUPS = 20;
/** shopify/app/settings/settings.ts, LEAD_DAYS_LIMITS.max: most days before the renewal a scheduled audit can run. */
export const MAX_LEAD_DAYS = 14;
/** shopify/app/routes/app.settings.tsx: lists (and segments) offered on the Settings page. */
export const GROUPS_LISTED_PER_KIND = 50;
/** shopify/app/klaviyo/config.ts, CANDIDATE_SEGMENT_NAME: the one segment the app keeps in the merchant's Klaviyo account. */
export const CANDIDATE_SEGMENT_NAME = "TierSaver: long-term inactive profiles (managed, do not edit)";
/** shopify/app/klaviyo/config.ts, KLAVIYO_SCOPES: what the Klaviyo consent screen asks for. */
export const KLAVIYO_SCOPES = [
  "accounts:read",
  "profiles:read",
  "profiles:write",
  "subscriptions:write",
  "subscriptions:read",
  "lists:read",
  "segments:read",
  "segments:write",
  "metrics:read",
  "usage:read",
] as const;
/** shopify/shopify.app.toml, [access_scopes]: what Shopify asks for on install. */
export const SHOPIFY_SCOPES = ["read_orders"] as const;
