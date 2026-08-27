CREATE TABLE `persona_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger` text NOT NULL,
	`force` integer DEFAULT 0 NOT NULL,
	`prompt_version` integer NOT NULL,
	`agent_prompt_version` integer NOT NULL,
	`evidence_hash` text NOT NULL,
	`provenance` text NOT NULL,
	`superseded_persona_id` text,
	`workflow_run_id` text NOT NULL,
	`rtx_workspace_slug` text,
	`rtx_thread_slug` text,
	`rtx_runtime_session_id` text,
	`agent_model` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`result_persona_id` text,
	`error` text,
	`error_code` text,
	`dispatched_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_persona_jobs_contact_status` ON `persona_jobs` (`contact_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_persona_jobs_status` ON `persona_jobs` (`status`);