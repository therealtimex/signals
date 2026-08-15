CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`batch_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`population_spec` text DEFAULT '{}',
	`agent_count` integer DEFAULT 0 NOT NULL,
	`prediction_model` text,
	`config` text DEFAULT '{}',
	`predicted_score` real,
	`prediction_confidence` real,
	`predicted_metrics` text DEFAULT '{}',
	`error` text,
	`scope` text DEFAULT 'shared' NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`workflow_run_id` text,
	`transcripts_pruned_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sim_runs_variant_completed` ON `simulation_runs` (`variant_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_sim_runs_batch` ON `simulation_runs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_sim_runs_status` ON `simulation_runs` (`status`);--> statement-breakpoint
CREATE TABLE `simulation_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`simulation_run_id` text NOT NULL,
	`contact_id` text,
	`org_id` text,
	`contact_persona_id` text,
	`grounding` text DEFAULT '{}',
	`engagement_score` real,
	`outcome` text,
	`predicted_actions` text DEFAULT '[]',
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`simulation_run_id`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_persona_id`) REFERENCES `contact_personas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_sim_agents_run` ON `simulation_agents` (`simulation_run_id`);--> statement-breakpoint
CREATE INDEX `idx_sim_agents_contact` ON `simulation_agents` (`contact_id`);--> statement-breakpoint
CREATE INDEX `idx_sim_agents_persona` ON `simulation_agents` (`contact_persona_id`);
