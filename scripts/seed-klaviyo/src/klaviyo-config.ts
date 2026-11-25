/**
 * Single place for everything that depends on the Klaviyo API contract.
 *
 * Every value below was checked against the official OpenAPI spec
 * (github.com/klaviyo/openapi, openapi/stable.json, info.version 2026-10-15)
 * and developers.klaviyo.com on 2026-11-25. See README.md for sources.
 */

export const KLAVIYO_BASE_URL = "https://a.klaviyo.com";

/** Sent as the `revision` header on every request. */
export const KLAVIYO_REVISION = "2026-10-15";

/** Request and response media type (JSON:API). */
export const KLAVIYO_MEDIA_TYPE = "application/vnd.api+json";

/** The only place the private key may come from. */
export const API_KEY_ENV = "KLAVIYO_TEST_PRIVATE_KEY";

/** Fixed-window limits published per endpoint: burst per second, steady per minute. */
export interface RateLimit {
  burstPerSecond: number;
  steadyPerMinute: number;
}

export const ENDPOINTS = {
  /** GET /api/accounts — XS tier. */
  accounts: { path: "/api/accounts", rate: { burstPerSecond: 1, steadyPerMinute: 15 } },
  /** POST /api/profile-bulk-import-jobs and GET .../{job_id} — M tier. */
  profileImport: { path: "/api/profile-bulk-import-jobs", rate: { burstPerSecond: 10, steadyPerMinute: 150 } },
  /** POST /api/event-bulk-create-jobs — M tier. Responds 202 with no body (nothing to poll). */
  eventBulkCreate: { path: "/api/event-bulk-create-jobs", rate: { burstPerSecond: 10, steadyPerMinute: 150 } },
  /** POST /api/profile-subscription-bulk-create-jobs — L tier. Responds 202 with no body. */
  subscribe: { path: "/api/profile-subscription-bulk-create-jobs", rate: { burstPerSecond: 75, steadyPerMinute: 750 } },
  /** POST /api/profile-suppression-bulk-create-jobs and GET .../{job_id} — L tier. */
  suppress: { path: "/api/profile-suppression-bulk-create-jobs", rate: { burstPerSecond: 75, steadyPerMinute: 750 } },
  /** POST /api/profile-suppression-bulk-delete-jobs and GET .../{job_id} — L tier. */
  unsuppress: { path: "/api/profile-suppression-bulk-delete-jobs", rate: { burstPerSecond: 75, steadyPerMinute: 750 } },
  /** GET /api/profiles — L tier, lower with `additional-fields`; we pace it as M on purpose. */
  profiles: { path: "/api/profiles", rate: { burstPerSecond: 10, steadyPerMinute: 150 } },
  /** GET /api/events — XL tier; we pace it as M on purpose. */
  events: { path: "/api/events", rate: { burstPerSecond: 10, steadyPerMinute: 150 } },
} as const satisfies Record<string, { path: string; rate: RateLimit }>;

export type EndpointName = keyof typeof ENDPOINTS;

export const LIMITS = {
  /** Bulk Import Profiles: "Accepts up to 10,000 profiles per request." */
  profilesPerImportJob: 10_000,
  /** Bulk Create Events: "Accepts up to 1,000 events per request." */
  eventsPerBulkRequest: 1_000,
  /** Bulk Subscribe Profiles: "Maximum number of profiles can be submitted for subscription: 1000". */
  profilesPerSubscribeRequest: 1_000,
  /** Bulk Suppress / Unsuppress Profiles: "Email address per request limit: 100". */
  emailsPerSuppressionRequest: 100,
  /** Global payload limit for the new APIs: 5 MB decompressed. */
  maxPayloadBytes: 5 * 1024 * 1024,
  /** We stop filling a request at this size to leave headroom under the 5 MB limit. */
  payloadBudgetBytes: 4_500_000,
  /** Profiles: "valid email address (must be <= 100 characters)". */
  maxEmailLength: 100,
  /** Event `unique_id` ($event_id): 1-255 characters. */
  maxUniqueIdLength: 255,
} as const;

/**
 * Metric names used for seeded events. They match the names of Klaviyo's
 * built-in metrics on purpose, but events created through the API always land
 * in a metric owned by the "API" integration, which is a DIFFERENT metric (own
 * id) from the built-in one owned by the "Klaviyo" or "Shopify" integration.
 * See README.md, "Métricas".
 */
export const METRICS = {
  open: "Opened Email",
  click: "Clicked Email",
  purchase: "Placed Order",
  activeOnSite: "Active on Site",
  startedCheckout: "Started Checkout",
} as const;

export type MetricKey = keyof typeof METRICS;

/** Integration that owns every metric created through the Events API. */
export const SEEDED_METRIC_INTEGRATION = "API";

/** Event property Klaviyo sets on its own "Opened Email" events for machine/privacy opens. */
export const MACHINE_OPEN_PROPERTY = "Machine Open";

/** Custom profile properties written by the seed so tests can find and assert each profile. */
export const SEED_PROPERTIES = {
  run: "ts_seed_run",
  cohort: "ts_seed_cohort",
  index: "ts_seed_index",
  /** The `--now` the dataset is relative to. Evaluate rules as of this instant. */
  now: "ts_seed_now",
  /** Intended profile age. Klaviyo's own `created` is always the import time. */
  createdAt: "ts_seed_created_at",
  /** Expected decision under DEFAULT_RULE_SETTINGS, e.g. "protected:recent_click". */
  expected: "ts_seed_expected",
} as const;

/**
 * Domains Klaviyo documents as silently dropped by the event pipeline
 * ("@example.com, @test.com, or similar"), plus the other RFC 2606 / RFC 6761
 * reserved names that we assume fall under "or similar".
 */
export const RESERVED_EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "test.com"] as const;
export const RESERVED_EMAIL_TLDS = ["test", "example", "invalid", "localhost"] as const;

export function isReservedEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (RESERVED_EMAIL_DOMAINS.some((r) => d === r || d.endsWith(`.${r}`))) return true;
  const tld = d.slice(d.lastIndexOf(".") + 1);
  return (RESERVED_EMAIL_TLDS as readonly string[]).includes(tld);
}
