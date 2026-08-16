INSERT INTO `contact_channels` (`id`, `contact_id`, `channel_type`, `value`, `value_normalized`, `is_primary`, `is_verified`, `scope`, `source`, `metadata`, `created_at`, `updated_at`)
SELECT
  lower(hex(randomblob(16))),
  c.id,
  'email',
  trim(c.email),
  lower(trim(c.email)),
  1,
  CASE WHEN c.verified_email = 1 THEN 1 ELSE 0 END,
  'shared',
  'migration:0018-backfill',
  '{}',
  unixepoch(),
  unixepoch()
FROM `contacts` c
WHERE c.email IS NOT NULL AND trim(c.email) != ''
AND NOT EXISTS (
  SELECT 1 FROM `contact_channels` cc
  WHERE cc.contact_id = c.id
  AND cc.channel_type = 'email'
  AND cc.value_normalized = lower(trim(c.email))
);--> statement-breakpoint
INSERT INTO `contact_channels` (`id`, `contact_id`, `channel_type`, `value`, `value_normalized`, `is_primary`, `is_verified`, `scope`, `source`, `metadata`, `created_at`, `updated_at`)
SELECT
  lower(hex(randomblob(16))),
  c.id,
  'phone',
  trim(c.phone),
  trim(c.phone),
  1,
  0,
  'shared',
  'migration:0018-backfill',
  '{}',
  unixepoch(),
  unixepoch()
FROM `contacts` c
WHERE c.phone IS NOT NULL AND trim(c.phone) != ''
AND NOT EXISTS (
  SELECT 1 FROM `contact_channels` cc
  WHERE cc.contact_id = c.id
  AND cc.channel_type = 'phone'
  AND cc.value_normalized = trim(c.phone)
);--> statement-breakpoint
DROP INDEX `idx_contacts_email`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `platform`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `platform_user_id`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `phone`;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `verified_email`;