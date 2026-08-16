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

Starting an agent from the Automation UI or `start_workflow` still creates a **workflow run** for observability, but the run is marked **failed** with `AGENT_ORCHESTRATION_UNAVAILABLE` until the workflow is migrated to RTX.

## Running agents

1. Open Signals as a RealTimeX Local App (see `docs/local-app.md`).
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
