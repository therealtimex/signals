# Agent Tools API

Signals exposes a **local REST API** so RealTimeX terminal agents (and other automation) can read and mutate CRM data without going through the in-app chat runner.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent-tools` | Tool manifest (names, descriptions, JSON Schema parameters) |
| `POST` | `/api/agent-tools/invoke` | Run a tool: `{ "tool": "create_contact", "input": { ... } }` |

Responses use a consistent envelope:

```json
{ "success": true, "tool": "create_contact", "result": { ... } }
```

Errors return `success: false` with a `code` (`TOOL_NOT_FOUND`, `VALIDATION_ERROR`, `EXECUTION_ERROR`, etc.).

## Authentication

By default the API is **localhost-only** (`localhost` / `127.0.0.1`).

To allow remote callers, set:

```bash
export SIGNALS_AGENT_TOOL_TOKEN="your-secret-token"
```

Then pass `Authorization: Bearer your-secret-token` on each request.

## Available tools (v1)

| Tool | Category | Description |
|------|----------|-------------|
| `query_contacts` | contacts | Search/filter contacts |
| `get_contact` | contacts | Full contact by ID |
| `create_contact` | contacts | Create a contact |
| `update_contact` | contacts | Update contact fields |
| `enrich_contact` | contacts | Fill gaps without overwriting |
| `archive_contact` | contacts | Archive with reason |
| `query_analytics` | analytics | Dashboard metrics |
| `query_workflows` | workflows | List workflow runs |
| `list_workflow_templates` | workflows | List startable templates |
| `start_workflow` | workflows | Start agent from template |
| `query_content` | content | List content items |
| `query_goals` | goals | List goals |
| `create_task` | tasks | Create a follow-up task |

Tools that require browser/LLM (web search, scrape, publish, etc.) are **not** exposed here — RTX terminal agents should use platform credentials and their own tools for those operations.

## Example: create and enrich a contact

Start Signals (standalone or embedded Local App), then:

```bash
# 1. List tools
curl -s http://localhost:3010/api/agent-tools | jq '.tools[] | .name'

# 2. Create a contact
curl -s -X POST http://localhost:3010/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "create_contact",
    "input": {
      "name": "Alex Rivera",
      "company": "Northwind",
      "platform": "linkedin"
    }
  }' | jq

# 3. Enrich with title and email (fill-gaps only)
CONTACT_ID="<id from step 2>"
curl -s -X POST http://localhost:3010/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d "{
    \"tool\": \"enrich_contact\",
    \"input\": {
      \"contactId\": \"$CONTACT_ID\",
      \"title\": \"Director of Partnerships\",
      \"email\": \"alex@northwind.example\"
    }
  }" | jq

# 4. Verify
curl -s -X POST http://localhost:3010/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d "{
    \"tool\": \"get_contact\",
    \"input\": { \"contactId\": \"$CONTACT_ID\" }
  }" | jq '.result'
```

## RTX terminal agent integration

### Agent skill (recommended)

Install the **`realtimex-signals`** skill for chat-linked terminal agents:

```
.claude/skills/realtimex-signals/
```

Package for workspace upload (keeps script execute bits):

```bash
./scripts/package-realtimex-signals-skill.sh
```

Dev RTX API is typically `http://127.0.0.1:3101` (not `3001` from the packaged app). Point `realtimex-pp-cli` with `REALTIMEX_BASE_URL=http://127.0.0.1:3101/cli` when managing the Dev workspace.

It resolves the Local App URL, loads the tool manifest, and wraps invoke calls. See the skill's [SKILL.md](../.claude/skills/realtimex-signals/SKILL.md) and [issue #21](https://github.com/therealtimex/signals/issues/21).

Quick start from repo root:

```bash
export SIGNALS_BASE_URL="$(.claude/skills/realtimex-signals/scripts/resolve-base-url.sh)"
.claude/skills/realtimex-signals/scripts/list-tools.sh | jq '.tools[].name'
.claude/skills/realtimex-signals/scripts/invoke-tool.sh query_analytics
```

### Direct API

1. Configure the Signals Local App in RTX (see [local-app.md](./local-app.md)).
2. `POST` to `http://localhost:{port}/api/agent-tools/invoke` with structured JSON.
3. Use `GET /api/agent-tools` at session start to discover tool names and parameter schemas.

The in-app agent runner (`/api/chat`) remains available; this API is the stable integration surface for external agents (#3).

## RTX Agent Flows

Ready-to-import flows live in [`flows/`](../flows/):

| Flow | Type |
|------|------|
| `signals-create-enrich-contact.agent-flow.json` | Deterministic `apiCall` steps (manifest → create → enrich → verify) |
| `signals-crm-agent-task.agent-flow.json` | `workspaceAgentTask` — terminal agent uses curl against this API |

Import via **Admin → Agents → Agent Flows**, set `signals_base_url` to your Local App port (e.g. `http://localhost:3010`), then run manually. See [`flows/README.md`](../flows/README.md).

For `runCommand` nodes or shell scripts, use [`scripts/invoke-agent-tool.sh`](../scripts/invoke-agent-tool.sh):

```bash
./scripts/invoke-agent-tool.sh create_contact '{"name":"Alex Rivera","company":"Northwind"}'
```

## Smoke tests

```bash
npm run smoke:core
```

Includes `e2e/smoke/03-agent-tools.spec.ts` for manifest + create/enrich invoke paths.
