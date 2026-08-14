CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`src_type` text NOT NULL,
	`src_id` text NOT NULL,
	`dst_type` text NOT NULL,
	`dst_id` text NOT NULL,
	`edge_type` text NOT NULL,
	`weight` real,
	`properties` text DEFAULT '{}',
	`properties_private` text,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_edge_identity` ON `graph_edges` (`edge_type`,`src_type`,`src_id`,`dst_type`,`dst_id`);--> statement-breakpoint
CREATE INDEX `idx_edge_src` ON `graph_edges` (`src_type`,`src_id`,`edge_type`);--> statement-breakpoint
CREATE INDEX `idx_edge_dst` ON `graph_edges` (`dst_type`,`dst_id`,`edge_type`);--> statement-breakpoint
CREATE TABLE `interactions` (
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
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_interactions_contact_time` ON `interactions` (`contact_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_interactions_org` ON `interactions` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_interactions_engagement` ON `interactions` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`org_type` text DEFAULT 'company' NOT NULL,
	`domain` text,
	`website` text,
	`description` text,
	`location` text,
	`avatar_url` text,
	`enrichment_score` integer DEFAULT 0 NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`metadata` text DEFAULT '{}',
	`source` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_orgs_name` ON `orgs` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orgs_domain` ON `orgs` (`domain`);