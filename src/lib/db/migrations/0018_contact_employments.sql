CREATE TABLE `contact_employments` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`org_id` text NOT NULL,
	`title` text,
	`started_at` integer,
	`ended_at` integer,
	`is_current` integer DEFAULT true NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_employment_contact_current` ON `contact_employments` (`contact_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `idx_employment_org` ON `contact_employments` (`org_id`);
