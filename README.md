# Signals

<h3 align="center">Local-First Social GTM &amp; Relationship Knowledge Graph</h3>

<p align="center">
  Unified multi-source knowledge graph across X/Twitter, LinkedIn, and Gmail — powered by RealTimeX agents and audience simulation.
  <br />
  All CRM data stays on your machine. Optional RTX-backed features may send bounded inputs to your configured model providers.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Proprietary" src="https://img.shields.io/badge/License-Proprietary-red.svg" /></a>
  <img alt="Node 22.16.0" src="https://img.shields.io/badge/Node-22.16.0-green.svg" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-blue.svg" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16.1-black.svg" />
</p>

---

**Marketplace install** — RealTimeX installs the native platform runtime and starts Signals locally
&nbsp;&bull;&nbsp;
**Local-first** — SQLite database under `~/.signals/`; graph and credentials stay local. Semantic search and persona workflows may send inputs through RealTimeX `llm.embed` / `llm.chat` (provider-dependent).
&nbsp;&bull;&nbsp;
**Multi-platform** — X + LinkedIn + Gmail in one living graph
&nbsp;&bull;&nbsp;
**RealTimeX agents** — terminal agents and flows call Signals via the local agent-tools API ([integration guide](./docs/realtimex-local-app.md))

---

## Features

### Contact Management
Unified contacts across platforms with automatic cross-platform deduplication. Enrichment scoring (0-100) based on profile completeness and identity count, funnel stage tracking from lead to customer.

### X/Twitter Integration
OAuth 2.0 authentication, contact sync from followers/following, tweet and mention import with cursor-based pagination, compose and publish tweets, thread support, and engagement actions (like, retweet, reply).

### LinkedIn Integration
OAuth 2.0 with OpenID Connect, profile sync, and CSV import for connections (no LinkedIn partner program required).

### Gmail / Google Contacts
Google People API contact sync with 2-tier deduplication (identity match then email match). Email metadata enrichment tracks message frequency (sent/received in last 30 days) per contact — no email content is stored.

### Content Library
Import posts and mentions from X, LinkedIn, and Gmail. Filter by platform to focus on a single channel. Multi-platform compose with platform-aware constraints (X: 280 chars + threads, LinkedIn: 3,000 char drafts). Platform-aware engagement display with per-platform action labels. Six content types (post, thread, article, newsletter, DM, reply). Drafts via manual compose or RTX agent workflows. Engagement metrics tracked over time with both JSON snapshots (fast display) and structured rows (time-series analysis).

### Task Management
Create, update, and track tasks with status and priority. Link tasks to contacts for relationship-aware workflows.

### Automation Hub
Three-tab Automation page — **Agents** (gallery + builder), **Actions** (platform sync operations), **Runs** (execution history). Agent templates are configured in Signals; execution is driven by RealTimeX terminal agents via `/api/agent-tools`. Six workflow types: sync, enrich, search, prune, sequence, and agent. Agent gallery with 10 seed agents (3 search, 3 enrich, 2 prune, plus user-created), activation dialog for quick setup. User agent builder lets you clone any system agent and customize it. Actions tab consolidates all sync operations (X, LinkedIn, Gmail) with platform connection awareness. Four visualization modes (list, kanban, swimlane, graph) with run/step observability. Cron-based workflow scheduling with presets, custom expressions, and a 60-second background runner.

### Prune & Archive
Metadata-based contact archiving from prune workflows — contacts are soft-archived (restorable, not deleted). Archive and restore from workflow detail or individual contact pages. "Show Archived" toggle in the contacts list with visual indicators for archived rows.

### Workflow Scheduling
Cron-based scheduling with common presets (hourly, daily, weekly) and custom cron expressions. Next-run preview and per-template config overrides. Auto-execution via a 60-second background runner initialized through Next.js instrumentation.

### Smart Search
Dual search providers: Serper for broad discovery (Google results), Tavily for deep research. Intelligent routing by workflow type and query patterns with automatic failover. Combined free tiers across both providers.

### Analytics Dashboard
Five-tab dashboard — Overview, Agents, Engagement, Content, Sync Health. Six reusable chart components (area, bar, donut, ranked table, stat cards, skeleton). Time range filtering across all tabs.

### Agent Tools API
Local REST API (`/api/agent-tools`) for RealTimeX terminal agents — query contacts, start workflows, enrich data, manage content, and more. See `docs/agent-tools.md` and `docs/rtx-agent-orchestration.md`.

### Profile enrichment (RTX agent-browser)
In-process Playwright profile scraping was removed. Terminal agents enrich contacts via RealTimeX Browser + `agent-browser`, writing results through `enrich_contact`. See `docs/rtx-agent-browser-enrichment.md`. Signals browser sessions remain for **publish/engage** only.

### Privacy & Security
AES-256 encrypted credential storage. CRM graph, credentials, and embeddings are stored locally in SQLite. Semantic search and persona generation send bounded inputs to RealTimeX `/sdk/llm/embed` and `/sdk/llm/chat`; whether those leave your machine depends on your configured RTX/model provider.

## Quick Start

Install Signals from the RealTimeX Marketplace. For source-checkout development, run:

```bash
nvm use
npm ci
npm run dev
```

Signals uses the same exact Node `22.16.0` runtime (module ABI `127`) as the RealtimeX host so native dependencies such as `better-sqlite3` are built and loaded compatibly.

On first run, Signals creates `~/.signals/` for your database and config, runs schema migrations, and starts the dashboard at `http://localhost:3000`.

### Environment Variables

Create a `.env.local` file in your project root:

```bash
# X/Twitter (optional)
X_CLIENT_ID=
X_CLIENT_SECRET=

# LinkedIn (optional)
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

# Gmail / Google Contacts (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Web search (optional — for agent workflows)
SERPER_API_KEY=
TAVILY_API_KEY=

# Optional data directory override
SIGNALS_DATA_DIR=~/.signals
```

## Platform Setup

**X/Twitter** — Create an app at [developer.x.com](https://developer.x.com), enable OAuth 2.0 with `http://localhost:3000/api/platforms/x/callback` as the redirect URI.

**LinkedIn** — Create an app at [developer.linkedin.com](https://developer.linkedin.com), add the "Sign In with LinkedIn using OpenID Connect" product, set `http://localhost:3000/api/platforms/linkedin/callback` as the redirect URI.

**Gmail / Google** — Create a project in [Google Cloud Console](https://console.cloud.google.com), enable the People API and Gmail API, configure OAuth consent screen, and add `http://localhost:3000/api/platforms/gmail/callback` as the redirect URI.

> See the in-app **Help** page (`/dashboard/help`) for detailed step-by-step setup guides for each platform.

## Architecture

**Boot flow** — RealTimeX selects the signed runtime artifact for the host platform, starts its compiled Next.js server with a managed Node runtime, and keeps application data under `~/.signals/` by default.

**Rendering boundary** — Server Components read the database directly (better-sqlite3 is synchronous). Client Components call API routes via `fetch`.

**Agents** — RealTimeX terminal agents call Signals via `/api/agent-tools`. Structured persona synthesis uses RTX `llm.chat` when embedded as a Local App (see `docs/local-app.md`).

**Data layer** — SQLite database at `~/.signals/data.db` managed by Drizzle ORM. Credentials are AES-256 encrypted in `~/.signals/config.json`.

## Tech Stack

| Category | Details |
|----------|---------|
| Framework | Next.js 16.1, React 19, TypeScript 5.8 |
| Database | SQLite (better-sqlite3), Drizzle ORM 0.45 |
| AI | RealTimeX SDK (`llm.chat`, `llm.embed`) + local agent-tools API |
| UI | Tailwind CSS 4, shadcn/ui (Radix), Lucide Icons |
| Charts | Recharts (via shadcn/ui chart component) |
| Browser | Playwright (publish/engage); RTX agent-browser for enrichment |
| Parsing | Cheerio (HTML), Tiptap (rich text editor) |
| Drag & Drop | @dnd-kit (kanban, swimlane views) |
| Testing | Vitest |
| Scheduling | cron-parser (cron expression parsing) |
| Validation | Zod 3.24 |

## Project Structure

```
bin/cli.ts                            # npx entry point
instrumentation.ts                    # Next.js instrumentation hook (scheduler init)
src/
  app/
    api/                              # API routes
      contacts/                       #   Contact CRUD
      content/                        #   Content CRUD
      platforms/                      #   X, LinkedIn, Gmail auth + sync
      tasks/                          #   Task CRUD
      agent-tools/                    #   Local REST API for RTX terminal agents
      analytics/                      #   Analytics endpoints (5 tabs)
      workflows/                      #   Workflow CRUD + templates + agent runs
    dashboard/                        # UI routes
      contacts/                       #   Contact list + detail
      content/                        #   Content list + detail + compose
      workflows/                      #   Automation hub (agents, actions, runs) + detail
      analytics/                      #   Analytics dashboard (5-tab)
      settings/                       #   Platform connections + API keys (config only)
      help/                           #   Setup guides
  lib/
    db/
      schema.ts                       # All database tables (Drizzle)
      client.ts                       # Database connection
      queries/                        # Query modules (contacts, content, tasks, ...)
    platforms/
      x/                              # X/Twitter client, mappers, adapter
      linkedin/                       # LinkedIn client, mappers, adapter
      gmail/                          # Gmail/Google client, mappers, adapter
    agents/                           # Agent-tools handlers, workflow stubs, routing metadata
    browser/                          # Publish/engage browser sessions (Playwright)
    analytics/                        # Analytics utilities (time range, formatting)
    scheduler/                        # Background scheduler runner (60s interval)
    auth/                             # AES-256 crypto + API key management
  components/                         # Shared UI components (shadcn/ui based)
    charts/                           #   Reusable chart components (area, bar, donut, ...)
```

## Development

```bash
npm run dev              # Next.js dev server (Turbopack)
npm run check            # Quality gate: typecheck, lint, test, migrate, build
npm run build            # Production build
npm run build:cli        # Compile CLI entry point
npm run db:generate      # Generate Drizzle migrations from schema
npm run db:migrate       # Apply pending migrations
npm run db:studio        # Open Drizzle Studio (DB browser)
npm run test             # Run Vitest (watch mode)
npm run test:run         # Run Vitest once (CI)
npm run lint             # ESLint
```

See [docs/qa/README.md](./docs/qa/README.md) for CI and quality gate details.

## Design

Frontend tokens, layout patterns, navigation, and component inventory: [`specs/04-frontend-design.md`](./specs/04-frontend-design.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [`docs/realtimex-local-app.md`](./docs/realtimex-local-app.md) | RTX integration map and migration status |
| [`docs/local-app.md`](./docs/local-app.md) | Startup contract, SDK bootstrap, embedded mode |
| [`docs/agent-tools.md`](./docs/agent-tools.md) | Terminal agent REST API |
| [`specs/signals-spec-v0.5.md`](./specs/signals-spec-v0.5.md) | Product vision and graph model |

## Roadmap

- [x] **Phase 0** — Project setup, CLI, schema, auth, UI shell
- [x] **Phase 1** — Contact CRUD, Task CRUD, Dashboard, Identities, Enrichment, X/Twitter
- [x] **Phase 2** — Content Library, LinkedIn + Gmail Integration, Browser Enrichment
- [x] **Phase 3** — Unified Workflows, workflow observability, prune execution, workflow scheduling (execution via RTX agent-tools)
- [x] **Phase 4** — Analytics Dashboard (5-tab with charts)
- [x] **Phase 5** — Agent Tools API + RTX orchestration migration (in-app chat and embedded runner removed)
- [x] **Phase 5.5** — Multi-Channel Content & Automation (platform-agnostic content, multi-platform compose, Automation hub with Agents/Actions/Runs tabs)
- [ ] **Phase 6** — Content & Demand Gen (media system, browser publishing, AI content creation, goals, user templates — 6E complete)

## License

Proprietary software. See [LICENSE](LICENSE). © 2026 RealtimeX.
