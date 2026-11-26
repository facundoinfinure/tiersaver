/**
 * Single place for everything that depends on the Klaviyo API contract.
 *
 * Checked on 2026-11-25 against the official OpenAPI spec
 * (github.com/klaviyo/openapi, openapi/stable.json, info.version 2026-10-15)
 * and developers.klaviyo.com. Where the two disagree the stricter value is used.
 */

export const KLAVIYO_API_BASE_URL = "https://a.klaviyo.com";

/** Sent as the `revision` header on every API request. Change it here only. */
export const KLAVIYO_REVISION = "2026-10-15";

/** Request and response media type (JSON:API). */
export const KLAVIYO_MEDIA_TYPE = "application/vnd.api+json";

/**
 * OAuth endpoints (developers.klaviyo.com/en/docs/set_up_oauth).
 * Token traffic must go to a.klaviyo.com: www.klaviyo.com has rejected
 * /oauth/token and /oauth/revoke since 2025-03-31.
 */
export const KLAVIYO_OAUTH = {
  authorizeUrl: "https://www.klaviyo.com/oauth/authorize",
  tokenUrl: "https://a.klaviyo.com/oauth/token",
  revokeUrl: "https://a.klaviyo.com/oauth/revoke",
} as const;

/**
 * Path of the OAuth redirect route, relative to SHOPIFY_APP_URL. It must be
 * listed, as a full URL, in the app's redirect allowlist in Klaviyo. It is
 * deliberately outside `/auth/*`, which belongs to Shopify's own OAuth.
 */
export const KLAVIYO_OAUTH_CALLBACK_PATH = "/klaviyo/oauth/callback";

/**
 * Scopes the app cannot work without. Klaviyo rejects apps that ask for more
 * than they use, and so do we (product rule 5). Every name was checked against
 * `x-klaviyo-scopes` of the operations listed next to it.
 */
export const KLAVIYO_REQUIRED_SCOPES = [
  /** Mandatory for every OAuth app. GET /api/accounts: account id, test_account flag. */
  "accounts:read",
  /** GET /api/profiles (id -> email at suppression time), segment and list members. */
  "profiles:read",
  /** POST /api/profile-suppression-bulk-create-jobs requires profiles:write + subscriptions:write. */
  "profiles:write",
  /** Bulk suppress, and bulk unsuppress (undo), which needs only this scope. */
  "subscriptions:write",
  /** GET /api/profile-suppression-bulk-{create,delete}-jobs/{id}: job status. */
  "subscriptions:read",
  /** GET /api/lists, GET /api/lists/{id}/relationships/profiles: protected groups. */
  "lists:read",
  /** GET /api/segments and members: protected groups, and reading the candidate segment. */
  "segments:read",
  /**
   * POST / PATCH /api/segments: the one segment TierSaver keeps in the account,
   * holding Klaviyo's own "long-term inactive" criteria. It is the only source
   * that can answer "never opened, clicked, visited or bought" over the whole
   * history, and "received 5+ emails in 72 weeks", at a cost that does not grow
   * with the account's event volume (see signals.ts). No other segment is
   * created, changed or deleted.
   */
  "segments:write",
  /** GET /api/metrics: resolve "Opened Email" etc. to metric ids by name + integration. */
  "metrics:read",
] as const;

/*
 * Deliberately NOT requested: `events:read`. The candidate segment replaced
 * the Events API as the source of engagement, so the app has no use for it
 * today. `listEngagementEventsPage` in api.ts stays as a tested alternative
 * (it gives dated events, e.g. to explain why a profile is protected); using
 * it means adding `events:read` here first, and merchants reconnecting.
 */

/**
 * Scopes that only add information. `usage:read` (GET /api/billing-usage)
 * feeds the audit and the monthly report with Klaviyo's own active-profile
 * count. No run and no charge depends on it, a connection without it is
 * complete, and it can be removed from this list without touching anything else.
 */
export const KLAVIYO_OPTIONAL_SCOPES = ["usage:read"] as const;

/** Everything requested on the consent screen. */
export const KLAVIYO_SCOPES = [...KLAVIYO_REQUIRED_SCOPES, ...KLAVIYO_OPTIONAL_SCOPES] as const;

export type KlaviyoScope = (typeof KLAVIYO_SCOPES)[number];

/** Fixed-window limits published per endpoint: burst per second, steady per minute. */
export interface RateLimit {
  burstPerSecond: number;
  steadyPerMinute: number;
  /** Some write endpoints also have a per-day limit, per account. */
  perDay?: number;
}

/**
 * Rate limits per endpoint class, from `x-klaviyo-ratelimit` in the spec.
 * The spec says 750/m for the "L" endpoints while the rate limit guide says
 * L = 700/m; the lower number is used. OAuth apps get their own quota per
 * installed account, separate from the merchant's private keys.
 */
export const ENDPOINTS = {
  /** GET /api/accounts — XS. */
  accounts: { burstPerSecond: 1, steadyPerMinute: 15 },
  /** GET /api/billing-usage — M. */
  billingUsage: { burstPerSecond: 10, steadyPerMinute: 150 },
  /** GET /api/profiles — L (M if `predictive_analytics` is requested; we never do). */
  profiles: { burstPerSecond: 75, steadyPerMinute: 700 },
  /** GET /api/events — XL. */
  events: { burstPerSecond: 350, steadyPerMinute: 3500 },
  /** GET /api/metrics — M. */
  metrics: { burstPerSecond: 10, steadyPerMinute: 150 },
  /** GET /api/lists — L. */
  lists: { burstPerSecond: 75, steadyPerMinute: 700 },
  /** GET /api/segments and GET /api/segments/{id} — L. */
  segments: { burstPerSecond: 75, steadyPerMinute: 700 },
  /**
   * POST /api/segments and PATCH /api/segments/{id} — 1/s, 15/m and 100 per
   * day. The client paces the first two; the daily limit is respected by
   * design: one segment per account, written only when its definition has to
   * change (connecting, or the merchant changing rules), never per audit.
   */
  segmentWrites: { burstPerSecond: 1, steadyPerMinute: 15, perDay: 100 },
  /** GET /api/{lists,segments}/{id}/relationships/profiles — L. */
  groupMembers: { burstPerSecond: 75, steadyPerMinute: 700 },
  /** POST and GET /api/profile-suppression-bulk-{create,delete}-jobs — L. */
  suppressionJobs: { burstPerSecond: 75, steadyPerMinute: 700 },
} as const satisfies Record<string, RateLimit>;

export type EndpointName = keyof typeof ENDPOINTS;

export const LIMITS = {
  /** Bulk Suppress / Unsuppress Profiles: "Email address per request limit: 100". */
  emailsPerSuppressionRequest: 100,
  /** GET /api/profiles and list/segment members: page[size] max 100 (default 20). */
  profilesPageSize: 100,
  /** GET /api/events: page[size] max 1000 (default 200). */
  eventsPageSize: 1000,
  /** GET /api/lists and GET /api/segments: page[size] max 10. */
  groupsPageSize: 10,
  /**
   * Profile ids per `any(id,[...])` lookup on GET /api/profiles. 50 ids keep the URL under 2.5 kB; verified
   * against the real API on 2026-11-26 (50 ids are accepted).
   */
  profileIdsPerLookup: 50,
  /**
   * Profile ids per `any(id,[...])` lookup on GET /api/segments/{id}/profiles. The real API answers
   * "Maximum number of filter values is 20" above this (verified 2026-11-26), and the field is `id`:
   * `profile_id`, which the published spec lists, is rejected as not filterable.
   */
  segmentMemberIdsPerLookup: 20,
  /** One refresh token may be used at most 10 times per minute. */
  refreshesPerMinute: 10,
} as const;

/**
 * Billing Usage API (developers.klaviyo.com/en/reference/billing_usage_api_overview).
 * The resource id IS the usage type key. `active_profiles` (unit "profiles")
 * is the email plan's billable profile count; it refreshes about twice a day.
 */
export const BILLING_USAGE = {
  activeProfilesId: "active_profiles",
  profilesUnit: "profiles",
  /** Other usage types with unit "profiles" that are NOT the email plan's count. */
  otherProfileUsageIds: ["total_profiles", "dw_sync_active_profiles", "customer_hub_active_profiles", "aa_active_profiles"],
} as const;

export type EngagementSignal =
  | "received"
  | "open"
  | "click"
  | "purchase"
  | "checkout"
  | "activeOnSite"
  | "viewedProduct";

export interface MetricSpec {
  /** Accepted metric names (exact, case-sensitive). */
  names: readonly string[];
  /** Accepted `integration.name` values (exact, case-sensitive). */
  integrations: readonly string[];
}

/**
 * Which Klaviyo metric feeds each signal. A metric is identified by name AND
 * integration: events sent through the API land in a separate metric (own id,
 * integration "API") from the built-in one with the same name.
 *
 * Verified: integration names "Klaviyo", "API", "Shopify"
 * (developers.klaviyo.com/en/reference/metrics_api_overview) and the metric
 * names "Opened Email" / "Clicked Email". Not verified without an account: the
 * exact names and integrations of the order, checkout and site metrics, so
 * each accepts the known variants. An unresolved metric never makes anybody a
 * candidate (see `buildDataCoverage`).
 */
export const DEFAULT_METRIC_SPECS: Record<EngagementSignal, MetricSpec> = {
  received: { names: ["Received Email"], integrations: ["Klaviyo"] },
  open: { names: ["Opened Email"], integrations: ["Klaviyo"] },
  click: { names: ["Clicked Email"], integrations: ["Klaviyo"] },
  purchase: { names: ["Placed Order"], integrations: ["Shopify"] },
  checkout: { names: ["Checkout Started", "Started Checkout"], integrations: ["Shopify"] },
  activeOnSite: { names: ["Active on Site"], integrations: ["API", "Klaviyo"] },
  viewedProduct: { names: ["Viewed Product"], integrations: ["API", "Shopify", "Klaviyo"] },
};

/**
 * Metric specs for an account filled by scripts/seed-klaviyo: every seeded
 * event belongs to a metric owned by the "API" integration.
 */
export const SEEDED_METRIC_SPECS: Record<EngagementSignal, MetricSpec> = {
  received: { names: ["Received Email"], integrations: ["API"] },
  open: { names: ["Opened Email"], integrations: ["API"] },
  click: { names: ["Clicked Email"], integrations: ["API"] },
  purchase: { names: ["Placed Order"], integrations: ["API"] },
  checkout: { names: ["Started Checkout", "Checkout Started"], integrations: ["API"] },
  activeOnSite: { names: ["Active on Site"], integrations: ["API"] },
  viewedProduct: { names: ["Viewed Product"], integrations: ["API"] },
};

/**
 * Name of the segment TierSaver maintains in the merchant's account. It is
 * found again by this exact name, so nothing has to be stored on our side.
 */
export const CANDIDATE_SEGMENT_NAME = "TierSaver: long-term inactive profiles (managed, do not edit)";

/**
 * Event property that flags an "Opened Email" as a machine / privacy open.
 * Klaviyo's help centre calls it "Apple Privacy Open"; our earlier notes and
 * the seed script say "Machine Open". The key in the API payload has not been
 * read from a real event yet, so both are accepted.
 */
export const MACHINE_OPEN_PROPERTY_KEYS = ["Apple Privacy Open", "Machine Open"] as const;

/** Profile property the seed script writes with the intended profile age (test accounts only). */
export const SEED_CREATED_AT_PROPERTY = "ts_seed_created_at";
