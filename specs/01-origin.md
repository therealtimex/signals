# OpenVolo Origin Specification

> Phase 0 — Foundation complete. This document captures every architectural decision,
> schema definition, and file location as of the initial build.
>
> Implements the vision defined in [`specs/00-init.md`](./00-init.md).

---

## 1. Project Overview

**OpenVolo** is an agentic AI-native social CRM for X/Twitter and LinkedIn. It ships as a
single npm package — `npx openvolo` boots a full local application with zero external
dependencies beyond Node.js 18+.

**Core premise:** Claude-powered multi-agent systems autonomously manage social media
outreach, engagement tracking, content scheduling, and campaign orchestration while
keeping the human in the loop for approvals and strategy. Agents are goal-driven — the
user defines objectives (grow network, increase engagement, nurture leads) and agents
plan and execute steps to achieve them.

**Multi-strategy data acquisition:** OpenVolo combines three complementary approaches to
interact with social platforms:
- **Official APIs** — X API v2 and LinkedIn API for authenticated, rate-limited actions
- **Playwright headless browser** — for session-based automation, scraping profile data,
  and actions not available via API
- **Scraping best practices** — respectful crawling with rate limits, caching, and
  robots.txt compliance

**Target platforms:** X/Twitter (Phase 1), LinkedIn (Phase 4).

**Auth flexibility:** Users authenticate with their Anthropic API key or use their
Claude Code Max/Pro subscription. The system detects the available auth method
automatically.

**Delivery model:** Single Next.js application with embedded SQLite database. No Docker,
no cloud services required. Everything runs on the user's machine with data stored at
`~/.openvolo/`.

**Key UI paradigms:**
- **Kanban board** — visual tracking of agentic AI activities, task states, and
  approval queues
- **Funnel visualization** — campaign pipeline view showing contacts progressing through
  stages (prospect → engaged → qualified → opportunity → customer → advocate)
- **Multimodal content management** — create, schedule, and publish posts, threads,
  articles, images, and video targeting platform-specific engagement patterns
- **Workflow builder** — visual orchestration of multi-step agent sequences

---

## 2. Architecture

### System Diagram

```
npx openvolo
    │
    ▼
bin/cli.ts ─── creates ~/.openvolo/ dirs
    │           runs drizzle-kit push
    │           finds available port
    │           spawns next dev --turbopack
    │
    ▼
Next.js 16.1 App
    ├── src/app/page.tsx ──────────── redirect → /dashboard
    ├── src/app/dashboard/layout.tsx ─ SidebarProvider + AppSidebar
    ├── src/app/dashboard/**         ─ 11 page routes
    ├── src/app/api/settings/        ─ API key management
    ├── src/app/api/ai/              ─ (Phase 2) AI chat
    ├── src/app/api/agents/          ─ (Phase 3) Agent execution
    ├── src/app/api/platforms/       ─ (Phase 1/4) Platform APIs
    └── src/app/api/cron/            ─ (Phase 3) Scheduled jobs
            │
            ▼
    src/lib/db/client.ts ─── better-sqlite3 + Drizzle ORM
            │
            ▼
    ~/.openvolo/data.db (SQLite, WAL mode)
    ~/.openvolo/config.json (encrypted credentials)
```

### Directory Layout

```
openvolo/
├── bin/cli.ts                    # npx entry point
├── specs/                        # Specifications (this file)
├── src/
│   ├── app/
│   │   ├── page.tsx              # Root redirect → /dashboard
│   │   ├── layout.tsx            # Root layout (html, body)
│   │   ├── globals.css           # Tailwind CSS 4 imports
│   │   ├── dashboard/
│   │   │   ├── layout.tsx        # Sidebar + content shell
│   │   │   ├── page.tsx          # Dashboard home
│   │   │   ├── contacts/         # Contact list + [id] detail
│   │   │   ├── content/          # Content list + [id] detail
│   │   │   ├── workflows/        # Workflow hub (list/kanban/swimlane views, [id] detail)
│   │   │   └── settings/         # API key + platform config
│   │   └── api/
│   │       ├── settings/route.ts # GET/POST API key management
│   │       ├── ai/chat/          # (Phase 2)
│   │       ├── agents/           # (Phase 3) run/status/approve
│   │       ├── platforms/        # (Phase 1/4) x/ + linkedin/
│   │       └── cron/scheduler/   # (Phase 3)
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts         # 15 Drizzle table definitions
│   │   │   ├── client.ts         # DB connection + exports
│   │   │   ├── types.ts          # Drizzle-inferred TypeScript types
│   │   │   ├── migrations/       # Generated SQL migrations
│   │   │   └── queries/          # Contact, task, dashboard queries
│   │   ├── auth/
│   │   │   ├── crypto.ts         # AES-256-GCM encrypt/decrypt
│   │   │   └── claude-auth.ts    # API key save/get/validate/clear
│   │   ├── workflows/            # Workflow types, sync wrapper, run helpers
│   │   ├── platforms/            # Platform adapters (x, linkedin, gmail)
│   │   ├── browser/              # Browser enrichment (Playwright, anti-detection)
│   │   └── ai/                   # AI utilities
│   └── components/
│       ├── app-sidebar.tsx       # Navigation sidebar
│       ├── contact-form.tsx      # Reusable contact form
│       ├── add-contact-dialog.tsx # Add contact dialog
│       ├── add-task-dialog.tsx   # Add task dialog
│       ├── funnel-stage-badge.tsx # Color-coded funnel stage badge
│       ├── priority-badge.tsx    # Color-coded priority badge
│       └── ui/                   # 19 shadcn/ui components
├── package.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── components.json
├── postcss.config.mjs
└── .npmrc                       # legacy-peer-deps=true
```

---

## 3. Tech Stack

| Package | Version | Purpose |
|---|---|---|
| next | 16.1.6 | App framework, Turbopack default |
| react | 19.2.4 | UI library |
| react-dom | 19.2.4 | React DOM renderer |
| ai (Vercel AI SDK) | 6.0.76 | UI-tier chat streaming |
| @ai-sdk/anthropic | 3.0.38 | Anthropic provider for Vercel AI SDK |
| @anthropic-ai/claude-agent-sdk | latest | Agent-tier autonomous execution |
| drizzle-orm | 0.45.1 | Type-safe SQL query builder |
| drizzle-kit | 0.31.8 | Schema migrations and studio |
| better-sqlite3 | 12.6.2 | SQLite driver (native) |
| tailwindcss | 4.1.18 | Utility-first CSS (v4, CSS-native) |
| tw-animate-css | 1.4.0 | Tailwind animation utilities |
| radix-ui | 1.4.3 | Headless UI primitives |
| lucide-react | 0.500.0 | Icon library |
| commander | 14.0.3 | CLI argument parsing |
| nanoid | 5.1.0 | ID generation |
| zod | 3.24.x | Schema validation (pinned to v3) |
| class-variance-authority | 0.7.1 | Component variant API |
| clsx | 2.1.0 | Conditional classnames |
| tailwind-merge | 3.0.0 | Tailwind class deduplication |
| cmdk | 1.1.1 | Command palette |
| @tiptap/react | 3.19.0 | Rich text editor |
| @tiptap/starter-kit | 3.19.0 | TipTap default extensions |
| @dnd-kit/core | 6.3.1 | Drag and drop |
| @dnd-kit/sortable | 10.0.0 | Sortable lists |
| open | 10.0.0 | Cross-platform browser opener |
| typescript | 5.8.x | Type system |
| vitest | 3.0.x | Test runner |

### Key Design Decisions

- **Two-tier AI architecture.** Vercel AI SDK 6 handles UI chat streaming with React
  Server Components. Claude Agent SDK handles autonomous multi-step agent runs with
  tool use and human-in-the-loop approvals. Supports both API keys and Claude Code
  Max/Pro subscriptions.
- **Unified workflow system.** The `workflow_runs` table tracks all operations — sync,
  enrichment, search, prune, sequence, and agent runs — with parent/child relationships
  via `parent_workflow_id`. See [`specs/06-unified-workflows.md`](./06-unified-workflows.md).
- **Playwright for browser automation.** Session-based platform interactions that aren't
  possible via official APIs — profile scraping, cookie-authenticated actions, and
  visual page interaction. Located at `src/lib/browser/` (Phase 4).
- **SQLite over Postgres.** Zero configuration. No Docker. File-based at
  `~/.openvolo/data.db` with WAL mode for concurrent reads. The entire CRM is
  portable — copy one file.
- **Drizzle over Prisma.** Lighter runtime, SQL-close API, better SQLite support.
  Schema defined in TypeScript, migrations generated via `drizzle-kit`.
- **Tailwind CSS 4.** CSS-native engine (no JS config file). PostCSS integration via
  `@tailwindcss/postcss`.
- **Zod v3 pinned.** Zod v4 exists but has breaking API changes. v3.24 is stable and
  widely supported.
- **No Docker.** The app runs directly on Node.js 18+. `npx openvolo` is the entire
  deployment.

---

## 4. CLI Launcher — implemented

**File:** `bin/cli.ts`

The CLI is the primary entry point. `npx openvolo` runs the compiled version at
`dist/bin/cli.js`.

### Startup Sequence

1. **Parse arguments** — Commander handles `--port <number>` and `--reset` flags.
2. **`--reset` flag** — If set, deletes `~/.openvolo/data.db` (plus `-wal` and `-shm`
   files) and exits. Does not start the server.
3. **Create data directories** — Ensures `~/.openvolo/`, `~/.openvolo/sessions/`, and
   `~/.openvolo/media/` exist.
4. **Run database migrations** — Executes `npx drizzle-kit push --force` to sync schema
   to SQLite. Passes `OPENVOLO_DATA_DIR` env var. Failures are non-fatal.
5. **Find available port** — Starts from the preferred port (default 3000) and increments
   until a free port is found.
6. **Spawn Next.js dev server** — `npx next dev --turbopack --port <port>` with
   `OPENVOLO_DATA_DIR` and `PORT` env vars.
7. **Auto-open browser** — After 3 seconds, opens `http://localhost:<port>` using the
   `open` package. Falls back to a console message.
8. **Graceful shutdown** — Catches `SIGINT` and `SIGTERM`, forwards to the child process,
   and exits.

### CLI Options

| Flag | Default | Description |
|---|---|---|
| `-p, --port <number>` | 3000 | Preferred server port |
| `--reset` | — | Delete database and exit |

---

## 5. Database Schema — implemented

**File:** `src/lib/db/schema.ts`

15 tables organized into 6 domains. All IDs are text (nanoid). Timestamps are Unix epoch
seconds via `unixepoch()`. Foreign keys use cascade deletes where appropriate.

> **Note:** The original Phase 0 schema had 12 tables including `campaigns`, `campaign_steps`,
> `campaign_contacts`, `agent_runs`, and `agent_steps`. These were consolidated into the
> unified workflow system — see [`specs/06-unified-workflows.md`](./06-unified-workflows.md)
> for the complete current schema. The tables below document what remains from Phase 0
> plus the key additions.

**Connection:** `src/lib/db/client.ts` — creates a `better-sqlite3` instance with WAL
journal mode and foreign keys enabled, wraps it with Drizzle ORM.

**Schema sync:** `drizzle-kit push --force` is used on CLI startup (not `drizzle-kit migrate`).
The DB has no migration journal.

### 5.1 Platform / Auth

#### `platform_accounts`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| platform | text | enum: `x`, `linkedin` |
| display_name | text | not null |
| auth_type | text | enum: `oauth`, `session`, `api_key` |
| credentials_encrypted | text | JSON, AES-256 encrypted |
| rate_limit_state | text | JSON |
| status | text | enum: `active`, `paused`, `needs_reauth` — default `active` |
| last_synced_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

### 5.2 Contacts

#### `contacts`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| name | text | not null |
| headline | text | |
| company | text | |
| title | text | |
| platform | text | enum: `x`, `linkedin` |
| platform_user_id | text | |
| profile_url | text | |
| avatar_url | text | |
| email | text | |
| phone | text | |
| bio | text | |
| tags | text | JSON array, default `[]` |
| funnel_stage | text | enum: `prospect`, `engaged`, `qualified`, `opportunity`, `customer`, `advocate` — default `prospect` |
| score | integer | default 0 |
| metadata | text | JSON, default `{}` |
| last_interaction_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

### 5.3 Workflow Templates (formerly Campaigns)

> Full schema details in [`specs/06-unified-workflows.md`](./06-unified-workflows.md) Section 3.

#### `workflow_templates`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| name | text | not null |
| description | text | |
| platform | text | enum: `x`, `linkedin`, `gmail`, `substack` |
| template_type | text | enum: `outreach`, `engagement`, `content`, `nurture`, `prospecting`, `enrichment`, `pruning` — not null |
| status | text | enum: `draft`, `active`, `paused`, `completed` — default `draft` |
| config | text | JSON, default `{}` |
| goal_metrics | text | JSON, default `{}` |
| starts_at | integer | |
| ends_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

#### `workflow_template_steps`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| template_id | text FK | → workflow_templates.id, cascade delete |
| step_index | integer | not null |
| step_type | text | enum: `connect`, `message`, `follow`, `like`, `comment`, `wait`, `condition` |
| config | text | JSON, default `{}` |
| delay_hours | integer | default 0 |

#### `workflow_enrollments`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| template_id | text FK | → workflow_templates.id, cascade delete |
| contact_id | text FK | → contacts.id, cascade delete |
| workflow_run_id | text FK | → workflow_runs.id |
| status | text | enum: `pending`, `active`, `completed`, `replied`, `removed` — default `pending` |
| current_step_index | integer | default 0 |
| enrolled_at | integer | default `unixepoch()` |
| completed_at | integer | |

### 5.4 Content

#### `content_items`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| title | text | not null |
| body | text | |
| content_type | text | enum: `post`, `article`, `thread`, `reply`, `image`, `video` |
| platform_target | text | |
| media_paths | text | JSON array, default `[]` |
| status | text | enum: `draft`, `review`, `approved`, `scheduled`, `published` — default `draft` |
| ai_generated | integer (bool) | default false |
| generation_prompt | text | |
| scheduled_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

#### `content_posts`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| content_item_id | text FK | → content_items.id, cascade delete |
| platform_account_id | text FK | → platform_accounts.id, cascade delete |
| platform_post_id | text | |
| platform_url | text | |
| published_at | integer | |
| status | text | enum: `scheduled`, `publishing`, `published`, `failed` — default `scheduled` |
| engagement_snapshot | text | JSON, default `{}` |

### 5.5 Engagements

#### `engagements`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| contact_id | text FK | → contacts.id, cascade delete |
| platform_account_id | text FK | → platform_accounts.id (nullable) |
| engagement_type | text | enum: `connection_request`, `message`, `like`, `comment`, `share`, `follow`, `view`, `reply` |
| direction | text | enum: `inbound`, `outbound` |
| content | text | |
| template_id | text FK | → workflow_templates.id (nullable) |
| workflow_run_id | text FK | → workflow_runs.id (nullable) |
| created_at | integer | default `unixepoch()` |

### 5.6 Tasks

#### `tasks`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| title | text | not null |
| description | text | |
| task_type | text | enum: `manual`, `agent_review`, `follow_up`, `content_review` — default `manual` |
| status | text | enum: `todo`, `in_progress`, `blocked`, `done` — default `todo` |
| priority | text | enum: `low`, `medium`, `high`, `urgent` — default `medium` |
| assignee | text | enum: `user`, `agent` — default `user` |
| related_contact_id | text FK | → contacts.id (nullable) |
| related_template_id | text FK | → workflow_templates.id (nullable) |
| due_at | integer | |
| completed_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

### 5.7 Workflow Runs & Steps / Jobs

> Full schema details in [`specs/06-unified-workflows.md`](./06-unified-workflows.md) Section 3.

#### `workflow_runs`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| template_id | text FK | → workflow_templates.id (nullable) |
| workflow_type | text | enum: `sync`, `enrich`, `search`, `prune`, `sequence`, `agent` — not null |
| platform_account_id | text FK | → platform_accounts.id (nullable) |
| status | text | enum: `pending`, `running`, `paused`, `completed`, `failed`, `cancelled` — default `pending` |
| total_items | integer | |
| processed_items | integer | default 0 |
| success_items | integer | default 0 |
| skipped_items | integer | default 0 |
| error_items | integer | default 0 |
| config | text | JSON, default `{}` |
| result | text | JSON, default `{}` |
| errors | text | JSON array, default `[]` |
| trigger | text | enum: `user`, `scheduled`, `template` — default `user` |
| model | text | AI model ID |
| input_tokens | integer | default 0 |
| output_tokens | integer | default 0 |
| cost_usd | real | default 0 |
| parent_workflow_id | text | self-FK for sub-workflows |
| started_at | integer | |
| completed_at | integer | |
| created_at | integer | default `unixepoch()` |
| updated_at | integer | default `unixepoch()` |

#### `workflow_steps`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| workflow_run_id | text FK | → workflow_runs.id, cascade delete |
| step_index | integer | not null |
| step_type | text | 15 types across 3 categories (pipeline, agent, observability) |
| status | text | enum: `pending`, `running`, `completed`, `failed`, `skipped` — default `pending` |
| contact_id | text FK | → contacts.id (nullable) |
| url | text | |
| tool | text | |
| input | text | JSON, default `{}` |
| output | text | JSON, default `{}` |
| error | text | |
| duration_ms | integer | |
| created_at | integer | default `unixepoch()` |

#### `scheduled_jobs`

| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| job_type | text | not null |
| payload | text | JSON, default `{}` |
| status | text | enum: `pending`, `running`, `completed`, `failed` — default `pending` |
| run_at | integer | not null |
| started_at | integer | |
| completed_at | integer | |
| retry_count | integer | default 0 |
| max_retries | integer | default 3 |
| error | text | |
| created_at | integer | default `unixepoch()` |

---

## 6. Authentication — implemented

**Files:** `src/lib/auth/crypto.ts`, `src/lib/auth/claude-auth.ts`

### Encryption

- **Algorithm:** AES-256-GCM
- **Key derivation:** SHA-256 hash of a machine-specific passphrase
  (`openvolo:<hostname>:<username>`)
- **IV:** 16 random bytes per encryption
- **Storage format:** Base64-encoded `iv + authTag + ciphertext`
- **Config file:** `~/.openvolo/config.json`

### Auth Detection (three states)

| State | Detection | UI Badge |
|---|---|---|
| Environment variable | `process.env.ANTHROPIC_API_KEY` exists | Green "Environment Variable" |
| Saved config | Encrypted key in `config.json` | Green "Connected" |
| Not configured | Neither source present | Gray "Not configured" |

**Future:** Claude Code Max/Pro subscription support will provide an alternative auth
path where users leverage their existing Claude subscription instead of a separate API key.

### API Key Lifecycle

1. **Save:** User enters key in settings UI → POST `/api/settings` with
   `action: "save_key"` → key validated against Anthropic API (sends a minimal request
   to claude-haiku-4-5) → encrypted and written to `config.json`.
2. **Read:** `getApiKey()` checks env var first, then decrypts from config. Env var
   takes priority.
3. **Clear:** POST `/api/settings` with `action: "clear_key"` → removes key from config.
4. **Mask:** `getAuthSource()` returns first 10 characters + `"...****"` for UI display.

---

## 7. API Endpoints — partial

### Implemented (Phase 0)

#### `GET /api/settings`

Returns current auth state.

```json
{ "source": "env_var" | "config" | "none", "keyPrefix": "sk-ant-api0...**", "hasKey": true }
```

#### `POST /api/settings`

Actions: `save_key` (with `apiKey` field) and `clear_key`.

- `save_key` validates the key against `api.anthropic.com` before saving.
- Returns `{ success: true }` or `{ error: "..." }` with 400 status.

### Implemented (Phase 1)

#### `GET /api/contacts`

Returns contact list. Query params: `search`, `funnelStage`, `platform`.

#### `POST /api/contacts`

Creates contact. Zod validation. Returns 201.

#### `GET/PUT/DELETE /api/contacts/[id]`

Single contact operations. Returns 404 if not found. DELETE returns 204.

#### `GET /api/tasks`

Returns task list. Query params: `status`, `priority`, `assignee`.

#### `POST /api/tasks`

Creates task. Zod validation. Returns 201.

#### `GET/PUT/DELETE /api/tasks/[id]`

Single task operations. Auto-sets `completedAt` on `status=done`.

### Planned Endpoint Directories

| Path | Phase | Purpose |
|---|---|---|
| `/api/ai/chat` | 2 | Vercel AI SDK streaming chat |
| `/api/agents/run` | 3 | Start agent execution |
| `/api/agents/status` | 3 | Poll agent run status |
| `/api/agents/approve` | 3 | Human-in-the-loop approvals |
| `/api/platforms/x/auth` | 1 | X OAuth 2.0 flow |
| `/api/platforms/x/actions` | 1 | X API v2 actions |
| `/api/platforms/linkedin/auth` | 4 | LinkedIn OAuth |
| `/api/platforms/linkedin/actions` | 4 | LinkedIn API actions |
| `/api/cron/scheduler` | 3 | Scheduled job execution |

---

## 8. UI Shell — partial

### Root Layout — implemented

**File:** `src/app/layout.tsx`

- **Fonts:** Geist Sans (`--font-geist-sans`) and Geist Mono (`--font-geist-mono`) via
  `next/font/google`. Applied to `<body>` via CSS variable classnames with `font-sans
  antialiased`.
- **Metadata:** Title is `"OpenVolo — AI-Native Social CRM"`, description is
  `"Manage X/Twitter and LinkedIn with Claude-powered agents"`.
- **Hydration:** `suppressHydrationWarning` on `<html>` to prevent dark-mode flash mismatch.

### Theme & Colors — implemented

**File:** `src/app/globals.css`

The design system uses the **OKLch color space** (modern perceptually-uniform CSS colors)
with full light and dark themes via CSS custom properties.

- **Color space:** All colors defined as `oklch(L C H)` values
- **Dark mode:** Toggled via `:is(.dark *)` Tailwind 4 custom variant
- **Semantic tokens:** background, foreground, card, popover, primary, secondary, muted,
  accent, destructive, border, input, ring
- **Chart palette:** 5-color series (`--chart-1` through `--chart-5`) for data visualization
- **Sidebar tokens:** Dedicated sidebar color variables (sidebar, sidebar-foreground,
  sidebar-primary, sidebar-accent, sidebar-border, sidebar-ring)
- **Border radius:** Base `--radius: 0.625rem` with computed sm/md/lg/xl variants
- **Base layer:** Global `border-border` and `outline-ring/50` on all elements, `bg-background
  text-foreground` on body

### Dashboard Layout — implemented

**File:** `src/app/dashboard/layout.tsx`

The dashboard uses shadcn/ui's `SidebarProvider` with `AppSidebar` and `SidebarInset`.
The header contains a `SidebarTrigger` (hamburger toggle). Content renders in a scrollable
main area with `p-6` padding.

### Sidebar Navigation — implemented

**File:** `src/components/app-sidebar.tsx`

6 navigation items (4 main + 2 footer):

| Item | Route | Icon | Position |
|---|---|---|---|
| Dashboard | `/dashboard` | LayoutDashboard | Main nav |
| Contacts | `/dashboard/contacts` | Users | Main nav |
| Content | `/dashboard/content` | FileText | Main nav |
| Workflows | `/dashboard/workflows` | GitBranch | Main nav |
| Settings | `/dashboard/settings` | Settings | Footer |
| Help | `/dashboard/help` | HelpCircle | Footer |

> Campaigns and Agents were consolidated into Workflows.
> See [`specs/06-unified-workflows.md`](./06-unified-workflows.md) for details.

Active state: exact match for `/dashboard`, prefix match for all others.

### Page Routes — partial

9 page routes across 5 sections:

| Route | Phase | Status | Description |
|---|---|---|---|
| `/dashboard` | 1 | implemented | Dashboard home — real metrics from DB (contact/workflow/content counts), recent contacts list, pending tasks list, 4-step onboarding checklist |
| `/dashboard/contacts` | 1 | implemented | Contact list — search by name/company, filter by funnel stage/platform, sortable table with stage badges and scores, add contact dialog |
| `/dashboard/contacts/[id]` | 1 | implemented | Contact detail — info display, edit form, identities tab, tasks tab, enrich button |
| `/dashboard/content` | 2 | implemented | Content library — compose dialog (single/thread), drafts tab, filters by type/origin/status |
| `/dashboard/content/[id]` | 2 | implemented | Content detail — engagement metrics, engagement actions (like/retweet/reply), thread context |
| `/dashboard/workflows` | 3 | implemented | Workflow hub — 3-view switcher (list/kanban/swimlane), quick actions, empty state |
| `/dashboard/workflows/[id]` | 3 | implemented | Workflow detail — summary cards, agent-specific cards, timeline/graph step visualization |
| `/dashboard/settings` | 0 | implemented | API key + platform connections (X, LinkedIn, Gmail) + browser enrichment session management |
| `/dashboard/help` | — | placeholder | Help page |

### Settings Page — implemented

**File:** `src/app/dashboard/settings/page.tsx`

Three-state auth UI:
- **State A (env_var):** Read-only display showing masked key prefix and instructions to
  update `.env.local`.
- **State B (config):** Shows masked key prefix with "Remove Key" button.
- **State C (none):** Input form with "Save & Validate" button and loading spinner.

Platform connections section shows X/Twitter (Phase 1) and LinkedIn (Phase 4) as
placeholder cards with phase badges.

### shadcn/ui Components (19 installed) — implemented

| Component | File |
|---|---|
| Alert Dialog | `src/components/ui/alert-dialog.tsx` |
| Avatar | `src/components/ui/avatar.tsx` |
| Badge | `src/components/ui/badge.tsx` |
| Button | `src/components/ui/button.tsx` |
| Card | `src/components/ui/card.tsx` |
| Dialog | `src/components/ui/dialog.tsx` |
| Dropdown Menu | `src/components/ui/dropdown-menu.tsx` |
| Input | `src/components/ui/input.tsx` |
| Label | `src/components/ui/label.tsx` |
| Scroll Area | `src/components/ui/scroll-area.tsx` |
| Select | `src/components/ui/select.tsx` |
| Separator | `src/components/ui/separator.tsx` |
| Sheet | `src/components/ui/sheet.tsx` |
| Sidebar | `src/components/ui/sidebar.tsx` |
| Skeleton | `src/components/ui/skeleton.tsx` |
| Table | `src/components/ui/table.tsx` |
| Tabs | `src/components/ui/tabs.tsx` |
| Textarea | `src/components/ui/textarea.tsx` |
| Tooltip | `src/components/ui/tooltip.tsx` |

**shadcn config:** New York style, zinc base color, CSS variables enabled, Lucide icons,
RSC enabled.

---

## 9. Configuration Files — implemented

### `package.json`

- **name:** `openvolo`
- **version:** `0.1.0`
- **type:** `module` (ESM)
- **bin:** `openvolo` → `./dist/bin/cli.js`
- **engines:** `node >= 18.0.0`
- **license:** Proprietary (`UNLICENSED` package metadata)

**Scripts:**

| Script | Command |
|---|---|
| `dev` | `next dev --turbopack` |
| `build` | `next build` |
| `start` | `next start` |
| `build:cli` | `tsc -p tsconfig.cli.json` |
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `drizzle-kit migrate` |
| `db:studio` | `drizzle-kit studio` |
| `lint` | `next lint` |
| `test` | `vitest` |
| `prepublishOnly` | `npm run build:cli && npm run build` |

### `tsconfig.json`

- **target:** ES2022
- **module:** ESNext with bundler resolution
- **strict:** true
- **jsx:** react-jsx
- **paths:** `@/*` → `./src/*`
- **incremental:** true
- **plugins:** `next`

### `tsconfig.cli.json`

Separate TypeScript config for building the CLI launcher (`bin/cli.ts`):

- **target:** ES2022
- **module:** ESNext with bundler resolution
- **outDir:** `./dist`
- **includes:** `bin/**/*.ts` only
- **declaration:** false (no type exports needed)

Used by the `build:cli` script: `tsc -p tsconfig.cli.json`.

### `next.config.ts`

- **serverExternalPackages:** `["better-sqlite3"]` — prevents bundling the native module.

### `drizzle.config.ts`

- **schema:** `./src/lib/db/schema.ts`
- **out:** `./src/lib/db/migrations`
- **dialect:** sqlite
- **dbCredentials.url:** `~/.openvolo/data.db`

### `components.json`

- **style:** new-york
- **rsc:** true
- **css:** `src/app/globals.css`
- **baseColor:** zinc
- **iconLibrary:** lucide

### `.npmrc`

Contains `legacy-peer-deps=true` to resolve the zod v3/v4 peer dependency conflict
between `ai` SDK (requires zod ≥3.25) and `@anthropic-ai/claude-agent-sdk` (requires
zod ≥4.0). Required for `npx shadcn` installs and general `npm install`.

### Environment Variables — implemented

**File:** `.env.example` (copy to `.env.local`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Claude Agent SDK + Vercel AI SDK authentication |
| `X_CLIENT_ID` | No | — | X/Twitter OAuth 2.0 client ID |
| `X_CLIENT_SECRET` | No | — | X/Twitter OAuth 2.0 client secret |
| `LINKEDIN_CLIENT_ID` | No | — | LinkedIn OAuth client ID |
| `LINKEDIN_CLIENT_SECRET` | No | — | LinkedIn OAuth client secret |
| `PORT` | No | 3000 | Server port |
| `OPENVOLO_DATA_DIR` | No | `~/.openvolo` | Data directory path |

---

## 10. Phase Roadmap

| Phase | Name | Status | Delivers |
|---|---|---|---|
| **0** | Foundation | complete | CLI launcher, database schema, auth system (AES-256), UI shell with sidebar, settings page with three-state auth |
| **1** | Core CRM + X/Twitter | complete | Contact CRUD, task CRUD, X OAuth 2.0, X API v2 client, platform adapter interface, rate limiter, contact identities (golden record), enrichment scores. See [`specs/02-channels.md`](./02-channels.md) |
| **2** | Content + Channels | complete | Content sync (tweets/mentions), engagement tracking, Gmail OAuth + People API + email metadata, LinkedIn OAuth + OpenID Connect, compose/draft/publish, thread posting. See [`specs/03-content-sync.md`](./03-content-sync.md) |
| **2.5** | Browser Enrichment | complete | Playwright headless browser, X profile scraping, LLM extraction, anti-detection, profile merge. See [`specs/05-browser-enrichment.md`](./05-browser-enrichment.md) |
| **3A** | Workflow Foundation | complete | Unified workflow system (merged campaigns + agents + workflows), observable pipeline tracking, 4 visualization views (list/kanban/swimlane/graph). See [`specs/06-unified-workflows.md`](./06-unified-workflows.md) |
| **3B** | Campaign Templates | planned | Template gallery, activation dialog, pre-defined campaign templates. See [`specs/07-agentic-workflows.md`](./07-agentic-workflows.md) |
| **3C** | Agent Router | planned | Claude Agent SDK tools, routing engine, multi-source search/scrape workflows |
| **3D** | Prune + Scheduling | planned | Prune workflows, cron scheduling, repeatable runs |
| **4** | Analytics + Insights | planned | Engagement analytics, funnel metrics, agent cost tracking, content performance dashboards |
| **5** | Polish + Distribution | planned | npm publish pipeline, onboarding wizard, documentation, performance optimization |

---

## 11. File Index

| Path | Purpose | Status |
|---|---|---|
| `bin/cli.ts` | CLI entry point — npx openvolo (+ auto identity migration) | exists |
| `src/app/layout.tsx` | Root layout (fonts, metadata, html/body) | exists |
| `src/app/globals.css` | Theme system (OKLch colors, light/dark, radii) | exists |
| `src/app/page.tsx` | Root redirect → /dashboard | exists |
| `src/app/dashboard/layout.tsx` | Dashboard shell (sidebar + content) | exists |
| `src/app/dashboard/page.tsx` | Dashboard home | exists |
| `src/app/dashboard/settings/page.tsx` | Settings page (auth + platforms + browser session) | exists |
| `src/app/dashboard/contacts/page.tsx` | Contact list page (server component) | exists |
| `src/app/dashboard/contacts/[id]/page.tsx` | Contact detail page (server component) | exists |
| `src/app/dashboard/content/page.tsx` | Content list with compose button + drafts tab | exists |
| `src/app/dashboard/content/[id]/page.tsx` | Content detail with engagement actions | exists |
| `src/app/dashboard/workflows/page.tsx` | Workflow hub with view switcher | exists |
| `src/app/dashboard/workflows/[id]/page.tsx` | Workflow detail with timeline/graph | exists |
| `src/app/api/settings/route.ts` | API key management endpoint | exists |
| `src/app/api/contacts/route.ts` | GET/POST contacts endpoint | exists |
| `src/app/api/contacts/[id]/route.ts` | GET/PUT/DELETE single contact | exists |
| `src/app/api/contacts/[id]/identities/route.ts` | Identity CRUD for a contact | exists |
| `src/app/api/content/route.ts` | GET/POST content items | exists |
| `src/app/api/content/[id]/route.ts` | GET/PUT/DELETE single content item | exists |
| `src/app/api/tasks/route.ts` | GET/POST tasks endpoint | exists |
| `src/app/api/tasks/[id]/route.ts` | GET/PUT/DELETE single task | exists |
| `src/app/api/workflows/route.ts` | GET list workflow runs | exists |
| `src/app/api/workflows/[id]/route.ts` | GET workflow run detail | exists |
| `src/app/api/workflows/templates/route.ts` | GET list / POST create templates | exists |
| `src/app/api/workflows/templates/[id]/route.ts` | GET / PATCH / DELETE template | exists |
| `src/app/api/platforms/x/` | X OAuth, sync, engage, compose, enrich, browser-session | exists |
| `src/app/api/platforms/linkedin/` | LinkedIn OAuth, callback, status, sync | exists |
| `src/app/api/platforms/gmail/` | Gmail OAuth, callback, status, sync | exists |
| `src/lib/db/schema.ts` | 15 Drizzle table definitions | exists |
| `src/lib/db/client.ts` | SQLite connection + Drizzle instance | exists |
| `src/lib/db/types.ts` | Drizzle-inferred TypeScript types | exists |
| `src/lib/db/enrichment.ts` | Enrichment score calculator | exists |
| `src/lib/db/queries/contacts.ts` | Contact CRUD + dedup + attachIdentities | exists |
| `src/lib/db/queries/identities.ts` | Identity CRUD | exists |
| `src/lib/db/queries/tasks.ts` | Task CRUD | exists |
| `src/lib/db/queries/dashboard.ts` | Dashboard metrics (counts, recent contacts, tasks) | exists |
| `src/lib/db/queries/content.ts` | Content CRUD + dedup helpers | exists |
| `src/lib/db/queries/engagements.ts` | Engagement CRUD | exists |
| `src/lib/db/queries/sync.ts` | Sync cursor management | exists |
| `src/lib/db/queries/platform-accounts.ts` | Platform account CRUD | exists |
| `src/lib/db/queries/workflows.ts` | Workflow run + step CRUD | exists |
| `src/lib/db/queries/workflow-templates.ts` | Template + step + enrollment CRUD | exists |
| `src/lib/auth/crypto.ts` | AES-256-GCM encrypt/decrypt | exists |
| `src/lib/auth/claude-auth.ts` | API key save/get/validate/clear | exists |
| `src/lib/workflows/types.ts` | WorkflowType, SyncSubType, configs | exists |
| `src/lib/workflows/run-sync-workflow.ts` | Sync wrapper with observability | exists |
| `src/lib/platforms/adapter.ts` | Generic platform adapter interface | exists |
| `src/lib/platforms/rate-limiter.ts` | Shared RateLimitError + rate limit check | exists |
| `src/lib/platforms/index.ts` | Platform adapter factory | exists |
| `src/lib/platforms/x/client.ts` | X API client (auth, engagement, compose) | exists |
| `src/lib/platforms/x/mappers.ts` | X data → Contact/Identity/Content mappers | exists |
| `src/lib/platforms/linkedin/` | LinkedIn OAuth, client, mappers, adapter | exists |
| `src/lib/platforms/gmail/` | Gmail OAuth, client, mappers, adapter | exists |
| `src/lib/platforms/sync-contacts.ts` | X contact import orchestration | exists |
| `src/lib/platforms/sync-content.ts` | Tweet/mention import with cursor pagination | exists |
| `src/lib/platforms/sync-linkedin-contacts.ts` | LinkedIn connection import + dedup | exists |
| `src/lib/platforms/sync-gmail-contacts.ts` | Google People API contact import | exists |
| `src/lib/platforms/sync-gmail-metadata.ts` | Gmail email interaction enrichment | exists |
| `src/lib/platforms/sync-x-profiles.ts` | Browser enrichment orchestrator | exists |
| `src/lib/browser/` | Browser enrichment (session, scraper, anti-detection, extractors) | exists |
| `src/lib/utils.ts` | `cn()` utility (clsx + tailwind-merge) | exists |
| `src/components/app-sidebar.tsx` | Navigation sidebar (4 main + 2 footer items) | exists |
| `src/components/platform-connection-card.tsx` | Platform connection status + sync UI | exists |
| `src/components/compose-dialog.tsx` | Tweet/thread compose modal | exists |
| `src/components/enrich-button.tsx` | Single/bulk browser enrichment trigger | exists |
| `src/components/workflow-*.tsx` | 7 workflow visualization components | exists |
| `src/components/ui/` | shadcn/ui primitives | exists |
| `~/.openvolo/data.db` | User's SQLite database | runtime |
| `~/.openvolo/config.json` | Encrypted credentials | runtime |
| `~/.openvolo/sessions/` | Browser session storage (encrypted cookies) | runtime |
| `~/.openvolo/browser-profiles/` | Persistent browser profiles per platform | runtime |
| `~/.openvolo/media/` | Media file storage | runtime |
