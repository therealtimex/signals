import { sqlite } from "@/lib/db/client";
import { reconstructAllContactScalarProjections } from "@/lib/db/contact-scalar-projection";

/** Re-add legacy contact scalar columns when an earlier drop migration was applied locally. */
export function ensureContactScalarColumns(): { restored: string[]; projections: number } {
  const rows = sqlite.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  const existing = new Set(rows.map((row) => row.name));
  const restored: string[] = [];

  if (!existing.has("platform")) {
    sqlite.exec("ALTER TABLE `contacts` ADD COLUMN `platform` text");
    restored.push("platform");
  }
  if (!existing.has("platform_user_id")) {
    sqlite.exec("ALTER TABLE `contacts` ADD COLUMN `platform_user_id` text");
    restored.push("platform_user_id");
  }
  if (!existing.has("email")) {
    sqlite.exec("ALTER TABLE `contacts` ADD COLUMN `email` text");
    restored.push("email");
  }
  if (!existing.has("phone")) {
    sqlite.exec("ALTER TABLE `contacts` ADD COLUMN `phone` text");
    restored.push("phone");
  }
  if (!existing.has("verified_email")) {
    sqlite.exec(
      "ALTER TABLE `contacts` ADD COLUMN `verified_email` integer DEFAULT 0 NOT NULL",
    );
    restored.push("verified_email");
  }

  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS `idx_contacts_email` ON `contacts` (`email`)",
  );

  const projections = reconstructAllContactScalarProjections();

  return { restored, projections };
}
