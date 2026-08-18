# Google Takeout + Himalaya Mail Import

Import Google contacts from Takeout and enrich the contact graph from
locally configured Himalaya mail accounts. Child of platform data import
epic (#119). Issue: #146.

## Why

- **#137** moved mail connection to Himalaya accounts in Settings — no Gmail
  OAuth sync cards on Workflows.
- Users still need bulk contact onboarding (Takeout) and ongoing enrichment
  (correspondents, mail activity, work-email org links) without OAuth.

## Milestone A — Takeout contact import

### UX

- Upload action **Import Google Contacts (Takeout)** under **Google mail (Himalaya)**.
- Reuses `ImportDialog` preview → confirm → import.
- Help copy: Google Takeout → Contacts → download zip/vcf.

### API

```
POST /api/platforms/gmail/import/preview
POST /api/platforms/gmail/import
```

### Pipeline

1. `import-file.ts` — validate `.zip` / `.vcf`, size caps.
2. `zip-import.ts` — locate `Contacts/*.vcf` in Takeout zip (zip-bomb guard).
3. `takeout-parse.ts` — parse vCard blocks or Google Contacts CSV.
4. `takeout-import.ts` — dedup via `contact_identities` (`platform=gmail`) →
   email channel → create; record `importSubType: gmail_takeout_contacts`.

## Milestone B — Himalaya correspondent import

### Execution

`himalaya -a <alias> envelope list -f INBOX|Sent --output json` (headers only).

- `himalaya-mail-scan.ts` — paginated scan with per-account cursor
  (`himalaya_correspondents`).
- Skip own addresses; dedup by email channel.
- API: `POST /api/platforms/gmail/sync` body `{ type: "correspondents", mailAccountId? }`.

## Milestone C — Org + mail activity enrichment

Single-pass scan in `mail_activity` mode:

- Work domains → `ensureOrgByDomain` + `contact_employments` (`source: email_domain`).
- Freemail denylist in `email-domain.ts`.
- Contact `metadata.messageFrequency` (`sent30d`, `received30d`, `lastMessageAt`).
- API: `POST /api/platforms/gmail/sync` body `{ type: "mail_activity", mailAccountId? }`.

## Workflows UI

- `gmail` group in `action-cards.tsx` with three actions.
- B/C gated on `/api/platforms/gmail/status` → `mailAccountCount`.
- Takeout upload requires no connected mail account.

## Out of scope

- Gmail OAuth / People API / Gmail API resurrection.
- Message body indexing or attachment storage.
