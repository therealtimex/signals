CREATE TABLE `contact_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`channel_type` text NOT NULL,
	`value` text NOT NULL,
	`value_normalized` text NOT NULL,
	`label` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`contact_identity_id` text,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_identity_id`) REFERENCES `contact_identities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channel_contact_value` ON `contact_channels` (`contact_id`,`channel_type`,`value_normalized`);--> statement-breakpoint
CREATE INDEX `idx_channel_lookup` ON `contact_channels` (`channel_type`,`value_normalized`);--> statement-breakpoint
CREATE INDEX `idx_channel_contact` ON `contact_channels` (`contact_id`);