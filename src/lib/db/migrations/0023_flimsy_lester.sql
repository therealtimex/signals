ALTER TABLE `contact_identities` ADD `headline` text;--> statement-breakpoint
UPDATE `contact_identities`
SET `avatar_url` = (
  SELECT COALESCE(c.`photo_url`, c.`avatar_url`)
  FROM `contacts` c
  WHERE c.`id` = `contact_identities`.`contact_id`
)
WHERE (`contact_identities`.`avatar_url` IS NULL OR `contact_identities`.`avatar_url` = '')
  AND EXISTS (
    SELECT 1 FROM `contacts` c
    WHERE c.`id` = `contact_identities`.`contact_id`
      AND (c.`photo_url` IS NOT NULL OR c.`avatar_url` IS NOT NULL)
  );--> statement-breakpoint
UPDATE `contact_identities`
SET `headline` = (
  SELECT c.`headline` FROM `contacts` c WHERE c.`id` = `contact_identities`.`contact_id`
)
WHERE (`contact_identities`.`headline` IS NULL OR `contact_identities`.`headline` = '')
  AND EXISTS (
    SELECT 1 FROM `contacts` c
    WHERE c.`id` = `contact_identities`.`contact_id` AND c.`headline` IS NOT NULL
  );--> statement-breakpoint
UPDATE `contact_identities`
SET `bio` = (
  SELECT c.`bio` FROM `contacts` c WHERE c.`id` = `contact_identities`.`contact_id`
)
WHERE (`contact_identities`.`bio` IS NULL OR `contact_identities`.`bio` = '')
  AND EXISTS (
    SELECT 1 FROM `contacts` c
    WHERE c.`id` = `contact_identities`.`contact_id` AND c.`bio` IS NOT NULL
  );--> statement-breakpoint
UPDATE `contact_identities`
SET `location` = (
  SELECT c.`location` FROM `contacts` c WHERE c.`id` = `contact_identities`.`contact_id`
)
WHERE (`contact_identities`.`location` IS NULL OR `contact_identities`.`location` = '')
  AND EXISTS (
    SELECT 1 FROM `contacts` c
    WHERE c.`id` = `contact_identities`.`contact_id` AND c.`location` IS NOT NULL
  );--> statement-breakpoint
UPDATE `contact_identities`
SET `website_url` = (
  SELECT c.`website` FROM `contacts` c WHERE c.`id` = `contact_identities`.`contact_id`
)
WHERE (`contact_identities`.`website_url` IS NULL OR `contact_identities`.`website_url` = '')
  AND EXISTS (
    SELECT 1 FROM `contacts` c
    WHERE c.`id` = `contact_identities`.`contact_id` AND c.`website` IS NOT NULL
  );--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `headline`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `profile_url`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `avatar_url`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `bio`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `website`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `photo_url`;
