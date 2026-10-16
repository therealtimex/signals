CREATE TABLE `browser_connection_origins` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`origin` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `browser_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_browser_connection_origins_unique` ON `browser_connection_origins` (`connection_id`,`origin`);