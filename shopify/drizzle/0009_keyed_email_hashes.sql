-- Email hashes are now keyed per store (HMAC), so every hash stored before this migration is unusable.
-- Purchase data is dropped and read again (until then every profile is protected), simulations that were not
-- run lose their lists (the audit has to be run again), and past cleanups lose the hash that confirmed the
-- email: a restore skips those profiles rather than guess.
DELETE FROM `purchase_hashes`;
--> statement-breakpoint
DELETE FROM `orders_sync`;
--> statement-breakpoint
UPDATE `shops` SET `purchases_covered_since` = NULL, `purchases_covered_until` = NULL;
--> statement-breakpoint
DELETE FROM `simulation_candidates` WHERE `simulation_id` IN (SELECT `id` FROM `simulations` WHERE `executed_at` IS NULL);
--> statement-breakpoint
UPDATE `simulation_candidates` SET `email_hash` = NULL;
--> statement-breakpoint
UPDATE `run_profiles` SET `email_hash` = NULL;
--> statement-breakpoint
DELETE FROM `privacy_requests`;
