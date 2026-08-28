CREATE TABLE `contact_email_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`org_id` text NOT NULL,
	`address` text NOT NULL,
	`address_normalized` text NOT NULL,
	`pattern` text,
	`status` text DEFAULT 'predicted' NOT NULL,
	`confidence` text NOT NULL,
	`evidence` text DEFAULT '{}',
	`source` text NOT NULL,
	`verification_method` text,
	`verified_at` integer,
	`checked_at` integer,
	`probe_attempts` integer DEFAULT 0 NOT NULL,
	`promoted_channel_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_candidates_contact_address` ON `contact_email_candidates` (`contact_id`,`address_normalized`);--> statement-breakpoint
CREATE INDEX `idx_email_candidates_org_status` ON `contact_email_candidates` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `org_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`contact_id` text,
	`activity_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`why_it_matters` text,
	`recommended_action` text DEFAULT '{}',
	`url` text,
	`occurred_at` integer NOT NULL,
	`actor` text NOT NULL,
	`source` text NOT NULL,
	`workflow_run_id` text,
	`dedupe_key` text NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_activities_dedupe` ON `org_activities` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_org_activities_org_time` ON `org_activities` (`org_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `org_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`domain` text NOT NULL,
	`kind` text DEFAULT 'alias' NOT NULL,
	`source` text NOT NULL,
	`mx_status` text DEFAULT 'unknown' NOT NULL,
	`catch_all` text DEFAULT 'unknown' NOT NULL,
	`mail_checked_at` integer,
	`mail_evidence` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_domains_domain` ON `org_domains` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_org_domains_org` ON `org_domains` (`org_id`);--> statement-breakpoint
CREATE TABLE `org_email_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`pattern` text NOT NULL,
	`rank` integer NOT NULL,
	`confidence` text NOT NULL,
	`score` real NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`evidence` text DEFAULT '[]',
	`is_selected` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`evaluated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_email_patterns_org_pattern` ON `org_email_patterns` (`org_id`,`pattern`);--> statement-breakpoint
CREATE INDEX `idx_org_email_patterns_org_rank` ON `org_email_patterns` (`org_id`,`rank`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `company_size` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `tags` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `orgs` ADD `owner_contact_id` text REFERENCES contacts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `orgs` ADD `account_stage` text;--> statement-breakpoint
ALTER TABLE `orgs` ADD `followed_at` integer;--> statement-breakpoint
ALTER TABLE `orgs` ADD `feed_seen_at` integer;--> statement-breakpoint
CREATE INDEX `idx_orgs_account_stage` ON `orgs` (`account_stage`);--> statement-breakpoint
CREATE INDEX `idx_orgs_owner` ON `orgs` (`owner_contact_id`);--> statement-breakpoint
CREATE INDEX `idx_orgs_followed` ON `orgs` (`followed_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `related_org_id` text REFERENCES orgs(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_related_org` ON `tasks` (`related_org_id`);
