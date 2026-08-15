CREATE TABLE `launches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brief` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`primary_platform` text,
	`audience_spec` text DEFAULT '{}',
	`workflow_template_id` text,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text,
	`metadata` text DEFAULT '{}',
	`launched_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workflow_template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_launches_status` ON `launches` (`status`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`label` text,
	`variant_type` text DEFAULT 'post' NOT NULL,
	`body` text,
	`content_item_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`predicted_score` real,
	`prediction_confidence` real,
	`predicted_metrics` text DEFAULT '{}',
	`prediction_model` text,
	`simulated_at` integer,
	`generation_model` text,
	`generation_metadata` text DEFAULT '{}',
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_variants_launch` ON `variants` (`launch_id`);--> statement-breakpoint
CREATE INDEX `idx_variants_content_item` ON `variants` (`content_item_id`);