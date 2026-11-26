-- A cleanup whose charge was still waiting out the 72-hour undo window when the store uninstalled can never be
-- charged. One row per Klaviyo account records that, and outlives the store's own data: the next cleanup on that
-- Klaviyo account is charged as soon as Klaviyo confirms it, without the window. No customer data: a keyed hash
-- of the Klaviyo account id, the date and the unpaid amount. Rows are dropped after 13 months.
CREATE TABLE `unpaid_cleanups` (
  `account_key` text PRIMARY KEY NOT NULL,
  `cleaned_at` integer NOT NULL,
  `fee_cents` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
