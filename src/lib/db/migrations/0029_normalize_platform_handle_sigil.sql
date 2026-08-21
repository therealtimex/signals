-- The `@` on an X handle is presentation, not data: every other platform stores a bare
-- identifier (an email, a LinkedIn vanity name), and every consumer already strips the sigil
-- before using it. Normalize storage so the sigil is added only at render time.
-- `ltrim(x, '@')` also repairs any doubled sigil persisted by the old contact-detail renderer,
-- and `nullif` avoids leaving an empty string behind for a handle that was only "@".
-- Scoped to `contact_identities` on purpose: no writer ever prefixed `org_identities`
-- handles, and touching a table created by a later migration breaks the N-1 replay contract
-- in `graph.test.ts`.
UPDATE `contact_identities`
SET `platform_handle` = nullif(ltrim(`platform_handle`, '@'), '')
WHERE `platform` = 'x' AND `platform_handle` LIKE '@%';
