-- Pricing changed on 2026-11-26 (owner's decision): a flat monthly plan by list size instead of one charge per
-- cleanup. Shopify is the source of truth for the subscription; this table is the app's copy of its last known
-- state, so the home page can say that cleanups are off because the plan ended without asking Shopify on every
-- load. One row per shop, deleted with the shop.
-- Additive only: `usage_charges` and `unpaid_cleanups` are no longer written or read, and are kept as history.
CREATE TABLE `shop_plans` (
  `shop` text PRIMARY KEY NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('active', 'frozen', 'cancelled', 'declined')),
  `subscription_id` text,
  `monthly_cents` integer DEFAULT 0 NOT NULL,
  `tier_max_profiles` integer,
  `test` integer DEFAULT false NOT NULL,
  `current_period_end` integer,
  `started_at` integer,
  `ended_at` integer,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY (`shop`) REFERENCES `shops`(`shop`) ON UPDATE no action ON DELETE cascade
);
