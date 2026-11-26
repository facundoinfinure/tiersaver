import { sql } from "drizzle-orm";
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Database schema (Cloudflare D1 / SQLite).
 *
 * Conventions:
 * - Timestamps are integer milliseconds since the epoch (UTC).
 * - Money is integer US cents.
 * - Every merchant-owned table references `shops.shop` with ON DELETE CASCADE,
 *   so deleting the shop row removes all of its data (shop/redact).
 * - No customer emails in clear: purchase matching and run-time email checks use the
 *   SHA-256 of the normalized email (`hashEmail` in @tiersaver/core). Profiles
 *   are identified by their Klaviyo profile id.
 *
 * The SQL migrations in `drizzle/` are the source of truth for the deployed
 * database; `test/schema.test.ts` checks that they match these definitions.
 */

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(unixepoch() * 1000)`;

/**
 * Shopify sessions. Column set required by
 * @shopify/shopify-app-session-storage-drizzle (SQLite adapter).
 * accessToken and refreshToken hold ciphertext (see app/session-storage.server.ts).
 */
export const sessionTable = sqliteTable("session", {
  id: text("id").primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: integer("isOnline", { mode: "boolean" }).notNull().default(false),
  scope: text("scope"),
  expires: text("expires"),
  accessToken: text("accessToken").notNull(),
  userId: blob("userId", { mode: "bigint" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: integer("accountOwner", { mode: "boolean" }),
  locale: text("locale"),
  collaborator: integer("collaborator", { mode: "boolean" }),
  emailVerified: integer("emailVerified", { mode: "boolean" }),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: text("refreshTokenExpires"),
});

export const SHOP_STATUSES = ["installed", "uninstalled"] as const;

/** One row per installed shop. The Shopify token lives in `session`, encrypted. */
export const shops = sqliteTable("shops", {
  /** myshopify.com domain. */
  shop: text("shop").primaryKey(),
  status: text("status", { enum: SHOP_STATUSES }).notNull().default("installed"),
  /** IANA time zone of the shop; scheduling uses the shop's calendar. */
  ianaTimezone: text("iana_timezone"),
  /** True once Shopify approved read_all_orders (orders older than 60 days). */
  readAllOrdersGranted: integer("read_all_orders_granted", { mode: "boolean" }).notNull().default(false),
  /**
   * Earliest date for which `purchase_hashes` is complete. null = no backfill
   * yet, so the purchase rule protects everyone (insufficient_purchase_history).
   */
  purchasesCoveredSince: timestamp("purchases_covered_since"),
  /**
   * Instant up to which `purchase_hashes` is complete: the last successful read
   * of the store's orders (app/orders/sync.ts). null or older than
   * PURCHASE_DATA_MAX_AGE_HOURS at scan time = the purchase rule protects everyone.
   */
  purchasesCoveredUntil: timestamp("purchases_covered_until"),
  /** Last time the hourly cron handed this shop to the orders sync (rotation). */
  purchasesSyncAttemptedAt: timestamp("purchases_sync_attempted_at"),
  installedAt: timestamp("installed_at").notNull().default(now),
  uninstalledAt: timestamp("uninstalled_at"),
  updatedAt: timestamp("updated_at").notNull().default(now),
});

export const KLAVIYO_CONNECTION_STATUSES = ["connected", "needs_reauth", "disconnected"] as const;

/** Klaviyo OAuth connection. Tokens are AES-GCM ciphertext; the key is a Worker secret. */
export const klaviyoConnections = sqliteTable("klaviyo_connections", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.shop, { onDelete: "cascade" }),
  klaviyoAccountId: text("klaviyo_account_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  /** Space-separated scopes granted by the merchant. */
  scopes: text("scopes").notNull(),
  apiRevision: text("api_revision").notNull(),
  status: text("status", { enum: KLAVIYO_CONNECTION_STATUSES }).notNull().default("connected"),
  /** Billing Usage API id of the "active email profiles" usage type for this account. */
  profilesUsageTypeId: text("profiles_usage_type_id"),
  connectedAt: timestamp("connected_at").notNull().default(now),
  lastRefreshedAt: timestamp("last_refreshed_at"),
  updatedAt: timestamp("updated_at").notNull().default(now),
});

export const OAUTH_ATTEMPT_STATUSES = ["pending", "connected", "failed"] as const;

/**
 * One row per Klaviyo authorization that reached the embedded "finish" step,
 * keyed by the SHA-256 of its `state`. Makes the single-use code exchange
 * idempotent across the repeated loads of that step. No code, token or state is stored.
 */
export const klaviyoOauthAttempts = sqliteTable("klaviyo_oauth_attempts", {
  stateHash: text("state_hash").primaryKey(),
  shop: text("shop")
    .notNull()
    .references(() => shops.shop, { onDelete: "cascade" }),
  status: text("status", { enum: OAUTH_ATTEMPT_STATUSES }).notNull().default("pending"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at").notNull().default(now),
});

export const RUN_MODES = ["approval", "automatic"] as const;
export const BILLING_DAY_SOURCES = ["klaviyo_api", "merchant"] as const;
export const KLAVIYO_PLANS = ["email", "marketing"] as const;

/**
 * Per-shop settings. Rule defaults mirror DEFAULT_RULE_SETTINGS in
 * @tiersaver/core, which are Klaviyo's own published criteria;
 * `test/schema.test.ts` keeps them in sync. A NULL window means "at any time".
 */
export const settings = sqliteTable("settings", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.shop, { onDelete: "cascade" }),
  /** Bumped on every change to rules or protected groups; supersedes open simulations. */
  version: integer("version").notNull().default(1),
  /** Protect buyers of the last N days. NULL: anyone who ever purchased. */
  purchaseDays: integer("purchase_days"),
  clickDays: integer("click_days"),
  openDays: integer("open_days"),
  siteActivityDays: integer("site_activity_days"),
  newProfileDays: integer("new_profile_days").notNull().default(365),
  /** Minimum emails received in ~72 weeks before a profile can be called inactive. */
  minEmailsReceived: integer("min_emails_received").notNull().default(5),
  /** A restored (unsuppressed) profile is not a candidate again for this many days. */
  reactivationLockDays: integer("reactivation_lock_days").notNull().default(365),
  countMachineOpens: integer("count_machine_opens", { mode: "boolean" }).notNull().default(true),
  /** Klaviyo list / segment ids the merchant marked as protected (VIP). */
  protectedGroupIds: text("protected_group_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Day of month the Klaviyo plan renews (1–31), so a monthly cleanup finishes before Klaviyo counts profiles. */
  billingDay: integer("billing_day"),
  billingDaySource: text("billing_day_source", { enum: BILLING_DAY_SOURCES }),
  leadDays: integer("lead_days").notNull().default(5),
  /** Monthly schedule on/off. Off by default: the merchant turns it on after seeing a cleanup work. */
  scheduleEnabled: integer("schedule_enabled", { mode: "boolean" }).notNull().default(false),
  /** "approval" = every scheduled run waits for the merchant. "automatic" is an explicit opt-in. */
  mode: text("mode", { enum: RUN_MODES }).notNull().default("approval"),
  klaviyoPlan: text("klaviyo_plan", { enum: KLAVIYO_PLANS }),
  updatedAt: timestamp("updated_at").notNull().default(now),
});

/** Read-only audit snapshots. Savings are list-price estimates and labeled as such. */
export const audits = sqliteTable(
  "audits",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().default(now),
    activeProfiles: integer("active_profiles").notNull(),
    /** Where `activeProfiles` came from: "klaviyo_usage" (Billing Usage API) or "counted" (by TierSaver). */
    activeProfilesSource: text("active_profiles_source"),
    /** Candidates under the rules in effect when the audit ran. */
    inactiveProfiles: integer("inactive_profiles").notNull(),
    suppressedProfiles: integer("suppressed_profiles"),
    /** Billing Usage API values for the active-profiles usage type, when available. */
    usageUsed: integer("usage_used"),
    usageMax: integer("usage_max"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    tierCurrentMax: integer("tier_current_max"),
    tierPossibleMax: integer("tier_possible_max"),
    estimatedMonthlySavingsCents: integer("estimated_monthly_savings_cents").notNull().default(0),
    /** Why no savings could be estimated (free_plan, above_known_tiers, no_change, unknown_tier). */
    savingsUnavailableReason: text("savings_unavailable_reason"),
    priceTableId: text("price_table_id").notNull(),
    ruleSettings: text("rule_settings", { mode: "json" }).notNull(),
  },
  (t) => [index("audits_shop_created_idx").on(t.shop, t.createdAt)],
);

export const RUN_ORIGINS = ["manual", "scheduled"] as const;

/**
 * A simulation is the only thing a suppression run can be created from.
 * It is executable only while approved, not superseded, not executed and
 * younger than 24 h (`whyNotExecutable` in @tiersaver/core).
 */
export const simulations = sqliteTable(
  "simulations",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    origin: text("origin", { enum: RUN_ORIGINS }).notNull().default("manual"),
    createdAt: timestamp("created_at").notNull().default(now),
    settingsVersion: integer("settings_version").notNull(),
    ruleSettings: text("rule_settings", { mode: "json" }).notNull(),
    coverage: text("coverage", { mode: "json" }).notNull(),
    /** SimulationSummary from @tiersaver/core (counts by reason). */
    summary: text("summary", { mode: "json" }).notNull(),
    evaluatedCount: integer("evaluated_count").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    protectedCount: integer("protected_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    activeProfiles: integer("active_profiles").notNull(),
    activeProfilesSource: text("active_profiles_source"),
    tierBeforeMax: integer("tier_before_max"),
    tierAfterMax: integer("tier_after_max"),
    estimatedMonthlySavingsCents: integer("estimated_monthly_savings_cents").notNull().default(0),
    estimatedFeeCents: integer("estimated_fee_cents").notNull().default(0),
    priceTableId: text("price_table_id").notNull(),
    approvedAt: timestamp("approved_at"),
    /** Shopify user id of the approver, or "automatic" when the merchant opted in to automatic mode. */
    approvedBy: text("approved_by"),
    executedAt: timestamp("executed_at"),
    supersededAt: timestamp("superseded_at"),
  },
  (t) => [index("simulations_shop_created_idx").on(t.shop, t.createdAt)],
);

/** The exact profiles a simulation would suppress. Copied into `run_profiles` when a run starts. */
export const simulationCandidates = sqliteTable(
  "simulation_candidates",
  {
    simulationId: text("simulation_id")
      .notNull()
      .references(() => simulations.id, { onDelete: "cascade" }),
    /** Klaviyo profile id. */
    profileId: text("profile_id").notNull(),
    /** CandidateReason: never_engaged | lapsed. */
    reason: text("reason").notNull(),
    /** SHA-256 of the normalized email, to confirm at run time that the email is the one that was simulated. */
    emailHash: text("email_hash"),
  },
  (t) => [primaryKey({ columns: [t.simulationId, t.profileId] })],
);

export const SCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;

/**
 * One audit + simulation scan (app/scans/engine.ts), executed as a resumable
 * Workflow. When it completes it has produced one `audits` row and one
 * `simulations` row; until then neither exists.
 */
export const scans = sqliteTable(
  "scans",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    origin: text("origin", { enum: RUN_ORIGINS }).notNull().default("manual"),
    status: text("status", { enum: SCAN_STATUSES }).notNull().default("queued"),
    /** "user:<shopify user id>", or "schedule". */
    createdBy: text("created_by").notNull(),
    workflowInstanceId: text("workflow_instance_id"),
    /** Members of the candidate segment read so far. */
    memberCount: integer("member_count").notNull().default(0),
    simulationId: text("simulation_id"),
    auditId: text("audit_id"),
    /** Short machine-readable error; never contains personal data. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().default(now),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("scans_shop_created_idx").on(t.shop, t.createdAt)],
);

/**
 * Working data of a running scan: the members of the candidate segment as
 * facts without emails. Deleted when the scan finishes or fails.
 */
export const scanProfiles = sqliteTable(
  "scan_profiles",
  {
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    /** Klaviyo profile id. */
    profileId: text("profile_id").notNull(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    /** 0-based page of the segment read this profile came in. */
    page: integer("page").notNull(),
    emailHash: text("email_hash"),
    /** The profile as read from Klaviyo (KlaviyoProfileRecord): dates, consent and suppression state. No email. */
    facts: text("facts", { mode: "json" }).notNull(),
    /** true = member of a protected group, false = not, NULL = could not be determined (protects). */
    inProtectedGroup: integer("in_protected_group", { mode: "boolean" }).default(false),
    decision: text("decision", { enum: ["candidate", "protected", "skipped"] }),
    /** CandidateReason, the protection reasons joined by "+", or the SkipReason. */
    reason: text("reason"),
  },
  (t) => [primaryKey({ columns: [t.scanId, t.profileId] }), index("scan_profiles_page_idx").on(t.scanId, t.page)],
);

export const RUN_KINDS = ["suppress", "undo"] as const;
export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
] as const;

/** One execution: a suppression (from an approved simulation) or the undo of a previous run. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    kind: text("kind", { enum: RUN_KINDS }).notNull().default("suppress"),
    /** Required for kind = suppress. Unique: a simulation can be executed once. */
    simulationId: text("simulation_id").references(() => simulations.id, { onDelete: "cascade" }),
    /** Required for kind = undo: the run whose profiles are unsuppressed. */
    undoOfRunId: text("undo_of_run_id"),
    origin: text("origin", { enum: RUN_ORIGINS }).notNull().default("manual"),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
    /** Shopify user id, or "schedule". */
    createdBy: text("created_by").notNull(),
    workflowInstanceId: text("workflow_instance_id"),
    totalCount: integer("total_count").notNull().default(0),
    batchCount: integer("batch_count").notNull().default(0),
    processedCount: integer("processed_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    /** Profiles whose request went out but whose outcome is unknown (may be suppressed; undo includes them). */
    unknownCount: integer("unknown_count").notNull().default(0),
    /** Plan profile limit (Billing Usage `usage_max`) read right before the run, to verify the tier drop later. */
    usageMaxBefore: integer("usage_max_before"),
    /** Short machine-readable error; never contains personal data. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().default(now),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    /** Heartbeat: written when the run starts and at every batch attempt. Stalled runs are found by it (runs/recovery.ts). */
    lastProgressAt: timestamp("last_progress_at"),
    /** Set by "Stop cleanup": the run stops before its next batch and ends as `cancelled`. */
    stopRequestedAt: timestamp("stop_requested_at"),
    stopRequestedBy: text("stop_requested_by"),
  },
  (t) => [
    uniqueIndex("runs_simulation_unique").on(t.simulationId),
    index("runs_shop_created_idx").on(t.shop, t.createdAt),
    index("runs_open_idx").on(t.status, t.lastProgressAt),
  ],
);

export const RUN_PROFILE_STATUSES = [
  /** Not sent to Klaviyo yet. */
  "pending",
  /** Claimed by a batch step; the Klaviyo request may or may not have gone out. */
  "submitting",
  /** Accepted by Klaviyo in a bulk job. */
  "submitted",
  /** Left untouched (for example no longer exists, or became protected). `error_code` says why. */
  "skipped",
  /**
   * Not confirmed by Klaviyo. With `attempted_at` NULL the profile was never sent and is untouched. With
   * `attempted_at` set the request went out and the outcome is unknown: it counts as possibly suppressed.
   */
  "failed",
] as const;

/**
 * Exactly which profiles a run touched and why. This is what makes a run
 * resumable (per-batch status) and reversible (undo reads this set).
 */
export const runProfiles = sqliteTable(
  "run_profiles",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Klaviyo profile id. */
    profileId: text("profile_id").notNull(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    /** 0-based batch this profile belongs to; fixed when the run is created. */
    batchIndex: integer("batch_index").notNull(),
    /** Rule that selected the profile (CandidateReason). */
    reason: text("reason").notNull(),
    emailHash: text("email_hash"),
    status: text("status", { enum: RUN_PROFILE_STATUSES }).notNull().default("pending"),
    /** Klaviyo bulk job that carried this profile. */
    klaviyoJobId: text("klaviyo_job_id"),
    errorCode: text("error_code"),
    /** Stamped right before the Klaviyo request carrying this profile is sent. NULL = never sent. */
    attemptedAt: timestamp("attempted_at"),
    /** Set when the profile was unsuppressed again by undoing the run. */
    reactivatedAt: timestamp("reactivated_at"),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.profileId] }),
    index("run_profiles_batch_idx").on(t.runId, t.batchIndex),
    index("run_profiles_shop_hash_idx").on(t.shop, t.emailHash),
  ],
);

/** Hashed buyers from Shopify orders. No emails, names or order contents. */
export const purchaseHashes = sqliteTable(
  "purchase_hashes",
  {
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    /** SHA-256 (hex) of the normalized order email. */
    emailHash: text("email_hash").notNull(),
    lastOrderAt: timestamp("last_order_at").notNull(),
    /** SHA-256 of the Shopify customer id, so customers/redact can remove the row. */
    customerIdHash: text("customer_id_hash"),
    updatedAt: timestamp("updated_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.shop, t.emailHash] }),
    index("purchase_hashes_customer_idx").on(t.shop, t.customerIdHash),
  ],
);

export const ORDERS_SYNC_KINDS = ["backfill", "incremental"] as const;

/**
 * The orders read in progress for a shop, if any (app/orders/sync.ts). The
 * cursor is saved after every page so the read is resumed across Workflow
 * instances and cron ticks. The row is deleted when the read completes. No
 * order or customer data.
 */
export const ordersSync = sqliteTable("orders_sync", {
  shop: text("shop")
    .primaryKey()
    .references(() => shops.shop, { onDelete: "cascade" }),
  /** Identifies this read; a runner only advances or completes the read it loaded. */
  passId: text("pass_id").notNull(),
  kind: text("kind", { enum: ORDERS_SYNC_KINDS }).notNull(),
  /** Lower bound of the orders query: processed_at for a backfill, updated_at for an incremental read. */
  queryFrom: timestamp("query_from").notNull(),
  /** Backfill only: the start of coverage this read proves once it completes. */
  coversSince: timestamp("covers_since"),
  /** Whether the read was planned with read_all_orders (a backfill planned with it is void without it). */
  readAllOrders: integer("read_all_orders", { mode: "boolean" }).notNull().default(false),
  /** When the read began. Once complete, purchase data is current up to shortly before this instant. */
  startedAt: timestamp("started_at").notNull(),
  /** Cursor of the last page stored; null before the first page. */
  cursor: text("cursor"),
  pages: integer("pages").notNull().default(0),
  /** Failed page reads since the last page that was stored. */
  failures: integer("failures").notNull().default(0),
  /** Last progress (a stored page), not the last attempt. */
  updatedAt: timestamp("updated_at").notNull(),
});

export const USAGE_CHARGE_STATUSES =["pending", "charged", "not_charged", "failed"] as const;

/**
 * TierSaver's fee for one cleanup: a flat price by list size, created only
 * when the run suppressed profiles. It never depends on the merchant's
 * Klaviyo invoice. One per run; the one-per-cycle rule (28 days) is enforced
 * by `quoteCharge` in @tiersaver/core.
 */
export const usageCharges = sqliteTable(
  "usage_charges",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** List size the price is based on (active profiles in the approved simulation). */
    activeProfiles: integer("active_profiles").notNull(),
    /** Upper bound of the price tier applied; NULL above the public tiers. */
    priceTierMax: integer("price_tier_max"),
    profilesSuppressed: integer("profiles_suppressed").notNull(),
    feeCents: integer("fee_cents").notNull(),
    capApplied: integer("cap_applied", { mode: "boolean" }).notNull().default(false),
    /** NoChargeReason from @tiersaver/core when nothing was charged. */
    noChargeReason: text("no_charge_reason"),
    status: text("status", { enum: USAGE_CHARGE_STATUSES }).notNull().default("pending"),
    /** `chargeIdempotencyKey(shop, runId)`; also sent to Shopify. */
    idempotencyKey: text("idempotency_key").notNull(),
    shopifyUsageRecordId: text("shopify_usage_record_id"),
    createdAt: timestamp("created_at").notNull().default(now),
    chargedAt: timestamp("charged_at"),
    /** Times the charge was sent to Shopify without success, and when the last try was (cron rotation). */
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    /** When Klaviyo's jobs confirmed `profilesSuppressed`; from then on the charge needs no further read of Klaviyo. */
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [
    uniqueIndex("usage_charges_idempotency_unique").on(t.idempotencyKey),
    uniqueIndex("usage_charges_run_unique").on(t.runId),
    index("usage_charges_shop_created_idx").on(t.shop, t.createdAt),
  ],
);

/** Audit trail: who did what, when. `detail` never contains personal data. */
export const eventsLog = sqliteTable(
  "events_log",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    at: timestamp("at").notNull().default(now),
    /** "user:<shopify user id>", "schedule", "webhook" or "system". */
    actor: text("actor").notNull(),
    /** For example simulation.approved, run.started, run.completed, settings.updated. */
    action: text("action").notNull(),
    runId: text("run_id"),
    simulationId: text("simulation_id"),
    detail: text("detail", { mode: "json" }),
  },
  (t) => [index("events_log_shop_at_idx").on(t.shop, t.at)],
);

/**
 * customers/data_request webhooks. The merchant downloads what the app holds
 * about that customer from Settings and passes it on. No email in clear.
 */
export const privacyRequests = sqliteTable(
  "privacy_requests",
  {
    id: text("id").primaryKey(),
    shop: text("shop")
      .notNull()
      .references(() => shops.shop, { onDelete: "cascade" }),
    shopifyRequestId: text("shopify_request_id"),
    shopifyCustomerId: text("shopify_customer_id"),
    emailHash: text("email_hash"),
    receivedAt: timestamp("received_at").notNull().default(now),
    downloadedAt: timestamp("downloaded_at"),
  },
  (t) => [index("privacy_requests_shop_idx").on(t.shop, t.receivedAt)],
);
