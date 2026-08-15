CREATE TABLE `org_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`platform` text NOT NULL,
	`platform_user_id` text NOT NULL,
	`platform_handle` text,
	`platform_url` text,
	`platform_data` text DEFAULT '{}',
	`display_name` text,
	`bio` text,
	`avatar_url` text,
	`location` text,
	`website_url` text,
	`is_verified` integer,
	`followers_count` integer,
	`following_count` integer,
	`posts_count` integer,
	`listed_count` integer,
	`platform_created_at` integer,
	`stats_updated_at` integer,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_synced_at` integer,
	`sync_errors` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_identity_platform_user` ON `org_identities` (`platform`,`platform_user_id`);--> statement-breakpoint
CREATE INDEX `idx_org_identity_org` ON `org_identities` (`org_id`);--> statement-breakpoint
CREATE TABLE `org_identity_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`org_identity_id` text NOT NULL,
	`snapshot_at` integer DEFAULT (unixepoch()) NOT NULL,
	`followers_count` integer,
	`following_count` integer,
	`posts_count` integer,
	`listed_count` integer,
	`engagement_rate` real,
	`metadata` text DEFAULT '{}',
	FOREIGN KEY (`org_identity_id`) REFERENCES `org_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_org_identity_metrics_identity_time` ON `org_identity_metrics` (`org_identity_id`,`snapshot_at`);