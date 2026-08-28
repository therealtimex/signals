# Company Intelligence — System Design for Signals #335 (#339 → #338 → #337 → #336)

**Status:** Proposed → route `system_design.approved` to Dev (schema boundary must be confirmed by the owner before `db:generate`; see §9)
**Date:** 2026-08-28
**Loop:** `loop-issue-335-6d249e06` · shared branch `issue-335` (worktree not yet created — see §11.1)
**Base inspected:** `/Users/realtimex/github/signals` @ `main` `4d807b0`
**Land this doc as:** `specs/company-intelligence.md` (first commit of PR-1)
**Aligned to:** `specs/schema-v0.5.md` §4 migration rules · `specs/contact-golden-record.md` (ADR-092-1/2/6) · `specs/contact-org-creation-provenance.md` (ADR-161-1/2) · `specs/persona-generation-mode.md` (config-flag + owner-confirms-migration precedent) · `AGENTS.md` §2, §4, §8, §10

---

## 0. Decisions at a glance

| ADR | Decision | Reversibility |
|---|---|---|
| **335-1** | One consolidated, additive, nullable-only migration for the whole epic (7 column adds on `orgs`, 1 on `tasks`, 4 new tables). Generated once in PR-1 after owner confirmation. | High — every column/table is nullable/defaulted; dropping the overlay loses nothing pre-existing |
| **335-2** | Relationship strength is **derived on read** from explainable inputs (manual warmth, recency, frequency, reciprocity, network connection). Never stored; manual `weight` stays the user's rating, not overwritten. | High — pure function, no schema |
| **335-3** | "Strongest introduction path" is an in-process ≤2-hop search over `graph_edges` from the owner (`isSelf`) contact. Snowball Network is the *discovery* action when no path exists. No path persistence. | High |
| **335-4** | Predicted addresses live in a new `contact_email_candidates` table and **never** become `contact_channels` rows until verified (promotion is the only path). Automation eligibility is a single query-layer predicate, default-deny for predictions, opt-in via `config.json`. | Medium — table is additive; the predicate is the enforcement point |
| **335-5** | No external enrichment/email provider. Verification = in-process `syntax` + `dns_mx` (always) + `smtp_rcpt` (config-gated, default **off**) + `manual`/`agent` evidence. Catch-all is `unknown` unless SMTP probing is enabled. | High — provider port; providers are swappable |
| **335-6** | Org-level events live in a new contactless `org_activities` log (mirrors `content_activities`, ADR-022-8). The company feed is a SQL `UNION ALL` of `org_activities` + member `interactions`, ordered by `occurred_at`, deduplicated by a unique `dedupe_key`. | High |
| **335-7** | Company enrichment and company signal ingestion are **seeded RTX agent workflow templates** (like Network Snowball) writing back through new agent tools. "Partial provider" = workflow-run outcome. | High |
| **335-8** | **Lists are deferred.** No lists entity exists anywhere in Signals; company `tags` provide grouping. Flagged to the owner as a scope deviation on #336. | Low cost to add later |
| **335-9** | User-facing term is **Company** (sidebar "Companies", page copy). Routes (`/dashboard/organizations`), tables (`orgs`), and API paths (`/api/orgs`) are unchanged. `orgType` badge still shows Fund/Team/Community. | Copy-only |
| **335-10** | "Account owner" = `orgs.owner_contact_id` → a contact with `isSelf = true`. There is no users table; this is the only identity Signals has, and it is forward-compatible with multi-user. | High |
| **335-11** | New org tools stay in agent-tool category `graph` (no `orgs` category) to avoid OpenAPI/CLI grouping churn. Every new capability is a **new tool**; existing tool schemas gain only additive optional params/keys (schema-v0.5 §4 rule 3). | High |
| **335-12** | New org routes use `toErrorResponse` (`src/lib/api/errors.ts`, `{error, code, details?}`); existing org routes are left as-is (no churn). | — |

**Confirmation boundaries required (exact):** schema (§9.1) — **yes, one migration**. New dependencies — **none**. Auth/credential changes — **none** (`src/lib/auth/` untouched; new tools use the existing `authorizeAgentToolRequest`). CI changes — **none**. Broad refactors — **none** (one extraction: the timeline list renderer out of `contact-timeline-tab.tsx`, behavior-preserving). New `src/lib/` folders — `src/lib/orgs/` and `src/lib/contacts/email-patterns/`, `src/lib/contacts/email-verification/` (called out per AGENTS.md §5 "browse before adding").

---

## 1. What exists today (the substrate)

Everything below was verified against `main @ 4d807b0`; file:line refs are for Dev to jump to.

| Concern | Exists | Missing |
|---|---|---|
| Org record | `orgs` (`schema.ts:855`): `name, orgType, domain (UNIQUE), website, description, location, avatarUrl, enrichmentScore, scope, metadata (JSON, **never read/written**), source (legacy free text), created{Source,SourceDetail,WorkflowRunId,TemplateId}` | industry, size, tags, owner, stage, follow, feed-seen |
| Org write path | `createOrg` / `ensureOrgByName` / `ensureOrgByDomain` (`queries/orgs.ts:161,198,232`) — name dedupe is an in-memory full scan; `createOrg` silently drops caller fields when a same-name org exists | **no `updateOrg`**, no `PATCH /api/orgs/[id]`, no edit UI, no `update_org` tool |
| Domain handling | `normalizeOrgWebsiteUrl` (`org-website.ts`); `ensureOrgByDomain` does `trim().toLowerCase()` only; `POST /api/orgs` does **not** normalize `domain` | domain normalizer, alias table, `www.`/scheme stripping |
| Provenance | `CREATION_TAGS` + `CREATION_TAG_LABELS` + `formatContactSourceLine` (`creation-sources.ts`), immutability guard (`creation-provenance-input.ts:75`), birth columns already on `orgs` | org page renders legacy `org.source` raw (`organization-detail-client.tsx:108`); no `agent:create_org` tag; `AddOrganizationDialog` omits `createdVia:"manual"` (mis-tags as `api:create_org`) |
| Socials | `org_identities` + `org_identity_metrics` (`schema.ts:916,950`), tools `query_org_identities`/`upsert_org_identity` | header rendering |
| People link | `contact_employments` is source of truth (ADR-092-2); `works_at` edges are a projection (`employment-works-at-projection.ts:53`); `listOrgLinkedContacts` reads the projection (`orgs.ts:130`) | link/unlink API/UI/tool on the org side; `upsert_edge` bypasses employments and gets clobbered by re-projection |
| Strength | manual 0–100 `weight` on owner→contact `relationship` edge (`contact-relationship.ts`, `contact-relationship-section.tsx`) | any derived score, any explanation, any org rollup |
| Paths | `getNeighbors` 1-hop (`graph.ts:182`); `explore-map.ts` owner-adjacency | multi-hop, path entity |
| Snowball | template launcher → RTX agent (`network-snowball.ts`, `snowball-dialog.tsx`); `seedType:"org_id"` takes the **name** (label "Organization Name") | run ↔ org linkage in config (`workflow-run-subjects.ts:29` already reads `config.orgId`) |
| Email | `contact_channels` (`schema.ts:189`): `value, valueNormalized, isPrimary, isVerified (manual Switch), source, metadata`; primary resolution `isPrimary → isVerified → createdAt` | pattern inference, candidates, statuses, MX/catch-all, any verification code |
| Name normalization | `normalizePersonName`, `orgNameKey`, `isRoleAccountEmail` (`contacts/dedupe/normalize.ts`) | first/last split, particles, initials |
| Sending | **Signals cannot send email today** (Himalaya = read-only CLI). Dormant `workflow_enrollments` + `stepType:"message"` schema has no runner | recipient-eligibility gate (must exist *before* any runner) |
| Activity | `interactions` (`schema.ts:1258`) with `orgId` (written, indexed, **never read**), `occurredAt` vs `createdAt`, `INTERACTION_TYPE_GROUPS` incl. `note`; `listContactTimeline` unions `interactions` ∪ `content_activities` in memory (N+1 attachments) | org-scoped reader, org-level events, signal taxonomy, follow, seen |
| Tasks | `tasks.relatedContactId` only; `create_task` tool; `AddTaskDialog` | `relatedOrgId` |
| Lists | nothing | — (deferred, ADR-335-8) |
| Auth | agent-tools: localhost bypass or `SIGNALS_AGENT_TOOL_TOKEN` bearer (`agent-tools/auth.ts`); dashboard REST routes: **no auth**; privacy axis `scope: shared|local_only` with `includeLocalOnly=false` default | no user/role model — "permission-denied" in this app means agent-tool 401/403 and privacy-scope exclusion |
| Tabs | URL-synced helper `settings-tabs.ts` (copy this) | org page has no tabs |
| Tests/gate | Vitest projects by suffix; `npm run check`; OpenAPI byte-gate; `.evidence/` naming | tests for `snowball-dialog`, `organization-detail-client`, `/api/orgs/[id]/contacts`, tasks |

---

## 2. Page architecture and terminology

### 2.1 Route and tabs
`/dashboard/organizations/[id]?tab=overview|people|signals|activity|notes` — URL-synced via `src/app/dashboard/organizations/organization-tabs.ts` cloned from `settings-tabs.ts` (`VALID_ORG_TABS`, `parseOrgTab`, `orgTabHref`, `navigateOrgTab`). `TabsList variant="line"`. Tab labels carry counts where cheap (`People (12)`, `Signals (3 new)`).

| Tab | Content | Phase |
|---|---|---|
| **Overview** | Company header (§3.3) · Profile card with empty-state CTAs · Relationship overview card · Email intelligence card (summary) · Recent signals (3) · Next actions (open tasks for the company) | 1, 2, 3, 4 |
| **People** | Expanded people table + filters/sort + Link person + Generate emails | 2, 3 |
| **Signals** | External signal feed (`category = signal`), Follow toggle, Scan now, stale/partial banners | 4 |
| **Activity** | Workspace activity (`category = workspace` + member interactions), actor chips | 4 |
| **Notes** | Company notes composer + list (`org_activities.activity_type = "note"`) | 4 |

Overview is the only tab rendered server-side with data; other tabs fetch on activation (`useEffect` + `fetch`, pattern from `contact-timeline-tab.tsx`).

### 2.2 Terminology (ADR-335-9)
User-facing: **Company / Companies** everywhere on this page, in `AddOrganizationDialog` title, `OrgPicker` label, and `app-sidebar.tsx:40` (`title: "Companies"`). Keep route/table/API names. Non-company `orgType` values render as a secondary badge (Fund, Team, Community, Other).

### 2.3 Header (Phase 1)
Logo (`avatarUrl`, fallback initials) · Name · `orgType` badge (non-company only) · Stage badge · Owner chip · Domain (link `https://{domain}`) · Website · Social icons from `org_identities` · Tags · Provenance line ("Manually added · 3 days ago", `ProvenanceLine` §4.5) · Actions: **Edit**, **Enrich company**, overflow: Snowball Network, Follow, Add task, Add note, Start workflow.

---

## 3. Data model — one consolidated migration (ADR-335-1)

All DDL is additive and nullable/defaulted (schema-v0.5 §4 rules 1, 5, 8). Generated **once** with `npm run db:generate` in PR-1 after owner confirmation. Tables unused until later phases are harmless and keep later PRs schema-free (Review/QA only see behavior diffs).

### 3.1 `orgs` — 7 new columns
```ts
industry: text("industry"),
companySize: text("company_size", { enum: COMPANY_SIZE_ENUM }),   // "1-10"|"11-50"|"51-200"|"201-500"|"501-1000"|"1001-5000"|"5001-10000"|"10001+"
tags: text("tags").default("[]"),                                  // JSON string[] — same shape as contacts.tags
ownerContactId: text("owner_contact_id").references(() => contacts.id, { onDelete: "set null" }),
accountStage: text("account_stage", { enum: ["prospect","engaged","qualified","opportunity","customer","advocate"] }), // nullable = not set (distinct from contacts' default)
followedAt: integer("followed_at"),      // null = not following
feedSeenAt: integer("feed_seen_at"),     // read/unread watermark for the company feed
```
Indexes: `idx_orgs_account_stage(account_stage)`, `idx_orgs_owner(owner_contact_id)`, `idx_orgs_followed(followed_at)`.
`location` is reused as **Headquarters** (label change only). `avatarUrl` is reused as **Logo**. Socials = `org_identities` (no new columns). Per-field provenance and enrichment run state go in the existing, unused `orgs.metadata` JSON (§4.4) — display-only data, not filtered, so JSON is right (ADR-161-1 rationale applies only to indexed equality).

### 3.2 `org_domains` (canonical + aliases, mail-domain status)
```ts
export const orgDomains = sqliteTable("org_domains", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),                 // normalized (§4.2)
  kind: text("kind", { enum: ["primary", "alias"] }).notNull().default("alias"),
  source: text("source").notNull(),                 // "manual:update_org" | "agent:update_org" | "api:update_org" | "derived:email_domain" | "backfill:orgs-domain"
  mxStatus: text("mx_status", { enum: ["ok", "none", "error", "unknown"] }).notNull().default("unknown"),
  catchAll: text("catch_all", { enum: ["yes", "no", "unknown"] }).notNull().default("unknown"),
  mailCheckedAt: integer("mail_checked_at"),
  mailEvidence: text("mail_evidence").default("{}"), // JSON: { mxHosts, probeMethod, probeDetail }
  ...timestamps,
}, (t) => [ uniqueIndex("idx_org_domains_domain").on(t.domain), index("idx_org_domains_org").on(t.orgId) ]);
```
`orgs.domain` remains the canonical projection (kept in lockstep by `updateOrg`; exactly one `kind="primary"` row per org). Backfill `backfill-org-domains` (idempotent, `INSERT OR IGNORE`, `source="backfill:orgs-domain"`) creates primary rows from existing `orgs.domain`.

### 3.3 `org_email_patterns`
```ts
export const orgEmailPatterns = sqliteTable("org_email_patterns", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),               // "{first}.{last}" — grammar §6.2
  rank: integer("rank").notNull(),                  // 1 = primary
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
  score: real("score").notNull(),                   // matches / samples, 0..1
  matchCount: integer("match_count").notNull().default(0),
  sampleCount: integer("sample_count").notNull().default(0),
  evidence: text("evidence").default("[]"),         // JSON EvidenceItem[] (§6.3) — contact ids + which template matched, or agent-supplied URL
  isSelected: integer("is_selected", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(),                 // "inferred" | "manual:override" | "agent:evidence"
  evaluatedAt: integer("evaluated_at").notNull(),
  ...timestamps,
}, (t) => [ uniqueIndex("idx_org_email_patterns_org_pattern").on(t.orgId, t.pattern), index("idx_org_email_patterns_org_rank").on(t.orgId, t.rank) ]);
```

### 3.4 `contact_email_candidates` (ADR-335-4)
```ts
export const contactEmailCandidates = sqliteTable("contact_email_candidates", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  addressNormalized: text("address_normalized").notNull(),   // normalizeChannelValue("email", …) — trim+lowercase, no plus-tag stripping (ADR-092-6)
  pattern: text("pattern"),                                  // null when user-corrected free-form
  status: text("status", { enum: ["predicted", "uncertain", "verified", "invalid"] }).notNull().default("predicted"),
  confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
  evidence: text("evidence").default("{}"),                  // JSON CandidateEvidence (§6.5)
  source: text("source").notNull(),                          // "enrich:email_pattern" | "manual:correct_email" | "agent:email_evidence"
  verificationMethod: text("verification_method"),           // "manual" | "agent" | "smtp_rcpt" | "dns_mx" | "syntax" | null
  verifiedAt: integer("verified_at"),
  checkedAt: integer("checked_at"),
  probeAttempts: integer("probe_attempts").notNull().default(0),
  promotedChannelId: text("promoted_channel_id"),            // soft ref → contact_channels.id once verified
  ...timestamps,
}, (t) => [ uniqueIndex("idx_email_candidates_contact_address").on(t.contactId, t.addressNormalized), index("idx_email_candidates_org_status").on(t.orgId, t.status) ]);
```

### 3.5 `org_activities` (ADR-335-6)
```ts
export const orgActivities = sqliteTable("org_activities", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),  // affected person, optional
  activityType: text("activity_type").notNull(),           // registry §7.1
  title: text("title").notNull(),
  summary: text("summary"),
  whyItMatters: text("why_it_matters"),
  recommendedAction: text("recommended_action").default("{}"), // JSON { kind, label, href?, contactId? }
  url: text("url"),
  occurredAt: integer("occurred_at").notNull(),
  actor: text("actor", { enum: ["user", "agent", "system", "sync"] }).notNull(),
  source: text("source").notNull(),                        // provenance tag (registry) — never primary UI
  workflowRunId: text("workflow_run_id"),                  // soft ref (ADR-161-2)
  dedupeKey: text("dedupe_key").notNull(),
  scope: text("scope", { enum: ["shared", "local_only"] }).notNull().default("shared"),
  metadata: text("metadata").default("{}"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),   // = ingestion time
}, (t) => [ uniqueIndex("idx_org_activities_dedupe").on(t.dedupeKey), index("idx_org_activities_org_time").on(t.orgId, t.occurredAt) ]);
```

### 3.6 `tasks` — 1 new column
```ts
relatedOrgId: text("related_org_id").references(() => orgs.id, { onDelete: "set null" }),
```
+ `index("idx_tasks_related_org").on(t.relatedOrgId)`.

### 3.7 Explicitly **not** changed
`interactions.contactId` stays NOT NULL (relaxing it is a table rebuild and breaks N-1; org-only events go to `org_activities`). `contact_channels` unchanged (predictions never live there). No `lists` tables (ADR-335-8). `orgs.source` legacy column untouched (label-mapped at read time). `resetCoreTables()` in `src/test/db.ts` gains the four new tables (children first).

### 3.8 Migration proof
`src/lib/db/migrate-company-intelligence.test.ts` following `migrate-platform-handle-sigil.test.ts`: replay the shipped `00NN_*.sql` statement-by-statement on an N-1 DB, assert `columnExists`/`tableExists`, assert idempotent re-run, assert N-1 reads (`getOrgById`, `listOrgLinkedContacts`) still work. Plus `rm -rf $SIGNALS_DATA_DIR && npm run db:migrate` fresh-dir proof.

---

## 4. Phase 1 — #339 Editable & enrichable company foundation

### 4.1 Query layer (`src/lib/db/queries/orgs.ts` + new `src/lib/orgs/`)
- `updateOrg(id, patch: OrgUpdateInput, provenance: OrgWriteProvenance): Org` — the single update choke point. Strips/rejects birth fields (reuse `getImmutableBirthFieldsError`). Normalizes `domain` (§4.2) and `website`; on domain change: `409 CONFLICT` if another org owns it (`org_domains` unique), else upserts the `kind="primary"` row and demotes the previous primary to `alias` (aliases are how old domains keep resolving). Writes per-field provenance into `metadata.fieldProvenance` (§4.4). Bumps `updatedAt`.
- `getOrgDTO(id): OrgDTO | undefined` (serializer `src/lib/serializers/org.ts`, shared by route **and** tools — the `ui-4.1-rest-api.md` rule): raw `Org` columns **plus** `tags: string[]`, `domains: {domain, kind}[]`, `identities: OrgIdentitySummary[]`, `owner: {contactId, name} | null`, `provenance: ProvenanceSummary` (§4.5), `fieldProvenance: Record<field, FieldProvenance>`, `enrichment: EnrichmentState` (§4.6), `completeness: {score, missing: string[]}`.
- `recalcOrgEnrichment(orgId)` — org analogue of `contact-enrichment-recalc.ts`: 0–100 from presence of domain, website, description, industry, size, HQ, logo, ≥1 identity, ≥1 linked person, owner, stage. Writes `orgs.enrichmentScore` (currently never written). Called after every `updateOrg`/identity/employment mutation.
- Fix while here (in the same seam, no behavior change for callers): `createOrg` — when a same-name org exists, **apply** caller-provided `domain/website/description/location` if the existing values are null, and use an indexed lookup by `orgDedupeKey` instead of loading all rows (`orgs.name` index + `lower()`; or add nothing and keep scan — Dev's call, but the silent-drop must go).
- `CREATION_TAGS` additions (`creation-sources.ts`): `"agent:create_org": "agent"`, plus write-tag vocabulary for field provenance: `manual:update_org`, `api:update_org`, `agent:update_org`, `agent:enrich_org`. `AddOrganizationDialog` sends `createdVia:"manual"` (bug fix).

### 4.2 Domain normalization — `src/lib/orgs/domain.ts`
```ts
export type NormalizeDomainResult =
  | { ok: true; domain: string }
  | { ok: false; code: "EMPTY" | "INVALID_HOSTNAME" | "NO_TLD" | "IP_ADDRESS" | "LOCAL"; message: string };
export function normalizeOrgDomain(raw: string | null | undefined): NormalizeDomainResult
```
Rules (deterministic, table-tested): trim → if empty `EMPTY` → prefix `https://` when no scheme → `new URL()` → take `hostname` (handles credentials, port, path, query, IDN→punycode) → lowercase → strip exactly one leading `www.` → reject IPv4/IPv6 (`IP_ADDRESS`), `localhost`/single-label (`LOCAL`/`NO_TLD`), labels not matching `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, TLD shorter than 2 (`INVALID_HOSTNAME`). **No eTLD+1 collapsing** (needs a public-suffix list = new dependency; documented limitation — `mail.acme.com` and `acme.com` are distinct; aliases cover it). Messages are user-facing: *"Enter a bare domain like acme.com — no http://, paths, or ports."*
`ensureOrgByDomain` and `POST /api/orgs` route through this. `resolveOrgByDomain(domain)` consults `org_domains` (aliases) before `orgs.domain`.

### 4.3 REST
| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/orgs/[id]` | — | `OrgDTO` (additive superset of today's raw `Org`) |
| **PATCH** | `/api/orgs/[id]` | `{ name?, orgType?, domain?, website?, description?, location?, industry?, companySize?, tags?: string[], ownerContactId?: string\|null, accountStage?: string\|null, avatarUrl?: string\|null }` (zod; `avatarUrl` http(s) only, no `file://`) | `200 OrgDTO` · `400 VALIDATION_ERROR` (details = zod flatten or `{field:"domain", code}`) · `400` birth fields ("creation provenance is immutable") · `404 NOT_FOUND` · `409 CONFLICT {details:{domain, orgId}}` |
| **POST** | `/api/orgs/[id]/enrich` | `{}` | `202 { workflowRunId, threadPath? }` — starts the "Company Profile Enrichment" template via `runTemplateViaRtx({ config: { orgId } })`; `409 CONFLICT code:"ENRICHMENT_IN_PROGRESS"` if a run for this org is `pending|running`; `503 RTX_UNAVAILABLE` when not embedded (UI shows "Enrichment needs RealTimeX") |
| GET | `/api/orgs/[id]/enrichment` | — | `EnrichmentState` (§4.6) — polled by the UI every 5 s while pending |
| GET | `/api/orgs` | + `stage`, `owner`, `followed`, `tag` filters | `{data: OrgListRow[], total}` (additive) |
Owner validation: `ownerContactId` must reference a contact with `isSelf=true` else `400 VALIDATION_ERROR {field:"ownerContactId"}`.

### 4.4 Field provenance (in `orgs.metadata`)
```ts
type FieldProvenance = { source: "manual" | "agent" | "import" | "sync" | "api" | "derived"; tag: string; at: number; workflowRunId?: string; evidenceUrl?: string };
metadata.fieldProvenance = { industry: {...}, companySize: {...}, description: {...}, ... }
metadata.enrichment = { lastRunId, lastRunAt, status: "pending"|"succeeded"|"partial"|"failed", fieldsUpdated: string[], unresolvedFields: string[], message? }
```
Every `updateOrg` call records provenance for exactly the fields it touched. Readers never render `tag` as primary UI.

### 4.5 Human-readable provenance — `src/lib/orgs/provenance.ts` + `<ProvenanceLine>` component
Generalize `formatContactSourceLine`/`<ContactSourceLine>` (contact-specific copy) into an entity-agnostic `formatProvenanceLine({createdSource, createdSourceDetail, legacySource, createdWorkflowRunId, createdTemplateId, createdAt})`:

| Input | Primary label |
|---|---|
| `createdSource=manual` or legacy `ui` | Manually added |
| `import` | Imported (X archive / LinkedIn CSV / Gmail Takeout — from tag label) |
| `sync` | Synced from {platform} |
| `agent` / legacy `agent`, `agent:*` | Agent added |
| `api` | Added via API |
| legacy `email_domain` | Derived from an email domain |
| legacy `backfill:*` | Derived from contact records |
| null/unknown | Source unknown |
Field-level: Manually edited · Agent enriched · Imported · Updated via API · Derived. Raw tag, run link ("View run"), and template appear in a "Details" popover/secondary line only. **AC gate:** `organization-detail-client.tsx:108` raw `org.source` is removed; a test asserts no string matching `/^(agent|api|manual|sync|import|backfill):/` is rendered in primary text.

### 4.6 Enrichment — "Company Profile Enrichment" seeded template (ADR-335-7)
`seed-templates.ts` entry: `templateType:"enrichment"`, `workflowType:"agent"`, `config: { companyEnrichment: { version: 1 } }`, brief: resolve `config.orgId` via `get_org`; visit website (use `routeUrl` strategy), LinkedIn company page / X profile when an `org_identities` row exists, Crunchbase/Wikipedia when static; **only write what you can cite** (`docs/rtx-agent-browser-enrichment.md` norm); call `update_org` with `fieldSources` per field and `evidenceUrl`; call `upsert_org_identity` for socials; report `unresolvedFields`; finish with `complete_workflow_run`. Never guess a logo — use `og:image`/site icon only if it returns HTTP 200.
`EnrichmentState` is derived: run `pending|running` → **pending**; `completed` with `fieldsUpdated.length>0` and `unresolvedFields.length===0` → **succeeded**; `completed` with both non-empty or `errors.length>0` → **partial** (UI lists which fields are still missing with Edit CTA); `failed|cancelled` → **failed** (UI: message + Retry). Manual edits are never blocked by a pending run; an agent write does **not** overwrite a field whose provenance is `manual` newer than the run start (fill-gaps rule from `enrich-contact.ts`).

### 4.7 Agent tools (category `graph`)
| Tool | Input | Output |
|---|---|---|
| `get_org` | `{ orgId? , domain? }` (one required) | `OrgDTO` |
| `create_org` | `{ name, orgType?, domain?, website?, description?, location?, industry?, companySize?, tags?, workflowRunId?, templateId? }` | `OrgDTO` (tag `agent:create_org`) |
| `update_org` | `{ orgId, ...PATCH fields, fieldSources?: Record<field,{evidenceUrl?}>, workflowRunId? }` | `{ org: OrgDTO, fieldsUpdated: string[] }` (tag `agent:update_org` or `agent:enrich_org` when `workflowRunId` set) |
`query_orgs` result rows gain additive keys `website, industry, companySize, accountStage, ownerContactId, tags, enrichmentScore`. Enrichment is *started* by the existing `start_workflow` tool (`templateId` of the seeded template, `config.orgId`) — no new tool; the REST `/enrich` route calls the same `runTemplateViaRtx`.

### 4.8 UI
- `organization-header.tsx`, `edit-organization-dialog.tsx` (all §4.3 fields; domain field validates inline with the normalizer's message; tags input like contact form; owner select lists `isSelf` contacts with "Assign to me" when exactly one), `organization-profile-card.tsx` (each missing field = muted label + inline **Add** (opens dialog on that field) or **Enrich** CTA — never a bare dash), `provenance-line.tsx`, `enrich-company-button.tsx` (states: idle / pending spinner / succeeded toast via `ActionToast` / partial banner / failed banner + retry / unavailable tooltip).
- Sparse state: header still renders name + actions; profile card shows a single "This company is mostly empty — Enrich company or fill in the basics" `EmptyState` when ≥6 of the tracked fields are missing.
- Dark mode: semantic tokens only (no `dark:`). Mobile: header stacks, actions collapse into overflow. Keyboard: dialog focus trap (shadcn), all actions are `<Button>`s.

### 4.9 Tests
`orgs/domain.test.ts` (table: `Acme.com`, `https://www.Acme.com/about?x=1`, `mail.acme.com`, `acme` → NO_TLD, `10.0.0.1` → IP, `xn--` IDN, `localhost`) · `queries/orgs.test.ts` (updateOrg persistence, immutability rejection, domain conflict 409 semantics, primary→alias demotion, fieldProvenance written, enrichmentScore recalculated) · `api/orgs/[id]/route.test.ts` (PATCH happy/400/404/409) · `api/orgs/[id]/enrich/route.test.ts` (202, 409 in-progress, 503 not embedded — mock `runTemplateViaRtx`) · `agent-tools/org-handlers.test.ts` (get/create/update + auth 401/403 via `invoke` route like `import-contract.test.ts`) · `orgs/provenance.test.ts` (label table incl. legacy values) · `components/organization-profile-card.test.ts` (SSR: sparse shows CTAs, no `—`; populated shows values; no raw tag in primary text) · `edit-organization-dialog.test.ts` (happy-dom: domain validation message) · migration test §3.8.

### 4.10 Proof observables (#339)
1. `PATCH /api/orgs/:id {industry:"Fintech", domain:"https://www.Acme.com/"}` → row `industry="Fintech"`, `domain="acme.com"`, `org_domains` primary row `acme.com`; reload shows both; `get_org` returns identical values.
2. `PATCH` with `domain:"acme"` → `400 {code:"VALIDATION_ERROR", details:{field:"domain", code:"NO_TLD"}}`; dialog shows the same message inline.
3. Sparse org page: zero `—` glyphs in the profile card; ≥1 "Add"/"Enrich" CTA per missing field (SSR test + screenshot).
4. Org created via `agent:create_contact` path renders "Agent added" (and `agent:create_contact` only inside Details popover).
5. `POST /enrich` → `202` + run row; UI badge "Enriching…" → after `complete_workflow_run` with `unresolvedFields:["companySize"]` → "Partially enriched — Company size still missing" + Edit CTA.
6. `.evidence/{before,after}_company-sparse_{desktop,mobile}_{light,dark}.png` and `…_company-populated_….png` (8 + 8).

---

## 5. Phase 2 — #338 Relationship overview & people management

### 5.1 Relationship strength (ADR-335-2) — `src/lib/graph/relationship-strength.ts`
Pure, deterministic, table-tested. Inputs are gathered per linked contact **C** relative to owner **O** = `getOwnerContactId()`:

| Component key | Label (UI) | Value 0–100 | Weight |
|---|---|---|---|
| `warmth` | Your rating | manual `relationship` edge `weight` (owner↔C), if set | 0.40 |
| `recency` | Recent contact | days since last **communication-category** or `isMeaningful` interaction: ≤7 → 100, ≤30 → 80, ≤90 → 50, ≤365 → 20, else/none → 0 | 0.25 |
| `frequency` | Interaction frequency | communication interactions in last 180 d, capped at 10, ×10 | 0.15 |
| `reciprocity` | They reach out | any `direction="inbound"` interaction in last 180 d → 100 else 0 | 0.10 |
| `connection` | Network connection | `connected_to` edge with O → 100; mutual `follows` → 70; single `follows` → 40; none → 0 | 0.10 |
`score = Σ(w_i·v_i)/Σ(w_i)` over **present** components only (a missing `warmth` renormalizes rather than penalizes). Bands: no inputs at all → `unknown` ("No data yet"); 1–29 `weak`; 30–59 `moderate`; 60–100 `strong`. Output:
```ts
type RelationshipStrength = { score: number | null; band: "unknown"|"weak"|"moderate"|"strong"; components: { key, label, value, weight, detail }[]; computedAt: number };
```
`detail` is a human sentence ("Last meaningful interaction 12 days ago", "You rated this relationship 70/100"). The `<StrengthBadge>` opens a popover listing components — this is the "accessible explanation" AC. Manual warmth continues to be edited on the contact page; the org page never writes it.

### 5.2 Introduction paths (ADR-335-3) — `src/lib/graph/intro-paths.ts`
```ts
type IntroPath = { target: {contactId, name, title}, via: {contactId, name}[] /* 0 or 1 */, score: number, band, explanation: string, nextAction: {kind:"reach_out"|"re_engage"|"ask_intro"|"run_snowball"|"link_people", label, href?} };
findIntroductionPaths(orgId, { limit = 5 }): { paths: IntroPath[]; coverage: "direct"|"second_degree"|"none" }
```
Algorithm: targets **T** = current linked contacts. 1-hop: any edge O–T of type `relationship|connected_to|follows` (either direction) → `score = strength(T).score` (null → 0). 2-hop: for each owner neighbor **X** (1-hop set, `getNeighbors(O, both)` filtered to contacts, excluding T), for each edge X–T (`connected_to|follows`, either direction) → `score = round(strength(X).score × factor)` where `factor = connected_to 0.8 / mutual follows 0.7 / single follow 0.5`. Keep the best path per target; sort desc; ties by target name. Explanation templates: *"You're connected to Priya (strong — rated 80, spoke 5 days ago)"*, *"Ask Marco (moderate) — he follows Priya on X"*. `nextAction`: direct strong → reach_out; direct weak/moderate → re_engage (deep-link to contact activity composer); 2-hop → ask_intro; no paths but linked people exist → run_snowball; no linked people → link_people. Complexity: |N(O)| × degree, all via `idx_edge_src/dst`; bounded by `maxNeighbors=2000` guard (returns `truncated:true`).

### 5.3 Relationship summary — `getOrgRelationshipSummary(orgId, opts)` (`src/lib/db/queries/org-relationships.ts`)
```ts
{ people: { total, current, former },
  coverage: { withEmail, withVerifiedEmail, withIdentity, withRelationship, withPersona },   // counts over current people
  strength: { unknown, weak, moderate, strong, best: {contactId, name, score} | null },
  lastInteractionAt: number | null,          // max(interactions.occurredAt) over members ∪ interactions.orgId = org
  owner: {contactId, name} | null,
  paths: IntroPath[], pathCoverage,
  snowball: { lastRunId, lastRunAt, status } | null }
```
"Coverage" is rendered as fractions ("4 of 12 people have a verified email"), never as raw percentages without the denominator — the "missing vs zero" AC.

### 5.4 People table — widen `listOrgLinkedContacts` → `listOrgPeople(orgId, { q?, employment?: "current"|"former"|"all", band?, sort?: "name"|"strength"|"lastInteraction"|"title", dir?, page, pageSize })`
Row = `OrgPersonRow = { contact: ContactDTO-lite (id, name, avatar, funnelStage, identities summary), employment: {title, isCurrent, startedAt, endedAt, source}, strength: RelationshipStrength, lastInteractionAt, emailStatus: EmailStatusSummary (§6.7; "none" in Phase 2), nextAction }`. Reads `contact_employments` joined to contacts (source of truth) rather than the projection; `includeLocalOnly` respected. Strength is computed in a batch (one interactions query grouped by contact, one edges query) — no per-row queries.
Columns: Name · Title · Stage · Strength (badge + popover) · Last interaction · Email (Phase 3) · Next action · row menu (Open, Unlink, Mark former). "Relationship owner" column is **omitted** (no user model; account owner is on the header) — stated in the AC map. Missing data renders as muted "Not set" with an inline action; zero renders as "0"/"None".
Filters/sort live in URL params (pattern from `contact-list-client.tsx`), two empty states (zero vs. no-match).

### 5.5 Link management (through employments only)
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/orgs/[id]/contacts` | `{ contactId, title?, isCurrent? = true, startedAt? }` | `201 OrgPersonRow` · `404` org/contact · `409 CONFLICT` if a current employment already exists (use PATCH) |
| PATCH | `/api/orgs/[id]/contacts/[contactId]` | `{ title?, isCurrent?, endedAt? }` | `200 OrgPersonRow` |
| DELETE | `/api/orgs/[id]/contacts/[contactId]` | — | `204` — deletes all employments for (contact, org) → `afterEmploymentMutation` re-projects `works_at` |
| GET | `/api/orgs/[id]/relationships` | `?includeLocalOnly` | summary §5.3 |
| GET | `/api/orgs/[id]/contacts` | + §5.4 params | `{data: OrgPersonRow[], total}` (additive) |
All writes call `createContactEmployment`/`updateContactEmployment`/`deleteContactEmployment` (`contact-employments.ts`) with `source` = write tag, then `afterEmploymentMutation(contactId)`, `recalcOrgEnrichment(orgId)`, and log `org_activities` `contact_linked`/`contact_unlinked` (Phase 4 table; in Phase 2 the call is a no-op stub). `<LinkContactDialog>` = new `contact-picker.tsx` (typeahead over `GET /api/contacts?search=`, mirrors `org-picker.tsx`) + title field + "Create new person" (opens `AddContactDialog` with `orgId` prefilled).
Snowball: `organization-detail-client` passes `seedValue={org.name}` **and** `config.orgId` so `workflow-run-subjects` links the run to the company; the relationship card shows "Last Snowball run · 3 days ago · 7 people added" from `workflow_runs` where `config.orgId = id` and template = Network Snowball.

### 5.6 Agent tools
`get_org_relationships {orgId, includeLocalOnly?}` → §5.3 · `list_org_contacts {orgId, employment?, band?, sort?, page?, pageSize?}` → `{total, people: OrgPersonRow[]}` · `link_contact_to_org {orgId, contactId, title?, isCurrent?, startedAt?}` · `unlink_contact_from_org {orgId, contactId, mode?: "remove"|"mark_former"}`. Docs for `upsert_edge` gain a warning: *do not write `works_at` directly — use `link_contact_to_org`*.

### 5.7 Tests
`graph/relationship-strength.test.ts` (table: each component alone; renormalization; bands; unknown vs 0) · `graph/intro-paths.test.ts` (seeded graph: direct, 2-hop via connected_to/mutual/single follow, best-per-target, no paths → run_snowball, no people → link_people, local_only edges excluded by default) · `queries/org-relationships.test.ts` · `queries/org-people.test.ts` (filters, sorts, former/current, batch strength) · `api/orgs/[id]/contacts/route.test.ts` (POST/PATCH/DELETE + projection assertions on `graph_edges`) · `agent-tools/org-relationship-handlers.test.ts` (incl. auth) · `components/organization-people-table.test.ts` (zero vs no-match, "Not set" vs "0") · `strength-badge.test.ts` (popover lists components, `aria-describedby`).

### 5.8 Proof observables (#338)
1. Seed O→A `relationship weight=80` + interaction 3 days ago → A shows **Strong** with popover "Your rating 80 · Recent contact 3 days ago"; B with no data shows **No data yet**, not Weak.
2. Seed O–X `connected_to`, X–T `follows`, T works at org → relationships payload has a 2-hop path `via:[X]` with `nextAction.kind="ask_intro"`.
3. `POST /api/orgs/:id/contacts {contactId}` → `contact_employments` row + exactly one `works_at` edge; `DELETE` → both gone; `link_contact_to_org` produces the same rows.
4. People filter `employment=former` returns only `isCurrent=false`; sort `strength desc` orders A before B.
5. `.evidence/{before,after}_company-people_….png` (populated) + `…_company-relationships-sparse_….png`.

---

## 6. Phase 3 — #337 Employee email-pattern prediction & verification

### 6.1 Precondition
Inference runs only when `org.domain` is set **and** `normalizeOrgDomain(org.domain).ok`. Otherwise the card shows "Add a company domain to infer email patterns" (Edit CTA); API returns `{ canInfer:false, reason:"missing_domain"|"invalid_domain" }`; tools return the same object (not an error).

### 6.2 Pattern grammar — `src/lib/contacts/email-patterns/patterns.ts`
Tokens `{first} {last} {f} {l}`; separators `.` `_` `-` or none; validated by `^(\{(first|last|f|l)\}[._-]?){1,3}$` with at least one token. Ranked template list (tie-break order): `{first}.{last}`, `{first}{last}`, `{f}{last}`, `{first}_{last}`, `{first}`, `{f}.{last}`, `{first}.{l}`, `{first}{l}`, `{last}.{first}`, `{last}{f}`, `{first}-{last}`, `{last}`. `renderPattern(pattern, parts)` and `matchPattern(localPart, parts) → pattern[]`.

### 6.3 Inference — `inferOrgEmailPatterns(orgId): InferenceResult`
Evidence set **E** = email channels of contacts with any employment at the org where: channel domain ∈ org domains (primary + aliases); `isVerified = true` **or** `source` starts with `sync:`/`import:` (observed from real mail/contact data); not `isRoleAccountEmail`. Each evidence email is matched against all templates using the contact's name parts (§6.4); unmatched emails count toward `sampleCount` only.
`score = matchCount / sampleCount`. Confidence: **high** = `matchCount ≥ 3 ∧ score ≥ 0.6`; **medium** = `matchCount ≥ 2 ∧ score ≥ 0.4`; **low** = `matchCount ≥ 1`. Primary = max score, tie → template order. Rows are replaced atomically (`source="inferred"`), preserving a `manual:override`/`agent:evidence` row's `isSelected`. `evaluatedAt = now`. If `E = ∅` → no rows, `{ canInfer:true, patterns:[], reason:"no_samples" }` and CTA "Verify one employee's email to start" or "Ask an agent to find the convention" (agent may call `set_org_email_pattern` with `evidence:{url}` → `low`, `source:"agent:evidence"`).

### 6.4 Name normalization — `src/lib/contacts/email-patterns/name-parts.ts`
`deriveNameParts(contact) → { ok:true, first, last, firstIsInitial, ambiguous: string[] } | { ok:false, reason:"single_token"|"non_latin"|"empty" }`. Rules, in order: prefer `firstName`/`lastName` columns; else tokenize `name` after NFKD + diacritic strip, honorific/suffix removal (reuse lists from `dedupe/normalize.ts`), apostrophes removed (`o'brien → obrien`), hyphens removed inside tokens (`smith-jones → smithjones`), other punctuation → space. Token count 0/1 → `single_token`. ≥2: `first = tokens[0]`; surname = last token **preceded by any contiguous particle chain** from `SURNAME_PARTICLES` (`van, von, der, den, de, da, del, della, di, la, le, du, dos, das, bin, al, el, ter, ten, mac, mc, st`) joined without spaces (`ludwig van der berg → first=ludwig,last=vanderberg`); middle tokens dropped and listed in `ambiguous`. If a token is a single letter (or `x.`) → `firstIsInitial=true` (templates requiring `{first}` are skipped). Any remaining char outside `[a-z]` → `non_latin` (no transliteration — deterministic by design). Family-name-first ordering is not detected (documented limitation; predictions are `predicted`, never verified by this step).

### 6.5 Candidates — `generateOrgEmailCandidates(orgId, { contactIds? })`
For each **current** linked contact: skip with reason `verified_email_exists` if a `contact_channels` email with `isVerified` at an org domain exists; `name_unusable:<reason>` if `deriveNameParts` fails; `no_pattern` if no selected pattern; `already_on_record` if the rendered normalized address already exists as a channel (any status). Else upsert `contact_email_candidates` (unique per contact+address): new → `predicted`; existing `predicted` → refresh `pattern/confidence/evidence`; existing `uncertain|verified|invalid` → untouched. Candidate confidence = pattern confidence, downgraded one level when `firstIsInitial`, particles were joined, or `ambiguous.length > 0`. `evidence = { pattern, parts, patternConfidence, sampleCount, conflicts: [{address, domain}] /* known addresses at other domains */, generatedAt }`. Returns `{ created, updated, skipped: [{contactId, reason}] }` — UI lists skips per person with an Edit-name CTA.

### 6.6 Verification lifecycle — `src/lib/contacts/email-verification/`
Provider port `EmailProbe = (address, ctx: { domainStatus }) => Promise<ProbeResult>` with `ProbeResult = { outcome: "deliverable"|"undeliverable"|"inconclusive", method, detail, catchAll?: "yes"|"no"|"unknown" }`. Providers: `syntax` (RFC-lite regex), `dns_mx` (`node:dns/promises resolveMx`, 5 s), `smtp_rcpt` (`node:net`/`node:tls`, EHLO → MAIL FROM `<>` → RCPT TO → QUIT, 8 s; catch-all = RCPT TO `<random32>@domain` accepted). **`smtp_rcpt` is config-gated, default off** (`emailSmtpProbeEnabled`, settings card "Email verification" with the ISP/port-25 caveat; env lock `SIGNALS_EMAIL_SMTP_PROBE=0|1`). All probes injectable (`probeImpl`) and never executed in unit tests.
Domain status is cached on `org_domains` (`mxStatus`, `catchAll`, `mailCheckedAt`; re-check after 30 d — `MAIL_STATUS_RETRY_SECONDS`).

State machine (`transitionCandidate(candidate, event)` pure):
| From | Event | To | Notes |
|---|---|---|---|
| any non-verified | `manual_verify` / `agent_verify {evidenceUrl}` | **verified** | `verificationMethod=manual|agent`, `verifiedAt`, then **promote**: insert `contact_channels` row (`source="enrich:email_pattern"`, `isVerified=true`, `metadata.candidateId`), set `promotedChannelId`; `recalcContactEnrichment` |
| any | `manual_invalidate` / `agent_invalidate` / `smtp: 5xx user unknown` / `dns_mx: none` | **invalid** | never deleted (provenance); excluded from generation refresh |
| predicted/uncertain | `smtp: accepted` ∧ `catchAll=no` | **verified** (`method=smtp_rcpt`) | detail "Accepted by mail server" — UI copy never says "deliverable guaranteed" |
| predicted/uncertain | `smtp: accepted` ∧ `catchAll ∈ {yes, unknown}` | **uncertain** | reason `catch_all_domain` / `catch_all_unknown` — **no false verification claim** |
| predicted | `probe: inconclusive` (timeout, blocked, probing disabled) | **uncertain** | reason `probe_inconclusive`; `probeAttempts++`; retry after 7 d (`EMAIL_PROBE_RETRY_SECONDS`) |
| verified | `manual_invalidate` (e.g. bounce reported) | **invalid** | promoted channel `isVerified=false` + `metadata.invalidatedAt` (channel kept; user may delete) |
| any | `correct {address}` | **predicted** (`source="manual:correct_email"`, `pattern=null`) | old row → `invalid` with `evidence.supersededBy` |
Every transition appends to `evidence.history[] = {from, to, event, method, at, detail}`. `verified` is reachable **only** via manual/agent evidence or SMTP-accept-on-non-catch-all — never via pattern confidence.

### 6.7 Status vocabulary everywhere
`EmailStatus = "verified" | "predicted" | "uncertain" | "invalid" | "unverified" | "none"` — `unverified` = a real user-entered channel with `isVerified=false` (existing data; not a prediction), `none` = nothing on record. `<EmailStatusBadge>` (icon + text, not color-only; `aria-label`), used in the People table, contact page channels section, and candidate drawer. API/tool responses always carry `status` + `verificationMethod` + `confidence` on candidates.

### 6.8 Automation safety (ADR-335-4) — `src/lib/contacts/email-eligibility.ts`
```ts
resolveAutomationEmail(contactId, opts?: { includePredicted?: boolean }): { address: string|null; status: EmailStatus; eligible: boolean; reason?: string }
```
Rules: verified channel → eligible; unverified channel → eligible (existing real record; unchanged behavior); candidate `predicted` → eligible **only if** `opts.includePredicted === true` **and** `readSignalsConfig().allowPredictedEmailInAutomation === true` (resolved via the `persona-generation-mode.ts` shape with env lock `SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION`; default `false`; settings card with explicit warning copy); candidate `uncertain|invalid` → never. The function is the **only** sanctioned recipient resolver; `docs/agent-tools.md` and the seeded outreach template briefs state: *never send to `emailCandidates` entries unless `status="verified"`*. `get_contact`/`query_contacts` gain an additive `emailCandidates: [{address, status, confidence, pattern, sendable:false|true}]` array; `primaryEmail`/`channels` never include candidates. `list_email_candidates` rows carry `sendable`.

### 6.9 REST
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/orgs/[id]/email-intelligence` | — | `{ canInfer, reason?, domain, domains:[{domain,kind,mxStatus,catchAll,mailCheckedAt}], patterns:[…rows], selected, candidateCounts:{predicted,uncertain,verified,invalid}, evaluatedAt }` |
| POST | `/api/orgs/[id]/email-intelligence/infer` | `{ checkMail?: boolean }` | `200` same payload (runs inference + MX check when `checkMail`) |
| PUT | `/api/orgs/[id]/email-intelligence/pattern` | `{ pattern }` | `200` (validates grammar; `source="manual:override"`, `isSelected=true`) · `400 VALIDATION_ERROR` |
| DELETE | `/api/orgs/[id]/email-intelligence/pattern` | — | `200` (clears override → inferred primary reselected) |
| POST | `/api/orgs/[id]/email-candidates/generate` | `{ contactIds? }` | `200 { created, updated, skipped }` |
| GET | `/api/orgs/[id]/email-candidates` | `?status` | `{ data: Candidate[], total }` |
| PATCH | `/api/email-candidates/[id]` | `{ action: "verify"\|"invalidate"\|"mark_uncertain"\|"correct"\|"probe", address?, evidenceUrl?, note? }` | `200 Candidate` · `409 CONFLICT` for illegal transition |
| POST/DELETE | `/api/orgs/[id]/domains` | `{ domain }` | alias add/remove (`400` normalization, `409` owned by another org) |
| GET/PUT | `/api/settings/email-verification` | `{ smtpProbeEnabled?, allowPredictedInAutomation? }` | resolved-flag shape (`storedValue, effectiveValue, source, envLocked`) |

### 6.10 Agent tools
`get_org_email_intelligence {orgId}` · `infer_org_email_pattern {orgId, checkMail?}` · `set_org_email_pattern {orgId, pattern, evidenceUrl?, clear?}` (`source="agent:evidence"` when `evidenceUrl`) · `generate_org_email_candidates {orgId, contactIds?}` · `list_email_candidates {orgId?, contactId?, status?}` · `update_email_candidate {candidateId, action, address?, evidenceUrl?, note?}` · `add_org_domain_alias {orgId, domain}`. Skill `reference.md` documents the state semantics and the never-send rule.

### 6.11 UI
Overview "Email intelligence" card: domain/mail status chips (MX ok · Catch-all unknown), primary pattern with confidence pill + "based on 4 verified emails · evaluated 2 h ago", alternatives list, actions Infer / Override / Generate for people. People table "Email" column with `<EmailStatusBadge>`; row action "Why this address?" opens `<EmailCandidateDrawer>` (address, pattern, name parts used, evidence/history, actions Verify / Mark invalid / Correct / Probe). Settings → new "Email verification" card (two toggles, env-locked state).

### 6.12 Tests
`email-patterns/patterns.test.ts` (grammar, render/match table) · `name-parts.test.ts` (table: "Dr. José García-López", "Ludwig van der Berg", "J. Smith", "Madonna", "山田 太郎", "Mary Anne O'Brien Jr.", firstName/lastName precedence) · `inference.test.ts` (thresholds table, ties, role accounts excluded, aliases counted, override preserved) · `candidates.test.ts` (skip reasons, refresh rules, downgrade rules, conflict evidence) · `email-verification/transitions.test.ts` (every row of §6.6 incl. catch-all yes/unknown → uncertain, promotion creates channel exactly once, invalidate after verify) · `email-verification/probes.test.ts` (injected fakes; disabled SMTP → inconclusive) · `email-eligibility.test.ts` (config off → predicted never returned even with `includePredicted`; env lock) · route tests for each §6.9 path · `agent-tools/email-handlers.test.ts` (incl. `get_contact.emailCandidates` separation, auth) · UI SSR tests for badge states and drawer content.

### 6.13 Proof observables (#337)
1. Org without domain → `GET …/email-intelligence` `{canInfer:false, reason:"missing_domain"}`; card shows Edit CTA; `infer_org_email_pattern` returns the same, not an error.
2. Seed 3 verified `first.last@acme.com` + 1 `flast@acme.com` → primary `{first}.{last}` **high** (3/4, 0.75), alternative `{f}{last}` **low**; `evaluatedAt` set; card shows "based on 4 emails".
3. Generate with selected `{first}.{last}` for "Ludwig van der Berg" → `ludwig.vanderberg@acme.com` `predicted/medium` (downgraded from high: particles joined); "J. Smith" → skipped `name_unusable:first_initial`; "山田 太郎" → skipped `name_unusable:non_latin`. Re-run with the pattern overridden to `{f}{last}` → "J. Smith" yields `jsmith@acme.com` `predicted/medium`.
4. `PATCH …/email-candidates/:id {action:"probe"}` with fake SMTP accept + `catchAll=yes` → `uncertain` (`catch_all_domain`), **no** `contact_channels` row; with `catchAll=no` → `verified` + one channel row `isVerified=true`, `source="enrich:email_pattern"`.
5. `get_contact` shows the candidate only under `emailCandidates` (`sendable:false`); `primaryEmail` unchanged; `resolveAutomationEmail(id,{includePredicted:true})` → `eligible:false` while config is off; flips only after `allowPredictedEmailInAutomation=true`.
6. `.evidence/{before,after}_company-email_….png` (populated patterns + candidate drawer).

---

## 7. Phase 4 — #336 Company signals, activity & workflow actions

### 7.1 Activity-type registry — `src/lib/db/org-activity-types.ts`
```ts
export const ORG_ACTIVITY_TYPE_GROUPS = {
  signal:    ["funding", "hiring", "leadership_change", "product_launch", "news", "content", "engagement"],
  workspace: ["note", "contact_linked", "contact_unlinked", "profile_updated", "profile_enriched", "email_pattern_inferred", "email_verified", "followed", "unfollowed", "workflow_started", "task_created"],
} as const;
```
`assertOrgActivityType`, `orgActivityCategory` mirror `interaction-types.ts`. Human labels + icons in `org-activity-format.ts`.

### 7.2 Writer — `logOrgActivity(input): { activity, created: boolean }`
`INSERT … ON CONFLICT(dedupe_key) DO NOTHING` (returns `created:false` on duplicate). `dedupeKey` = caller-supplied, else `sha256(orgId|activityType|normalizedUrl ?? title|dayBucket(occurredAt))` for signals and `sha256(orgId|activityType|subjectId)` for system events. `actor` derived from the write tag prefix (`manual`→user, `agent`→agent, `sync`/`import`→sync, else system). System writers (Phase 1/2/3 hooks): `updateOrg` → `profile_updated` (fields list in metadata; **not** for enrichment runs, which emit one `profile_enriched`), link/unlink → `contact_linked/unlinked` (`contactId`), inference → `email_pattern_inferred`, promotion → `email_verified`, follow toggles, task creation with `relatedOrgId`, `runTemplateViaRtx` with `config.orgId` → `workflow_started`.
`interactions.orgId` is populated going forward from the contact's current employment (`logInteraction` + `engagement-interaction-sync.ts:95` stop hardcoding `null`). No backfill needed — the feed fans in via membership.

### 7.3 Feed reader — `listOrgTimeline(orgId, { page, pageSize, category?: "signal"|"workspace"|"all", types?, since?, includeLocalOnly? })`
SQL `UNION ALL` of (a) `org_activities WHERE org_id = ?` and (b) `interactions WHERE (org_id = ? OR contact_id IN (current+former members)) AND interaction_type != 'note' OR …` — **member notes are included** (they are activity) but tagged with the person; `ORDER BY occurred_at DESC, created_at DESC, id DESC LIMIT/OFFSET`; `total` via `COUNT` over the same union. Attachments resolved in one `IN (…)` query. Item:
```ts
type OrgFeedItem = { id, kind: "org_activity"|"interaction", type, category, title, summary, whyItMatters, recommendedAction, contact: {id,name}|null, occurredAt, ingestedAt, isNew: boolean /* ingestedAt > feedSeenAt */, actor: "user"|"agent"|"system"|"sync", sourceLabel /* human */, sourceDetail /* raw tag, secondary */, url, workflowRunId, attachments }
```
Ordering is by **occurrence**; "Ingested {relative}" is shown only when it differs from occurrence by > 1 h. Extract `timeline-list.tsx` (icon rail, `ActivityMarkdown`, attachment chips, preview dialog) from `contact-timeline-tab.tsx` and reuse it (behavior-preserving; contact tab keeps its composer).

### 7.4 Signal ingestion — "Company Signal Scan" seeded template (ADR-335-7)
`templateType:"enrichment"`, `workflowType:"agent"`, `config:{ companySignalScan:{ version:1, lookbackDays:90 } }`. Brief: `get_org` + `list_org_contacts`; use `search-web` (Serper/Tavily already wired) for `"{name}" funding|hiring|launch|CEO|announces` within lookback, plus the company website/news page; for each **dated, cited** finding call `log_org_activity` with `activityType`, `title`, `summary`, `url`, `occurredAt` (article date), `dedupeKey = url`, `whyItMatters` (≤ 2 sentences, must reference a linked person or the relationship coverage when relevant), `recommendedAction` (`{kind:"reach_out"|"ask_intro"|"add_task"|"follow", contactId?}`); do not fabricate dates (use `occurredAt = now` with `metadata.dateUnknown:true` when the source has none); call `complete_workflow_run` with `result.partial:true` + `errors[]` if any source failed. Rescans are safe: duplicates are dropped by `dedupe_key`.
Optional 4b (not required by AC): scheduled `org_signal_scan` job weekly for `followedAt IS NOT NULL` orgs via `scheduled_jobs` + `MAINTENANCE_HANDLERS`.

### 7.5 Actions
| Action | REST | Tool | UI |
|---|---|---|---|
| Follow / Unfollow | `POST /api/orgs/[id]/follow` `{follow: boolean}` → `200 {followedAt}` | `follow_org {orgId, follow}` | header/Signals tab toggle; list page filter `followed=true` |
| Mark feed seen | `POST /api/orgs/[id]/feed-seen` → `200 {feedSeenAt}` | — | automatic on Signals tab open |
| Scan now | `POST /api/orgs/[id]/signal-scan` → `202 {workflowRunId}` / `409` in progress / `503` not embedded | `start_workflow` (template id + `config.orgId`) | Signals tab button; banner states |
| Add note | `POST /api/orgs/[id]/activities` `{activityType:"note", title?, summary, occurredAt?}` → `201` | `log_org_activity` (`actor` derived) | Notes tab composer (reuse `Textarea` + `ActivityMarkdown`) |
| Add task | `POST /api/tasks` gains `relatedOrgId`; `GET /api/tasks?relatedOrgId=` | `create_task` gains optional `relatedOrgId` | `AddTaskDialog` gains `relatedOrgId?`; Overview "Next actions" card |
| Add to list | — **deferred (ADR-335-8)**; Tags editing is the grouping affordance | — | — |
| Start workflow | existing `/api/workflows/templates/[id]/run` with `config.orgId` | `start_workflow` | overflow menu: Snowball Network, Company Profile Enrichment, Company Signal Scan, plus any non-system agent template that declares `config.acceptsOrgId` |
| Feed read | `GET /api/orgs/[id]/timeline` | `list_org_activity {orgId, category?, page?, pageSize?, since?}` | tabs |
Every action button: pending (`disabled` + `Loader2`), success (`ActionToast`), error (inline `text-destructive` with the server `error` string), and a **401/403 branch**: a shared `readApiError(res)` helper maps `UNAUTHORIZED|FORBIDDEN` to "You don't have permission to do this here" (today only agent-tool routes can produce these; the branch exists so the UI is honest when auth is added). Not-embedded (`503 RTX_UNAVAILABLE`) → "Available inside RealTimeX".

### 7.6 Feed states
Empty (never scanned, not followed): `EmptyState` "No signals yet — Follow this company or Scan now". Loading: `TableSkeleton`-style rows. Stale: followed and last completed scan > 7 d or none → amber banner with last scan time + Scan now. Partial: last run `result.partial` → banner "Some sources failed — results may be incomplete" with run link. Error: last run failed → red banner + Retry. Permission-denied: §7.5 copy. New items: "New" divider above items with `isNew`.

### 7.7 Tests
`org-activity-types.test.ts` · `queries/org-activities.test.ts` (dedupe: same key twice → `created:false`, one row; actor derivation) · `queries/org-timeline.test.ts` (union ordering by `occurredAt` desc with tiebreaks, pagination totals, member fan-in, `since`, `isNew` vs `feedSeenAt`, local_only excluded by default, attachments batched) · `api/orgs/[id]/{timeline,activities,follow,feed-seen,signal-scan}/route.test.ts` · `api/tasks` (relatedOrgId filter; **adds the first tests for tasks**) · `agent-tools/org-activity-handlers.test.ts` (incl. auth, dedupe via tool) · `seed-templates.test.ts` (two new system templates seeded idempotently) · `components/organization-feed.test.ts` (SSR: provenance label present, raw tag absent from primary text, ingested-vs-occurred rendering, stale/partial banners) · `timeline-list.test.ts` (extraction is behavior-preserving; contact tab snapshot unchanged).

### 7.8 Proof observables (#336)
1. `log_org_activity` twice with `dedupeKey:"https://news/acme-series-a"` → one row; `GET …/timeline` returns it once with `sourceLabel:"Agent scan"`, `sourceDetail:"agent:signal_scan"` (secondary), `occurredAt` = article date, `ingestedAt` = now.
2. Feed ordering: activity at T-10d, interaction at T-2d, note at T-5d → returned `[interaction, note, activity]`.
3. `POST …/follow {follow:true}` → `followed_at` set → `followed` row in feed → list page `?followed=true` includes org; `follow_org` tool round-trips.
4. `POST /api/tasks {title, relatedOrgId}` → task row; Overview "Next actions" shows it; `create_task` with `relatedOrgId` produces the same.
5. Scan run completed with `result.partial:true` → Signals tab shows the partial banner with run link; failed run → error banner + Retry.
6. `.evidence/{before,after}_company-signals-empty_….png` and `…_company-signals-populated_….png`.

---

## 8. Cross-cutting

### 8.1 API ↔ agent-tool symmetry (every capability has both, sharing one query/serializer)
| Capability | REST | Tool(s) |
|---|---|---|
| Read company | `GET /api/orgs/[id]` | `get_org`, `query_orgs` (widened rows) |
| Create/edit | `POST /api/orgs`, `PATCH /api/orgs/[id]` | `create_org`, `update_org` |
| Enrich | `POST /api/orgs/[id]/enrich`, `GET …/enrichment` | `start_workflow` (+ `update_org` from inside the run) |
| Relationships | `GET …/relationships`, `GET/POST/PATCH/DELETE …/contacts[/…]` | `get_org_relationships`, `list_org_contacts`, `link_contact_to_org`, `unlink_contact_from_org` |
| Email intelligence | §6.9 | §6.10 (7 tools) |
| Feed & actions | §7.5 | `list_org_activity`, `log_org_activity`, `follow_org`, `create_task(+relatedOrgId)`, `start_workflow` |
**16 new tools** + 3 additive param/response extensions (`query_orgs` rows, `get_contact`/`query_contacts.emailCandidates`, `create_task.relatedOrgId`). Every tool: zod schema in `src/lib/agent-tools/org-schemas.ts`, handlers in `org-handlers.ts` / `org-email-handlers.ts` / `org-activity-handlers.ts`, registry entries, regenerated `openapi/agent-tools.json`, rows in `docs/agent-tools.md`, `.claude/skills/realtimex-signals/reference.md` (+ SKILL.md "Company intelligence" section with the never-send rule), and `invoke.test.ts` name assertions.

### 8.2 Authorization — stated plainly
Signals is single-user and local-first: no users, roles, sessions, or workspace scoping. "Authorization" for this epic means (a) every new agent tool goes through `authorizeAgentToolRequest` (localhost or bearer) and has 401/403 contract tests; (b) privacy scope — all org reads default `includeLocalOnly=false` and filter `scope='shared'` in the query layer (`local_only` employments, interactions, edges, activities excluded unless asked); (c) dashboard REST routes inherit the app-wide no-auth model (consistent with `/api/contacts`), and the UI still handles 401/403 bodies (§7.5). This is the honest reading of "permissions" ACs; no auth code is added (no `src/lib/auth/` change).

### 8.3 Errors
New routes: `toErrorResponse` / `badRequestResponse` / `notFoundResponse` (`{error, code, details?}`). Codes used: `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `ENRICHMENT_IN_PROGRESS`, `SCAN_IN_PROGRESS`, `RTX_UNAVAILABLE`, `IMMUTABLE_PROVENANCE`, `ILLEGAL_TRANSITION`.

### 8.4 UI quality bar (every phase)
Semantic tokens only (theme-automatic); mobile-first (`sm:`/`md:` — tables use `min-w-0 w-full` first column, `hidden sm:table-cell` low-priority columns, card list fallback under `sm` for People); keyboard: all actions are buttons/links, dialogs trap focus, popovers open on Enter/Space and are `aria-describedby` targets, tabs are Radix (arrow-key navigable); status never color-only (icon + text). `npm run doctor -- --verbose --scope changed` must not regress.

### 8.5 Visual evidence (AGENTS.md §10)
View names (new, kept consistent): `company-sparse`, `company-populated`, `company-people`, `company-email`, `company-signals-empty`, `company-signals-populated`. For each: `{before,after}_{view}_{desktop,mobile}_{light,dark}.png` → `before_` from the unmodified build (for views that do not exist yet — people/email/signals tabs — the `before_` set is the current org page, same 4 combos). Capture with a copy of `scripts/capture-settings-evidence.mjs` → `scripts/capture-company-evidence.mjs` (`SIGNALS_BASE_URL`, viewports 1280×900 / 390×844, `fullPage`), seeded via a small fixture script (`scripts/qa/seed-company-intelligence-fixture.mjs`, writes only to `SIGNALS_DATA_DIR`).

### 8.6 Docs to update
`docs/agent-tools.md` (tool table, envelope notes, never-send rule) · `.claude/skills/realtimex-signals/{SKILL.md,reference.md}` · `openapi/agent-tools.json` (generated) · `guide/` new page "Companies" (+ `guide/assets/` desktop-light shots) · `README.md` Companies section · `.env.example` (`SIGNALS_EMAIL_SMTP_PROBE`, `SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION`) · `AGENTS.md` §2 migration count ("30 files" is already stale) · `specs/company-intelligence.md` (this doc) · `docs/qa/README.md` gate description drift (optional, small).

---

## 9. Confirmation boundaries — exact request Dev must get answered before `db:generate`

### 9.1 Schema (required; AGENTS.md §8)
> **Request:** one additive migration for #335 (company intelligence). **Why the current schema cannot satisfy the contract:** `orgs` has no industry/size/tags/owner/stage/follow columns; predicted email addresses must be stored outside `contact_channels` (a channel row is auto-promoted to primary, counted as enrichment, and matched by dedupe — a prediction there would masquerade as real); org-level events cannot live in `interactions` (`contact_id NOT NULL`); tasks cannot reference a company.
> **DDL:** `orgs` +7 nullable/defaulted columns (`industry, company_size, tags, owner_contact_id, account_stage, followed_at, feed_seen_at`) + 3 indexes; `tasks` +1 (`related_org_id`) + index; new tables `org_domains`, `org_email_patterns`, `contact_email_candidates`, `org_activities` (full DDL in §3).
> **Impact:** additive only (schema-v0.5 §4 rules 1–8); no data movement in the migration; one idempotent backfill (`backfill-org-domains`, `INSERT OR IGNORE`, provenance-tagged); N-1 binaries keep working (all reads/writes against existing columns unchanged); `resetCoreTables` updated; migration replay + idempotency + fresh-dir tests.
> **Also for your awareness (not schema):** two new `src/lib` folders (`orgs/`, `contacts/email-patterns/` + `contacts/email-verification/`); "Lists" deferred (ADR-335-8) — say if you want `lists`/`list_members` tables added to the same migration; SMTP probing ships **off** by default.

### 9.2 Not required
No new dependencies (MX via `node:dns`, SMTP via `node:net`/`node:tls`, hashing via `node:crypto`). No auth/credential changes. No CI changes. No deletions. No `COVERAGE_INCLUDE` edits (new files get co-located tests but are not added to the gated allowlist).

---

## 10. Implementation order, PRs, validation

### 10.1 Order (dependency-driven)
**PR-1 (#339)** — land `specs/company-intelligence.md`; non-schema work first while the §9.1 request is pending: domain normalizer, `updateOrg` for existing columns, `PATCH`, provenance line, `AddOrganizationDialog` fix, terminology, tabs scaffold with Overview only, `get_org`/`create_org`/`update_org`, enrichment template + `/enrich`. Then, **after owner confirmation**: `npm run db:generate` (single migration), new columns in the edit dialog/DTO, backfill, migration tests.
**PR-2 (#338)** — strength, paths, relationship summary, people table, link/unlink, contact picker, Snowball linkage, 4 tools.
**PR-3 (#337)** — patterns, name parts, inference, candidates, verification providers + settings card, eligibility predicate, `emailCandidates` on contact tools, People "Email" column + drawer, 7 tools.
**PR-4 (#336)** — activity registry + writer + system hooks, feed reader + `timeline-list` extraction, Signals/Activity/Notes tabs, follow/seen/scan/notes/tasks, signal-scan template, 3 tools + `create_task` param, guide page.
Branching: stacked draft PRs `issue-339` → `issue-338` → `issue-337` → `issue-336` (each based on the previous), with `issue-335` as the loop's integration branch that each phase merges into once Review/QA approve; hand off **PR URLs** (AGENTS.md §9).

### 10.2 Validation plan (per PR; exact commands)
```bash
nvm use && npm ci                                     # Node 22.16.0 / ABI 127
export SIGNALS_DATA_DIR=/private/tmp/signals-335-$$   # BEFORE anything that migrates
npx vitest run src/lib/orgs src/lib/graph src/lib/contacts/email-patterns src/lib/contacts/email-verification src/lib/db/queries/org-*.test.ts src/app/api/orgs   # focused (adjust per phase)
npm run typecheck && npm run lint
npm run generate:agent-tools-openapi && npm run check:agent-tools-openapi   # any tool change
rm -rf "$SIGNALS_DATA_DIR" && npm run db:migrate && npx vitest run src/lib/db/migrate-company-intelligence.test.ts   # PR-1 only
npm run doctor -- --verbose --scope changed           # blocking in CI; record the score
npm run check                                         # full gate = CI
npm run verify:fresh-import
SIGNALS_DATA_DIR=$PWD/.ci/signals-e2e E2E_FRESH_DB=1 npm run test:integration
# RealTimeX Local App QA (AGENTS.md §10): yarn dev:all in realtimex-ai-app; add worktree as Local App with SIGNALS_DATA_DIR=/private/tmp/signals-qa-335-data;
#   read assigned port; probe /api/health and /dashboard/organizations/<id>; exercise Enrich / Snowball / Scan (agent lanes); then teardown and confirm ports clear.
SIGNALS_BASE_URL=http://127.0.0.1:<port> node scripts/capture-company-evidence.mjs   # after_ set; before_ set from main
```
Report per AGENTS.md §12, copying the PR #322 verification format, and name any check that could not run (e.g. embedded RTX lanes if the dev host is unavailable) with the exact command and expected outcome.

---

## 11. Risks, assumptions, open items

1. **Shared worktree missing.** `LOOP_COMMS` records `realtimex-dev/worktrees/loop-issue-335-6d249e06` on branch `issue-335`, but neither exists (`git worktree list` / `git branch` on 2026-08-28). Dev must create it (`git worktree add … -b issue-335 origin/main` + `node_modules` symlink per AGENTS.md §11) before starting.
2. **Schema approval latency.** PR-1 is split so ~60% of #339 lands without the migration; the remaining columns, PR-3 and PR-4 are blocked on §9.1. Ask early, in the Dev thread, with §9.1 verbatim.
3. **SMTP probing reliability.** Port 25 is commonly blocked; with probing off, `verified` is reachable only via manual/agent evidence → many candidates will sit at `predicted`. This is by design (no false verification), stated in UI copy.
4. **Inference cold start.** Orgs with zero verified samples get no pattern; the agent-evidence path (`set_org_email_pattern` with URL) and "verify one email" CTA are the ramps.
5. **Snowball `seedType:"org_id"` carries the name.** Left as-is (template brief treats it as a string); `config.orgId` is added for linkage. Renaming the seed type would touch the template contract — out of scope.
6. **Performance.** Strength/paths are computed on read (batch queries; owner-neighborhood bounded at 2000). If an org page ever exceeds ~500 people, add a `relationship_strength` cache — not now.
7. **Lists deferred (ADR-335-8)** — one AC line in #336 is consciously not met; the owner can pull it back in via §9.1.
8. **`relationship owner` column omitted** in the People table (no user model); "account owner" on the header covers the intent — noted in the AC map.
9. **Name-order and transliteration limits** (§6.4) are deterministic refusals, not guesses — candidates are skipped with a visible reason.
10. **Docs drift** already present (`AGENTS.md` migration count, `docs/qa/README.md` gate list) — fix opportunistically in PR-1; not a blocker.

---

## 12. Acceptance-criteria map

### #339
| AC | Design | Proof |
|---|---|---|
| Populated header communicates facts/owner/stage/tags | §2.3, §4.8 | 4.10-6 populated shots |
| Editable fields persist | §4.1, §4.3 PATCH | 4.10-1 |
| Sparse presents CTAs not `—` | §4.8 | 4.10-3 |
| Domain normalized + actionable validation | §4.2 | 4.10-2 |
| Enrichment pending/success/partial/failure | §4.6 | 4.10-5 |
| No raw source in primary UI | §4.5 | 4.10-4 + SSR test |
| API/agent tools with consistent validation | §4.3, §4.7 (shared serializer + zod) | tool tests |
| Focused tests | §4.9 | — |
| Visual evidence | §8.5 | 4.10-6 |

### #338
| AC | Design | Proof |
|---|---|---|
| Coverage + strongest paths on page | §5.3, §5.2 | 5.8-2 |
| Strength has accessible explanation | §5.1 popover | 5.8-1 |
| Add/link/unlink/filter/sort in context | §5.4, §5.5 | 5.8-3, 5.8-4 |
| Missing vs zero distinguished | §5.3/§5.4 copy rules, `unknown` band | 5.8-1 |
| Snowball results: path, participants, strength, next action | §5.2 output + Snowball run linkage §5.5 | 5.8-2 |
| Technical ids secondary only | §4.5 rules reused; edge/source tags only in popover "Details" | SSR test |
| Reads/mutations via tools with auth | §5.6 + `authorizeAgentToolRequest` | tool tests |
| Tests / evidence | §5.7 / §8.5 | 5.8-5 |
| *Deviation:* "relationship owner" column | omitted — no user model (§5.4) | — |

### #337
| AC | Design | Proof |
|---|---|---|
| No inference without valid domain | §6.1 | 6.13-1 |
| Patterns show confidence/evidence/time | §6.3, §6.11 | 6.13-2 |
| Deterministic name edge cases | §6.4 | 6.13-3 + table tests |
| Predicted never labeled/returned as verified | §6.5 (separate table), §6.7, §6.8 | 6.13-5 |
| Verification transitions keep provenance | §6.6 history | transitions tests |
| Catch-all → no false verification | §6.6 rows 3–4 | 6.13-4 |
| Inspect/correct/override | §6.9 PATCH actions, PUT pattern, drawer | route + UI tests |
| Automation excludes predicted unless opted in | §6.8 predicate + config flag | 6.13-5 |
| API/tool semantics preserved | §6.9/§6.10 | tool tests |
| Tests | §6.12 | — |

### #336
| AC | Design | Proof |
|---|---|---|
| Chronological deduplicated feed | §7.2, §7.3 | 7.8-1, 7.8-2 |
| Source/provenance + occurrence/ingestion time | `OrgFeedItem` §7.3 | 7.8-1 |
| Recommendations explain why | `whyItMatters` + `recommendedAction` required by the scan brief §7.4 | feed SSR test |
| Follow/unfollow, note/task, list, workflows without leaving | §7.5 (**list deferred**, ADR-335-8) | 7.8-3, 7.8-4 |
| Empty/loading/stale/partial/error/denied states | §7.6 | 7.8-5 + shots |
| User vs agent activity distinguishable, no raw ids | `actor` + `sourceLabel` | SSR test |
| Reads/actions via tools with auth | §7.5 tools | tool tests |
| Tests / evidence | §7.7 / §8.5 | 7.8-6 |

