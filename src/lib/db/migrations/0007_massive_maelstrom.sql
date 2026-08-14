CREATE TABLE `niches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`niche_type` text DEFAULT 'interest' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_niche_id` text,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_niches_slug` ON `niches` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_niches_status` ON `niches` (`status`);--> statement-breakpoint
ALTER TABLE `interactions` ADD `content_post_id` text REFERENCES content_posts(id);--> statement-breakpoint
ALTER TABLE `interactions` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `interactions` ADD `workflow_run_id` text REFERENCES workflow_runs(id);--> statement-breakpoint
CREATE INDEX `idx_interactions_content_post` ON `interactions` (`content_post_id`);