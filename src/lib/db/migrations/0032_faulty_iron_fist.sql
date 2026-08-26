ALTER TABLE `snowball_seed_ledger` ADD `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
-- Rows predating this column were only ever written after the calendar accepted
-- the event, so they are confirmed. Leaving them at the 'pending' default would
-- let them be re-queued once the claim TTL elapsed.
UPDATE `snowball_seed_ledger` SET `status` = 'queued';
