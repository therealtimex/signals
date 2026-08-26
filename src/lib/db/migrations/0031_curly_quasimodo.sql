CREATE TABLE `snowball_seed_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`platform` text,
	`calendar_event_uuid` text,
	`producer_run_id` text,
	`enqueued_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snowball_seed_ledger_url_hash` ON `snowball_seed_ledger` (`url_hash`);--> statement-breakpoint
CREATE INDEX `idx_snowball_seed_ledger_enqueued_at` ON `snowball_seed_ledger` (`enqueued_at`);