---
name: realtimex-signals
description: >-
  Operate the Signals CRM Local App through the agent-tools REST API. Use when
  a chat-linked terminal agent should create, enrich, query, or manage contacts,
  goals, tasks, workflows, or analytics in Signals; when the user mentions
  Signals CRM, GTM contacts, or relationship graph actions; or when integrating
  RTX agent work with a running Signals Local App.
author: RealtimeX
license: Apache-2.0
allowed-tools: Read Bash
---

# RealtimeX Signals

Operate **Signals** (local-first social GTM CRM) via its stable REST API. Intelligence lives in the RTX terminal agent — Signals exposes data tools only.

## Start here

Every session:

1. **Prefer the bundled CLI** when `tools/signals-pp-cli/bin/signals-pp-cli.cjs` exists (marketplace plugin) or `signals-pp-cli` is on `PATH`:

```bash
signals-pp-cli health
signals-pp-cli import contacts --file workflow-runs/<runId>/contacts.csv --dedupe
```

Use `signals-pp-cli reconcile --file …` to preview dedupe without mutating. For `--dedupe --dry-run` imports, reconcile is the accurate preview (dry-run skips dedupe queries).

2. **Resolve base URL** (fallback when CLI is unavailable):

```bash
.claude/skills/realtimex-signals/scripts/resolve-base-url.sh
```

Export for subsequent shell helpers:

```bash
export SIGNALS_BASE_URL="$(.claude/skills/realtimex-signals/scripts/resolve-base-url.sh)"
```

3. **Load tool manifest** (schemas change — refresh at session start when not using CLI):

```bash
.claude/skills/realtimex-signals/scripts/list-tools.sh | jq '.tools[] | {name, description, category}'
```

4. **Invoke tools** via the helper only when the bundled CLI cannot cover the operation:

```bash
.claude/skills/realtimex-signals/scripts/invoke-tool.sh query_contacts '{"search":"acme"}'
```

From repo root you can also use `scripts/invoke-agent-tool.sh` with `SIGNALS_BASE_URL` set.

## When to use this skill

- User asks to add, find, update, enrich, or archive contacts in Signals
- User wants CRM analytics, goals, tasks, or workflow status from Signals
- After browser/LLM research in RTX — persist findings into Signals via `enrich_contact` / `update_contact`
- Any open-ended Signals request in a chat-linked terminal agent thread

## When NOT to use

- **In-app Signals chat** (`/api/chat`) — deprecated path; use agent-tools instead
- **Ad-hoc browser scrape / web search** — use RTX browser/credentials, then write to Signals via agent-tools
- **Inline server publish** — retired; compose uses **Send to agent** + `get_publish_job` / `complete_publish` (see `signals-publish` skill)
- **Automated persona briefs** — use only the job brief and return synthesis through `complete_persona_job`; do not fetch evidence or write the persona directly
- **Deterministic scheduled automation** — use Agent Flows in `flows/` instead

## Discovery order

| Priority | Source | Notes |
|----------|--------|-------|
| 1 | `SIGNALS_BASE_URL` | Explicit override |
| 2 | `RTX_PORT` / `PORT` | Embedded Local App |
| 3 | Health probe | Tries `3010`, `3000` on localhost |

Health check: `GET {base}/api/health` → `{ "app": "signals", "status": "ok" }`

## Invoke contract

```bash
POST {base}/api/agent-tools/invoke
Content-Type: application/json

{ "tool": "create_contact", "input": { "name": "..." } }
```

Success: `{ "success": true, "tool": "...", "result": { ... } }`

Errors: `{ "success": false, "code": "VALIDATION_ERROR|NOT_FOUND|CONFLICT|TOOL_NOT_FOUND|EXECUTION_ERROR", "details": ... }`

Auth: localhost-only by default. Remote calls need `SIGNALS_AGENT_TOOL_TOKEN` + `Authorization: Bearer ...`.

PersonaAgentJob callbacks use the same local trust boundary as publish callbacks: the job ID is the
correlation token, and the synthesis is validated and persisted by Signals.

## Agent workflow

```mermaid
flowchart TD
  A[User request in chat thread] --> B[resolve-base-url.sh]
  B --> C[list-tools.sh / manifest]
  C --> D{Plan tool calls}
  D --> E[invoke-tool.sh per step]
  E --> F[Summarize for user with IDs and next steps]
```

1. Parse intent — don't guess IDs; query first if unsure
2. Call manifest-backed tools only — check parameter schema before invoke
3. Chain calls — e.g. `create_contact` → `enrich_contact` → `get_contact`
4. Prefer `enrich_contact` over `update_contact` when filling missing fields
5. Reply with contact IDs, fields changed, enrichment score, suggested follow-ups

## Contact avatars

Signals resolves avatars in this order:

1. **Local upload** — `POST /api/media` + attachment with `role: "avatar"` (best for generated or edited photos)
2. **Identity `avatarUrl`** — `https://` URL from a synced platform via `upsert_contact_identity`
3. **Gravatar** — from primary email
4. **Initials** — UI fallback when nothing else resolves

**Critical rules for agents:**

- **Never** set `avatarUrl` to `file://`, absolute filesystem paths, or bare filenames — they will not render in Signals.
- **Never** treat `GenerateImage` output as linked until you upload it through Signals media.
- After upload, `get_contact` returns `resolvedAvatarUrl` like `/api/media/<assetId>` (served by the Local App).

### Set avatar from a local/generated image

```bash
export SIGNALS_BASE_URL="$(.claude/skills/realtimex-signals/scripts/resolve-base-url.sh)"

# Find target contact id first:
.claude/skills/realtimex-signals/scripts/invoke-tool.sh query_contacts '{"search":"Trung"}' | jq '.result.contacts[] | {id,name}'

# Upload and attach (use absolute path to the image file):
.claude/skills/realtimex-signals/scripts/upload-avatar.sh "<contactId>" "/path/to/avatar.png"

# Verify:
.claude/skills/realtimex-signals/scripts/invoke-tool.sh get_contact '{"contactId":"<contactId>"}' | jq '.result.resolvedAvatarUrl'
```

### Set avatar from a platform profile URL

Only when you have a real `https://` URL from sync or public profile:

```bash
.claude/skills/realtimex-signals/scripts/invoke-tool.sh upsert_contact_identity \
  '{"contactId":"<id>","platform":"linkedin","platformUserId":"handle","avatarUrl":"https://media.licdn.com/..."}'
```

## Playbooks

### Add a new person

```bash
.claude/skills/realtimex-signals/scripts/invoke-tool.sh create_contact \
  '{"name":"Jane Doe","company":"Acme","channels":[{"channelType":"email","value":"jane@acme.com","isPrimary":true}]}'

# Use contact id from result:
.claude/skills/realtimex-signals/scripts/invoke-tool.sh upsert_contact_identity \
  '{"contactId":"<id>","platform":"linkedin","platformUserId":"jane-doe","platformHandle":"jane-doe"}'

.claude/skills/realtimex-signals/scripts/invoke-tool.sh enrich_contact \
  '{"contactId":"<id>","title":"Head of Partnerships"}'
```

### Find and summarize pipeline

```bash
.claude/skills/realtimex-signals/scripts/invoke-tool.sh query_contacts \
  '{"funnelStage":"qualified","pageSize":20}'
.claude/skills/realtimex-signals/scripts/invoke-tool.sh query_analytics '{}'
```

### Research → CRM (with RTX browser)

1. Use RTX browser / web tools to gather profile data
2. `create_contact` or `query_contacts` to find existing record
3. `enrich_contact` with discovered fields (fill-gaps only)
4. `create_task` for follow-up if appropriate

### Wind Tunnel (variant simulation)

```bash
.claude/skills/realtimex-signals/scripts/invoke-tool.sh create_simulation_run \
  '{"variantId":"<variant-id>","populationSpec":{"contactIds":["<contact-id>"]}}'

# After scoring agents externally:
.claude/skills/realtimex-signals/scripts/invoke-tool.sh record_simulation_results \
  '{"runId":"<run-id>","results":[{"agentId":"<agent-id>","engagementScore":72,"outcome":"like"}]}'

.claude/skills/realtimex-signals/scripts/invoke-tool.sh complete_simulation_run \
  '{"runId":"<run-id>","predictedScore":78,"predictionConfidence":0.85,"predictedMetrics":{"likes":120}}'
```

## Install on an RTX workspace

**Package for upload** (preserves `+x` on `scripts/*.sh`):

```bash
./scripts/package-realtimex-signals-skill.sh /tmp/realtimex-signals.zip
```

**Option A — link from this repo** (development):

Copy or symlink `.claude/skills/realtimex-signals` into the workspace skills directory, or register via RealtimeX admin skills UI.

**Option B — CLI** (when `realtimex-pp-cli` is available):

```bash
realtimex-pp-cli prepare --agent
realtimex-pp-cli create-workspace-agent-skill <workspaceSlug>
# Point skill content at this directory or publish as workspace skill pack
realtimex-pp-cli enable-workspace-agent-skill <workspaceSlug> realtimex-signals
```

Ensure the Signals Local App is running (RTX **Settings → Local Apps**). See [`docs/local-app.md`](../../../docs/local-app.md).

## Reference

- Tool catalog and enums: [reference.md](./reference.md)
- Full API docs: [`docs/agent-tools.md`](../../../docs/agent-tools.md)
- Automation flows (secondary): [`flows/README.md`](../../../flows/README.md)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Could not find a running Signals instance` | Start Local App; set `SIGNALS_BASE_URL=http://localhost:{port}` |
| `VALIDATION_ERROR` | Re-read manifest schema for that tool; fix `input` shape |
| `403` / unauthorized | API called off-localhost — set `SIGNALS_AGENT_TOOL_TOKEN` |
| Empty contacts | Expected on fresh DB — create first contact |
| Avatar shows broken / `file://` in summary | Re-upload with `scripts/upload-avatar.sh`; do not set local paths on `avatarUrl` |
