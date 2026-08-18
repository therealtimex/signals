# Getting Started

**From zero to a running CRM in under a minute.**

---

## Why This Is Different

Traditional CRMs take weeks to deploy. You evaluate vendors, sign contracts, configure integrations, import data, train your team. The setup cost alone kills adoption for solo founders and small teams.

Signals takes a page from the indie hacker playbook. Pieter Levels runs [multiple profitable products on SQLite](https://x.com/levelsio/status/1727382446563840368) — no Postgres cluster, no managed database service, just a file on disk. The [local-first software movement](https://www.inkandswitch.com/local-first/), pioneered by Ink & Switch and Martin Kleppmann, argues that the best software owns its data locally and syncs on your terms. Signals embraces both ideas: your CRM graph and credentials live in local SQLite and encrypted config under `~/.signals/`. Semantic search and scheduled persona refreshes may send bounded inputs through RealTimeX `llm.embed` / `llm.chat` — whether those leave your machine depends on your configured RTX/model provider. Terminal agents you run may also fetch external data when you ask them to.

## Prerequisites

- **Node.js 20+** — Check with `node --version`
- **A terminal** — Any terminal works: iTerm, Warp, the VS Code integrated terminal
- **API access** (configured after install):
  - **RealtimeX Local App** — AI chat, embeddings, and search use the RTX SDK proxy. Approve `llm.chat` and `llm.embed` for Signals in RealtimeX **Settings → Local Apps** (no provider keys in Signals Settings).
  - **Standalone development** — Set `ANTHROPIC_API_KEY` in `.env.local` (optional `SERPER_API_KEY` / `TAVILY_API_KEY` until search fully migrates off direct keys).
  - **RealTimeX workspace** — Terminal agents run enrichment, search, and workflow orchestration via `/api/agent-tools` (see `docs/rtx-agent-orchestration.md`)

## Installation

```bash
npx @realtimex/signals
```

This single command:
1. Downloads the Signals package
2. Creates `~/.signals/` — your data directory
3. Runs database migrations automatically
4. Starts the Next.js server on `http://localhost:3000`

No Docker. No cloud account. No `.env` file to wrestle with (though you can use one if you prefer).

### Your Data Directory

Everything lives in `~/.signals/`:

```
~/.signals/
  data.db          # SQLite database — your entire CRM
  config.json      # Encrypted credentials and settings
  sessions/        # Browser automation sessions
  media/           # Uploaded images and attachments
```

This is your data. Back it up, move it between machines, or delete it entirely — you're in control.

## AI and search configuration

Signals does **not** collect Anthropic, Serper, or Tavily API keys in its Settings UI. Configure LLM and search through one of these paths:

### RealtimeX Local App (recommended)

When Signals runs as a Local App (`RTX_APP_ID` set), all LLM compute goes through the RealtimeX SDK proxy:

1. Open RealtimeX **Settings → Local Apps** and select the Signals app.
2. Approve **`llm.chat`** and **`llm.embed`** permissions.
3. Ensure your RealtimeX LLM provider configuration is healthy (models and spend controls live in RTX, not Signals).

The Signals **Settings** page shows a short notice when running embedded — it does not expose provider key forms.

### Standalone development

For local dev without the Local App shell, copy `.env.example` to `.env.local` and set:

- **`ANTHROPIC_API_KEY`** — Required for Claude-powered chat and agents.
- **`SERPER_API_KEY`** / **`TAVILY_API_KEY`** — Optional until search routes fully migrate off direct provider keys (ADR-022-9 follow-up).

Restart the dev server after changing environment variables.

## Settings and platform connections

Navigate to **Settings** in the sidebar. This is where you connect platforms and manage browser sessions — not third-party LLM API keys.

![Settings page — platform connections and browser sessions](assets/settings-page.png)
*Settings: connect platforms, manage browser sessions, and view the Local App LLM notice when embedded.*

## Connecting platforms

In **Settings**, open **Platform Connections**. Signals supports three OAuth platforms:

- **X / Twitter** — OAuth connection for contact sync and engagement tracking
- **LinkedIn** — OAuth connection for professional network integration
- **Gmail / Google** — OAuth connection for email contact sync

Each connection shows its status (Connected/Disconnected), the signed-in account, granted permissions, and last sync time.

### Browser Sessions (Publish / Engage)

At the bottom of Settings, **Browser Session** supports **publish and engage** flows on X and LinkedIn. Profile enrichment no longer runs inside Signals — use RealTimeX Browser + agent-browser (see `docs/rtx-agent-browser-enrichment.md`).

## The Help Page

If you're not sure what to do next, click **Help** in the sidebar.

![Help page — setup checklist and documentation](assets/help-page.png)
*The Help page: a quick setup checklist, environment setup instructions, and platform-specific guides.*

The Help page includes:
- **Quick Setup Checklist** — Shows completion status for each configuration step (LLM access, platform connections, first sync)
- **Environment Setup** — Instructions for configuring `.env.local` if you prefer environment variables
- **Platform-specific tabs** — Detailed setup guides for X/Twitter, LinkedIn, and Gmail

## Your Dashboard

Once you've connected at least one platform (or imported contacts), head to the **Dashboard**.

![Dashboard overview — your CRM at a glance](assets/dashboard-overview.png)
*The Dashboard: stat cards for contacts, workflows, tasks, and content. Contact pipeline below.*

The dashboard gives you a single-screen overview:

- **Stat cards** — Total contacts, active workflows, pending tasks, content items
- **Contact Pipeline** — Visual funnel distribution across stages: Prospect, Engaged, Qualified, Opportunity, Customer, Advocate
- **Recent Contacts** — Latest additions to your CRM with stage badges
- **Pending Tasks** — Action items needing your attention

The sidebar navigation mirrors the workflow you'll follow through these guides: **Contacts** → **Content** → **Automation** → **Analytics** → **Goals**. Settings and Help are always at the bottom.

## What's Next

Your CRM is running. Your platforms and AI access are configured. Time to get people into the system.

**Next: [Contacts and Enrichment](02-contacts-and-enrichment.md)** — Import contacts from X and LinkedIn, understand enrichment scores, and enrich via RTX agents.
