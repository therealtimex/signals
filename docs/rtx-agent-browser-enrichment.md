# RealTimeX agent-browser profile enrichment

Signals no longer scrapes X profiles with in-process Playwright. Enrichment runs through **RealTimeX Browser** sessions and the **agent-browser** CLI, with CRM writes via the local **Agent Tools API**.

Publish and engage flows still use Signals-managed browser sessions for posting — that is separate from enrichment (#5).

## Architecture

```
RTX terminal agent
  → RealTimeX Browser session (CDP port)
  → agent-browser connect / snapshot / extract
  → POST /api/agent-tools/invoke (enrich_contact | create_contact)
  → SQLite CRM (local)
```

## Prerequisites

1. Signals running (`npx @realtimex/signals` or RTX Local App).
2. RealTimeX Browser session with an authenticated X tab (see workspace `agent-browser` skill).
3. Agent Tools API reachable at `http://127.0.0.1:3000/api/agent-tools/invoke` (or your Signals port).

Optional auth when not on localhost:

```bash
export SIGNALS_AGENT_TOOL_TOKEN="your-secret-token"
```

## Workflow (terminal agent)

### 1. Select contacts to enrich

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{"tool":"query_contacts","input":{"pageSize":10,"sort":"enrichmentScore","order":"asc"}}'
```

Prioritize low `enrichmentScore` contacts or pass explicit IDs from the dashboard.

### 2. Open RealTimeX Browser and attach agent-browser

Follow the workspace **agent-browser** skill:

1. Create/start a RealTimeX Browser session (moderator SDK or `realtimex-pp-cli`).
2. Log into X in the content tab if needed.
3. Attach: `agent-browser --session <name> connect <remoteDebugPort>`
4. Select the HTTPS X tab (not the Electron shell target).

### 3. Scrape profile evidence

Use agent-browser upstream commands (`snapshot`, `get text`, etc.) to read:

- Display name, bio, location, website
- Pinned tweet and recent tweets (when visible)
- Public email/phone only when explicitly present in bio

Do not guess fields. Only write what you can cite from the page.

### 4. Write structured updates

Use `enrich_contact` to fill gaps without overwriting existing data:

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "enrich_contact",
    "input": {
      "contactId": "<id>",
      "title": "CTO",
      "company": "AcmeAI",
      "email": "jane@acme.ai",
      "headline": "CTO at AcmeAI"
    }
  }'
```

For net-new people discovered during prospecting, use `create_contact` instead.

### 5. Record provenance (optional)

Add a note on the contact or log an interaction when enrichment came from a manual agent pass:

```bash
curl -s http://127.0.0.1:3000/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "log_interaction",
    "input": {
      "contactId": "<id>",
      "interactionType": "note",
      "summary": "Profile enriched via RTX agent-browser on 2026-08-15"
    }
  }'
```

## Signals UI behavior

- **Automation → Actions → Enrich Profiles** still creates an `enrich` workflow run for observability, but the run fails with `BROWSER_ENRICHMENT_UNAVAILABLE` until migrated to RTX orchestration.
- **Contact detail → Enrich from X** shows the same migration message.
- **Settings → Browser Session** remains for **publish/engage**, not in-app enrichment.

## Related docs

- `docs/agent-tools.md` — tool manifest and invoke envelope
- `docs/rtx-agent-orchestration.md` — removed in-app AI SDK / chat / agent runner
- Workspace skill: `.claude/skills/agent-browser/SKILL.md`
