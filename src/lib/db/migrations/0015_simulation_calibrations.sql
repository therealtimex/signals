CREATE TABLE `simulation_calibrations` (
	`id` text PRIMARY KEY NOT NULL,
	`simulation_run_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`content_item_id` text,
	`content_post_id` text,
	`observed_from` integer NOT NULL,
	`observed_until` integer NOT NULL,
	`actual_score` real,
	`actual_metrics` text DEFAULT '{}',
	`score_error` real,
	`calibration` text DEFAULT '{}',
	`workflow_run_id` text,
	`source` text DEFAULT 'workflow' NOT NULL,
	`computed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simulation_run_id`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`content_post_id`) REFERENCES `content_posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sim_calibrations_run_window` ON `simulation_calibrations` (`simulation_run_id`,`observed_until`);--> statement-breakpoint
CREATE INDEX `idx_sim_calibrations_variant` ON `simulation_calibrations` (`variant_id`);