CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`node_type` text NOT NULL,
	`node_id` text NOT NULL,
	`kind` text DEFAULT 'profile' NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`content_hash` text NOT NULL,
	`scope` text DEFAULT 'shared' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_embeddings_node_kind_model` ON `embeddings` (`node_type`,`node_id`,`kind`,`model`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_model_kind` ON `embeddings` (`model`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_embeddings_node` ON `embeddings` (`node_type`,`node_id`,`kind`);