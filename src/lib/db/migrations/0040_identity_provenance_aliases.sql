ALTER TABLE `contact_identities` ADD `provenance_kind` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `provenance_source_url` text;--> statement-breakpoint
ALTER TABLE `contact_identities` ADD `provenance_observed_at` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `aliases` text;