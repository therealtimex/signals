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
| `query_contacts` | Search/filter CRM contacts |
| `get_contact` | Full record by `contactId` |
| `create_contact` | New contact (requires `name`) |
| `update_contact` | Overwrite fields on existing contact |
| `enrich_contact` | Fill gaps only; needs `contactId` |
| `archive_contact` | Archive with `reason` |
| `query_analytics` | Dashboard metrics |
| `query_workflows` | List workflow runs |
| `list_workflow_templates` | Templates available to start |
| `start_workflow` | Start run from `templateId` |
| `query_content` | List content items |
| `query_goals` | List goals |
| `create_task` | Follow-up task |

## Common input shapes

**create_contact**
```json
{ "name": "Alex Rivera", "company": "Northwind", "platform": "linkedin", "funnelStage": "prospect" }
```

**enrich_contact** (fill-gaps — does not overwrite existing fields)
```json
{ "contactId": "<id>", "title": "VP Sales", "email": "alex@example.com", "tags": ["saas"] }
```

**query_contacts**
```json
{ "search": "northwind", "funnelStage": "prospect", "pageSize": 20 }
```

## Platform enum

`x` | `linkedin` | `gmail` | `substack`

## Funnel stages

`prospect` | `engaged` | `qualified` | `opportunity` | `customer` | `advocate`

## Not exposed via agent-tools

Browser scrape, web search, publish, engage — use RTX terminal agent capabilities (browser session, platform credentials) then write results into Signals via `enrich_contact` / `update_contact`.
