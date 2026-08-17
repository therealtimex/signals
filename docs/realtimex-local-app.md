# Signals ↔ RealTimeX Local App

How Signals fits into the RealTimeX platform after the epic #1 migration: local graph/UI in Signals, intelligence and browser automation delegated to RTX.

## Architecture

```
RealTimeX Main App
  ├── manages Signals process (Local AppsManager)
  ├── terminal agents + Agent Flows
  └── RTX Browser (CDP) for agent-browser

Signals Local App
  ├── Next.js dashboard + SQLite knowledge graph
  ├── SDK client (register, permissions, llm.embed / llm.chat)
  └── Agent Tools API (/api/agent-tools)

Terminal agent
  ├── invokes Signals tools (local REST)
  └── agent-browser sessions for enrichment / scraping
```

## Signals documentation map

| Topic | Document |
|-------|----------|
| Startup contract, env vars, embedded vs standalone | [`local-app.md`](./local-app.md) |
| Tool discovery and invoke | [`agent-tools.md`](./agent-tools.md) |
| Replaced in-app AI SDK / chat / workflow runner | [`rtx-agent-orchestration.md`](./rtx-agent-orchestration.md) |
| Replaced in-process Playwright enrichment | [`rtx-agent-browser-enrichment.md`](./rtx-agent-browser-enrichment.md) |
| Product vision + graph model | [`specs/signals-spec-v0.5.md`](../specs/signals-spec-v0.5.md) |

## RealTimeX upstream docs

Canonical docs in the [realtimex-ai-app](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app) repository (`realtimex-dev` branch):

| Topic | Link |
|-------|------|
| Local Apps architecture | [architecture.md](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/blob/realtimex-dev/docs/local-apps/architecture.md) |
| SDK LLM proxy (`llm.embed`, `llm.chat`) | [sdk-llm-proxy.md](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/blob/realtimex-dev/docs/local-apps/sdk-llm-proxy.md) |
| Local Apps admin / registration | [user-guide.md](https://rtgit.rta.vn/rtlab/rtwebteam/realtimex-ai-app/-/blob/realtimex-dev/docs/local-apps/user-guide.md) |

Signals [`local-app.md`](./local-app.md) documents the concrete startup command, health probe, and permission manifest (`rtx-manifest.json`) for this app.

## Responsibility split

| Concern | Owner |
|---------|--------|
| CRM data, graph, dashboard UI | **Signals** (local SQLite) |
| Conversational / open-ended agent work | **RTX terminal agents** → Signals agent-tools |
| Deterministic automation chains | **RTX Agent Flows** → `apiCall` / webhooks → Signals |
| Profile enrichment scraping | **RTX Browser + agent-browser** → `enrich_contact` |
| Publish / engage (current) | **Signals** Playwright sessions (`#6` migrates to agent-browser) |
| Structured persona synthesis | **Signals** workflow + RTX `llm.chat` (provenance on `workflow_runs`) |
| Embeddings for semantic search | **Signals** calls RTX `llm.embed`; vectors stored locally |

## Migration status (epic #1)

| Change | Status | Doc |
|--------|--------|-----|
| Local App bootstrap + SDK | Shipped (#2) | `local-app.md` |
| Agent Tools API | Shipped (#3) | `agent-tools.md` |
| Remove Vercel AI SDK | Shipped (#4) | `rtx-agent-orchestration.md` |
| Remove Playwright enrichment | Shipped (#5) | `rtx-agent-browser-enrichment.md` |
| Publish/engage browser migration | Open (#6) | — |
| Cron → RTX flows | Open (#7) | — |

## Legacy specs

Pre-migration implementation specs under `specs/` (e.g. `05-browser-enrichment.md`, `06-unified-workflows.md`, `07-agentic-workflows.md`) are **historical**. They carry a superseded banner — implement from the docs above, not from those files.

## Quick start (embedded)

**Production:** Install via RealtimeX marketplace plugin — see [`realtimex-marketplace-plugin.md`](./realtimex-marketplace-plugin.md).

**Local dev:**

1. Register Signals in RTX **Settings → Local Apps** (see `rtx-local-app.example.json` or `scripts/qa/provision-signals-local-app.mjs`).
2. Start Signals from RTX or locally with `RTX_APP_ID` + `SERVER_URL` — details in [`local-app.md`](./local-app.md).
3. Install plugin pack: `npm run package:realtimex-plugin` → upload zip → Deploy workspace provision.
4. Use a terminal agent with the Signals skill / agent-tools to query and mutate CRM data.
5. For enrichment, follow [`rtx-agent-browser-enrichment.md`](./rtx-agent-browser-enrichment.md).
