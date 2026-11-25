-- Audit + simulation scans: one resumable Workflow per scan.
--
-- `scans` is the durable record of a scan. `scan_profiles` is working data that
-- exists only while a scan runs: the members of the candidate segment, as
-- facts without emails (ids and SHA-256 hashes). The final step copies the
-- candidates into `simulation_candidates` and deletes the working rows in the
-- same transaction, so a simulation never exists half-built.

CREATE TABLE `scans` (
  `id` text PRIMARY KEY NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `origin` text DEFAULT 'manual' NOT NULL CHECK (`origin` IN ('manual', 'scheduled')),
  `status` text DEFAULT 'queued' NOT NULL CHECK (`status` IN ('queued', 'running', 'completed', 'failed')),
  `created_by` text NOT NULL,
  `workflow_instance_id` text,
  `member_count` integer DEFAULT 0 NOT NULL,
  `simulation_id` text,
  `audit_id` text,
  `last_error` text,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `started_at` integer,
  `finished_at` integer,
  -- A finished scan always points at its results.
  CHECK (`status` <> 'completed' OR (`simulation_id` IS NOT NULL AND `audit_id` IS NOT NULL))
);
CREATE INDEX `scans_shop_created_idx` ON `scans` (`shop`, `created_at`);

CREATE TABLE `scan_profiles` (
  `scan_id` text NOT NULL REFERENCES `scans`(`id`) ON DELETE CASCADE,
  `profile_id` text NOT NULL,
  `shop` text NOT NULL REFERENCES `shops`(`shop`) ON DELETE CASCADE,
  `page` integer NOT NULL,
  `email_hash` text,
  `facts` text NOT NULL,
  -- 1 = member of a protected group, 0 = not, NULL = could not be determined (protects).
  `in_protected_group` integer DEFAULT 0,
  `decision` text CHECK (`decision` IS NULL OR `decision` IN ('candidate', 'protected', 'skipped')),
  `reason` text,
  PRIMARY KEY (`scan_id`, `profile_id`)
);
CREATE INDEX `scan_profiles_page_idx` ON `scan_profiles` (`scan_id`, `page`);

-- How the active profile count of an audit / simulation was obtained:
-- 'klaviyo_usage' (Billing Usage API) or 'counted' (TierSaver counted emailable, unsuppressed profiles).
ALTER TABLE `audits` ADD COLUMN `active_profiles_source` text;
ALTER TABLE `simulations` ADD COLUMN `active_profiles_source` text;
