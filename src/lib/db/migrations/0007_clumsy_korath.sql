PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`org_id` text,
	`interaction_type` text NOT NULL,
	`direction` text,
	`summary` text,
	`is_meaningful` integer DEFAULT false NOT NULL,
	`occurred_at` integer NOT NULL,
	`scope` text DEFAULT 'local_only' NOT NULL,
	`source` text NOT NULL,
	`engagement_id` text,
	`content_item_id` text,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_interactions`("id", "contact_id", "org_id", "interaction_type", "direction", "summary", "is_meaningful", "occurred_at", "scope", "source", "engagement_id", "content_item_id", "metadata", "created_at") SELECT "id", "contact_id", "org_id", "interaction_type", "direction", "summary", "is_meaningful", "occurred_at", "scope", "source", "engagement_id", "content_item_id", "metadata", "created_at" FROM `interactions`;--> statement-breakpoint
DROP TABLE `interactions`;--> statement-breakpoint
ALTER TABLE `__new_interactions` RENAME TO `interactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_interactions_contact_time` ON `interactions` (`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_interactions_org` ON `interactions` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_interactions_engagement` ON `interactions` (`engagement_id`);