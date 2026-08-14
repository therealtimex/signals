# Signals RTX Agent Flows

Importable [RealTimeX Agent Flow](https://github.com/therealtimex/realtimex-ai-app) definitions that call the Signals [`/api/agent-tools`](../docs/agent-tools.md) REST API.

## Flows

| File | UUID | Purpose |
|------|------|---------|
| [`signals-create-enrich-contact.agent-flow.json`](./signals-create-enrich-contact.agent-flow.json) | `b7e4a9c2-3f1d-4a8e-9c55-0a1b2c3d4e5f` | Deterministic pipeline: manifest → create → enrich → verify |
| [`signals-crm-agent-task.agent-flow.json`](./signals-crm-agent-task.agent-flow.json) | `c8f5b0d3-4e2e-5b9f-0d66-1b2c3d4e5f6a` | Workspace terminal agent with curl instructions for open-ended CRM work |

## Prerequisites

1. **Signals Local App** running (embedded in RTX or standalone).
2. Note the port — default `3010` in these examples (`signals_base_url` start variable).
3. For the CRM agent flow, set `workspace_slug` to a valid workspace before running.

## Import into RealTimeX

### UI

1. Open **Admin → Agents → Agent Flows**.
2. Create or import a flow and paste the JSON from one of the files above (or upload the file if your build supports import).
3. Edit start variables:
   - `signals_base_url` — e.g. `http://localhost:3010`
   - `contact_*` — sample contact fields
   - `workspace_slug` — required for the CRM agent flow
4. Activate the flow and run manually from Agent Flows.

### API (local dev)

```bash
FLOW_JSON="$(cat flows/signals-create-enrich-contact.agent-flow.json)"
curl -sS -X POST "http://127.0.0.1:3101/api/agent-flows/save" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-token>" \
  -d "{\"name\":\"Signals — Create & Enrich Contact\",\"config\":${FLOW_JSON}}"
```

Adjust host/port to match your RTX dev server (`tmp/dev-runtime/endpoints.json` when using `yarn dev:all`).

## Test the deterministic flow

1. Ensure Signals responds: `curl -s http://localhost:3010/api/health`
2. Run the flow from Agent Flows (manual trigger).
3. Check **Contacts** in Signals for the new record.

## Shell helper

For `runCommand` nodes or terminal agents:

```bash
chmod +x scripts/invoke-agent-tool.sh
./scripts/invoke-agent-tool.sh create_contact '{"name":"Alex Rivera","company":"Northwind"}'
```

See [docs/agent-tools.md](../docs/agent-tools.md) for the full API reference.
