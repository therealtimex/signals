DROP INDEX `idx_contacts_company`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `company`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `title`;
