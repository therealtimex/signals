CREATE TABLE `content_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_type` text NOT NULL,
	`direction` text,
	`summary` text,
	`occurred_at` integer NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text NOT NULL,
	`engagement_id` text,
	`content_item_id` text,
	`content_post_id` text,
	`platform` text,
	`workflow_run_id` text,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_post_id`) REFERENCES `content_posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_content_activities_post` ON `content_activities` (`content_post_id`);--> statement-breakpoint
CREATE INDEX `idx_content_activities_item_time` ON `content_activities` (`content_item_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_content_activities_engagement` ON `content_activities` (`engagement_id`);