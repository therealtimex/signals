CREATE TABLE `contact_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archetype` text,
	`tone` text,
	`summary` text,
	`description` text,
	`interests` text DEFAULT '[]',
	`conversion_triggers` text DEFAULT '[]',
	`engagement_formats` text DEFAULT '[]',
	`confidence` real,
	`scope` text DEFAULT 'shared' NOT NULL,
	`model` text,
	`source_window` text DEFAULT '{}',
	`workflow_run_id` text,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`superseded_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_personas_contact_status` ON `contact_personas` (`contact_id`,`status`);--> statement-breakpoint
CREATE TABLE `identity_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_identity_id` text NOT NULL,
	`snapshot_at` integer DEFAULT (unixepoch()) NOT NULL,
	`followers_count` integer,
	`following_count` integer,
	`posts_count` integer,
	`listed_count` integer,
	`engagement_rate` real,
	`metadata` text DEFAULT '{}',
	FOREIGN KEY (`contact_identity_id`) REFERENCES `contact_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_identity_metrics_identity_time` ON `identity_metrics` (`contact_identity_id`,`snapshot_at`);--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `avatar_url` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `location` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `website_url` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `is_verified` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `followers_count` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `following_count` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `posts_count` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `listed_count` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `platform_created_at` integer;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `stats_updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_identity_followers` ON `contact_identities` (`followers_count`);