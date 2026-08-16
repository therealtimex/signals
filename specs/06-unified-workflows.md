# Unified Workflow System

> **Partially superseded (2026-08)** — Schema/UI unification sections remain valid; execution steps that reference in-process LLM extraction, Claude Agent SDK loops, or Playwright `browser_scrape` were removed in #4/#5.
> **Current path:** [`docs/rtx-agent-orchestration.md`](../docs/rtx-agent-orchestration.md), [`docs/rtx-agent-browser-enrichment.md`](../docs/rtx-agent-browser-enrichment.md), [`docs/realtimex-local-app.md`](../docs/realtimex-local-app.md).
> Retained for historical context; do not implement new execution behavior from §4 step types without checking current docs.

> Documents the completed unification of Campaigns, Agents, and Workflows into
> a single Workflow system. Covers schema consolidation, type system, API routes,
> visualization views, and the `runSyncWorkflow` wrapper pattern.
>
> Implements the vision defined in [`specs/recent-instructions.md`](./recent-instructions.md).
> See [`specs/01-origin.md`](./01-origin.md) for foundation context.

---

## 1. Motivation

The original architecture had three overlapping concepts:

| Concept | Table | Purpose | Problem |
|---------|-------|---------|---------|
| Campaigns | `campaigns`, `campaign_steps`, `campaign_contacts` | Multi-step outreach sequences | Overlaps with workflow orchestration |
| Agents | `agent_runs`, `agent_steps` | Autonomous AI task execution | Separate tracking from workflows |
| Workflows | (conceptual only) | Pipeline orchestration | No schema, no tracking |

Users found the distinction confusing: "Why switch between Campaigns and Workflows tabs?"
The sidebar had 7 items (Dashboard, Contacts, Campaigns, Content, Agents, Workflows, Settings),
and the UI needed 3 separate pages for related concepts.

**Solution:** Merge all three into a single Workflow system with typed runs. A "campaign" becomes
a workflow template of type `sequence`. An "agent run" becomes a workflow run of type `agent`.
A sync operation becomes a workflow run of type `sync`. One system, one tab, one mental model.

---

## 2. Schema Consolidation

### 2.1 Renames

| Old Table | New Table | Notes |
|-----------|-----------|-------|
| `campaigns` | `workflow_templates` | Reusable definitions |
| `campaign_steps` | `workflow_template_steps` | Steps within a template |
| `campaign_contacts` | `workflow_enrollments` | Contact enrollment in templates |

### 2.2 Dropped Tables (merged into workflow system)

| Dropped Table | Absorbed By | How |
|---------------|-------------|-----|
| `agent_runs` | `workflow_runs` | +6 agent columns: `trigger`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `parent_workflow_id` |
| `agent_steps` | `workflow_steps` | +5 step types: `thinking`, `tool_call`, `tool_result`, `decision`, `engagement_action` |

### 2.3 New Tables

| New Table | Purpose |
|-----------|---------|
| `workflow_runs` | Individual execution instances (sync, enrich, agent, etc.) |
| `workflow_steps` | Step-level observability within a run |

### 2.4 FK Renames

| Old FK | New FK | Table |
|--------|--------|-------|
| `campaign_id` | `template_id` | `engagements`, `workflow_enrollments` |
| `agent_run_id` | `workflow_run_id` | `engagements`, `workflow_enrollments` |
| `related_campaign_id` | `related_template_id` | `tasks` |

---

## 3. Complete Schema (17 Tables)

**File:** `src/lib/db/schema.ts`

### 3.1 Table Listing

| # | Table | Domain | Status |
|---|-------|--------|--------|
| 1 | `platform_accounts` | Auth | Phase 0 |
| 2 | `contacts` | CRM | Phase 0+1 |
| 3 | `contact_identities` | CRM | Phase 1 |
| 4 | `workflow_templates` | Workflows | Unified |
| 5 | `workflow_template_steps` | Workflows | Unified |
| 6 | `workflow_enrollments` | Workflows | Unified |
| 7 | `content_items` | Content | Phase 2 |
| 8 | `content_posts` | Content | Phase 2 |
| 9 | `engagements` | Content | Phase 2 |
| 10 | `tasks` | CRM | Phase 0 |
| 11 | `sync_cursors` | Sync | Phase 2 |
| 12 | `workflow_runs` | Workflows | Phase 3A |
| 13 | `workflow_steps` | Workflows | Phase 3A |
| 14 | `engagement_metrics` | Content | Phase 2 |
| 15 | `scheduled_jobs` | Jobs | Phase 0 |

Note: The codebase defines 15 `sqliteTable` calls in `schema.ts`. The "17 tables" count
from project memory includes the conceptual domains. Actual DDL tables are 15.

### 3.2 Workflow Templates

```
workflow_templates
├── id                text PK
├── name              text NOT NULL
├── description       text
├── platform          text enum (x, linkedin, gmail, substack)
├── template_type     text enum (outreach, engagement, content, nurture, prospecting, enrichment, pruning) NOT NULL
├── status            text enum (draft, active, paused, completed) DEFAULT 'draft'
├── config            text JSON DEFAULT '{}'
├── goal_metrics      text JSON DEFAULT '{}'
├── starts_at         integer
├── ends_at           integer
├── created_at        integer DEFAULT unixepoch()
└── updated_at        integer DEFAULT unixepoch()
```

### 3.3 Workflow Template Steps

```
workflow_template_steps
├── id                text PK
├── template_id       text FK → workflow_templates.id (cascade delete)
├── step_index        integer NOT NULL
├── step_type         text enum (connect, message, follow, like, comment, wait, condition) NOT NULL
├── config            text JSON DEFAULT '{}'
└── delay_hours       integer DEFAULT 0
```

### 3.4 Workflow Enrollments

```
workflow_enrollments
├── id                    text PK
├── template_id           text FK → workflow_templates.id (cascade delete)
├── contact_id            text FK → contacts.id (cascade delete)
├── workflow_run_id        text FK → workflow_runs.id
├── status                text enum (pending, active, completed, replied, removed) DEFAULT 'pending'
├── current_step_index    integer DEFAULT 0
├── enrolled_at           integer DEFAULT unixepoch()
└── completed_at          integer
```

### 3.5 Workflow Runs

```
workflow_runs
├── id                    text PK
├── template_id           text FK → workflow_templates.id
├── workflow_type          text enum (sync, enrich, search, prune, sequence, agent) NOT NULL
├── platform_account_id   text FK → platform_accounts.id
├── status                text enum (pending, running, paused, completed, failed, cancelled) DEFAULT 'pending'
├── total_items           integer
├── processed_items       integer DEFAULT 0
├── success_items         integer DEFAULT 0
├── skipped_items         integer DEFAULT 0
├── error_items           integer DEFAULT 0
├── config                text JSON DEFAULT '{}'
├── result                text JSON DEFAULT '{}'
├── errors                text JSON DEFAULT '[]'
│   ── Agent tracking (merged from agent_runs) ──
├── trigger               text enum (user, scheduled, template) DEFAULT 'user'
├── model                 text
├── input_tokens          integer DEFAULT 0
├── output_tokens         integer DEFAULT 0
├── cost_usd              real DEFAULT 0
├── parent_workflow_id    text (self-FK for sub-workflows)
├── started_at            integer
├── completed_at          integer
├── created_at            integer DEFAULT unixepoch()
└── updated_at            integer DEFAULT unixepoch()

Indexes:
  idx_workflow_runs_template  ON (template_id)
  idx_workflow_runs_status    ON (status)
  idx_workflow_runs_type      ON (workflow_type)
```

### 3.6 Workflow Steps

```
workflow_steps
├── id                text PK
├── workflow_run_id   text FK → workflow_runs.id (cascade delete)
├── step_index        integer NOT NULL
├── step_type         text enum (15 types, see Section 4.2) NOT NULL
├── status            text enum (pending, running, completed, failed, skipped) DEFAULT 'pending'
├── contact_id        text FK → contacts.id
├── url               text
├── tool              text
├── input             text JSON DEFAULT '{}'
├── output            text JSON DEFAULT '{}'
├── error             text
├── duration_ms       integer
└── created_at        integer DEFAULT unixepoch()

Indexes:
  idx_workflow_steps_run  ON (workflow_run_id)
```

---

## 4. Type System

**File:** `src/lib/workflows/types.ts`

### 4.1 WorkflowType (6 types)

| Type | Label | Purpose |
|------|-------|---------|
| `sync` | Platform Sync | Import contacts/content from connected platforms |
| `enrich` | Contact Enrichment | Browser scraping + LLM extraction to fill CRM fields |
| `search` | Web Search | Find new contacts via web search + scraping |
| `prune` | Contact Pruning | Archive/remove contacts matching criteria |
| `sequence` | Sequence | Multi-step outreach campaigns (formerly "campaigns") |
| `agent` | AI Agent | Autonomous Claude Agent SDK execution |

### 4.2 WorkflowStepType (15 types, 3 categories)

**Data pipeline steps:**

| Step Type | Usage |
|-----------|-------|
| `url_fetch` | HTTP GET of a URL for content extraction |
| `browser_scrape` | Playwright headless page scrape |
| `web_search` | Search engine query |
| `llm_extract` | LLM-powered structured data extraction |
| `contact_merge` | Merge extracted data into existing contact |
| `contact_create` | Create a new contact from extracted data |
| `contact_archive` | Archive/prune a contact |
| `routing_decision` | Log of which tool/strategy was chosen |
| `sync_page` | Summary of a sync page (batch of items) |
| `error` | Error encountered during execution |

**Agent steps (merged from `agent_steps`):**

| Step Type | Usage |
|-----------|-------|
| `thinking` | Agent reasoning/planning step |
| `tool_call` | Agent invoking a tool |
| `tool_result` | Result returned from a tool call |
| `decision` | Agent making a routing or strategy decision |
| `engagement_action` | Agent performing a platform engagement (like, reply, etc.) |

### 4.3 SyncSubType (7 sub-types)

Qualifies the `sync` workflow type with platform-specific context:

| Sub-Type | Label | Platform |
|----------|-------|----------|
| `x_contacts` | X Contacts | X/Twitter |
| `x_tweets` | X Tweets | X/Twitter |
| `x_mentions` | X Mentions | X/Twitter |
| `x_enrich` | X Profile Enrichment | X/Twitter |
| `gmail_contacts` | Gmail Contacts | Gmail |
| `gmail_metadata` | Gmail Email Metadata | Gmail |
| `linkedin_contacts` | LinkedIn Connections | LinkedIn |

### 4.4 Config Interfaces

```typescript
/** Stored in workflowRuns.config JSON */
interface WorkflowConfig {
  syncSubType?: SyncSubType;
  platformAccountId?: string;
  maxPages?: number;
  maxProfiles?: number;
  maxContacts?: number;
  contactIds?: string[];
  [key: string]: unknown;
}

/** For agent-type workflows */
interface AgentConfig {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: string[];
}
```

---

## 5. TypeScript Types

**File:** `src/lib/db/types.ts`

All types are Drizzle-inferred using `InferSelectModel` and `InferInsertModel`:

| Type | Table |
|------|-------|
| `WorkflowTemplate` / `NewWorkflowTemplate` | `workflowTemplates` |
| `WorkflowTemplateStep` / `NewWorkflowTemplateStep` | `workflowTemplateSteps` |
| `WorkflowEnrollment` / `NewWorkflowEnrollment` | `workflowEnrollments` |
| `WorkflowRun` / `NewWorkflowRun` | `workflowRuns` |
| `WorkflowStep` / `NewWorkflowStep` | `workflowSteps` |
| `WorkflowRunWithSteps` | `WorkflowRun & { steps: WorkflowStep[] }` |
| `PaginatedResult<T>` | `{ data: T[]; total: number }` |

Additional composed types in query modules:

| Type | Location | Shape |
|------|----------|-------|
| `WorkflowTemplateWithSteps` | `queries/workflow-templates.ts` | `WorkflowTemplate & { steps: WorkflowTemplateStep[]; enrollmentCount: number }` |
| `EnrollmentWithContact` | `queries/workflow-templates.ts` | `WorkflowEnrollment & { contactName: string; contactEmail: string \| null }` |

---

## 6. Query Modules

### 6.1 Workflow Runs — `src/lib/db/queries/workflows.ts`

| Function | Signature | Notes |
|----------|-----------|-------|
| `createWorkflowRun` | `(data: Omit<NewWorkflowRun, "id">) → WorkflowRun` | Generates nanoid |
| `updateWorkflowRun` | `(id, data) → WorkflowRun \| undefined` | Partial update of status, counters, agent fields |
| `getWorkflowRun` | `(id) → WorkflowRunWithSteps \| undefined` | Includes ordered steps |
| `listWorkflowRuns` | `(opts?) → PaginatedResult<WorkflowRun>` | Filter by status, workflowType, templateId; paginated |
| `createWorkflowStep` | `(data: Omit<NewWorkflowStep, "id">) → WorkflowStep` | Generates nanoid |
| `listWorkflowSteps` | `(workflowRunId) → WorkflowStep[]` | Ordered by stepIndex ASC |
| `nextStepIndex` | `(workflowRunId) → number` | Max stepIndex + 1 for monotonic ordering |

### 6.2 Workflow Templates — `src/lib/db/queries/workflow-templates.ts`

| Function | Signature | Notes |
|----------|-----------|-------|
| `createTemplate` | `(data: Omit<NewWorkflowTemplate, "id">) → WorkflowTemplate` | Generates nanoid |
| `updateTemplate` | `(id, data) → WorkflowTemplate \| undefined` | Partial update |
| `getTemplate` | `(id) → WorkflowTemplateWithSteps \| undefined` | Includes steps + enrollment count |
| `listTemplates` | `(opts?) → PaginatedResult<WorkflowTemplate>` | Filter by status, templateType; paginated |
| `deleteTemplate` | `(id) → boolean` | Cascade deletes steps + enrollments |
| `addTemplateStep` | `(data) → WorkflowTemplateStep` | Generates nanoid |
| `enrollContact` | `(data) → WorkflowEnrollment` | Generates nanoid |
| `listEnrollments` | `(templateId) → EnrollmentWithContact[]` | Joined with contacts table |

---

## 7. API Routes

### 7.1 Workflow Runs

#### `GET /api/workflows`

List workflow runs with optional filtering.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | enum | all | Filter by run status |
| `workflowType` | enum | all | Filter by workflow type |
| `templateId` | string | — | Filter runs for a specific template |
| `page` | integer | 1 | Page number |
| `pageSize` | integer | 25 | Results per page |

Response: `{ data: WorkflowRun[], total: number }`

#### `GET /api/workflows/[id]`

Get a single workflow run with all its steps.

Response: `WorkflowRunWithSteps` (run + ordered steps array)

### 7.2 Workflow Templates

#### `GET /api/workflows/templates`

List templates with optional filtering by `status` and `templateType`.

#### `POST /api/workflows/templates`

Create a new template. Zod-validated body:

```typescript
{
  name: string;           // required
  description?: string;
  platform?: "x" | "linkedin" | "gmail" | "substack";
  templateType: "outreach" | "engagement" | "content" | "nurture" | "prospecting" | "enrichment" | "pruning";
  status?: "draft" | "active" | "paused" | "completed";
  config?: string;        // JSON string
  goalMetrics?: string;   // JSON string
  startsAt?: number;
  endsAt?: number;
}
```

Response: `WorkflowTemplate` (201 Created)

#### `GET /api/workflows/templates/[id]`

Get template with steps and enrollment count.

Response: `WorkflowTemplateWithSteps`

#### `PATCH /api/workflows/templates/[id]`

Partial update. Same fields as POST (all optional).

#### `DELETE /api/workflows/templates/[id]`

Delete template (cascades to steps + enrollments). Returns 204.

---

## 8. Sync Workflow Wrapper

**File:** `src/lib/workflows/run-sync-workflow.ts`

The `runSyncWorkflow()` function wraps existing sync operations with workflow
observability. It does not modify the sync orchestrators themselves — it wraps
them at the API route level.

### 8.1 Pattern

```typescript
const { workflowRun, syncResult } = await runSyncWorkflow({
  workflowType: "sync",          // or "enrich"
  syncSubType: "x_contacts",     // platform-specific qualifier
  platformAccountId: "...",
  syncFunction: () => syncContacts(platformAccountId),  // existing sync fn
});
```

### 8.2 Execution Flow

1. **Create run** — `createWorkflowRun()` with status `"running"`, startedAt = now
2. **Record start step** — `sync_page` step with status `"running"`
3. **Execute sync** — Calls the wrapped `syncFunction()` closure
4. **Map results** — `SyncResult.added + updated → successItems`, `skipped → skippedItems`, `errors.length → errorItems`
5. **Update run** — Final status (`completed` or `failed`), counters, result JSON
6. **Create summary step** — `sync_page` step with counts and duration
7. **Log errors** — Up to 10 error steps (type `error`) for individual failures

### 8.3 Error Handling

If the sync function throws, the wrapper catches the error and:
- Sets run status to `"failed"`
- Creates a `SyncResult` with the error message
- Logs an `error` step with the exception message
- Returns the failed run (does not re-throw)

### 8.4 Integration Points

Each platform sync API route wraps its sync call:

| Route | Sync SubType | Sync Function |
|-------|-------------|---------------|
| `POST /api/platforms/x/sync` (contacts) | `x_contacts` | `syncContacts()` |
| `POST /api/platforms/x/sync` (tweets) | `x_tweets` | `syncTweets()` |
| `POST /api/platforms/x/sync` (mentions) | `x_mentions` | `syncMentions()` |
| `POST /api/platforms/x/enrich` | `x_enrich` | `syncXProfiles()` |
| `POST /api/platforms/gmail/sync` | `gmail_contacts` | `syncGmailContacts()` |
| `POST /api/platforms/gmail/sync` (metadata) | `gmail_metadata` | `syncGmailMetadata()` |
| `POST /api/platforms/linkedin/sync` | `linkedin_contacts` | `syncLinkedInContacts()` |

---

## 9. UI Architecture

### 9.1 Navigation

**File:** `src/components/app-sidebar.tsx`

4 main navigation items + 2 footer items:

| Item | Route | Icon | Position |
|------|-------|------|----------|
| Dashboard | `/dashboard` | LayoutDashboard | Main nav |
| Contacts | `/dashboard/contacts` | Users | Main nav |
| Content | `/dashboard/content` | FileText | Main nav |
| Workflows | `/dashboard/workflows` | GitBranch | Main nav |
| Settings | `/dashboard/settings` | Settings | Footer |
| Help | `/dashboard/help` | HelpCircle | Footer |

The Campaigns and Agents items were removed.

### 9.2 Dashboard Integration

The Dashboard overview stat card previously labeled "Campaigns" now shows
**"Active Workflows"** — counting `workflow_runs` with status `"running"`.

### 9.3 Workflows Hub Page

**File:** `src/app/dashboard/workflows/page.tsx`

Server Component that:
1. Fetches all workflow runs via `listWorkflowRuns({ pageSize: 100 })`
2. Shows empty state if no runs exist
3. Passes runs to `WorkflowViewSwitcher` client component

Includes `WorkflowQuickActions` for triggering sync/enrich operations.

### 9.4 View Switcher

**File:** `src/app/dashboard/workflows/workflow-view-switcher.tsx`

Client Component with 3 view modes, persisted via `?view=` URL search param:

| View | Component | Description |
|------|-----------|-------------|
| `list` | `WorkflowListView` | Table with type, status, counts, duration columns |
| `kanban` | `WorkflowKanbanView` | 4-column status board (Pending / Running / Completed / Failed) |
| `swimlane` | `WorkflowSwimlaneView` | Horizontal lanes per workflow type with `ScrollArea` |

Uses `useSearchParams()` wrapped in `<Suspense>` boundary (Next.js 16 requirement).

### 9.5 Workflow Detail Page

**File:** `src/app/dashboard/workflows/[id]/page.tsx`

Server Component showing:

1. **Summary cards** — Status, type, item counts (processed/success/skipped/error), duration
2. **Agent-specific cards** — Model, token usage (input/output), cost in USD (only shown for agent-type runs)
3. **Step visualization** — Toggleable between Timeline and Graph views

**File:** `src/app/dashboard/workflows/[id]/workflow-detail-steps.tsx`

Client Component with two modes:
- **Timeline** — Chronological step list via `WorkflowStepTimeline`
- **Graph** — Vertical pipeline via `WorkflowGraphView`

### 9.6 Visualization Components

| Component | File | Purpose |
|-----------|------|---------|
| `WorkflowProgressCard` | `workflow-progress-card.tsx` | Card with type icon (6 types), progress bar, stats |
| `WorkflowStepTimeline` | `workflow-step-timeline.tsx` | Chronological step list (15 step types) with status/duration |
| `WorkflowRunCard` | `workflow-run-card.tsx` | Compact card for kanban/swimlane (two layout variants) |
| `WorkflowListView` | `workflow-list-view.tsx` | Table view with sortable columns |
| `WorkflowKanbanView` | `workflow-kanban-view.tsx` | 4-column status board |
| `WorkflowSwimlaneView` | `workflow-swimlane-view.tsx` | Horizontal lanes per workflow type |
| `WorkflowGraphView` | `workflow-graph-view.tsx` | Vertical pipeline with expandable step nodes (pure CSS, no reactflow/d3) |

---

## 10. Deleted Artifacts

| Artifact | Type | Reason |
|----------|------|--------|
| `src/app/dashboard/campaigns/` | Directory | Replaced by workflows |
| `src/app/dashboard/agents/` | Directory | Replaced by workflows |
| Sidebar "Campaigns" item | Nav entry | Consolidated into Workflows |
| Sidebar "Agents" item | Nav entry | Consolidated into Workflows |
| `campaigns` table schema | DDL | Renamed to `workflow_templates` |
| `campaign_steps` table schema | DDL | Renamed to `workflow_template_steps` |
| `campaign_contacts` table schema | DDL | Renamed to `workflow_enrollments` |
| `agent_runs` table schema | DDL | Merged into `workflow_runs` |
| `agent_steps` table schema | DDL | Merged into `workflow_steps` |

---

## 11. Key Patterns & Gotchas

### `nextStepIndex()` Helper

Always use `nextStepIndex(runId)` when creating new steps. It reads the max
`stepIndex` for a run and returns +1. This ensures monotonically increasing
step ordering even when steps are created from different code paths.

### JSON Column Casts

`workflowRuns.config`, `.result`, and `.errors` are stored as JSON strings.
Always `JSON.stringify()` when writing and `JSON.parse()` when reading.

### Static Prerendering + SQLite

Server Components execute DB queries at build time. Tables must exist before
`npm run build`. The CLI runs `drizzle-kit push --force` on startup to ensure
this.

### `useSearchParams()` Requires Suspense

The view switcher uses `useSearchParams()` which requires a `<Suspense>`
boundary in Next.js 16. Without it, the page will throw a hydration error.

### Workflow Run Status Transitions

```
pending → running → completed
                  → failed
                  → cancelled
         → paused → running (resume)
```

A run is created with `"running"` status for sync workflows (immediate execution)
or `"pending"` for queued/scheduled workflows.

---

## 12. File Index

| Path | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | All 15 table definitions |
| `src/lib/db/types.ts` | Drizzle-inferred TypeScript types |
| `src/lib/db/queries/workflows.ts` | Workflow run + step CRUD |
| `src/lib/db/queries/workflow-templates.ts` | Template + step + enrollment CRUD |
| `src/lib/workflows/types.ts` | WorkflowType, WorkflowStepType, SyncSubType, configs |
| `src/lib/workflows/run-sync-workflow.ts` | Sync wrapper with observability |
| `src/app/api/workflows/route.ts` | GET list workflow runs |
| `src/app/api/workflows/[id]/route.ts` | GET workflow run detail |
| `src/app/api/workflows/templates/route.ts` | GET list / POST create templates |
| `src/app/api/workflows/templates/[id]/route.ts` | GET / PATCH / DELETE template |
| `src/app/dashboard/workflows/page.tsx` | Workflows hub page |
| `src/app/dashboard/workflows/workflow-view-switcher.tsx` | View mode tabs (list/kanban/swimlane) |
| `src/app/dashboard/workflows/workflow-quick-actions.tsx` | Quick action buttons |
| `src/app/dashboard/workflows/[id]/page.tsx` | Workflow run detail page |
| `src/app/dashboard/workflows/[id]/workflow-detail-steps.tsx` | Timeline/Graph toggle |
| `src/components/workflow-progress-card.tsx` | Run card with type icon + progress |
| `src/components/workflow-step-timeline.tsx` | Chronological step list |
| `src/components/workflow-run-card.tsx` | Compact run card |
| `src/components/workflow-list-view.tsx` | Table view |
| `src/components/workflow-kanban-view.tsx` | Kanban status columns |
| `src/components/workflow-swimlane-view.tsx` | Type-based swimlanes |
| `src/components/workflow-graph-view.tsx` | Pipeline graph (pure CSS) |
