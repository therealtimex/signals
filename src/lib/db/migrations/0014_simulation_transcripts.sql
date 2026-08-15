CREATE TABLE `simulation_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`simulation_agent_id` text NOT NULL,
	`content` text NOT NULL,
	`byte_size` integer NOT NULL,
	`token_count` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simulation_agent_id`) REFERENCES `simulation_agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sim_transcripts_agent` ON `simulation_transcripts` (`simulation_agent_id`);