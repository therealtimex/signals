DROP INDEX `idx_contacts_email`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `platform`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `platform_user_id`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `verified_email`;