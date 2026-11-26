-- customers/data_request: one row per request, so the merchant can download what the app holds about that
-- customer and answer within the legal deadline. Holds the Shopify customer id (to tell the merchant whose
-- request it is) and the keyed hash of the email (to find the rows); no email in clear.
CREATE TABLE `privacy_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `shopify_request_id` text,
  `shopify_customer_id` text,
  `email_hash` text,
  `received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `downloaded_at` integer
);
--> statement-breakpoint
CREATE INDEX `privacy_requests_shop_idx` ON `privacy_requests` (`shop`, `received_at`);
--> statement-breakpoint
-- Charge retries: rotate by oldest attempt instead of always retrying the same oldest runs.
ALTER TABLE `usage_charges` ADD `attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `usage_charges` ADD `last_attempt_at` integer;
--> statement-breakpoint
-- Set when Klaviyo's jobs confirmed the cleanup, so the cron can finish the charge without reading Klaviyo again.
ALTER TABLE `usage_charges` ADD `confirmed_at` integer;
