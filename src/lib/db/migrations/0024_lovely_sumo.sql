CREATE TABLE `publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`content_item_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`targets` text NOT NULL,
	`rtx_workspace_slug` text,
	`rtx_thread_slug` text,
	`rtx_runtime_session_id` text,
	`error` text,
	`error_code` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_content_item` ON `publish_jobs` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `idx_publish_jobs_status` ON `publish_jobs` (`status`);