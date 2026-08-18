# Contact & Org Creation Provenance — Birth Fields, Run Linkage, Backfill

**Status:** Approved (System Design deliverable for [#161](https://github.com/therealtimex/signals/issues/161), loop `loop-issue-161-b9a0c4e2`)
**Date:** 2026-08-18
**Base:** `main` @ `8ecf4f5`
**Aligned to:** [`specs/contact-golden-record.md`](./contact-golden-record.md) (#92 — child `source` contract), [`specs/schema-v0.5.md`](./schema-v0.5.md) §4 (additive-first migration rules)
**Related:** #153 (RTX Run lane, shipped), #144 (graph edges)

---

## 1. Problem & Constraints

Provenance today is fragmented across child rows and never lands on the golden record:

| Path | Recorded today | Golden-record link |
|---|---|---|
| X archive import | `workflow_runs` (`x_archive_contacts`), identity `platformData.source = "x_archive_import"` (`x/mappers.ts:205`), `follows` edges `source = "import:x_archive"` | none |
| Agent `create_contact` | `"agent:create_contact"` on channels/employments (`handlers.ts:165`) | none — no run/template id |
| Platform sync | `"sync:gmail_contacts"`, `"sync:himalaya_correspondents"` on children; edges `"sync:x"`, `"sync:linkedin"` | none |
| X / LinkedIn live sync | **nothing** — `createContact(contactData)` falls through to the `"api:create_contact"` default (`sync-contacts.ts:102`, `sync-linkedin-contacts.ts:136`) | none |
| Manual UI create | indistinguishable from external REST (`POST /api/contacts` hard-codes `"api:create_contact"`) | none |

Humans and RTX agents cannot answer "where did this contact come from?", filter archive-only stubs, or scope follow-up work to a template run.

Constraints inherited from #92 / schema-v0.5 and this repo's mechanics:

1. **Additive DDL only.** SQLite (`drizzle.config.ts`), migrations in `src/lib/db/migrations/` (next: `0026_*`), `npm run check` (typecheck + lint + tests + `db:migrate` + build) must stay green.
2. **`foreign_keys = ON`** (`client.ts:21`) — any declared FK is enforced at insert time. File imports record their `workflow_runs` row **after** contacts are created (`record-import-run.ts`), so a hard FK would force restructuring every import route.
3. **Complement, not replace.** Child-level `source` on `contact_channels`, `contact_employments`, `graph_edges`, and identity `platformData` keep their exact semantics and vocabulary.
4. **Agent-tools v1 stays callable** — additive params/response keys only.
5. **Single choke points exist and must stay single:** every contact insert goes through `createContact()` (`src/lib/db/queries/contacts.ts:283`); every org insert goes through `createOrg` / `ensureOrgByName` / `ensureOrgByDomain` (`src/lib/db/queries/orgs.ts`). No new insert sites.

---

## 2. DDL Contract

Additive nullable columns on **both** `contacts` and `orgs` (migration `0026`, `ALTER TABLE … ADD COLUMN` only; `NULL` = pre-provenance/unknown, no default):

```ts
// schema.ts — added to `contacts` and to `orgs` (identical shape)
createdSource: text("created_source", {
  enum: ["manual", "agent", "import", "sync", "api"],
}),                                                    // birth category; NULL = unknown
createdSourceDetail: text("created_source_detail"),    // canonical tag, registry-validated (§3)
createdWorkflowRunId: text("created_workflow_run_id"), // soft ref → workflow_runs.id (ADR-161-2)
createdTemplateId: text("created_template_id"),        // soft ref → workflow_templates.id
```

Indexes (same migration):

```ts
// contacts
index("idx_contacts_created_source").on(table.createdSource, table.createdSourceDetail),
index("idx_contacts_created_run").on(table.createdWorkflowRunId),
index("idx_contacts_created_template").on(table.createdTemplateId),
// orgs
index("idx_orgs_created_source").on(table.createdSource, table.createdSourceDetail),
index("idx_orgs_created_run").on(table.createdWorkflowRunId),
```

Notes:

- **Columns, not `metadata` JSON** (ADR-161-1). The archive machinery already pays the `json_extract` tax (`contacts.ts:199,472`); list filters and the run-detail count need indexed equality.
- **No `.references()`** on the run/template columns (ADR-161-2). Precedent: `workflowRuns.parentWorkflowId` (`schema.ts:524`) and `workflowTemplates.sourceTemplateId` (`schema.ts:173`) are both soft self-references. Write paths validate existence where the id crosses a trust boundary (§5, §8).
- `Contact` / `Org` types flow automatically from `$inferSelect`; `ContactDTO` gains the four fields explicitly (§6.1).
- `orgs.source` (existing, nullable, mixed vocabulary: `"ui"`, `"agent"`, `"email_domain"`, `"backfill:contacts-company"`, threaded child tags) is **untouched** — it remains the child-level tag; the new columns are the birth record.

---

## 3. Provenance Vocabulary & Immutability

### 3.1 One registry, one tag per write path

New module `src/lib/db/creation-sources.ts`, following the `PLATFORMS` / `CHANNEL_TYPES` registry precedent (open text validated in the write path; growth = code edit, not migration):

```ts
export const CREATED_SOURCES = ["manual", "agent", "import", "sync", "api"] as const;
export type CreatedSource = (typeof CREATED_SOURCES)[number];

/**
 * Canonical creation tags. The tag IS the child-row `source` string the same
 * path writes (channels/employments), so birth and child provenance can never
 * drift. `createdSource` is derived from the prefix; `createdSourceDetail`
 * stores the full tag.
 */
export const CREATION_TAGS = {
  "manual:create_contact":        "manual", // NEW tag — Signals UI dialogs (§4)
  "manual:create_org":            "manual", // NEW tag — org create dialog
  "api:create_contact":           "api",
  "api:create_org":               "api",
  "agent:create_contact":         "agent",
  "import:x_archive":             "import",
  "import:linkedin_csv":          "import",
  "import:gmail_takeout":         "import",
  "sync:x_contacts":              "sync",
  "sync:linkedin_contacts":       "sync",
  "sync:gmail_contacts":          "sync",
  "sync:himalaya_correspondents": "sync",
} as const satisfies Record<string, CreatedSource>;
export type CreationTag = keyof typeof CREATION_TAGS;
```

- Sync tag suffixes are the exact `syncSubType` literals already used by `runSyncWorkflow` (`"x_contacts"`, `"linkedin_contacts"`, `"gmail_contacts"`, `"himalaya_correspondents"`).
- An unknown tag passed to `createContact`/org creators **throws** — all callers are in-repo; a typo should fail tests, not write junk.
- Display metadata (human label per tag, §6.3) lives in the same module.
- **Deviation from the issue's shorthand, decided here:** `createdSourceDetail` stores the *full* tag (`"import:x_archive"`), not the bare suffix (`"x_archive"`). Bare suffixes collide (`api:create_contact` vs `agent:create_contact` vs `manual:create_contact` all suffix to `create_contact`). Filters accept the bare suffix as an alias when unambiguous (§6.2), so the issue's AC query `createdSourceDetail=x_archive` still works verbatim.

### 3.2 Immutability rules

1. **Birth-only.** The four fields are written exactly once, inside the creating transaction. `updateContact()` strips them from any update payload (same mechanism as `stripContactWriteExtras`, `contacts.ts:68`); org update paths likewise.
2. **Explicit rejection at the API edge.** `PATCH /api/contacts/[id]`, `PATCH/PUT /api/orgs/[id]`, and `update_contact` reject payloads naming any birth field with a 400 / `VALIDATION_ERROR` — "creation provenance is immutable" — via a shared guard in `src/lib/api/contact-route-validation.ts` (same pattern as `getDeprecatedPlatformFieldsError`). Silent stripping hides bugs from agents; a named error is self-correcting.
3. **The backfill (§7) is the only sanctioned writer after birth**, and only for `NULL → value`. Never `value → value`.
4. **Complement, not replacement.** Child `source` tags keep accumulating normally after birth (enrichment adds a channel tagged `agent:update_contact` later; the birth record does not change). The birth fields answer "where did the *record* come from"; child tags answer "where did *this field* come from".
5. Run/template rows referenced by birth fields may age or (in the future) be deleted; because the reference is soft, the birth record survives unchanged and read paths render "run no longer available" (§6.3).

---

## 4. Write-Path Matrix

`createContact`'s second parameter widens (backward-compatible — every existing call site compiles unchanged):

```ts
// src/lib/db/queries/contacts.ts
export type CreationProvenance = {
  tag: CreationTag;                    // = channelSource for child rows
  workflowRunId?: string | null;
  templateId?: string | null;
};

export function createContact(
  data: ContactWriteInput,
  provenance: CreationTag | CreationProvenance = "api:create_contact",
): ContactDTO
```

The insert derives `createdSource = CREATION_TAGS[tag]`, `createdSourceDetail = tag`, and stores the run/template ids. The tag continues to flow to `applyContactWrites → applyChannelWrites/applyEmploymentWrites` exactly as `channelSource` does today; the full provenance object now flows one level further, into org creation (§4.1).

Every creator, with exact values:

| # | Creator (file:line today) | `tag` → (`createdSource`, `createdSourceDetail`) | `createdWorkflowRunId` | `createdTemplateId` | Change required |
|---|---|---|---|---|---|
| 1 | Signals UI `AddContactDialog` → `POST /api/contacts` (`add-contact-dialog.tsx:84`) | `manual:create_contact` → (`manual`, `manual:create_contact`) | `null` | `null` | dialog payload gains `createdVia: "manual"`; route maps it (§4.2) |
| 2 | REST `POST /api/contacts` (external caller, `route.ts:104`) | `api:create_contact` → (`api`, `api:create_contact`) | `body.workflowRunId ?? null` (validated) | `body.templateId ?? run.templateId ?? null` | additive optional body fields (§5) |
| 3 | Agent-tool `create_contact` (`agent-tools/handlers.ts:165`) | `agent:create_contact` → (`agent`, `agent:create_contact`) | `input.workflowRunId ?? null` (validated) | `input.templateId ?? run.templateId ?? null` | additive optional params (§5) |
| 4 | X archive import (`x/archive-import.ts:248`) | `import:x_archive` → (`import`, `import:x_archive`) | pre-allocated contacts run id (§4.3) | `null` | thread run id through `importXArchiveContacts` |
| 5 | LinkedIn CSV import (`linkedin/csv-import.ts:255`) | `import:linkedin_csv` → (`import`, `import:linkedin_csv`) | pre-allocated (§4.3) | `null` | thread run id |
| 6 | Gmail Takeout import (`gmail/takeout-import.ts:90`) | `import:gmail_takeout` → (`import`, `import:gmail_takeout`) | pre-allocated (§4.3) | `null` | thread run id |
| 7 | X contacts sync (`sync-contacts.ts:102`) | `sync:x_contacts` → (`sync`, `sync:x_contacts`) | `run.id` from `runSyncWorkflow` (§4.4) | `null` | **fixes existing drift** — today this path writes no tag at all |
| 8 | LinkedIn connections sync (`sync-linkedin-contacts.ts:136`) | `sync:linkedin_contacts` → (`sync`, `sync:linkedin_contacts`) | `run.id` (§4.4) | `null` | **fixes existing drift** — same fall-through today |
| 9 | Gmail contacts sync (`sync-gmail-contacts.ts:175`) | `sync:gmail_contacts` → (`sync`, `sync:gmail_contacts`) | `run.id` (§4.4) | `null` | pass run id |
| 10 | Himalaya mail scan (`gmail/himalaya-mail-scan.ts:173`) | `sync:himalaya_correspondents` → (`sync`, `sync:himalaya_correspondents`) | `run.id` when wrapped by `runSyncWorkflow`, else `null` | `null` | pass run id |
| 11 | Org: Signals UI → `POST /api/orgs` (`orgs/route.ts:44`, today `source: "ui"`) | `manual:create_org` → (`manual`, `manual:create_org`) | `null` | `null` | `createdVia: "manual"` from UI; default `api:create_org` (§4.2). `orgs.source` keeps receiving `"ui"` — unchanged |
| 12 | Org: `ensureOrgByName` / `ensureOrgByDomain` during any contact transaction (`orgs.ts:177,203`) | **inherits the parent transaction's full provenance** — same tag, run, template | inherited | inherited | §4.1 |
| 13 | Backfills (`backfills/orgs.ts` etc.) | leave birth fields `NULL` — backfilled rows are pre-provenance reconstructions | `null` | `null` | none |

Rows created by tests/fixtures follow whatever tag the code under test uses; no test-only vocabulary.

### 4.1 Org inheritance (`ensureOrgByName` propagation)

`ensureOrgByName(name, source)` is already called from inside the contact write path with the threaded `channelSource` tag (`contact-employment-writes.ts:53,253`, `contact-org-dual-write.ts:42`). Widen the same seam:

```ts
export function ensureOrgByName(
  name: string,
  source = "agent",                        // unchanged — still writes orgs.source
  provenance?: CreationProvenance,         // NEW — stamped only when the row is NEW
): Org
```

- `applyEmploymentWrites` receives the full `CreationProvenance` from `createContact` and passes it down. Because `createContact` wraps everything in one `db.transaction` (`contacts.ts:315–318`), a new org created for a new contact **inherits the identical birth record atomically** (issue AC 3).
- When the org already exists: no change to any field — `ensureOrg*` stays a pure find-or-create.
- `ensureOrgByDomain(domain, source, provenance?)` — same shape; the himalaya scan passes its sync provenance while `orgs.source` keeps `"email_domain"`.
- `createOrg(input)` gains optional `provenance` on `CreateOrgInput`; the REST route maps `createdVia` (§4.2).

### 4.2 Manual vs API discrimination (ADR-161-5)

The UI and external callers share `POST /api/contacts` / `POST /api/orgs`. Additive body field:

```ts
createdVia: z.literal("manual").optional(), // sent ONLY by Signals UI dialogs
```

`createdVia: "manual"` selects the `manual:*` tag; absence defaults to `api:*`. This is honor-system (localhost-auth, single-user app — `agent-tools/auth.ts` gates the only other lane); it does not need to be adversarial. Other in-repo REST creators (e.g. self-contact onboarding) may opt into `manual` in follow-ups; anything that doesn't send the field is `api`.

### 4.3 File imports — pre-allocated run id

`recordImportRun` (`record-import-run.ts`) deliberately records the run **once at the end** of the synchronous import. Keep that shape; pre-allocate the id instead of restructuring:

```ts
// queries/workflows.ts — additive
export function createWorkflowRun(data: Omit<NewWorkflowRun, "id"> & { id?: string }): WorkflowRun
// record-import-run.ts — additive
interface RecordImportRunOpts { id?: string; /* …existing… */ }
```

Each import route generates `const runId = nanoid()` **before** parsing, threads it into the import function (`importXArchiveContacts(merged, runId)` etc. — additive trailing param), and passes `{ id: runId }` to `recordImportRun` at the end. Contacts therefore carry a run id that exists by the time the request completes; because the reference is soft (§2), the seconds-long window where contacts precede the run row is harmless — this is precisely why the columns are not enforced FKs. A crash mid-import leaves contacts pointing at a never-recorded run id; the failure-path `recordImportRun` call in each route already fires for plausible files, and read paths tolerate missing runs (§6.3).

Per-import-route mapping (all recorded, for the backfill's window matching too):

| Route | `importSubType` | Contacts run |
|---|---|---|
| `POST /api/platforms/x/import` | `"x_archive_contacts"` (posts run `"x_archive_posts"` is separate — contacts get the **contacts** run id) | pre-allocated |
| `POST /api/platforms/linkedin/import` | `"linkedin_connections"` | pre-allocated |
| `POST /api/platforms/gmail/import` | `"gmail_takeout_contacts"` | pre-allocated |

### 4.4 Platform syncs — run id from `runSyncWorkflow`

`runSyncWorkflow` already creates the run (`status: "running"`) **before** invoking the sync (`run-sync-workflow.ts:37`). Additive signature change:

```ts
syncFunction: (workflowRunId: string) => Promise<SyncResult>;
```

Existing closures ignore the argument and compile unchanged; the four contact-creating syncs (matrix rows 7–10) accept it and pass provenance into `createContact`. Rows 7–8 simultaneously get their missing child tag fixed — flag this in the PR description since it changes the `source` value written to new child rows on those paths (from the erroneous `api:create_contact` default to the correct sync tag).

---

## 5. RTX Run Lane (#153 → #161)

**Decision (ADR-161-4): explicit tool params carried by the brief — no implicit server-side context.** `invokeAgentTool(tool, input)` is stateless (`invoke.ts`), auth is localhost/bearer with no session→run binding (`auth.ts`), and the terminal agent is an out-of-process REST caller. The brief already prints both ids as its first lines (`template-brief.ts:51–52`: `Workflow run: ${id}` / `Template ID: ${id}`), so the ids are in the agent's context by construction.

Contract:

1. **`create_contact` gains optional params** (`agent-tools/schemas.ts`):
   ```ts
   workflowRunId: z.string().min(1).optional(),
   templateId: z.string().min(1).optional(),
   ```
2. **Server-side resolution in `handleCreateContact`:**
   - `workflowRunId` present → must exist in `workflow_runs`, else `VALIDATION_ERROR` `"Unknown workflowRunId: <id>"` (agent-friendly: retry without it). `templateId` omitted → **derived** from `run.templateId` (one indexed lookup).
   - `templateId` present (with or without run) → must exist in `workflow_templates`, else `VALIDATION_ERROR`.
   - Both omitted → contact is still (`agent`, `agent:create_contact`) with null ids — an agent working outside a template run.
3. **REST `POST /api/contacts` accepts the same optional fields** with identical validation/derivation, under the `api` (or `manual`) tag. Same for `POST /api/orgs`.
4. **Brief instruction line** — `template-brief.ts` adds one numbered instruction: *"When you create contacts or orgs via agent-tools, pass `workflowRunId` and `templateId` from this brief so Signals can attribute them to this run."* The `realtimex-signals` skill doc gets the matching note (follow-up, non-blocking).
5. The run-detail read path (§6.4) closes the loop: run → contacts created.

Rejected alternative — binding an invoke-envelope `context: { workflowRunId }` server-side: it would be the only stateful thing in the agent-tools surface, still requires the agent to echo the id (no session), and adds a second way to say the same thing. Revisit only if per-run bearer tokens ever exist.

---

## 6. Read / UX Contract

### 6.1 DTO & serializers

- `ContactDTO` (`queries/contact-dto.ts`, assembled in `contact-read-model.ts`) gains `createdSource`, `createdSourceDetail`, `createdWorkflowRunId`, `createdTemplateId` (all `| null`). They ride along in every REST response that returns the DTO.
- Agent tools: `get_contact` and `query_contacts` item serializers (`handlers.ts`) expose the same four keys. `Org` rows already serialize from `$inferSelect` — additive columns appear automatically in `GET /api/orgs*`.

### 6.2 List filters — `listContacts`, REST, `query_contacts`

`listContacts` opts (`contacts.ts:186`), `GET /api/contacts` query params, and `queryContactsSchema` all gain (ANDed with existing filters):

```ts
createdSource?: CreatedSource;
createdSourceDetail?: string;   // canonical tag, or unambiguous bare suffix (alias)
createdWorkflowRunId?: string;
createdTemplateId?: string;
minEnrichmentScore?: number;    // issue: "archive-only, low enrichment" briefs
maxEnrichmentScore?: number;
```

**Suffix alias rule:** a `createdSourceDetail` value without `":"` resolves against the registry: exactly one tag with that suffix → use it (`"x_archive"` → `"import:x_archive"`, satisfying the issue AC verbatim); multiple → validation error listing candidates (`"create_contact"` matches `manual:/api:/agent:create_contact` — the error names all three, same agent-friendly style as the `log_interaction` registry error); zero → no rows (exact match on the raw value, tolerating post-registry historical tags). Resolution is a pure registry function, unit-tested for suffix uniqueness of the shipped vocabulary.

Enrichment-score bounds are plain comparisons on `contacts.enrichment_score`. Example follow-up brief query:

```json
{ "tool": "query_contacts",
  "input": { "createdSourceDetail": "x_archive", "maxEnrichmentScore": 20, "sort": "enrichmentScore", "order": "asc" } }
```

### 6.3 Contact Details "Source" line

Rendered in `contact-detail-client.tsx` from DTO fields only (no extra query except the template-name lookup, which the detail API joins server-side as `createdTemplateName`):

- Render the line **only when `createdSource` is non-null** (pre-provenance contacts show nothing — no fake "Unknown").
- Copy rules, driven by display metadata in `creation-sources.ts`:
  - `manual` → `Added manually · {createdAt}`
  - `agent` + template → `{templateName} agent · run {runId≤8} · {createdAt}`; `agent` without template → `Agent (create_contact){ · run …}? · {createdAt}`
  - `import` → `{label} · run {runId≤8} · {createdAt}` with labels `X archive import` / `LinkedIn CSV import` / `Gmail Takeout import`
  - `sync` → `Synced from {platform label}` (`X`, `LinkedIn`, `Gmail`, `Mail scan`) `· {createdAt}`
  - `api` → `Created via API{ · run …}? · {createdAt}`
- The run fragment links to `/dashboard/workflows/{createdWorkflowRunId}`. If the run row no longer resolves, render the id as plain text — the birth record is immutable even when observability rows age out (§3.2 rule 5).
- Org detail gets the same line with the same rules (follow-up-sized; UI slice may land separately).

### 6.4 Workflow run detail — "Contacts created"

- New query `countContactsByCreatedWorkflowRun(runId)` (and the org twin) hitting `idx_contacts_created_run`.
- `GET /api/workflows/[id]` response gains `contactsCreated: number` (+ `orgsCreated`).
- Run detail page (`dashboard/workflows/[id]/page.tsx`) shows `Contacts created: N` linking to `/dashboard/contacts?createdWorkflowRunId={id}`; the contacts list client forwards the param. Template cards can later aggregate via `createdTemplateId` — out of scope here.

---

## 7. Backfill Algorithm

`src/lib/db/backfills/creation-provenance.ts`, wired into `instrumentation.ts` `register()` behind its own try/catch, after the existing backfills — the established idempotent-on-boot pattern. **Idempotent by construction:** every rule's WHERE includes `created_source IS NULL`, and the script only ever writes `NULL → value`; a second run is a no-op. Returns `{ byRule: Record<string, number>, skipped: number }` and logs once when non-zero.

Run attribution uses a **time-window match**: candidate `workflow_runs` of the expected `workflowType`/`importSubType` (from `config` JSON) where `contact.created_at BETWEEN run.started_at − 60 AND COALESCE(run.completed_at, run.started_at) + 60`. Exactly one candidate → link it; zero or multiple → leave the run id `NULL` (conservative; never guess).

Rules in priority order — first match wins per contact:

| # | Signal (contacts with `created_source IS NULL`) | Writes |
|---|---|---|
| C1 | `workflow_steps` row with `step_type = 'contact_create'` AND `contact_id = contacts.id` (legacy agent runs recorded per-contact steps; `schema.ts:547`) | (`agent`, `agent:create_contact`), `run = step.workflow_run_id`, `template = run.templateId` — the only rule that can recover ids exactly |
| C2 | X identity with `json_extract(platform_data,'$.source') = 'x_archive_import'` (`x/mappers.ts:205`) | (`import`, `import:x_archive`) + window-matched `x_archive_contacts` run |
| C3 | `follows`/`followed_by` edge with `source = 'import:x_archive'` touching the contact (catches stubs whose identity was later merged; `relationship-edges.ts`) | (`import`, `import:x_archive`) + window match |
| C4 | LinkedIn identity `platform_data.source = 'csv_import'` (`csv-import.ts:241`) OR child row `source = 'import:linkedin_csv'` created within ±60s of the contact | (`import`, `import:linkedin_csv`) + window-matched `linkedin_connections` run |
| C5 | child row `source = 'import:gmail_takeout'` within ±60s of birth | (`import`, `import:gmail_takeout`) + window-matched `gmail_takeout_contacts` run |
| C6 | earliest child row (channels ∪ employments, by `created_at`) has `source = 'agent:create_contact'` and sits within ±60s of the contact's `created_at` | (`agent`, `agent:create_contact`), run/template `NULL` — ids unrecoverable per issue |
| C7 | child row `source IN ('sync:gmail_contacts','sync:himalaya_correspondents')` within ±60s of birth | (`sync`, that tag), run `NULL` |
| C8 | `follows` edge `source = 'sync:x'` (or `connected_to` `source = 'sync:linkedin'`) with `first_seen_at` within ±60s of contact birth | (`sync`, `sync:x_contacts` / `sync:linkedin_contacts`), run `NULL` — best-effort; edges are also written on updates, hence the birth window |

Orgs (with `created_source IS NULL`), keyed off the existing `orgs.source` value:

| # | `orgs.source` | Writes |
|---|---|---|
| O1 | a registered creation tag (threaded child tags: `agent:create_contact`, `api:create_contact`, `import:linkedin_csv`, `sync:gmail_contacts`, …) | derive (`CREATION_TAGS[tag]`, tag); run/template `NULL` |
| O2 | `"ui"` | (`manual`, `manual:create_org`) |
| O3 | `"agent"` (bare — pre-#92 `ensureOrgByName` default) | (`agent`, `agent:create_contact`) |
| O4 | `"email_domain"` | (`sync`, `sync:himalaya_correspondents`) |
| O5 | `"backfill:%"` or `NULL` | stays `NULL` — reconstructed rows, origin unknowable |

**Documented gaps (accepted, listed in the run-once log and this spec):**

- Pre-provenance manual and external-REST contacts both carry `api:create_contact` child tags — indistinguishable; they stay `NULL`.
- X/LinkedIn live-sync contacts created before this change wrote **no** sync child tag (matrix rows 7–8 drift), so C8's edge heuristic is their only signal; contacts synced long ago whose edges were re-projected outside the birth window stay `NULL`.
- Agent-created contacts from the RTX lane before this change have no per-contact step rows → C6 sets the category but ids stay `NULL`.
- Multiple archive imports in one minute defeat the window match → category set, run `NULL`.

Tests: unit-test each rule on fixtures + a double-run idempotency assertion (pattern: `backfills/backfills.test.ts`).

---

## 8. API / Agent-Tools Compatibility Summary

All changes are additive; no existing param, response key, or tool name changes meaning.

| Surface | Additive change |
|---|---|
| `POST /api/contacts`, `POST /api/orgs` | optional `createdVia: "manual"`, `workflowRunId`, `templateId` (validated; template derived from run) |
| `PATCH /api/contacts/[id]`, org updates | 400 on any birth field (shared guard) — previously these keys were silently ignored, so no working client breaks |
| `GET /api/contacts` | new filter params (§6.2), forwarded to `listContacts` |
| `GET /api/workflows/[id]` | `contactsCreated`, `orgsCreated` |
| `create_contact` | optional `workflowRunId`, `templateId`; response gains the four birth keys |
| `update_contact` | rejects birth fields with `VALIDATION_ERROR` |
| `get_contact`, `query_contacts` | responses gain the four birth keys; `query_contacts` gains the six filter params |
| Serializers/DTO | `ContactDTO` + org rows expose birth fields; contact detail API adds `createdTemplateName` |
| `createWorkflowRun`, `recordImportRun`, `runSyncWorkflow`, `ensureOrgByName/ByDomain`, `createOrg`, `createContact` | optional-parameter widenings only (§4) |

---

## 9. ADRs

**ADR-161-1: Birth provenance as queryable columns, not `metadata` JSON.** Context: `contacts.metadata` already holds birth-adjacent flags (`archived`, `archiveWorkflowRunId`) queried via `json_extract` full scans. Decision: four typed columns + composite indexes on both tables; `metadata` stays for flags that are never filter dimensions. Alternatives rejected: validated metadata keys (unindexable at list-filter and run-count scale; no type safety in the DTO). Consequences: one additive migration; filters and the run-detail count are index hits; the enum lives in the column definition like `funnelStage`.

**ADR-161-2: Soft references for `createdWorkflowRunId` / `createdTemplateId`.** Context: `foreign_keys = ON`; file imports record runs after contact creation; birth fields must be immutable. Decision: plain indexed text columns, no `.references()` — precedent `parentWorkflowId` and `sourceTemplateId`; existence is validated in the write path exactly where an id crosses a trust boundary (agent/REST input), and trusted internal ids (pre-allocated import run ids, `runSyncWorkflow` ids) are stamped without a lookup. Alternatives rejected: enforced FK + restructuring imports to begin/finalize runs (touches every import route for no user-visible gain); FK with `ON DELETE SET NULL` (a future run-retention sweep would silently mutate immutable birth records). Consequences: reads must tolerate dangling ids (§6.3); integrity is write-path + convention, matching `graph_edges.parent_id` (schema-v0.5 §4 rule 7).

**ADR-161-3: One tag registry; `createdSourceDetail` = the canonical child-source tag; category derived from prefix.** Context: child `source` vocabulary already exists and the issue demands alignment; bare suffixes collide across categories. Decision: the tag written to child rows *is* the birth detail; `CREATION_TAGS` maps tag → category; filters resolve unambiguous bare suffixes as aliases. Alternatives rejected: bare-suffix storage (collisions; two vocabularies to keep aligned); free-text detail (drift guaranteed). Consequences: zero drift by construction; two new tags (`manual:create_contact`, `manual:create_org`) enter the shared vocabulary; the X/LinkedIn sync paths must finally pass their tag (a bug fix this design forces into the open).

**ADR-161-4: Run context flows as explicit params carried by the brief, not implicit server-side context.** Context: §5. Decision: brief already prints the ids; `create_contact`/REST accept and validate them; template derived from run when omitted. Alternatives rejected: invoke-envelope context binding (stateless API would grow session semantics for one field pair); parsing thread metadata server-side (couples Signals to RTX transport). Consequences: attribution is opt-in per call — acceptable for v1 and observable (run detail shows what was attributed); a per-run bearer token could make it automatic later without changing the schema.

**ADR-161-5: Manual vs API discrimination via a UI-sent `createdVia` field.** Context: the dialog and external callers share one route. Decision: `createdVia: "manual"` from Signals UI dialogs; default `api`. Alternatives rejected: separate internal route (duplicate validation stack); header sniffing (fragile). Consequences: honor-system in a localhost-auth single-user app; worst case a mislabelled `manual`/`api` — never a wrong `import`/`sync`/`agent`.

---

## 10. Acceptance Matrix

| Issue AC | Testable assertion | Where |
|---|---|---|
| Archive zip → `createdSource=import`, detail `x_archive`, run id set | POST an archive fixture; created contact has (`import`, `import:x_archive`, `createdWorkflowRunId = contactsRunId` returned by the route) and org-less stubs stay clean | route/integration test beside `archive-import` tests |
| Agent `create_contact` with run context → agent + run/template ids | `handleCreateContact({ …, workflowRunId })` → row has (`agent`, `agent:create_contact`), run id, template derived from run; unknown run id → `VALIDATION_ERROR` | `agent-tools` handler tests |
| Org created in same transaction inherits birth provenance | `handleCreateContact` with `employments: [{ orgName: "NewCo" }]` + run id → new org row carries identical four values; pre-existing org untouched | handler + `orgs.ts` tests |
| `query_contacts` filters by `createdSourceDetail=x_archive` | alias resolves to `import:x_archive`; returns only archive contacts; ambiguous suffix `create_contact` errors listing candidates; `maxEnrichmentScore` combo narrows | `query_contacts` handler tests |
| Contact detail shows human-readable source | DTO exposes fields + `createdTemplateName`; detail renders per §6.3 copy rules; no line when `NULL` | component/e2e smoke |
| Immutability | PATCH `/api/contacts/[id]` and `update_contact` naming any birth field → 400/`VALIDATION_ERROR`; `updateContact()` strips them defensively | route + query-layer tests |
| Backfill idempotent + gaps explicit | rules C1–C8/O1–O5 on fixtures; second run writes 0; `NULL`-gap cases stay `NULL` | `backfills/creation-provenance.test.ts` |
| Sync drift fix | X/LinkedIn sync-created contacts get (`sync`, `sync:x_contacts`/`sync:linkedin_contacts`) + run id; child rows now tagged | sync tests |
| `npm run check` passes; migration additive only | `0026_*.sql` contains only `ALTER TABLE … ADD COLUMN` + `CREATE INDEX`; empty-DB + upgraded-DB migration tests green | CI / `db:migrate` |

### Suggested implementation slicing (each PR-able, in order)

1. **DDL + registry + choke-point widening** — migration `0026`, `creation-sources.ts`, `createContact`/`createOrg`/`ensureOrg*` provenance params, immutability guards, DTO fields. (Everything else compiles unchanged.)
2. **Write paths** — matrix rows 1–11: dialog `createdVia`, REST fields, agent-tool params + brief line, import run-id pre-allocation, `runSyncWorkflow` run-id threading (includes the sync-tag drift fix).
3. **Read paths** — list filters (query layer + REST + `query_contacts`), Source line, run-detail count.
4. **Backfill** — script + instrumentation wiring + tests.
