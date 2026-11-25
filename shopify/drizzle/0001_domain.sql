-- Domain tables. Timestamps are integer milliseconds (UTC); money is integer US cents.
-- Every merchant-owned table cascades from shops, so deleting a shop removes all its data.

CREATE TABLE IF NOT EXISTS `shops` (
  `shop` text PRIMARY KEY NOT NULL,
  `status` text DEFAULT 'installed' NOT NULL CHECK (`status` IN ('installed', 'uninstalled')),
  `iana_timezone` text,
  `read_all_orders_granted` integer DEFAULT false NOT NULL,
  `purchases_covered_since` integer,
  `installed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `uninstalled_at` integer,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE TABLE IF NOT EXISTS `klaviyo_connections` (
  `shop` text PRIMARY KEY NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `klaviyo_account_id` text NOT NULL,
  `access_token_enc` text NOT NULL,
  `refresh_token_enc` text NOT NULL,
  `access_token_expires_at` integer NOT NULL,
  `scopes` text NOT NULL,
  `api_revision` text NOT NULL,
  `status` text DEFAULT 'connected' NOT NULL CHECK (`status` IN ('connected', 'needs_reauth', 'disconnected')),
  `profiles_usage_type_id` text,
  `connected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `last_refreshed_at` integer,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

-- Rule defaults mirror DEFAULT_RULE_SETTINGS in @tiersaver/core. The CHECKs are the
-- lower bounds of RULE_LIMITS: the database refuses reckless thresholds too.
CREATE TABLE IF NOT EXISTS `settings` (
  `shop` text PRIMARY KEY NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `version` integer DEFAULT 1 NOT NULL,
  `purchase_days` integer DEFAULT 365 NOT NULL CHECK (`purchase_days` >= 90),
  `click_days` integer DEFAULT 180 NOT NULL CHECK (`click_days` >= 60),
  `open_days` integer DEFAULT 90 NOT NULL CHECK (`open_days` >= 30),
  `new_profile_days` integer DEFAULT 90 NOT NULL CHECK (`new_profile_days` >= 30),
  `site_activity_days` integer DEFAULT 180 NOT NULL CHECK (`site_activity_days` >= 30),
  `reactivation_lock_days` integer DEFAULT 90 NOT NULL CHECK (`reactivation_lock_days` >= 90),
  `count_machine_opens` integer DEFAULT true NOT NULL,
  `protected_group_ids` text DEFAULT '[]' NOT NULL,
  `billing_day` integer CHECK (`billing_day` IS NULL OR `billing_day` BETWEEN 1 AND 31),
  `billing_day_source` text CHECK (`billing_day_source` IS NULL OR `billing_day_source` IN ('klaviyo_api', 'merchant')),
  `lead_days` integer DEFAULT 5 NOT NULL CHECK (`lead_days` >= 4),
  `mode` text DEFAULT 'approval' NOT NULL CHECK (`mode` IN ('approval', 'automatic')),
  `reactivation_enabled` integer DEFAULT false NOT NULL,
  `klaviyo_plan` text CHECK (`klaviyo_plan` IS NULL OR `klaviyo_plan` IN ('email', 'marketing')),
  `auto_downgrade_ack_at` integer,
  `reported_current_price_cents` integer,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

CREATE TABLE IF NOT EXISTS `audits` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `active_profiles` integer NOT NULL,
  `inactive_profiles` integer NOT NULL,
  `suppressed_profiles` integer,
  `usage_used` integer,
  `usage_max` integer,
  `period_start` integer,
  `period_end` integer,
  `tier_current_max` integer,
  `tier_possible_max` integer,
  `estimated_monthly_savings_cents` integer DEFAULT 0 NOT NULL,
  `savings_unavailable_reason` text,
  `price_table_id` text NOT NULL,
  `rule_settings` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `audits_shop_created_idx` ON `audits` (`shop`, `created_at`);

CREATE TABLE IF NOT EXISTS `simulations` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `origin` text DEFAULT 'manual' NOT NULL CHECK (`origin` IN ('manual', 'scheduled')),
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `settings_version` integer NOT NULL,
  `rule_settings` text NOT NULL,
  `coverage` text NOT NULL,
  `summary` text NOT NULL,
  `evaluated_count` integer NOT NULL,
  `candidate_count` integer NOT NULL,
  `protected_count` integer NOT NULL,
  `skipped_count` integer NOT NULL,
  `active_profiles` integer NOT NULL,
  `tier_before_max` integer,
  `tier_after_max` integer,
  `estimated_monthly_savings_cents` integer DEFAULT 0 NOT NULL,
  `estimated_fee_cents` integer DEFAULT 0 NOT NULL,
  `price_table_id` text NOT NULL,
  `approved_at` integer,
  `approved_by` text,
  `executed_at` integer,
  `superseded_at` integer,
  -- An approval always names who approved.
  CHECK ((`approved_at` IS NULL) = (`approved_by` IS NULL))
);
CREATE INDEX IF NOT EXISTS `simulations_shop_created_idx` ON `simulations` (`shop`, `created_at`);

CREATE TABLE IF NOT EXISTS `simulation_candidates` (
  `simulation_id` text NOT NULL REFERENCES `simulations`(`id`) ON DELETE CASCADE,
  `profile_id` text NOT NULL,
  `reason` text NOT NULL,
  `email_hash` text,
  PRIMARY KEY (`simulation_id`, `profile_id`)
);

CREATE TABLE IF NOT EXISTS `runs` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `kind` text DEFAULT 'suppress' NOT NULL CHECK (`kind` IN ('suppress', 'undo')),
  `simulation_id` text REFERENCES `simulations`(`id`) ON DELETE CASCADE,
  `undo_of_run_id` text,
  `origin` text DEFAULT 'manual' NOT NULL CHECK (`origin` IN ('manual', 'scheduled')),
  `status` text DEFAULT 'queued' NOT NULL CHECK (`status` IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  `created_by` text NOT NULL,
  `workflow_instance_id` text,
  `total_count` integer DEFAULT 0 NOT NULL,
  `batch_count` integer DEFAULT 0 NOT NULL,
  `processed_count` integer DEFAULT 0 NOT NULL,
  `skipped_count` integer DEFAULT 0 NOT NULL,
  `failed_count` integer DEFAULT 0 NOT NULL,
  `usage_max_before` integer,
  `last_error` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `started_at` integer,
  `finished_at` integer,
  -- Product rule 1: a suppression run cannot exist without a simulation.
  CHECK (
    (`kind` = 'suppress' AND `simulation_id` IS NOT NULL AND `undo_of_run_id` IS NULL)
    OR (`kind` = 'undo' AND `undo_of_run_id` IS NOT NULL AND `simulation_id` IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS `runs_simulation_unique` ON `runs` (`simulation_id`);
CREATE INDEX IF NOT EXISTS `runs_shop_created_idx` ON `runs` (`shop`, `created_at`);

CREATE TABLE IF NOT EXISTS `run_profiles` (
  `run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `profile_id` text NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `batch_index` integer NOT NULL,
  `reason` text NOT NULL,
  `email_hash` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'submitting', 'submitted', 'skipped', 'failed')),
  `klaviyo_job_id` text,
  `error_code` text,
  `reactivated_at` integer,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`run_id`, `profile_id`)
);
CREATE INDEX IF NOT EXISTS `run_profiles_batch_idx` ON `run_profiles` (`run_id`, `batch_index`);
CREATE INDEX IF NOT EXISTS `run_profiles_shop_hash_idx` ON `run_profiles` (`shop`, `email_hash`);

CREATE TABLE IF NOT EXISTS `purchase_hashes` (
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `email_hash` text NOT NULL,
  `last_order_at` integer NOT NULL,
  `customer_id_hash` text,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`shop`, `email_hash`)
);
CREATE INDEX IF NOT EXISTS `purchase_hashes_customer_idx` ON `purchase_hashes` (`shop`, `customer_id_hash`);

CREATE TABLE IF NOT EXISTS `usage_charges` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `klaviyo_period_start` integer NOT NULL,
  `tier_max_before` integer NOT NULL,
  `tier_max_after` integer NOT NULL,
  `price_table_id` text NOT NULL,
  `estimated_savings_cents` integer NOT NULL,
  `verified_savings_cents` integer NOT NULL,
  `billable_savings_cents` integer NOT NULL,
  `fee_cents` integer NOT NULL CHECK (`fee_cents` >= 0),
  `cap_applied` integer DEFAULT false NOT NULL,
  `no_charge_reason` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'charged', 'not_charged', 'failed')),
  `idempotency_key` text NOT NULL,
  `shopify_usage_record_id` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `charged_at` integer,
  -- Product rule 6: no savings, no charge.
  CHECK (`fee_cents` = 0 OR `billable_savings_cents` > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS `usage_charges_idempotency_unique` ON `usage_charges` (`idempotency_key`);
CREATE UNIQUE INDEX IF NOT EXISTS `usage_charges_shop_period_unique` ON `usage_charges` (`shop`, `klaviyo_period_start`);

CREATE TABLE IF NOT EXISTS `events_log` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `actor` text NOT NULL,
  `action` text NOT NULL,
  `run_id` text,
  `simulation_id` text,
  `detail` text
);
CREATE INDEX IF NOT EXISTS `events_log_shop_at_idx` ON `events_log` (`shop`, `at`);
