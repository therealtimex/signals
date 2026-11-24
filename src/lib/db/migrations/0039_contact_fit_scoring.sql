ALTER TABLE `contacts` ADD `fit_score` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_tier` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_product` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_confidence` real;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_rationale` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_score_version` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `fit_scored_at` integer;--> statement-breakpoint
CREATE INDEX `idx_contacts_fit_score` ON `contacts` (`fit_score`);