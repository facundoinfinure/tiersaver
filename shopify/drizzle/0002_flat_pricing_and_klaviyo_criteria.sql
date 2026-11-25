-- 2026-11-25 decisions (docs/12-CUMPLIMIENTO-KLAVIYO.md):
--   * rule defaults and floors follow Klaviyo's published suppression criteria;
--   * reactivation on purchase is removed from the MVP;
--   * the fee is a flat price by list size, not a share of any saving.
-- SQLite cannot alter CHECK constraints, so both tables are rebuilt.

CREATE TABLE `settings_new` (
  `shop` text PRIMARY KEY NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `version` integer DEFAULT 1 NOT NULL,
  -- NULL window = "at any time in the profile's history".
  `purchase_days` integer CHECK (`purchase_days` IS NULL OR `purchase_days` >= 365),
  `click_days` integer CHECK (`click_days` IS NULL OR `click_days` >= 182),
  `open_days` integer CHECK (`open_days` IS NULL OR `open_days` >= 182),
  `site_activity_days` integer CHECK (`site_activity_days` IS NULL OR `site_activity_days` >= 182),
  `new_profile_days` integer DEFAULT 365 NOT NULL CHECK (`new_profile_days` >= 180),
  `min_emails_received` integer DEFAULT 5 NOT NULL CHECK (`min_emails_received` >= 5),
  `reactivation_lock_days` integer DEFAULT 365 NOT NULL CHECK (`reactivation_lock_days` >= 365),
  `count_machine_opens` integer DEFAULT true NOT NULL,
  `protected_group_ids` text DEFAULT '[]' NOT NULL,
  `billing_day` integer CHECK (`billing_day` IS NULL OR `billing_day` BETWEEN 1 AND 31),
  `billing_day_source` text CHECK (`billing_day_source` IS NULL OR `billing_day_source` IN ('klaviyo_api', 'merchant')),
  `lead_days` integer DEFAULT 5 NOT NULL CHECK (`lead_days` >= 4),
  `mode` text DEFAULT 'approval' NOT NULL CHECK (`mode` IN ('approval', 'automatic')),
  `klaviyo_plan` text CHECK (`klaviyo_plan` IS NULL OR `klaviyo_plan` IN ('email', 'marketing')),
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);

-- Existing rows move to the new, stricter defaults (windows become "any time")
-- and their version is bumped, which supersedes any open simulation.
INSERT INTO `settings_new` (`shop`, `version`, `count_machine_opens`, `protected_group_ids`, `billing_day`, `billing_day_source`, `lead_days`, `mode`, `klaviyo_plan`, `updated_at`)
SELECT `shop`, `version` + 1, `count_machine_opens`, `protected_group_ids`, `billing_day`, `billing_day_source`, `lead_days`, `mode`, `klaviyo_plan`, `updated_at`
FROM `settings`;

DROP TABLE `settings`;
ALTER TABLE `settings_new` RENAME TO `settings`;

DROP TABLE `usage_charges`;
CREATE TABLE `usage_charges` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `run_id` text NOT NULL REFERENCES `runs`(`id`) ON DELETE CASCADE,
  `active_profiles` integer NOT NULL,
  `price_tier_max` integer,
  `profiles_suppressed` integer NOT NULL,
  `fee_cents` integer NOT NULL CHECK (`fee_cents` >= 0),
  `cap_applied` integer DEFAULT false NOT NULL,
  `no_charge_reason` text,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'charged', 'not_charged', 'failed')),
  `idempotency_key` text NOT NULL,
  `shopify_usage_record_id` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `charged_at` integer,
  -- No cleanup, no charge.
  CHECK (`fee_cents` = 0 OR `profiles_suppressed` > 0)
);
CREATE UNIQUE INDEX `usage_charges_idempotency_unique` ON `usage_charges` (`idempotency_key`);
CREATE UNIQUE INDEX `usage_charges_run_unique` ON `usage_charges` (`run_id`);
CREATE INDEX `usage_charges_shop_created_idx` ON `usage_charges` (`shop`, `created_at`);
