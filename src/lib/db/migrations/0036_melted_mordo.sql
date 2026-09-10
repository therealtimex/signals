CREATE TABLE `snowball_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`template_id` text,
	`platform` text NOT NULL,
	`profile_url` text NOT NULL,
	`profile_key` text NOT NULL,
	`proposed_name` text NOT NULL,
	`proposed_name_key` text NOT NULL,
	`proposed_company` text,
	`proposed_title` text,
	`seed_type` text,
	`seed_value` text,
	`status` text DEFAULT 'identity_unverified' NOT NULL,
	`failure_reason` text NOT NULL,
	`failure_message` text NOT NULL,
	`failure_details` text DEFAULT '{}' NOT NULL,
	`failure_history` text DEFAULT '[]' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`promoted_contact_id` text,
	`promoted_identity_id` text,
	`promoted_org_id` text,
	`promoted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_identity_id`) REFERENCES `contact_identities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snowball_candidates_run_profile` ON `snowball_candidates` (`workflow_run_id`,`platform`,`profile_key`);--> statement-breakpoint
CREATE INDEX `idx_snowball_candidates_status_updated` ON `snowball_candidates` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_snowball_candidates_profile_name` ON `snowball_candidates` (`platform`,`profile_key`,`proposed_name_key`);