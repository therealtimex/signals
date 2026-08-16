CREATE TABLE `media_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`media_asset_id` text NOT NULL,
	`parent_type` text NOT NULL,
	`parent_id` text NOT NULL,
	`role` text DEFAULT 'attachment' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`caption` text,
	`source` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attachment_identity` ON `media_attachments` (`media_asset_id`,`parent_type`,`parent_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_attachment_parent` ON `media_attachments` (`parent_type`,`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_attachment_asset` ON `media_attachments` (`media_asset_id`);--> statement-breakpoint
ALTER TABLE `media_assets` ADD `origin` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `scope` text DEFAULT 'shared' NOT NULL;