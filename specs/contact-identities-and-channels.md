# Contact detail: Identities & Channels (#534)

**Status:** Accepted (System Design, 2026-10-04, loop `loop-issue-534-9d89dc2f`)
**Issue:** [therealtimex/signals#534](https://github.com/therealtimex/signals/issues/534)
**Base:** `main` @ `0408aa2` (v0.2.21)
**Parents:** [`contact-golden-record.md`](./contact-golden-record.md) (#92, ADR-092-1 and ADR-092-6),
[`contact-web-research-enrichment.md`](./contact-web-research-enrichment.md) (#369),
[`contact-enrich-profile-authenticated-target.md`](./contact-enrich-profile-authenticated-target.md) (#384)
**Out of scope:** automatic enrichment on contact creation (issue §2 "background agent trigger");
verified-email discovery (#385); Zalo as a synced platform identity (ADR-534-7); editing channel
`scope` in the UI (ADR-534-10).

---

## 1. Facts (current system)

Measured on 2026-10-04 against a read-only open of `~/.signals/data.db` and the code at `0408aa2`.
Facts here describe what exists; §3 onward is the recommendation.

### 1.1 The reproduction

Contact `ovOyU2PhwU9789vHyJnZh` (Bùi Sỹ Giang, MES-Engineering, created by an agent after a Cal.com
booking):

| table | rows |
|---|---|
| `contact_channels` | `email bui-sy.giang@mes-engineering.com.vn` (primary, unverified, no label, `agent:create_contact`) and `phone +84913039986` (primary, unverified, no label, `agent:create_contact`) |
| `contact_identities` | 0 |

`/dashboard/contacts/[id]` renders `Identities (0)` because the tab counts only
`contact.identities` (`contact-detail-client.tsx:457`). The two channels appear only as header
subtitle text, resolved by `pickPrimaryChannel` in `src/lib/db/queries/contact-dto.ts`.

### 1.2 The install

| measure | value |
|---|---|
| contacts | 14,758 |
| contacts with ≥ 1 identity | 11,606 (linkedin 9,784 · gmail 997 · x 967 · long tail 17) |
| contacts with ≥ 1 channel | 1,058 |
| contacts with channels and **no** identity | 12 (5 created by agents) |
| channel rows | 1,028 email · 64 phone · 1 each whatsapp / telegram / discord / slack (agent test rows) · 0 zalo |
| `label` | NULL on all 1,096 rows |
| `scope` | `shared` on all rows |
| `is_verified` | 6 rows, all `enrich:email_pattern` |
| channel sources | `import:gmail_takeout` 998 · `agent:create_contact` 76 · `import:linkedin_csv` 11 · `enrich:email_pattern` 6 · `api:*` 4 · `backfill:contacts-scalars` 1 |

The segment the issue describes (inbound, agent-created, email + phone, no public social) is small
today and is exactly the segment the product is moving toward; the UI gap is real for every one of
those contacts.

### 1.3 Primary invariant is violated in the data

ADR-092-6 says one `is_primary` per `(contact, channel_type)`, write-path enforced. The write path
does enforce it (`demoteOtherPrimaries` in `src/lib/db/queries/contact-channels.ts`). The data does
not hold it:

- 22 contacts carry 2–5 email rows **all flagged primary** (54 rows, 32 excess).
- All 54 rows are `import:gmail_takeout` rows with identical `created_at`, re-parented onto one
  contact. `mergeChannels` in `src/lib/contacts/dedupe/merge.ts` moves a secondary's channel rows to
  the survivor with `set({ contactId, updatedAt })` and never touches `isPrimary`. `mergeIdentities`,
  twenty lines below it, demotes incoming primary identities when the survivor already has one. The
  asymmetry is the root cause.

Any UI that shows a `Primary` badge per flag will show several on those 22 contacts, and "Set as
primary" will appear to work only partially unless the invariant is restored first (§5).

### 1.4 What already manages channels

- **Edit sheet** on contact detail mounts `ContactForm` with `onChannelsChange`, which renders
  `ContactChannelsInput` (type, value, primary, verified for email only; **no label**). Save sends
  `channels: [...]` on `PATCH /api/contacts/[id]`, which runs `syncChannelInputs`: rows absent from
  the client list are **deleted**. The same input is used by the create dialog.
- **Query layer**: `createContactChannel`, `updateContactChannel`, `deleteContactChannel`,
  `resolvePrimaryChannel`, `findContactByChannel`, `ensureContactChannel` (upsert by normalized
  value), `applyChannelInputs`, `syncChannelInputs`. Type is immutable on update
  (`updateChannelInPlace`). `valueNormalized` is recomputed on value change; a collision with another
  row of the same contact hits the unique index `idx_channel_contact_value` and surfaces as a 500.
- **Agent tools**: `create_contact.channels[]`, `update_contact.channels[]` (same full-sync),
  `enrich_contact.email / phone / observedEmails` (additive). `channelInputSchema` in
  `src/lib/agent-tools/schemas.ts` is shared with the REST contact route and feeds
  `openapi/agent-tools.json`.
- **Identities**: `IdentitiesSection` (add / remove), routes `POST /api/contacts/[id]/identities`
  and `DELETE .../identities/[identityId]`, schema module `src/lib/contact-identities-api.ts`.
- **Enrich**: `EnrichContactButton` in the header, gated by `canEnrich` (not archived, not self,
  and either `shouldRunWebResearch` or a Profile Pipeline template). `shouldRunWebResearch` is true
  when the contact has no active identity, so the reproduction contact already shows
  **Enrich profile** and it already routes to Contact Web Research.
- **Free-mail list**: `FREEMAIL_DOMAINS`, `extractEmailDomain`, `isFreemailDomain` in
  `src/lib/platforms/gmail/email-domain.ts`.
- **Zalo**: `zalo` is already a `CHANNEL_TYPES` entry (handle-normalized) with a label in
  `channelTypeLabels`. It is not in `PLATFORMS`.
- **Registries**: `PLATFORMS` is a TypeScript const; Drizzle `text({ enum })` emits no CHECK
  constraint (none in `src/lib/db/migrations/*.sql`). Three maps are total over `Platform` and fail
  to compile when an entry is missing: `PLATFORM_SHORT_LABELS`, `platformLabels`
  (`contact-identity-draft.ts`), `PLATFORM_MEDIA_CONSTRAINTS`. `PLATFORMS` also drives the launch
  dialog platform select, agent-tool enums (OpenAPI), `platform-mark` / `platform-badge` styles, and
  `identityProfileHref`. `handlers.ts:459` repeats the registry as a hard-coded `||` chain.
- **i18n**: Signals has no i18n layer (no `useTranslation`, `next-intl`, or `i18next` under `src/`).
  UI strings are literal English. The "i18n gate" named in the loop handoff does not apply to this
  repository; react-doctor, `check:fast`, `check:all`, `probe:ui`, and the QA Local App do.

---

## 2. Decision summary

| Item | Decision | ADR |
|---|---|---|
| AC1 information architecture | Option B. One tab `Identities & Channels (N)`, N = channels + identities, two fixed groups: **Channels**, then **Platform identities**. | 534-1 |
| AC2 channel management | New per-row REST routes under `/api/contacts/[id]/channels`; new `ContactChannelsSection`; label presets; manual verification with provenance; one primary per type; channel editing leaves the Edit sheet (stays in Create). | 534-2, 534-4, 534-5, 534-8 |
| Data | Fix `mergeChannels`; one-shot idempotent repair at boot. | 534-3 |
| AC3 enrich path | In this increment as a thin slice: empty-state prompt that reuses `EnrichContactButton`; corporate domain = primary email domain not in `FREEMAIL_DOMAINS`; the research brief gains one domain line. No new backend flow, no automatic trigger. | 534-6 |
| AC4 zalo | Not added to `PLATFORMS`. `zalo` is already a channel type and becomes first-class in the new UI (label, `zalo.me` link). | 534-7 |
| `scope` | Display-only badge; not editable here. | 534-10 |
| Routing | `approved` to Dev. No pre-Dev Product/UX contract; Review must return `ready_for_ux`. | 534-9 |

---

## 3. Information architecture (AC1)

### 3.1 Tab

- Label: `Identities & Channels ({contact.channels.length + contact.identities.length})`.
- Keep `value="identities"` on the trigger and content so existing state and any deep links keep
  working.
- Header subtitle is unchanged: resolved primary email · primary phone · primary platform label.

### 3.2 Body: two groups in fixed order

1. **Channels** — heading "Channels"; sub-heading "How you reach them: email, phone, messaging."
   Action button "Add channel".
2. **Platform identities** — heading "Platform identities"; sub-heading "Accounts on social and
   content platforms." Action button "Add identity" (existing `IdentitiesSection`, behaviour
   unchanged).

Order is fixed, not data-dependent: controls must not move between contacts. Channels go first
because, for the target segment, the channel *is* the identity, and identity rows carry heavier
visuals (platform marks) that read fine second.

### 3.3 Channel row

- Leading: type chip (`Badge variant="neutral"`) from `channelTypeLabels` (Email, Phone, Zalo,
  WhatsApp, …).
- Value: `channel.value` exactly as stored. Rendered as a link when `channelHref(channel)` (§4.6)
  resolves; `mailto:` and `tel:` open in place, `https:` links get `target="_blank"
  rel="noopener noreferrer"`.
- Badges, in this order: label (`variant="secondary"`, text from `channelLabelText`), `Primary`
  (`outline`) when `isPrimary`, `Verified` (`outline`, check icon) when `isVerified`, `Local only`
  (`neutral`) when `scope === "local_only"`.
- Actions (right-aligned): "Set as primary" (hidden on the primary row), "Edit" (pencil, opens the
  dialog in edit mode), "Remove" (trash, `aria-label="Remove <value>"`). No confirm dialog for
  remove, matching `IdentitiesSection`; the enrichment score recomputes server-side.
- `source` and `metadata` are not shown. They are provenance for agents and audits, and the issue
  does not ask for them.

### 3.4 Empty states

- Channels, 0 rows: card "No email, phone or messaging channel yet." with "Add channel".
- Platform identities, 0 rows: card "No platform identities linked yet." with "Add identity" and the
  enrich prompt (§6) when eligible.
- Both empty: both cards. The tab honestly reads `(0)`; the defect was `(0)` while channels exist.

### 3.5 Add / Edit channel dialog

One dialog component, two modes.

| Field | Control | Notes |
|---|---|---|
| Type | `Select` over `CONTACT_CHANNEL_TYPES` | Read-only chip in edit mode (type is immutable, §4.1) |
| Value | `Input` | Placeholder per type: `email@example.com`, `+84 9x xxx xxxx`, `@handle` |
| Label | `Select`: None / Work / Personal / Other | Stored lowercase (§4.4) |
| Primary | `Switch` | Default on when the contact has no channel of that type yet (first email becomes primary without a click) |
| Verified | `Switch` | Shown for `email` and `phone` only; API accepts it for any type |

Submit label: "Add channel" / "Save". Server errors render inline under the form in a `role="alert"`
paragraph: 409 → "This contact already has that {type label}." ; 400 → the server message.

---

## 4. Channel management contract (AC2)

### 4.1 REST routes (new)

`src/app/api/contacts/[id]/channels/route.ts` and `.../channels/[channelId]/route.ts`, modelled on
the identities routes.

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/contacts/:id/channels` | — | 200 `ContactChannel[]` in `listContactChannels` order | 404 contact |
| POST | `/api/contacts/:id/channels` | `{ channelType, value, label?, isPrimary?, isVerified? }` | 201 `ContactChannel` | 400 zod, unknown type, empty value · 404 contact · 409 `CHANNEL_DUPLICATE` |
| PATCH | `/api/contacts/:id/channels/:channelId` | `{ value?, label?, isPrimary?, isVerified? }` | 200 `ContactChannel` | 400 zod, or `channelType` present ("Channel type cannot change") · 404 contact, or channel not owned by `:id` · 409 `CHANNEL_DUPLICATE` |
| DELETE | `/api/contacts/:id/channels/:channelId` | — | 204 | 404 contact or channel not owned by `:id` |

Rules:

- Schemas live in a new `src/lib/contact-channels-api.ts` (`contactChannelCreateSchema`,
  `contactChannelPatchSchema`), mirroring `contact-identities-api.ts`. **Do not edit
  `channelInputSchema` in `src/lib/agent-tools/schemas.ts`.** It is part of the agent-tools contract
  and regenerates `openapi/agent-tools.json`; leaving it alone keeps `check:agent-tools-openapi` a
  no-op for this PR.
- `source` for every write from these routes is `api:contact_channels`.
- Ownership: a `channelId` that exists but belongs to another contact is a 404, the same policy the
  identities route and `validateChannelSync` apply.
- Duplicate detection: before insert or value change, look up
  `(contactId, channelType, normalizeChannelValue(type, value))`. A hit on a different row returns
  409 `{ error, code: "CHANNEL_DUPLICATE", details: { channelId } }`. Also catch
  `SQLITE_CONSTRAINT*` from the unique index and map it to the same 409, so a race cannot surface as
  a 500.
- Primary: the query layer already demotes other primaries of the same type inside the transaction.
  "Set as primary" is `PATCH { isPrimary: true }`. The UI offers no "unset primary"; the API still
  accepts `isPrimary: false`, after which `pickPrimaryChannel` falls back to verified, then newest.
- Verified provenance (ADR-534-4): when a request sets `isVerified: true`, the route merges
  `metadata.verification = { method: "manual", at: <unix seconds> }` into the row's existing metadata.
  `isVerified: false` deletes `metadata.verification`. Read the row, spread, then write; the query
  layer's `metadata` input replaces the whole object.
- Enrichment recalculation happens inside the query layer on every mutation; the routes do not call
  it again.
- Response body is the raw `ContactChannel` row, as the identities routes return raw identity rows.

### 4.2 Agent tools: unchanged

`create_contact.channels[]`, `update_contact.channels[]`, and `enrich_contact` keep their contracts.
`update_contact.channels[]` is a full replace: an agent that passes one new email and omits the phone
deletes the phone. That is pre-existing behaviour, not introduced here. Dev may add one sentence to
the `channels` note in `docs/agent-tools.md` saying so; a per-row `upsert_contact_channel` tool is a
follow-up if agents turn out to need it, not part of this PR.

### 4.3 Edit sheet (ADR-534-8)

In `contact-detail-client.tsx`, stop passing `onChannelsChange` to `ContactForm`; delete the
`channelsData` ref and the `channels` branch in `handleSave`. `ContactForm` already renders the
channels block only when the callback is present, so the create dialog keeps it unchanged. The sheet
description becomes: "Update name, role, and profile fields for {name}. Email, phone and messaging
live under Identities & Channels."

### 4.4 Labels (ADR-534-5)

Storage stays free text; no write-path validation is added. `src/lib/contact-channel-draft.ts` gains
`CHANNEL_LABEL_PRESETS = ["work", "personal", "other"] as const` and
`channelLabelText(label)` (`work` → "Work", `personal` → "Personal", `other` → "Other", anything else
→ as stored, trimmed). The dialog stores the lowercase preset or `null` for None.

### 4.5 Scope (ADR-534-10)

Display-only. The routes' schemas omit `scope`; `CreateContactChannelInput.scope` remains reachable
from the query layer for importers. A "Local only" badge renders when set.

### 4.6 Deep links

New `src/lib/contact-channel-link.ts`, `channelHref(channel): string | null`, unit-tested as a table:

| type | href |
|---|---|
| `email` | `mailto:<value>` |
| `phone`, `imessage` | `tel:<valueNormalized>` when it starts with `+` or has ≥ 8 digits, else null |
| `whatsapp` | `https://wa.me/<digits>` when ≥ 8 digits, else null |
| `telegram` | `https://t.me/<handle>` |
| `zalo` | `https://zalo.me/<digits>` when the value is phone-like (≥ 8 digits), else `https://zalo.me/<handle>` |
| everything else | null |

---

## 5. Primary invariant: fix and repair (ADR-534-3)

### 5.1 Merge fix

In `mergeChannels` (`src/lib/contacts/dedupe/merge.ts`), after computing `movable`, for each channel
type where the survivor already holds a primary row (after duplicates are dropped), set
`isPrimary = false` on the moved rows of that type. Mirror `mergeIdentities`. Test: survivor has a
primary email; secondary has a primary email and a primary phone → after merge the survivor has
exactly one primary email (its own) and the moved phone keeps `isPrimary = true`.

### 5.2 One-shot repair

New `src/lib/db/backfills/channel-primaries.ts`, `repairChannelPrimaries(): { contacts; demoted }`.

- Select `(contact_id, channel_type)` groups with more than one `is_primary = 1` row.
- Keep rule, per group: the newest **verified** primary if any, else the lowest `rowid` (insertion
  order; for Takeout rows that is Google's first-listed address). Demote the rest
  (`is_primary = 0`, `updated_at = now`).
- Idempotent: a second run reports `{ contacts: 0, demoted: 0 }`.
- Wire it in `src/instrumentation.ts` right after `backfillChannels`, in the same try/catch and log
  shape (`[instrumentation] Channel primary repair applied: {...}`). No DDL, no migration, no
  `db:generate`.
- Expected effect on the live install: 22 contacts, 32 rows demoted. Expected effect on a fresh
  install: none.

### 5.3 UI truthfulness

Badges render per flag, with no client-side "pick one". After 5.2 exactly one `Primary` shows per
type; `pickPrimaryChannel` in the DTO is unchanged.

---

## 6. Enrich prompt (AC3, ADR-534-6)

- **Placement:** inside the Platform identities empty state, shown only when the header's
  `canEnrich` is true (not archived, not self, and a research or pipeline route exists). The header
  button stays; both instances are the same component and the same state machine.
- **Copy:** with a corporate domain → "Enrich public social profiles for {name} at {domain}?"; without
  → "Enrich public social profiles for {name}?". Sub-line: "Runs Contact Enrich Profile in RealTimeX
  and links what it finds here."
- **Control:** `<EnrichContactButton contactId needsWebResearch profilePipelineTemplateId
  variant="outline" />` with the same props as the header. Polling, labels ("Enriching…", "Continue
  enrichment", "Retry enrichment"), error text and the Platform connections repair link are inherited.
- **Corporate domain:** new `src/lib/contacts/corporate-domain.ts`,
  `corporateEmailDomain(email: string | null | undefined): string | null` →
  `extractEmailDomain` → `null` when there is no email, when `isFreemailDomain(domain)`, or when the
  domain has no dot; otherwise the lowercase domain. Ambiguity resolves to `null`, which resolves to
  the generic copy. Nothing is automated off this value.
- **Brief:** `ContactWebResearchBriefContact` gains `"email"`. When `corporateEmailDomain` is
  non-null, `buildContactWebResearchBriefSection` appends one line after `Enrichment score`:
  `Corporate email domain: <domain>. A profile whose company website, employer, or email domain
  matches it is strong matching evidence; a mismatch alone is not disqualifying.` Query builders are
  unchanged. The brief is built at dispatch, so no `SEED_VERSION` bump.
- **Not in this increment:** triggering research when an inbound contact is created; writing
  identities from the prompt itself (the agent does that through `upsert_contact_identity`, as today).

---

## 7. ADRs

**ADR-534-1: Unified tab (Option B) over a rename (Option A).** Context: the owner read `Identities
(0)` as "this contact is empty"; renaming to `Social & Platforms (N)` would stop the lie but leave
email and phone with no management surface, which is AC2. Decision: one tab, two labelled groups, one
count. Alternatives rejected: separate `Channels` tab (sixth tab; splits "how do I reach this
person" from "where do they exist" that users think of together); channels inside Details (buries
the management surface the issue asks for). Consequences: tab value stays `identities`; the
`IdentitiesSection` component is reused as-is inside the second group.

**ADR-534-2: Per-row channel routes instead of reusing the full-sync PATCH.** Context: the only
channel write surface today is `PATCH /api/contacts/[id] { channels: [...] }`, which deletes rows the
client did not send. Decision: `GET/POST /channels`, `PATCH/DELETE /channels/[channelId]` over the
existing query functions, same shape as the identities routes. Alternatives rejected: driving the
tab through the full-sync PATCH (every add re-sends every row; a concurrent agent write is silently
deleted); a new agent tool first (the UI is the requirement; agents already have additive paths).
Consequences: two write surfaces exist for a transition (create dialog keeps full-sync; detail tab is
per-row); 409 for duplicates where today a 500 would surface; agent-tools schema and OpenAPI untouched.

**ADR-534-3: One primary per (contact, type) is enforced on every path, and the data is repaired
once.** Context: §1.3. Decision: fix `mergeChannels` to mirror `mergeIdentities`; add an idempotent
boot-time `repairChannelPrimaries` with a deterministic keep rule (verified first, else insertion
order). Alternatives rejected: client-side "show one Primary" (hides a data fault); a Drizzle
migration (no DDL is involved; backfills already run at boot for exactly this class of fix); leaving
the 22 contacts to self-heal on the next user click (the badge semantics would be wrong until then).
Consequences: 32 flag flips on the live install at the first boot after release, logged; reversible
by hand via `updated_at`.

**ADR-534-4: Manual verification carries provenance in `metadata.verification`.** Context: the only
verified rows today come from `enrich:email_pattern`, and downstream code treats `is_verified` as
"sendable". A user toggle would be indistinguishable from a probe result. Decision: routes write
`{ method: "manual", at }` on true and remove it on false. Alternatives rejected: a new column (DDL
for one JSON key); refusing manual verification (the issue asks for it, and a human who just spoke
to the person is the best verifier we have). Consequences: #385 can tell manual from probed; nothing
reads the key yet.

**ADR-534-5: Labels stay free text in storage; the UI offers presets.** Context: `label` is NULL on
every row; the issue wants work/personal. Decision: `work | personal | other` presets, stored
lowercase, unknown values rendered verbatim, no write-path validation. Alternatives rejected: an enum
with validation (would 400 any agent sending "Office"; no precedent for validating this column).
Consequences: the vocabulary can be tightened later with a one-shot normalize, the same way
ADR-092-6 upgrades normalizers.

**ADR-534-6: AC3 lands as a thin slice on the existing router.** Context: the reproduction contact
already shows "Enrich profile" in the header, and `shouldRunWebResearch` already routes zero-identity
contacts to Contact Web Research; what is missing is discoverability next to the empty identities
list and the corporate domain as evidence. Decision: reuse `EnrichContactButton` in the empty state,
compute the corporate domain with the existing free-mail list, add one line to the brief, change no
query builder, no seed, no trigger. Alternatives rejected: auto-dispatch on inbound create (costs an
agent run and a signed-in browser per Cal.com booking without the owner opting in; the issue itself
files it as medium-term); a separate "domain-first" research template (duplicates #369's contract).
Consequences: AC3 is satisfied at the UI and brief level; identity write-back remains the agent's job.

**ADR-534-7: `zalo` stays a channel type; it is not added to `PLATFORMS` in this increment.**
Context: ADR-092-1 defines identities as presence on a platform we sync from and channels as
addresses we reach people at. Zalo in Vietnamese B2B is a phone-backed messaging address, which is
already modelled (`CHANNEL_TYPES` includes `zalo`); the only reason it looked unsupported is that no
UI surfaced channels. Adding it to `PLATFORMS` would put it in the launch-dialog platform select, the
agent-tool enums and OpenAPI, three compile-forced maps, two style maps and `identityProfileHref`,
with no sync, scout, capability or publish code behind it. Decision: make the existing channel type
first-class in the new UI (label, `zalo.me` link) and leave the registry alone. Revisit when a Zalo
identity source exists (an OA page scout or sync); at that point also replace the hard-coded
platform chain at `handlers.ts:459` with `isPlatform`. Consequences: AC4's user outcome ("link a Zalo
handle or phone-backed Zalo") is delivered through channels; the optional registry change is
deferred with a named trigger.

**ADR-534-8: The Edit sheet stops editing channels.** Context: §1.4; the sheet's full-sync is the
riskier semantics and it lacks label. Decision: remove the channels block from the detail Edit sheet;
keep it in the create dialog. Alternatives rejected: keeping both (two surfaces with different rules
for the same rows). Consequences: a user who edited channels in the sheet now finds them one tab
away; the sheet description says so.

**ADR-534-9: No pre-Dev Product/UX route.** Context: the handoff asked whether the IA choice needs a
UX contract first. The issue author already chose Option B; the field set is dictated by the schema;
copy and ordering are fixed here and are cheap to change on review. Decision: route `approved` to
Dev. Review must return `ready_for_ux` (new management surface and dialog meet its "significant UI
change" rule), so Product/UX reviews the built experience before QA. Consequences: one fewer
round-trip before code; UX feedback lands on a running UI, which `probe:ui` and the QA Local App can
show.

**ADR-534-10: `scope` is display-only in this increment.** Context: every row is `shared`; no
user-facing definition of `local_only` for channels exists; the launch dialog exposes scope with
copy ("Private (local only)") that was written for content. Decision: badge only. Consequences: an
editable privacy control for channels is a follow-up that needs UX copy, not this PR.

---

## 8. Slices, tests, proof

One PR on `issue-534`, four commits in this order so each is reviewable alone.

| # | Commit | Files (indicative) | Tests |
|---|---|---|---|
| A | `fix(contacts): demote moved primary channels on merge and repair existing rows` | `merge.ts`, `backfills/channel-primaries.ts`, `instrumentation.ts` | merge test (§5.1); repair test seeding 3 primary emails incl. one verified → keeps the verified one; second run is a no-op |
| B | `feat(api): per-row contact channel routes` | `contact-channels-api.ts`, `channels/route.ts`, `channels/[channelId]/route.ts`, `contact-channel-link.ts` | route tests mirroring `contact-channels.test.ts` / `identities/route.test.ts`: create 201, list order, duplicate 409 (create and on value change), foreign channel 404, type-change 400, set-primary demotes the other row, verified true/false writes and removes `metadata.verification`, delete 204; `channelHref` table |
| C | `feat(contacts): Identities & Channels tab with channel management` | `contact-channels-section.tsx`, `contact-channel-dialog.tsx`, `contact-detail-client.tsx`, `contact-channel-draft.ts` | happy-dom component tests (pattern: `enrich-contact-button.test.ts`): count = channels + identities; both groups and both empty states; badges per flag; dialog hides Verified for non email/phone; 409 renders the inline error; Edit sheet no longer renders the channels block |
| D | `feat(contacts): enrich prompt with corporate domain` | `corporate-domain.ts`, `contact-channels-section.tsx` (or the identities group), `contact-web-research.ts` | `corporateEmailDomain` table (null email, gmail.com, yahoo.fr, `mes-engineering.com.vn`, `localhost`); prompt copy with and without domain; brief contains the domain line only when non-null |

Also: `.evidence/{before,after}_contact-identities-channels_{desktop,mobile}_{light,dark}.png`
(AGENTS.md §10 naming); grep `guide/` for "Identities" and update any screenshot or sentence that
names the tab.

### 8.1 Live proof (required; unit tests do not prove layout)

1. `node /Users/realtimex/github/signals/scripts/qa/qa-local-app.mjs up --issue 534 --loop-id loop-issue-534-9d89dc2f`
   from the worktree. The QA app has an empty data dir. Create the reproduction through the running
   app's REST API (`POST /api/contacts` with name, company, and the two channels; no identity), then:
   - `npm run probe:ui -- --path /dashboard/contacts/<id> --eval "document.querySelector('[role=tab][data-state][value=identities], [role=tab]:nth-child(2)').textContent"` →
     `Identities & Channels (2)`;
   - click the tab (`--click "Identities & Channels (2)"`), assert two channel rows, one `Primary`
     badge per type, the enrich prompt text containing `at mes-engineering.com.vn`;
   - through the UI: add a Zalo channel with a phone value and confirm the `zalo.me` link; add a
     second email, "Set as primary" on it, confirm the badge moved; set label Work, confirm the
     badge; re-add the first email and confirm the inline 409 copy; remove a row; confirm the header
     subtitle follows the primary change after refresh.
   - Capture the four screenshot combinations for the tab.
   - `node … qa-local-app.mjs down --issue 534` must exit 0 before the QA handoff.
2. Repair proof against a **copy** of the real database: copy `~/.signals/data.db` to a disposable
   dir, run `repairChannelPrimaries()` via `npx tsx` from inside the repo with
   `SIGNALS_DATA_DIR=<copy> SIGNALS_SKIP_CLIENT_MIGRATIONS=1`, expect `{ contacts: 22, demoted: 32 }`
   then `{ contacts: 0, demoted: 0 }`, and
   `select contact_id, channel_type, count(*) from contact_channels where is_primary=1 group by 1,2 having count(*)>1`
   returns no rows. Never run it against `~/.signals` from a worktree; the packaged app runs the boot
   backfill itself after release.
3. AC3 live dispatch is optional and the owner's call: it attaches to the signed-in `signals-publish`
   browser (`desktop.runtime-sessions`, `desktop.browser` grants). The copy and the brief line are
   unit-tested; `GET /api/contacts/<id>/web-research` polling is already covered by
   `enrich-contact-button.test.ts`.

### 8.2 Gates

`npm run check:fast` while iterating; `npm run doctor` after every React change (blocking in CI);
`SIGNALS_DATA_DIR=/private/tmp/signals-agent-$$ npm run check:all` before handoff;
`npm run check:agent-tools-openapi` should be a no-op (if it is not, the agent schema was touched —
revert that). Run gates in the main checkout per AGENTS.md §3, with the worktree only for attribution.

---

## 9. Acceptance traceability

| Issue AC | Where it is met | Proof |
|---|---|---|
| 1 "no misleading `Identities (0)` when channels exist" | §3.1 count, §3.4 | probe:ui tab text on the reproduction contact |
| 2 "view and manage channels: add, edit, remove, label, primary, verified" | §3.3, §3.5, §4.1 | route tests + UI walk-through §8.1 |
| 3 "streamlined path to enrich social identities for corporate-domain contacts" | §6 | prompt copy with domain; brief line test |
| 4 (optional) "add `zalo` to `PLATFORMS`" | ADR-534-7: delivered as a channel, registry deferred with trigger | Zalo channel row with `zalo.me` link |

---

## 10. Risks, follow-ups, open questions

Risks
- Two `EnrichContactButton` instances poll `/web-research` every 5 s while pending. Acceptable; if it
  bothers review, lift the state into the parent in a follow-up.
- The boot repair flips 32 flags on the live install. It only restores an invariant the write path
  already enforces; rows keep `updated_at`, so it is auditable and reversible by hand.
- Removing channels from the Edit sheet changes a journey; Review's `ready_for_ux` catches copy or
  placement objections before QA.
- Rollback: UI and additive routes revert cleanly; the merge fix and repair have no DDL.

Follow-ups (not this PR)
- `upsert_contact_channel` agent tool, if agents need per-row semantics; until then document the
  full-replace behaviour of `update_contact.channels`.
- Editable `scope` for channels, with UX copy for what `local_only` means on a reachability record.
- Cross-contact duplicate hint ("also on <other contact>") on add; `find_duplicate_contacts` covers
  the data today.
- Replace the hard-coded platform chain at `handlers.ts:459` with `isPlatform`; add `zalo` to
  `PLATFORMS` only alongside a Zalo identity source (ADR-534-7).
- Automatic enrichment prompt or dispatch when an inbound contact with a corporate domain is created
  (issue §2, medium-term).

Open questions for the owner (none block Dev)
- Whether the tab should be renamed in `guide/` screenshots now or at the next guide refresh.
- Whether manual verification should also be offered for messenger types in the dialog (API already
  accepts it).
