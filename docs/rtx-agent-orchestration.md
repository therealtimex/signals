# RealTimeX agent orchestration (replaces in-app AI SDK)

Signals no longer runs embedded LLM orchestration (Vercel AI SDK, `/api/chat`, in-process `generateText` agent loops).

Intelligence moves to **RealTimeX terminal agents** and **Agent Flows**, which call Signals through the local **Agent Tools API**.

## What changed

| Removed from Signals | Replacement |
|----------------------|-------------|
| Cmd+K chat panel (`/api/chat`) | RealTimeX workspace thread / terminal agent |
| In-process agent runner (`run-agent-workflow.ts`) | RTX flows + `POST /api/agent-tools/invoke` |
| `/api/content/ai-generate` | Agent-driven creative workflows in RTX |
| `/api/workflows/templates/generate-prompt` | Manual templates or RTX-assisted authoring |
| LLM profile parsing (`generateObject`) | RTX agent-browser + `enrich_contact` |
| In-process Playwright enrichment | RTX Browser + agent-browser (`docs/rtx-agent-browser-enrichment.md`) |

Starting an agent from the Automation UI now provisions a **RealTimeX workspace thread** and launches a terminal agent with the template brief. Workflow runs are recorded for observability with RTX thread references in the run config.

## Agent Workflows gallery

The **Automation → Workflows → Agent Workflows** gallery is the template source for terminal-agent briefs:

1. Pick a built-in or custom template (unified list).
2. Click **Run** — Signals provisions an RTX workspace thread and launches the terminal agent with the rendered brief.
3. The agent executes via `realtimex-signals` and `POST /api/agent-tools/invoke`.
4. Use `POST /api/workflows/runs/{id}/open-thread` to refocus RealTimeX on a prior run thread.

Recurring schedules for agent templates belong in **RealTimeX Agent Flows** (not Signals `scheduled_jobs`).

## Running agents

1. Open Signals as a RealTimeX Local App (see `docs/local-app.md` and `docs/realtimex-local-app.md`).
2. Use a terminal agent with access to Signals agent tools.
3. Invoke tools via `POST /api/agent-tools/invoke` — see `docs/agent-tools.md`.

Example:

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{"tool":"query_contacts","input":{"search":"founder","pageSize":5}}'
```

## Structured workflows inside Signals

Signals still orchestrates **schema-validated** workflows that call RTX `llm.chat` directly (e.g. persona generation). Those are provenance-tracked on `workflow_runs` and are separate from the removed conversational / tool-loop runner.

## Chat replacement (Cmd+K)

The in-app chat assistant was removed. Use your RealTimeX workspace thread to query CRM data conversationally; agents should call Signals tools rather than relying on embedded chat routes.
