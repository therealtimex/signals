CREATE TABLE `snowball_event_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_workspace` text NOT NULL,
	`connection_id` text NOT NULL,
	`session_name` text NOT NULL,
	`viewer_identity_hash` text NOT NULL,
	`capability_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `browser_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snowball_event_grants_capability` ON `snowball_event_access_grants` (`capability_hash`);--> statement-breakpoint
CREATE INDEX `idx_snowball_event_grants_run_owner` ON `snowball_event_access_grants` (`run_id`,`owner_workspace`);--> statement-breakpoint
CREATE TABLE `snowball_event_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_workspace` text NOT NULL,
	`grant_id` text NOT NULL,
	`event_key` text NOT NULL,
	`subject_key` text NOT NULL,
	`observation_kind` text NOT NULL,
	`scope` text DEFAULT 'authorized' NOT NULL,
	`payload_json` text NOT NULL,
	`observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `snowball_event_access_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snowball_event_observation_identity` ON `snowball_event_observations` (`run_id`,`grant_id`,`event_key`,`subject_key`,`observation_kind`);--> statement-breakpoint
CREATE INDEX `idx_snowball_event_observations_owner` ON `snowball_event_observations` (`run_id`,`owner_workspace`,`grant_id`);
