# Agent Tools API

Signals exposes a **local REST API** so RealTimeX terminal agents (and other automation) can read and mutate CRM data. In-app chat and embedded agent orchestration were removed in favor of RTX agents — see `docs/rtx-agent-orchestration.md`.

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
| `create_contact` | contacts | Create a contact (`channels[]`, `employments[]` supported) |
| `update_contact` | contacts | Update contact fields |
| `upsert_contact_identity` | contacts | Create or update a platform identity for a contact |
| `enrich_contact` | contacts | Fill gaps without overwriting |
| `archive_contact` | contacts | Archive with reason |
| `query_analytics` | analytics | Dashboard metrics |
| `query_workflows` | workflows | List workflow runs |
| `list_workflow_templates` | workflows | List startable templates |
| `start_workflow` | workflows | Record a workflow run (failed until migrated to RTX orchestration) |
| `query_content` | content | List content items |
| `query_goals` | goals | List goals |
| `create_task` | tasks | Create a follow-up task |
| `get_persona` | contacts | Get active AI persona for a contact |
| `upsert_persona` | contacts | Save versioned persona (supersedes prior active) |
| `get_persona_evidence` | contacts | Read shared-scope evidence bundle for persona synthesis |
| `generate_persona` | contacts | Synthesize persona from evidence via RTX `llm.chat` |
| `query_orgs` | graph | Search organization nodes |
| `query_org_identities` | graph | List org platform identities with profile/stat fields |
| `upsert_org_identity` | graph | Create or update an org platform identity |
| `query_graph` | graph | 1-hop graph traversal from a node |
| `upsert_edge` | graph | Create/update typed graph edge |
| `log_interaction` | graph | Append interaction event for a contact |
| `query_niches` | graph | List/search niche clusters with member counts |
| `upsert_niche` | graph | Create or update a niche cluster |
| `query_launches` | graph | List GTM launches with variant summaries (`variantType`, `predictionConfidence`, `simulatedAt`, `contentItemId` additive fields) and goal links |
| `upsert_launch` | graph | Create or update a GTM launch |
| `upsert_variant` | graph | Create or update a launch variant (publish via status) |
| `semantic_search` | graph | Top-k semantic search over embedded nodes (query embed via RealtimeX) |
| `create_simulation_run` | graph | Start a Wind Tunnel simulation run (atomic create + start) |
| `query_simulations` | graph | List simulation runs with optional agent grounding. With `includeCalibrations: true`, detail payloads include `latestCalibration` and the full per-horizon `calibrations[]` history (same shape as `GET /api/simulations/[id]?includeCalibration=true`). |
| `record_simulation_results` | graph | Batch per-agent simulation outcomes on a running run |
| `complete_simulation_run` | graph | Complete/fail/cancel a run and project variant predictions. Default `status` is `completed`, which requires `predictedScore`, `predictionConfidence`, and `predictedMetrics` (engagement_metrics keyspace). `failed` requires `error`. |
| `get_publish_job` | content | Load a publish job payload + targets for the agent lane |
| `update_publish_job` | content | Mark job/target in-flight (`publishing`) |
| `complete_publish` | content | Record per-platform publish result; creates `content_posts` on success |

Simulation run tool responses include additive fields (`populationSpec`, `error`, `workflowRunId`, `createdAt`, `updatedAt`, `transcriptsPrunedAt`) shared with the dashboard REST API (`specs/ui-4.1-rest-api.md`).

`create_contact` / `update_contact` with a `company` field also dual-write an `orgs` row and `works_at` edge (contacts projection unchanged).

`semantic_search` requires Signals running as a RealtimeX Local App with the `llm.embed` permission granted. Vectors are stored locally in SQLite; only embedding generation is delegated to RealtimeX.

`generate_persona` requires the same embedded runtime plus the `llm.chat` permission for structured persona synthesis. Terminal agents can instead call `get_persona_evidence` and write with `upsert_persona` using their own intelligence (no `workflow_runs` row).

**Publish lane** (`get_publish_job`, `update_publish_job`, `complete_publish`) coordinates CRM publish jobs with RTX terminal agents. Browser automation runs in the `signals-publish` skill — not in Signals server code. See `docs/rtx-browser-publish.md` and `.claude/skills/signals-publish/SKILL.md`.

Tools that require browser/LLM for ad-hoc research (web search, scrape, etc.) are **not** exposed here — RTX terminal agents should use platform credentials and their own tools for those operations.

**Avatar uploads** are also not agent-tools. Terminal agents should use the `realtimex-signals` skill script `upload-avatar.sh` (multipart `POST /api/media` + `POST /api/media/attachments` with `role: avatar`). Never persist `file://` or local filesystem paths as `avatarUrl` — identity `avatarUrl` accepts `http(s)` platform URLs only; uploaded photos resolve as `/api/media/<assetId>`.

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
      "channels": [
        { "channelType": "email", "value": "alex@northwind.example", "isPrimary": true }
      ]
    }
  }' | jq

# 2b. Link a platform identity (optional)
CONTACT_ID="<id from step 2>"
curl -s -X POST http://localhost:3010/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d "{
    \"tool\": \"upsert_contact_identity\",
    \"input\": {
      \"contactId\": \"$CONTACT_ID\",
      \"platform\": \"linkedin\",
      \"platformUserId\": \"alex-rivera\",
      \"platformHandle\": \"alexrivera\"
    }
  }" | jq

# 3. Enrich with title (fill-gaps only)
CONTACT_ID="<id from step 2>"
curl -s -X POST http://localhost:3010/api/agent-tools/invoke \
  -H 'Content-Type: application/json' \
  -d "{
    \"tool\": \"enrich_contact\",
    \"input\": {
      \"contactId\": \"$CONTACT_ID\",
      \"title\": \"Director of Partnerships\"
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

The in-app chat panel and embedded agent runner were removed; **`/api/agent-tools` is the stable integration surface** for RealTimeX terminal agents (#3/#4). See `docs/rtx-agent-orchestration.md`.

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
npm run test:integration
```

Includes `e2e/smoke/03-agent-tools.spec.ts` for manifest + create/enrich invoke paths.
