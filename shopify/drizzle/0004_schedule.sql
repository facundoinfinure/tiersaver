-- Monthly schedule is an explicit opt-in (off by default). With it on, a scan
-- is started a few days before the Klaviyo plan renews; whether the resulting
-- simulation waits for the merchant or runs by itself is `settings.mode`.
ALTER TABLE `settings` ADD COLUMN `schedule_enabled` integer DEFAULT false NOT NULL;
