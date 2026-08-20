ALTER TABLE `contacts` ADD `created_source` text;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `created_source_detail` text;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `created_workflow_run_id` text;
--> statement-breakpoint
ALTER TABLE `contacts` ADD `created_template_id` text;
--> statement-breakpoint
CREATE INDEX `idx_contacts_created_source` ON `contacts` (`created_source`,`created_source_detail`);
--> statement-breakpoint
CREATE INDEX `idx_contacts_created_run` ON `contacts` (`created_workflow_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_contacts_created_template` ON `contacts` (`created_template_id`);
--> statement-breakpoint
ALTER TABLE `orgs` ADD `created_source` text;
--> statement-breakpoint
ALTER TABLE `orgs` ADD `created_source_detail` text;
--> statement-breakpoint
ALTER TABLE `orgs` ADD `created_workflow_run_id` text;
--> statement-breakpoint
ALTER TABLE `orgs` ADD `created_template_id` text;
--> statement-breakpoint
CREATE INDEX `idx_orgs_created_source` ON `orgs` (`created_source`,`created_source_detail`);
--> statement-breakpoint
CREATE INDEX `idx_orgs_created_run` ON `orgs` (`created_workflow_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_orgs_created_template` ON `orgs` (`created_template_id`);
