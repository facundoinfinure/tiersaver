-- Confirming a large cleanup takes more Klaviyo reads than one cron tick allows. The cron now confirms it a page
-- of jobs at a time and keeps its place here, so a charge no longer depends on the cleanup's own Workflow.
ALTER TABLE `usage_charges` ADD `confirm_offset` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `usage_charges` ADD `confirm_suppressed` integer DEFAULT 0 NOT NULL;
