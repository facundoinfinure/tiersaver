-- Purchase data now has an end as well as a start. `purchases_covered_since`
-- says from when the hashed buyers are complete; `purchases_covered_until` says
-- up to when (the last successful read of the store's orders). A scan treats
-- purchase history as insufficient, and protects everyone, when that instant is
-- unknown or more than a few hours old (PURCHASE_DATA_MAX_AGE_HOURS in
-- packages/core). Existing shops start as NULL: protected until their next sync.
ALTER TABLE `shops` ADD COLUMN `purchases_covered_until` integer;
--> statement-breakpoint
-- Last time the hourly cron handed this shop to the orders sync (rotation, so one failing shop cannot starve the rest).
ALTER TABLE `shops` ADD COLUMN `purchases_sync_attempted_at` integer;
--> statement-breakpoint
-- The orders read in progress for a shop, if any: either the history backfill or
-- an incremental catch-up. The cursor is saved after every page, so a read that
-- outlives one Workflow instance or one cron tick is resumed, not restarted.
-- Holds no order or customer data.
CREATE TABLE `orders_sync` (
  `shop` text PRIMARY KEY NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `pass_id` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('backfill', 'incremental')),
  `query_from` integer NOT NULL,
  `covers_since` integer,
  `read_all_orders` integer DEFAULT false NOT NULL,
  `started_at` integer NOT NULL,
  `cursor` text,
  `pages` integer DEFAULT 0 NOT NULL,
  `failures` integer DEFAULT 0 NOT NULL,
  `updated_at` integer NOT NULL
);
