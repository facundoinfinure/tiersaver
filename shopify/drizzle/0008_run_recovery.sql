-- Run recovery, honest batch outcomes and "Stop cleanup" (review findings C2, M3, M8; 2026-11-26).
-- Additive only: no table is rebuilt and no existing value changes meaning.

-- Heartbeat. Written when a run starts and at every batch attempt. The hourly cron uses it to find runs whose
-- Workflow died (no progress for a safe interval) and close them with what was really submitted.
ALTER TABLE `runs` ADD COLUMN `last_progress_at` integer;
--> statement-breakpoint
-- Set by "Stop cleanup". The run stops before its next batch and ends as `cancelled`.
ALTER TABLE `runs` ADD COLUMN `stop_requested_at` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `stop_requested_by` text;
--> statement-breakpoint
-- Profiles whose request went out but whose outcome is not known (`run_profiles.status = 'failed'` with
-- `attempted_at` set). They may be suppressed in Klaviyo, so an undo includes them.
ALTER TABLE `runs` ADD COLUMN `unknown_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Stamped right before the Klaviyo request that carries the profile is sent. NULL = never sent to Klaviyo.
ALTER TABLE `run_profiles` ADD COLUMN `attempted_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `runs_open_idx` ON `runs` (`status`, `last_progress_at`);
