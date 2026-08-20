# Signals agent-tools reference

Full API docs: [`docs/agent-tools.md`](../../../docs/agent-tools.md)

## Endpoints

| Method | Path |
|--------|------|
| `GET` | `/api/agent-tools` |
| `POST` | `/api/agent-tools/invoke` |

Invoke body: `{ "tool": "<name>", "input": { ... } }`

## v1 tools

| Tool | Use when |
|------|----------|
| `query_contacts` | Search/filter active CRM contacts (`email` = exact normalized match, `platformUserId` = exact identity match) |
| `resolve_platform_claim` | Is a platform account already claimed, by a contact or an org? Use before creating a contact for an imported handle |
| `get_contact` | Full record by `contactId` |
| `create_contact` | New contact (requires `name`; optional `channels[]`, `employments[]`) |
| `update_contact` | Overwrite fields on existing contact |
| `upsert_contact_identity` | Create or update a platform identity for a contact |
| `enrich_contact` | Fill gaps only; needs `contactId` |
| `archive_contact` | Archive with `reason` |
| `query_analytics` | Dashboard metrics |
| `query_workflows` | List workflow runs |
| `list_workflow_templates` | Templates available to start |
| `start_workflow` | Start run from `templateId` |
| `query_content` | List content items |
| `query_goals` | List goals |
| `create_task` | Follow-up task |
| `create_simulation_run` | Wind Tunnel: create + start a simulation run for a variant |
| `query_simulations` | List runs; `includeAgents: true` returns public grounding |
| `record_simulation_results` | Per-agent scores/outcomes on a running simulation |
| `complete_simulation_run` | Finish run and project `variants.predicted_*` |

## Wind Tunnel simulation flow

1. `upsert_launch` + `upsert_variant` on a **shared** launch
2. `create_simulation_run` with `variantId` and optional `populationSpec`
3. `record_simulation_results` while status is `running`
4. `complete_simulation_run` with `predictedScore` (0–100), `predictionConfidence` (0–1), and `predictedMetrics` (engagement_metrics keyspace, e.g. `{ "likes": 120 }`). All three are required when completing (default `status`).

Scores and metrics are validated at the query layer. Grounding uses shared-scope CRM data only — no `local_only` rows or `properties_private`.

## Common input shapes

**create_contact**
```json
{
  "name": "Alex Rivera",
  "company": "Northwind",
  "channels": [{ "channelType": "email", "value": "alex@northwind.example", "isPrimary": true }],
  "employments": [{ "orgName": "Northwind", "title": "VP Sales", "isCurrent": true }]
}
```

**upsert_contact_identity**
```json
{
  "contactId": "<id>",
  "platform": "linkedin",
  "platformUserId": "alex-rivera",
  "platformHandle": "alexrivera",
  "headline": "VP Sales at Northwind",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

**enrich_contact** (fill-gaps — does not overwrite existing fields)
```json
{ "contactId": "<id>", "title": "VP Sales", "headline": "Partnerships leader" }
```

**query_contacts**
```json
{ "search": "northwind", "funnelStage": "prospect", "pageSize": 20 }
```

**resolve_platform_claim**
```json
{ "platform": "x", "platformUserId": "sama" }
```
Returns `{"claimed": false}` or `{"claimed": true, "claimant": {...}}`. A `contact`
claimant reports `archived`; an `org` claimant means the account belongs to an
organization. Both block `upsert_contact_identity`, so resolve before creating a contact.

## Platform enum

`x` | `linkedin` | `gmail` | `substack`

## Funnel stages

`prospect` | `engaged` | `qualified` | `opportunity` | `customer` | `advocate`

## Not exposed via agent-tools

Browser scrape, web search, publish, engage — use RTX terminal agent capabilities (browser session, platform credentials) then write results into Signals via `enrich_contact` / `update_contact`.

**Avatar file upload** — not an agent-tool. Use `scripts/upload-avatar.sh <contactId> <file>` in the skill (wraps `POST /api/media` + `role: avatar` attachment). Do **not** set `file://` or local paths on `identity.avatarUrl`.

## Avatar resolution

| Priority | Source | How agents set it |
|----------|--------|-------------------|
| 1 | Local upload | `upload-avatar.sh` → `resolvedAvatarUrl` = `/api/media/<id>` |
| 2 | Identity URL | `upsert_contact_identity` with `avatarUrl` = `https://...` only |
| 3 | Gravatar | Automatic from primary email |
| 4 | Initials | UI fallback |

**upsert_contact_identity** (platform profile URL only)
```json
{
  "contactId": "<id>",
  "platform": "linkedin",
  "platformUserId": "alex-rivera",
  "avatarUrl": "https://media.licdn.com/dms/image/..."
}
```

**upload-avatar.sh** (generated or local file)
```bash
.claude/skills/realtimex-signals/scripts/upload-avatar.sh "<contactId>" "/absolute/path/to/avatar.png"
```
