PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`origin` text DEFAULT 'upload' NOT NULL,
	`source_url` text,
	`sha256` text,
	`duration_ms` integer,
	`scope` text DEFAULT 'shared' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_media_assets`("id", "filename", "storage_path", "mime_type", "file_size", "width", "height", "origin", "source_url", "sha256", "duration_ms", "scope", "created_at", "updated_at") SELECT "id", "filename", "storage_path", "mime_type", "file_size", "width", "height", "origin", "source_url", "sha256", "duration_ms", "scope", "created_at", "updated_at" FROM `media_assets`;--> statement-breakpoint
DROP TABLE `media_assets`;--> statement-breakpoint
ALTER TABLE `__new_media_assets` RENAME TO `media_assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `content_items` DROP COLUMN `media_paths`;