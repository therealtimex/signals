CREATE TABLE `browser_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`session_name` text NOT NULL,
	`kind` text DEFAULT 'shared' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_browser_connections_session` ON `browser_connections` (`session_name`);--> statement-breakpoint
CREATE TABLE `browser_session_leases` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`holder` text NOT NULL,
	`target_id` text,
	`intent` text,
	`acquired_at` integer NOT NULL,
	`renewed_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `browser_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `platform_targets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `platform_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`platform` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`handle` text,
	`handle_normalized` text,
	`canonical_url` text,
	`auth_principal_target_id` text,
	`platform_account_id` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_target_id` text,
	`last_verified_at` integer,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `browser_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_platform_targets_identity` ON `platform_targets` (`platform`,`kind`,`external_id`) WHERE "platform_targets"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_platform_targets_handle` ON `platform_targets` (`platform`,`kind`,`handle_normalized`);--> statement-breakpoint
CREATE INDEX `idx_platform_targets_connection` ON `platform_targets` (`connection_id`);--> statement-breakpoint
ALTER TABLE `content_posts` ADD `target_id` text REFERENCES platform_targets(id);--> statement-breakpoint
CREATE INDEX `idx_content_posts_target` ON `content_posts` (`target_id`);