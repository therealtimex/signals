# Agentic Workflows — Implementation Spec

> **Superseded (2026-08)** — Describes in-app Claude Agent SDK / Vercel AI SDK tool loops.
> **Current path:** RTX terminal agents + [`docs/rtx-agent-orchestration.md`](../docs/rtx-agent-orchestration.md) + [`docs/agent-tools.md`](../docs/agent-tools.md).
> Retained for historical context; do not implement new work from this spec.

> Full implementation spec for autonomous Claude Agent SDK workflows: agent tools,
> routing strategy, pre-defined campaign templates, pruning, multi-source search/scrape,
> scheduling, and progress tracking. Covers Phases 3B-3D.
>
> Builds on [`specs/06-unified-workflows.md`](./06-unified-workflows.md) (completed unified system).
> See [`specs/05-browser-enrichment.md`](./05-browser-enrichment.md) for existing Playwright infrastructure.
> See [`specs/recent-instructions.md`](./recent-instructions.md) for the original vision.

---

## 1. Overview & Motivation

### 1.1 Current State

The unified workflow system (Spec 06) tracks all operations — but every workflow is
**manually triggered** by the user clicking "Sync" or "Enrich." The system records
what happened but cannot make decisions about what to do next.

### 1.2 The Gap

| Capability | Current | Agentic |
|------------|---------|---------|
| Contact sync | Manual trigger per platform | Agent decides which platforms need refresh |
| Enrichment | Manual bulk/single trigger | Agent identifies low-score contacts and enriches |
| New lead discovery | Not available | Agent searches web, scrapes profiles, creates contacts |
| Contact cleanup | Not available | Agent evaluates contacts against criteria, archives matches |
| Outreach campaigns | Template exists, no execution | Agent executes sequence steps with personalization |
| Scheduling | `scheduledJobs` table exists, unused | Agent-driven workflows run on cron schedules |

### 1.3 Architecture Principle

The Claude Agent SDK agent uses **tools** (not direct code execution) to interact
with the CRM. Each tool maps to an existing capability. The agent reasons about
which tools to use and in what order. Every decision is logged as a `workflow_step`
for full observability.

---

## 2. Agent Tool Architecture

Five tools available to the Claude Agent SDK agent. Each tool is a thin wrapper
around existing library functions.

### 2.1 `url_fetch_and_parse(url)`

Direct HTTP GET with content extraction. For static HTML pages (Wikipedia,
GitHub, personal sites, company pages).

**Input:**
```typescript
{
  url: string;          // Target URL
  extractFields?: string[];  // Optional: specific fields to extract
  timeout?: number;     // Request timeout in ms (default: 10000)
}
```

**Implementation:**
1. HTTP GET with standard browser User-Agent
2. Parse HTML with Cheerio (lightweight DOM parser)
3. Extract readable content (title, meta description, main text)
4. Return structured text for LLM extraction

**Output:**
```typescript
{
  success: boolean;
  url: string;
  title: string;
  description: string;
  textContent: string;     // Readable extracted text
  statusCode: number;
  contentType: string;
  error?: string;
}
```

**Error handling:**
- `4xx` — Return error, do not retry
- `5xx` — Retry once after 2 seconds
- Timeout — Return error, suggest `browser_scrape` as fallback
- JS-rendered page detected (empty body, `<noscript>` present) — Return error with hint

**Rate limiting:** Respect `robots.txt`. Max 1 request/second to same domain.

**Workflow step:** Creates `url_fetch` step with URL, status code, content length.

### 2.2 `browser_scrape(url, options)`

Playwright headless scrape with anti-detection. For JS-rendered SPAs (X, LinkedIn)
and pages that block simple HTTP requests.

**Input:**
```typescript
{
  url: string;
  selectors?: Record<string, string>;  // CSS selectors to extract
  waitFor?: string;      // CSS selector to wait for before extraction
  screenshot?: boolean;  // Capture screenshot for debugging
  timeout?: number;      // Page load timeout (default: 30000)
}
```

**Implementation:**
1. Reuse existing Playwright infrastructure from `src/lib/browser/`
2. Launch context with anti-detection (from `anti-detection.ts`)
3. Navigate to URL with Gaussian delay
4. Wait for content to render (selector or network idle)
5. Extract content via selectors or full page text
6. Close context

**Output:**
```typescript
{
  success: boolean;
  url: string;
  extractedData: Record<string, string>;  // Selector → content mapping
  fullText: string;       // Full page text content
  screenshot?: string;    // Base64 PNG (if requested)
  error?: string;
}
```

**When to use vs `url_fetch`:** See Section 4 decision matrix.

**Rate limiting:** Gaussian delays between requests. Max 15 pages per 30-minute window
(existing batch limit from `BaseScraper`).

**Workflow step:** Creates `browser_scrape` step with URL, extracted fields, duration.

### 2.3 `search_web(query, options)`

Web search to discover URLs for a given query. Returns ranked results for the
agent to decide which to fetch/scrape.

**Input:**
```typescript
{
  query: string;         // Search query
  maxResults?: number;   // Default: 10
  domain?: string;       // Restrict to domain (e.g., "linkedin.com")
}
```

**Implementation:**
- Primary: Tavily Search API (structured results, good for agent use)
- Fallback: Brave Search API (broader coverage)
- API key stored in `~/.openvolo/config.json` (encrypted, like platform credentials)

**Output:**
```typescript
{
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    score: number;        // Relevance score 0-1
  }>;
  totalResults: number;
  query: string;
}
```

**API key management:** Stored alongside other credentials in the encrypted config.
Added to Settings page under "Search API" section.

**Workflow step:** Creates `web_search` step with query, result count, top URLs.

### 2.4 `enrich_contact(contactId, data)`

Merge extracted data into an existing contact. Respects the "fill gaps, don't overwrite"
merge strategy from `src/lib/browser/extractors/profile-merger.ts`.

**Input:**
```typescript
{
  contactId: string;
  data: Partial<{
    firstName: string;
    lastName: string;
    headline: string;
    company: string;
    title: string;
    email: string;
    phone: string;
    bio: string;
    location: string;
    website: string;
  }>;
  source: string;         // e.g., "wikipedia", "github", "personal_site"
  confidence?: number;    // 0-1, default 0.7
}
```

**Implementation:**
1. Load existing contact
2. Apply merge rules (fill empty fields, don't overwrite existing)
3. Update contact row
4. Trigger `recalcEnrichment(contactId)`
5. Return updated contact

**Merge rules:**
- Empty field + new value → accept
- Existing field + new value → keep existing (unless `confidence >= 0.9`)
- Store extraction source in `contacts.metadata.enrichmentSources[]`

**Workflow step:** Creates `contact_merge` step with contactId, fields updated, source.

### 2.5 `update_workflow_progress(runId, step)`

Report progress from within an agent workflow. Creates a step and updates counters.

**Input:**
```typescript
{
  runId: string;
  stepType: WorkflowStepType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  description?: string;
  data?: Record<string, unknown>;
  contactId?: string;
  url?: string;
}
```

**Implementation:**
1. `nextStepIndex(runId)` to get monotonic index
2. `createWorkflowStep()` with provided data
3. Update `workflowRuns.processedItems` counter
4. If `status === "completed"`, increment `successItems`
5. If `status === "failed"`, increment `errorItems`

**Workflow step:** The step itself IS the workflow step (meta-tool).

---

## 3. Routing Strategy

### 3.1 Deterministic Rules (fast path)

Pre-baked rules for known domains. No LLM call needed.

| Domain Pattern | Strategy | Rationale |
|----------------|----------|-----------|
| `x.com`, `twitter.com` | `browser_scrape` | JS-rendered SPA, anti-bot detection |
| `linkedin.com` | `browser_scrape` | JS-rendered, login walls |
| `wikipedia.org` | `url_fetch` | Static HTML, structured infoboxes |
| `github.com` | `url_fetch` | Server-rendered, public profiles |
| `*.substack.com` | `url_fetch` | Server-rendered content |
| `crunchbase.com` | `browser_scrape` | JS-rendered, anti-scraping |
| Personal sites (`*.com`, `*.io`) | `url_fetch` first | Try static, escalate if needed |

### 3.2 LLM Fallback (smart path)

When `url_fetch` fails or returns insufficient data:

1. Detect failure indicators:
   - Empty body / minimal HTML
   - `<noscript>` tag present
   - Known JS framework markers (`__NEXT_DATA__`, `<div id="root"></div>`)
   - HTTP 403/429 response
2. If detected, escalate to `browser_scrape`
3. Log a `routing_decision` step with the reasoning

### 3.3 Routing Decision Logging

Every routing choice creates a `routing_decision` workflow step:

```json
{
  "stepType": "routing_decision",
  "output": {
    "url": "https://en.wikipedia.org/wiki/Jane_Doe",
    "domain": "wikipedia.org",
    "strategy": "url_fetch",
    "reason": "deterministic_rule",
    "fallback": false
  }
}
```

### 3.4 Configuration

Routing rules are stored in `workflowTemplates.config` JSON:

```json
{
  "routingOverrides": {
    "example.com": "browser_scrape",
    "api.example.com": "url_fetch"
  },
  "defaultStrategy": "url_fetch",
  "escalateOnFailure": true
}
```

Users can override rules per template via the template config editor.

---

## 4. DOM Parsing vs Headless Browsing

### 4.1 Decision Matrix

| Criterion | `url_fetch` + Cheerio | `browser_scrape` + Playwright |
|-----------|----------------------|-------------------------------|
| **Speed** | ~200ms per page | ~3-5s per page |
| **Cost** | Minimal (HTTP only) | Higher (browser process) |
| **JS-rendered content** | Cannot extract | Full extraction |
| **Anti-bot detection** | Easily blocked | Anti-detection measures |
| **Login walls** | Cannot bypass | Cookie-based sessions |
| **Rate limiting** | Standard HTTP limits | Browser-level throttling |
| **Resource usage** | ~5MB per request | ~100MB per browser context |
| **Parallelism** | High (50+ concurrent) | Limited (3-5 concurrent) |

### 4.2 Hybrid Strategy

The default pipeline for unknown URLs:

```
1. Try url_fetch (fast, cheap)
   ├── Success → Extract with Cheerio → Done
   └── Failure (JS-required, blocked, empty)
       └── Escalate to browser_scrape (slower, more capable)
           ├── Success → Extract from rendered DOM → Done
           └── Failure → Log error, skip URL
```

### 4.3 Cost Comparison (per 100 profiles)

| Strategy | Time | API Cost | Compute |
|----------|------|----------|---------|
| url_fetch only | ~20s | $0 | Minimal |
| browser_scrape only | ~5-8min | $0 | ~500MB RAM |
| Hybrid (70% fetch, 30% browser) | ~2-3min | $0 | ~200MB RAM |
| + LLM extraction | +30s | ~$0.20 | Minimal |

---

## 5. Pre-defined Campaign Templates

### 5.1 Template Schema Additions

New columns on `workflow_templates` (future migration):

| Column | Type | Purpose |
|--------|------|---------|
| `system_prompt` | text | Claude Agent SDK system prompt for this template |
| `target_persona` | text | Description of target contact persona |
| `estimated_cost` | real | Estimated cost per run in USD |
| `total_runs` | integer DEFAULT 0 | Lifetime run count |
| `last_run_at` | integer | Timestamp of most recent run |

### 5.2 Template Cards

#### Search & Prospecting Templates

**1. Top AI Influencers**
- Type: `search`
- System prompt: "Search for and identify the top 50 AI/ML influencers on X/Twitter. Look for people with 10k+ followers who regularly post about AI, machine learning, LLMs, and related topics. Extract their profile data and create contacts."
- Default config: `{ maxResults: 50, sources: ["x.com", "github.com", "wikipedia.org"] }`
- Expected steps: web_search → url_fetch/browser_scrape → llm_extract → contact_create
- Estimated cost: ~$0.50

**2. Fintech Leaders**
- Type: `search`
- System prompt: "Find fintech industry leaders — CEOs, CTOs, and VPs at companies in payments, banking, lending, and crypto. Focus on people actively sharing insights on X/Twitter and LinkedIn."
- Default config: `{ maxResults: 30, sources: ["linkedin.com", "x.com", "crunchbase.com"] }`
- Estimated cost: ~$0.40

**3. Developer Advocates**
- Type: `search`
- System prompt: "Identify developer advocates and DevRel professionals at major tech companies. Look for people who speak at conferences, maintain popular open-source projects, or have active technical blogs."
- Default config: `{ maxResults: 40, sources: ["github.com", "x.com", "dev.to"] }`
- Estimated cost: ~$0.35

#### Enrichment Templates

**4. Enrich Low-Score Contacts**
- Type: `enrich`
- System prompt: "For each contact with enrichment score below 40, search for additional information using their name, company, and any known social profiles. Fill in missing fields."
- Default config: `{ maxEnrichmentScore: 40, maxContacts: 50 }`
- Expected steps: per contact: web_search → url_fetch → llm_extract → enrich_contact
- Estimated cost: ~$0.30

**5. Fill Email Gaps**
- Type: `enrich`
- System prompt: "For contacts missing email addresses, search the web for their professional email. Check company about pages, GitHub profiles, personal websites, and conference speaker pages."
- Default config: `{ missingField: "email", maxContacts: 30 }`
- Estimated cost: ~$0.25

#### Pruning Templates

**6. Prune Inactive Contacts**
- Type: `prune`
- System prompt: "Evaluate each contact. Archive contacts that have no platform activity in the last 6 months AND no engagement interactions in OpenVolo AND an enrichment score below 20."
- Default config: `{ inactiveDays: 180, maxEnrichmentScore: 20 }`
- Expected steps: per contact: evaluate criteria → decision → contact_archive
- Estimated cost: ~$0.10

**7. Prune by Company**
- Type: `prune`
- System prompt: "Archive all contacts from the specified company. This is useful for removing contacts from your own organization or companies you don't want to campaign."
- Default config: `{ company: "" }` (user fills in)
- Estimated cost: ~$0.05

#### Custom

**8. Custom Search**
- Type: `search`
- System prompt: (user-defined)
- Default config: `{ maxResults: 20 }`
- UI: Full prompt editor + config form

### 5.3 Template Gallery UI

Card grid showing each template with:
- Type icon (matching the 6 workflow type icons)
- Name and description
- Estimated cost badge
- "Run" button → opens activation dialog

---

## 6. Pruning Workflows

### 6.1 Execution Flow

```
1. User selects prune template (or creates custom)
2. User provides prune criteria (prompt + optional filters)
3. System creates workflow_run (type: "prune")
4. Agent evaluates contacts in batches:
   a. Load batch of 50 contacts
   b. Send to Claude with prune criteria
   c. Claude returns per-contact decision: { archive: boolean, reason: string }
   d. For each "archive" decision:
      - Create contact_archive workflow step
      - Update contact metadata: { archived: true, archiveReason: "...", archivedAt: timestamp }
   e. For each "keep" decision:
      - Create decision workflow step with reason
5. Update run counters (processedItems, successItems for archived, skippedItems for kept)
6. Complete run
```

### 6.2 Prune Result Schema

Stored in `workflowRuns.result` JSON:

```json
{
  "evaluated": 150,
  "archived": 23,
  "kept": 127,
  "errors": 0,
  "topReasons": [
    { "reason": "No activity in 8 months, score 12", "count": 15 },
    { "reason": "Company match: Acme Corp", "count": 8 }
  ]
}
```

### 6.3 Undo Capability

Pruned contacts are archived (soft-delete), not permanently removed:
- `contacts.metadata.archived = true`
- `contacts.metadata.archivedAt = <timestamp>`
- `contacts.metadata.archiveReason = "..."`
- `contacts.metadata.archiveWorkflowRunId = "..."`

Undo: clear archive flags and restore contact to active state.
UI: "Archived Contacts" filter on contacts list, "Restore" button per contact.

---

## 7. Multi-Source Search/Scrape Workflows

### 7.1 Pipeline Phases

```
Search Phase ──→ Scrape Phase ──→ Extract Phase ──→ Merge Phase
(find URLs)      (fetch content)   (structure data)   (create/update contacts)
```

### 7.2 Search Phase

1. Agent formulates search queries from template system prompt
2. Calls `search_web()` tool with queries
3. Ranks and deduplicates URLs
4. Filters out irrelevant results
5. Creates `web_search` workflow steps

### 7.3 Scrape Phase

For each URL from search results:

1. Apply routing rules (Section 3) to choose strategy
2. Call `url_fetch()` or `browser_scrape()` tool
3. Create `url_fetch` or `browser_scrape` workflow step
4. Collect raw text/HTML content

### 7.4 Extract Phase

1. Send raw content to Claude via `generateObject()` with Zod schema
2. Extract structured contact fields:
   ```typescript
   {
     name: string;
     firstName?: string;
     lastName?: string;
     headline?: string;
     company?: string;
     title?: string;
     email?: string;
     bio?: string;
     location?: string;
     website?: string;
     socialProfiles?: { platform: string; url: string }[];
   }
   ```
3. Create `llm_extract` workflow step with extracted data

### 7.5 Merge Phase

1. For each extracted contact:
   a. Check for existing contact (email match, name+company match)
   b. If match found → call `enrich_contact()` tool (merge)
   c. If no match → create new contact + identity
2. Create `contact_merge` or `contact_create` workflow step

### 7.6 Source-Specific Extraction

| Source | Key Data | Extraction Method |
|--------|----------|-------------------|
| Wikipedia infoboxes | Name, born, occupation, awards | Cheerio `.infobox` selector |
| GitHub profiles | Name, company, location, bio, website | `url_fetch` + JSON-LD/meta tags |
| LinkedIn public profiles | Name, headline, company, location | `browser_scrape` + selectors |
| Personal websites | Name, bio, contact info, social links | `url_fetch` + LLM extraction |
| Company about pages | Team members: name, title, photo | `url_fetch` + LLM extraction |
| Conference speaker pages | Name, title, company, bio, photo | `url_fetch` + LLM extraction |

---

## 8. Scheduled/Repeatable Workflows

### 8.1 Scheduling Model

Extend the existing `scheduled_jobs` table to support workflow template triggers:

| Column Addition | Type | Purpose |
|----------------|------|---------|
| `template_id` | text FK | Link to workflow template |
| `cron_expression` | text | Cron schedule (e.g., `0 9 * * 1` for Monday 9am) |
| `enabled` | integer DEFAULT 1 | Toggle scheduling on/off |
| `last_triggered_at` | integer | Timestamp of last trigger |

### 8.2 Execution Flow

```
1. Scheduler checks scheduled_jobs every minute
2. For due jobs with template_id:
   a. Create new workflow_run from template config
   b. Set trigger = "scheduled"
   c. Execute workflow (agent or sync)
   d. Update scheduled_job with next run_at based on cron_expression
3. Archive pattern: completed runs remain queryable
   Template tracks total_runs and last_run_at
```

### 8.3 De-duplication

- Don't re-enrich contacts within cooldown window (7 days, from `metadata.browserEnrichment.scrapedAt`)
- Don't re-create contacts already in the system (email/platformUserId dedup)
- Don't re-search URLs already fetched in the current run (URL set tracking)

---

## 9. Progress Tracking Enhancements

### 9.1 Source-Aware Tracking

Current tracking counts items processed. Enhanced tracking adds source context:

| Metric | Current | Enhanced |
|--------|---------|----------|
| Processed | `processedItems: 47` | `processedItems: 47, sourceTotal: 1000` |
| Batch | (none) | `currentBatch: 3, estimatedBatches: 7, batchSize: 150` |
| Cross-run | (none) | Template-level: `totalEnriched: 340 across 12 runs` |

### 9.2 Schema Additions on `workflow_runs`

| Column | Type | Purpose |
|--------|------|---------|
| `source_total` | integer | Total items at the source (e.g., Gmail has 1000 contacts) |
| `source_processed` | integer | Items processed from source so far (across runs) |

### 9.3 UI Enhancements

- **Progress bars with source context:** "347 of ~1,000 Gmail contacts synced"
- **Batch indicators:** "Batch 3 of ~7 (150 contacts this batch)"
- **Template-level stats:** "12 runs completed, 340 contacts enriched, $2.40 total cost"
- **Estimated completion:** Based on average batch time and remaining items

---

## 10. Schema Changes Summary

### 10.1 `workflow_templates` Additions

```sql
ALTER TABLE workflow_templates ADD COLUMN system_prompt TEXT;
ALTER TABLE workflow_templates ADD COLUMN target_persona TEXT;
ALTER TABLE workflow_templates ADD COLUMN estimated_cost REAL DEFAULT 0;
ALTER TABLE workflow_templates ADD COLUMN total_runs INTEGER DEFAULT 0;
ALTER TABLE workflow_templates ADD COLUMN last_run_at INTEGER;
```

### 10.2 `workflow_runs` Additions

```sql
ALTER TABLE workflow_runs ADD COLUMN source_total INTEGER;
ALTER TABLE workflow_runs ADD COLUMN source_processed INTEGER DEFAULT 0;
```

### 10.3 `scheduled_jobs` Additions

```sql
ALTER TABLE scheduled_jobs ADD COLUMN template_id TEXT REFERENCES workflow_templates(id);
ALTER TABLE scheduled_jobs ADD COLUMN cron_expression TEXT;
ALTER TABLE scheduled_jobs ADD COLUMN enabled INTEGER DEFAULT 1;
ALTER TABLE scheduled_jobs ADD COLUMN last_triggered_at INTEGER;
```

### 10.4 No New Tables Required

All new capabilities fit within the existing 15-table schema with column additions.
Routing rules are embedded in `workflowTemplates.config` JSON rather than a separate table.

---

## 11. API Routes

### 11.1 New Endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/workflows/templates/[id]/activate` | POST | Create a run from a template with user-provided config |
| `/api/workflows/templates/[id]/runs` | GET | List all runs spawned from a template |
| `/api/workflows/run-agent` | POST | Start an agentic workflow with Claude Agent SDK |
| `/api/workflows/[id]/progress` | GET | Live progress polling (returns counters + latest steps) |

### 11.2 Template Activation

```
POST /api/workflows/templates/[id]/activate
Body: {
  config?: {
    maxContacts?: number;
    targetPersona?: string;
    company?: string;       // for prune templates
    customPrompt?: string;  // override system prompt
  }
}
Response: { workflowRun: WorkflowRun }
```

### 11.3 Agent Run

```
POST /api/workflows/run-agent
Body: {
  templateId?: string;
  workflowType: "search" | "enrich" | "prune" | "agent";
  systemPrompt: string;
  config: AgentConfig;
}
Response: { workflowRun: WorkflowRun }
```

The agent run is asynchronous. The response returns immediately with the created
run. The client polls `/api/workflows/[id]/progress` for live updates.

### 11.4 Progress Polling

```
GET /api/workflows/[id]/progress
Response: {
  run: WorkflowRun;
  recentSteps: WorkflowStep[];   // Last 10 steps
  isComplete: boolean;
}
```

Poll interval: 2 seconds while `status === "running"`.

---

## 12. UI Changes

### 12.1 Template Gallery

New section on the Workflows page (above the run list):

- Card grid layout matching the stat cards aesthetic
- Each card: type icon, name, description, estimated cost, "Run" button
- Filter by template type (search, enrich, prune, sequence)
- "Create Custom" card at the end

### 12.2 Activation Dialog

Modal that opens when clicking "Run" on a template:

- Template name and description (read-only)
- System prompt (editable, pre-filled from template)
- Config fields (dynamic based on template type):
  - Search: max results, target domains
  - Enrich: max contacts, max enrichment score threshold
  - Prune: company name, inactivity days, custom criteria
- Estimated cost display
- "Start Workflow" button

### 12.3 Run Progress View

Enhanced workflow detail page for running workflows:

- **Step feed** — Real-time list of steps as they complete:
  - `thinking` → "Analyzing contact profile..."
  - `tool_call` → "Searching web for Jane Doe..."
  - `tool_result` → "Found 3 results"
  - `routing_decision` → "Using url_fetch for wikipedia.org"
  - `contact_merge` → "Updated company field for Jane Doe"
- **Cost ticker** — Running total of tokens used and estimated USD cost
- **Progress bar** — `processedItems / totalItems` with source context

### 12.4 Prune Results View

After a prune workflow completes:

- Summary card: evaluated, archived, kept, cost
- Table of archived contacts with archive reason
- "Restore" button per contact (clears archive metadata)
- "Restore All" button for bulk undo

---

## 13. Implementation Phases

### Phase 3B — Campaign Template Framework

**Delivers:** Template CRUD UI, gallery, activation flow

1. Add schema columns to `workflow_templates` (system_prompt, target_persona, etc.)
2. Seed 7 pre-defined templates
3. Build template gallery UI (card grid)
4. Build activation dialog (config form + start button)
5. Wire `POST /api/workflows/templates/[id]/activate`
6. Show template runs in workflow detail

**Files to create/modify:**
- `src/app/dashboard/workflows/template-gallery.tsx` — Gallery component
- `src/app/dashboard/workflows/activate-dialog.tsx` — Activation modal
- `src/app/api/workflows/templates/[id]/activate/route.ts` — Activation endpoint
- `src/app/api/workflows/templates/[id]/runs/route.ts` — Template runs list
- `src/lib/db/seed-templates.ts` — Pre-defined template data

### Phase 3C — Agent Router + Multi-Source

**Delivers:** Claude Agent SDK tools, routing engine, search/scrape workflows

1. Implement 5 agent tools (Section 2)
2. Build routing engine (Section 3)
3. Wire tools into Claude Agent SDK agent
4. Implement `POST /api/workflows/run-agent`
5. Build progress polling UI
6. Add Tavily/Brave Search API key management

**Files to create/modify:**
- `src/lib/agents/tools/url-fetch.ts` — URL fetch tool
- `src/lib/agents/tools/browser-scrape.ts` — Browser scrape tool
- `src/lib/agents/tools/search-web.ts` — Web search tool
- `src/lib/agents/tools/enrich-contact.ts` — Contact enrichment tool
- `src/lib/agents/tools/update-progress.ts` — Progress reporting tool
- `src/lib/agents/router.ts` — Routing decision engine
- `src/lib/agents/run-agent-workflow.ts` — Agent execution orchestrator
- `src/app/api/workflows/run-agent/route.ts` — Agent run endpoint
- `src/app/api/workflows/[id]/progress/route.ts` — Progress polling endpoint

### Phase 3D — Prune + Scheduling

**Delivers:** Prune workflows, cron scheduling, repeatable runs

1. Implement prune workflow execution
2. Add archive metadata pattern to contacts
3. Build prune results UI (archived contacts table, restore buttons)
4. Add cron columns to `scheduled_jobs`
5. Build scheduler runner (check due jobs, create runs)
6. Build schedule management UI (enable/disable, cron editor)

**Files to create/modify:**
- `src/lib/agents/run-prune-workflow.ts` — Prune execution logic
- `src/lib/scheduler/runner.ts` — Cron job checker and executor
- `src/app/dashboard/workflows/prune-results.tsx` — Prune results view
- `src/app/dashboard/workflows/schedule-dialog.tsx` — Schedule management
- `src/app/api/workflows/schedule/route.ts` — Schedule CRUD

---

## 14. Files to Create/Modify

### New Files

| Path | Purpose |
|------|---------|
| `src/lib/agents/tools/url-fetch.ts` | URL fetch + Cheerio extraction |
| `src/lib/agents/tools/browser-scrape.ts` | Playwright scrape wrapper |
| `src/lib/agents/tools/search-web.ts` | Tavily/Brave search wrapper |
| `src/lib/agents/tools/enrich-contact.ts` | Contact merge tool |
| `src/lib/agents/tools/update-progress.ts` | Progress reporting tool |
| `src/lib/agents/router.ts` | Routing decision engine |
| `src/lib/agents/run-agent-workflow.ts` | Agent workflow orchestrator |
| `src/lib/agents/run-prune-workflow.ts` | Prune workflow execution |
| `src/lib/scheduler/runner.ts` | Cron job scheduler |
| `src/lib/db/seed-templates.ts` | Pre-defined template data |
| `src/app/api/workflows/run-agent/route.ts` | Agent run API |
| `src/app/api/workflows/[id]/progress/route.ts` | Progress polling API |
| `src/app/api/workflows/templates/[id]/activate/route.ts` | Template activation API |
| `src/app/api/workflows/templates/[id]/runs/route.ts` | Template runs list API |
| `src/app/api/workflows/schedule/route.ts` | Schedule CRUD API |
| `src/app/dashboard/workflows/template-gallery.tsx` | Template card grid |
| `src/app/dashboard/workflows/activate-dialog.tsx` | Activation modal |
| `src/app/dashboard/workflows/prune-results.tsx` | Prune results view |
| `src/app/dashboard/workflows/schedule-dialog.tsx` | Schedule management |

### Modified Files

| Path | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add columns to workflow_templates, workflow_runs, scheduled_jobs |
| `src/lib/db/types.ts` | Updated type inference for new columns |
| `src/app/dashboard/workflows/page.tsx` | Add template gallery section |
| `src/app/dashboard/workflows/[id]/page.tsx` | Add progress polling, prune results |
| `src/app/dashboard/settings/page.tsx` | Add search API key management |
| `src/components/app-sidebar.tsx` | No change (already consolidated) |

---

## 15. Verification Checklist

### Phase 3B

- [ ] Template gallery renders 7 pre-defined templates
- [ ] Activation dialog opens with correct config fields per template type
- [ ] `POST /api/workflows/templates/[id]/activate` creates a workflow run
- [ ] Template detail shows all runs spawned from it
- [ ] Template `total_runs` and `last_run_at` update after each run

### Phase 3C

- [ ] `url_fetch` tool returns structured content for Wikipedia, GitHub
- [ ] `browser_scrape` tool returns extracted data for X profiles
- [ ] `search_web` tool returns ranked results from Tavily/Brave
- [ ] Routing engine selects correct strategy per domain
- [ ] Agent creates workflow steps for every tool call and decision
- [ ] Progress polling returns real-time step updates
- [ ] End-to-end: search template → web search → scrape → extract → create contacts

### Phase 3D

- [ ] Prune template evaluates contacts against criteria
- [ ] Archived contacts have restore capability
- [ ] Scheduled jobs run on cron expression
- [ ] Scheduled workflow creates new run each trigger
- [ ] Schedule can be enabled/disabled from UI
- [ ] De-duplication prevents re-enrichment within cooldown
