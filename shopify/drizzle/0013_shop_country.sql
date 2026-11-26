-- 2026-11-27 (owner's decision): TierSaver is not offered to stores in the EU/EEA, the UK or Switzerland for now
-- (app/markets.ts). The store's country is read from Shopify once (and re-read weekly) and kept here.
-- Additive only: existing rows get NULL, which means "not known yet" and is allowed until Shopify answers.
ALTER TABLE `shops` ADD `country_code` text;
--> statement-breakpoint
ALTER TABLE `shops` ADD `country_checked_at` integer;
