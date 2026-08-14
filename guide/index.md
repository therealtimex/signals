# Signals User Guide

**AI-Native Social GTM & Relationship Knowledge Graph**

One command. Your own CRM. AI agents that actually do the work.

![Signals Dashboard — your CRM at a glance](assets/dashboard-overview.png)
*The Signals dashboard: contacts, workflows, tasks, and content pipeline in a single view.*

---

## The Solo Builder's CRM

According to Carta, [36% of new startups in 2025 are solo-founded](https://carta.com/blog/state-of-startups-2025/) — the highest share on record. Dario Amodei, CEO of Anthropic, has predicted that AI could enable [a one-person billion-dollar company](https://darioamodei.com/machines-of-loving-grace) within a few years. The bottleneck isn't ambition. It's that most tools were built for teams of 50, not teams of one.

Social CRM is one of those tools. You know the problem: your X followers live in one silo, LinkedIn connections in another, and the relationship context — who you've talked to, what they care about, when to follow up — exists only in your head. Traditional CRMs charge $100+/month, require weeks of setup, and assume you have a sales team to manage.

Signals takes a different approach. It's an AI-native CRM built for founders and builders who live on X/Twitter and LinkedIn. It runs locally on your machine with a single command. AI agents handle the tedious work — enriching contacts, generating content, discovering prospects — while you focus on building relationships that matter.

## What Makes Signals Different

- **One command to start** — `npx @realtimex/signals` boots a full CRM with zero configuration. No Docker, no cloud accounts, no waiting.
- **Local-first, your data** — Everything lives on your machine in SQLite. No vendor lock-in, no data hostage situations. Encrypted credentials, portable database.
- **AI agents that work** — 10 pre-built agents for prospecting, enrichment, content creation, and engagement. Not chatbot theater — real tool-using agents that search the web, scrape profiles, and take actions.
- **Browser-based publishing** — Post to X and LinkedIn through actual browser automation. Bypasses expensive APIs and platform restrictions. Choose between full auto or human-in-the-loop review mode.
- **AI content creation** — Generate drafts, get topic suggestions, refine your writing. Audience-aware, platform-adapted, tone-controlled. One-click cross-platform adaptation.
- **Goal-driven demand generation** — Set targets (100 new leads, 50 published posts), link workflows, and track auto-computed progress. Outcomes, not just activity.
- **Natural language CRM** — Every feature is accessible through an AI chat assistant. Query contacts, start workflows, create content — all conversationally with Cmd+K.

## Guide Directory

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 1 | [Getting Started](01-getting-started.md) | Installation, API keys, platform connections, and your first dashboard tour |
| 2 | [Contacts and Enrichment](02-contacts-and-enrichment.md) | Multi-platform contacts, AI-powered enrichment, and smart pruning |
| 3 | [Content and Publishing](03-content-and-publishing.md) | Content library, AI-assisted writing, and browser-based publishing |
| 4 | [AI Agents and Automation](04-ai-agents-and-automation.md) | Agent gallery, workflow execution, scheduling, and observability |
| 5 | [Analytics and Goals](05-analytics-and-goals.md) | Dashboard analytics, goal tracking, and demand generation |
| 6 | [AI Chat Assistant](06-ai-chat-assistant.md) | Natural language CRM interface, smart prompts, and conversation history |

## Quick Start

```bash
npx @realtimex/signals
```

That's it. Open `http://localhost:3000` and you're in. Head to [Getting Started](01-getting-started.md) to configure your API keys and connect your platforms.

---

*Signals is open source. Built with Next.js, SQLite, and the Vercel AI SDK.*
