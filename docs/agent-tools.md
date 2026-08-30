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

Errors return `success: false` with a `code` (`TOOL_NOT_FOUND`, `VALIDATION_ERROR`,
`NOT_FOUND`, `CONFLICT`, or `EXECUTION_ERROR`).

## Authentication

By default the API is **localhost-only** (`localhost` / `127.0.0.1`).

The local callback trust boundary is intentionally the same for persona and publish jobs: any
loopback process that knows a job ID can call `complete_persona_job` or `complete_publish`. Signals
is a single-user local app; remote callers still require the bearer token below.

To allow remote callers, set:

```bash
export SIGNALS_AGENT_TOOL_TOKEN="your-secret-token"
```

Then pass `Authorization: Bearer your-secret-token` on each request.

## Available tools (v1)

| Tool | Category | Description |
|------|----------|-------------|
| `query_contacts` | contacts | Search/filter **active** contacts; `email` is an exact normalized match (incl. non-primary channels), `platformUserId` an exact identity match. Results list their identities. Not a claim lookup — use `resolve_platform_claim` |
| `resolve_platform_claim` | contacts | Is this platform account already claimed, by a contact **or an org** identity? Same resolution `upsert_contact_identity` enforces. Returns `{claimed:false}` or `{claimed:true, claimant:{kind, …, archived}}` |
| `get_contact` | contacts | Full contact by ID |
| `get_contact_arpp` | contacts | Project a contact as ARPP with internal or public visibility |
| `create_contact` | contacts | Create a contact (`channels[]`, `employments[]` supported) |
| `update_contact` | contacts | Update contact fields |
| `upsert_contact_identity` | contacts | Create or update a platform identity for a contact |
| `enrich_contact` | contacts | Fill gaps without overwriting |
| `archive_contact` | contacts | Archive with reason |
| `find_duplicate_contacts` | contacts | Scan for duplicate contacts. Tier 1 = shared email or platform handle, tier 2 = matching name at the same org, tier 3 = shared employment node plus overlapping interaction threads. Read-only |
| `merge_contacts` | contacts | Merge duplicates into a surviving primary and archive each secondary with `mergedIntoContactId`. Idempotent; supports `options.dryRun` |
| `query_analytics` | analytics | Dashboard metrics |
| `query_workflows` | workflows | List workflow runs |
| `list_workflow_templates` | workflows | List startable templates |
| `start_workflow` | workflows | Record a workflow run (failed until migrated to RTX orchestration) |
| `dispatch_follow_on_workflow` | workflows | Cascade a completed parent run into a configured follow-on workflow |
| `complete_workflow_run` | workflows | Persist terminal status and structured results, then dispatch configured or conditional cascades |
| `record_workflow_run_contacts` | workflows | Validate a workflow run/template pair and idempotently add existing contact IDs to the run's durable cohort |
| `query_content` | content | List content items |
| `get_content` | content | Read one content item with an untruncated body and durable privacy redaction |
| `create_content_draft` | content | Idempotently create one platform-native writing draft with ordered units |
| `update_content_draft` | content | Revise an editable writing draft with optional optimistic concurrency |
| `get_writing_context` | content | Read a launch's privacy-filtered sources, targets, variants, and capability rows |
| `list_voice_profiles` | content | List immutable voice-profile versions and lifecycle states |
| `get_voice_profile` | content | Read one voice-profile version with authoritative lifecycle projection |
| `upsert_voice_profile` | content | Register immutable voice content as a draft version |
| `approve_voice_profile` | content | Approve the latest admissible draft and atomically supersede the prior active version |
| `upsert_personality_statements` | content | Store verbatim user-authored values and boundaries for Personality projection |
| `query_goals` | goals | List goals |
| `create_task` | tasks | Create a follow-up task |
| `get_persona` | contacts | Get active AI persona for a contact |
| `upsert_persona` | contacts | Save versioned persona (supersedes prior active) |
| `get_persona_evidence` | contacts | Read shared-scope evidence bundle for persona synthesis |
| `generate_persona` | contacts | Synthesize a persona with the globally configured structured-workflow or terminal-agent backend |
| `get_persona_job` | contacts | Read PersonaAgentJob status and matching evidence for degraded-mode recovery |
| `complete_persona_job` | contacts | Return a validated synthesis or failure for a stateless PersonaAgentJob |
| `query_orgs` | graph | Search organization nodes |
| `get_org` | graph | Read one company by ID or normalized domain, including profile provenance |
| `get_org_aroo` | graph | Project a company as AROO with internal or public visibility |
| `create_org` | graph | Create a company with immutable agent creation provenance |
| `update_org` | graph | Update editable company fields with per-write provenance |
| `get_org_relationships` | graph | Read company relationship coverage, strength bands, and introduction paths |
| `list_org_contacts` | graph | List current/former company people with strength and email status |
| `link_contact_to_org` | graph | Link a contact through structured employment |
| `unlink_contact_from_org` | graph | Remove an employment or mark it former |
| `get_org_email_intelligence` | graph | Read domains, email patterns, and candidate counts |
| `infer_org_email_pattern` | graph | Infer ranked patterns from verified/imported company samples |
| `set_org_email_pattern` | graph | Select or clear an evidence-backed pattern override |
| `generate_org_email_candidates` | graph | Generate non-sendable predicted addresses for company people |
| `list_email_candidates` | graph | Read predictions separately from contact email channels |
| `update_email_candidate` | graph | Verify, invalidate, correct, or probe a prediction |
| `add_org_domain_alias` | graph | Add a normalized company domain alias |
| `log_org_activity` | graph | Write an idempotent company signal or workspace event |
| `list_org_activity` | graph | Read the unified company signal/activity feed |
| `follow_org` | graph | Follow or unfollow a company for signal tracking |
| `query_org_identities` | graph | List org platform identities with profile/stat fields |
| `upsert_org_identity` | graph | Create or update an org platform identity |
| `query_graph` | graph | 1-hop graph traversal from a node |
| `upsert_edge` | graph | Create/update typed graph edge |
| `log_interaction` | graph | Append interaction event for a contact |
| `query_niches` | graph | List/search niche clusters with member counts |
| `upsert_niche` | graph | Create or update a niche cluster |
| `query_launches` | graph | List GTM launches with variant summaries (`variantType`, `predictionConfidence`, `simulatedAt`, `contentItemId` additive fields) and goal links |
| `upsert_launch` | graph | Create or update a GTM launch |
| `upsert_variant` | graph | Create/update a launch variant; writing variants derive audit, approval, capability, and lineage server-side |
| `materialize_variant` | graph | Create or refresh the one approved content artifact for a current writing variant |
| `revoke_variant_approval` | graph | Revoke writing approval and return an unqueued approved artifact to draft |
| `semantic_search` | graph | Top-k semantic search over embedded nodes (query embed via RealtimeX) |
| `create_simulation_run` | graph | Start a Wind Tunnel simulation run (atomic create + start) |
| `query_simulations` | graph | List simulation runs with optional agent grounding. With `includeCalibrations: true`, detail payloads include `latestCalibration` and the full per-horizon `calibrations[]` history (same shape as `GET /api/simulations/[id]?includeCalibration=true`). |
| `record_simulation_results` | graph | Batch per-agent simulation outcomes on a running run |
| `complete_simulation_run` | graph | Complete/fail/cancel a run and project variant predictions. Default `status` is `completed`, which requires `predictedScore`, `predictionConfidence`, and `predictedMetrics` (engagement_metrics keyspace). `failed` requires `error`. |
| `get_publish_job` | content | Load a publish job payload + targets for the agent lane |
| `update_publish_job` | content | Mark job/target in-flight (`publishing`) |
| `complete_publish` | content | Record per-platform publish result; creates `content_posts` on success |
| `list_platform_targets` | platforms | List named acting targets and browser connections |
| `get_platform_target` | platforms | Get target identity, capabilities, connection, and lease state |
| `prepare_platform_target` | platforms | Lease the connection, activate the target, and verify the live identity |
| `release_platform_target` | platforms | Release a target preparation lease |

Simulation run tool responses include additive fields (`populationSpec`, `error`, `workflowRunId`, `createdAt`, `updatedAt`, `transcriptsPrunedAt`) shared with the dashboard REST API (`specs/ui-4.1-rest-api.md`).

`create_contact` / `update_contact` with a `company` field also dual-write an `orgs` row and `works_at` edge (contacts projection unchanged).

Company profile agents should call `get_org` before research, write cited fields through
`update_org.fieldSources`, and use `upsert_org_identity` for verified social profiles. The
dashboard and agent tools share the same normalized company DTO; raw source tags remain
secondary provenance details rather than user-facing labels.

Contact web research is a seeded **Contact Web Research** template, dispatched from
`POST /api/contacts/:id/web-research`; it is not a new search agent tool. The RTX terminal agent
collects and visits scored candidates through RealTimeX Browser, then composes existing tools:
`get_contact`, `get_contact_arpp`, `upsert_contact_identity`, `enrich_contact`,
`link_contact_to_org`, `log_interaction`, and `complete_workflow_run`. Its structured completion
result may include `fieldsUpdated`, `unresolvedFields`, `identityLinked`, `visitedUrls`,
`serpCandidates`, `ambiguous`, `partial`, and `message`. `identityLinked: true` conditionally
cascades that contact into Contact profile pipeline.

Predicted business emails live only in `contact_email_candidates`; they are not contact channels
and are excluded from outreach by default. Use `update_email_candidate` with explicit evidence to
verify one. Verification promotes it to a sendable channel; catch-all or inconclusive probes never
do. Link people with `link_contact_to_org` rather than writing `works_at` graph edges directly.

`semantic_search` requires Signals running as a RealtimeX Local App with the `llm.embed` permission granted. Vectors are stored locally in SQLite; only embedding generation is delegated to RealtimeX.

`generate_persona` resolves the global persona mode at call time. Structured workflow requires the
embedded runtime plus `llm.chat`. Terminal-agent mode creates one fresh RTX thread per contact,
writes a frozen evidence brief, and blocks programmatic callers until `complete_persona_job`
validates and persists the result. Automated persona jobs must not call `get_persona_evidence` or
`upsert_persona`; Signals owns their evidence, validation, provenance, and write.

**Publish lane** (`get_publish_job`, `update_publish_job`, `complete_publish`) coordinates CRM publish jobs with RTX terminal agents. Each job target may snapshot `targetId`, `expectedHandle`, and `sessionName`; callbacks should return `targetId` and the preparation `leaseId`. Browser content manipulation runs in the `signals-publish` skill. Signals owns target activation and live identity verification through `prepare_platform_target`.

## Writing content tools

`get_content` is the detail-by-ID complement to `query_content`: it returns the complete body
instead of the 200-character list preview. Email, DM, and inbound content remains classified
private. Its body, title, raw platform data, and media are redacted unless `writingSource` names a
matching source already stored on a Launch with durable `contextApproval`; a caller-supplied flag
cannot manufacture approval. `get_writing_context` applies the same rule to every launch source
and forces the brief and all sources private for a `local_only` Launch.

`create_content_draft` accepts one value from the canonical 12-platform registry and stores one
platform per item. `body` is ordered unit 0; an X or Threads `thread` requires non-empty
`threadTexts` continuation units. The required `idempotencyKey` returns the original item on
replay and never overwrites it. Use `update_content_draft` for revisions and pass
`expectedUpdatedAt` to detect concurrent edits. Only writing items in `draft` or `failed` status
are editable through this tool.

Draft support is not publish support. Each draft reports its static `capability.publish` state.
Items carrying `platformData.writing` enter `/api/content/send-to-agent` only after the writing
pipeline has materialized an `approved` item whose audit and approval snapshot still match its
linked variant. The REST route returns `writing_approval_required` for missing or revoked approval,
`writing_artifact_stale` for snapshot/unit/target drift, and `capability_unsupported` for a
draft/export-only surface. For approved X threads, the job's `text` and ordered `threadTexts` are
derived from persisted units; caller-supplied text is ignored.

Writing launches persist a validated, hash-stamped evidence spine in `launches.metadata.writing`.
For `generationMetadata.kind: "signals-writing"`, `upsert_variant` requires the complete writing
document and derives the body, audit input hash, verdict, risk tier, approval state, capability,
and Signals-owned lineage. The legacy `status: "published"` shortcut is unavailable to writing
variants. `materialize_variant` checks the current spine, audit, approval, target, and ordered
units before even an idempotent return. It can report `AUDIT_STALE`, `AUDIT_BLOCKED`,
`APPROVAL_REQUIRED`, `CAPABILITY_UNSUPPORTED`, or `TARGET_REQUIRED`.

Agents own the creative inputs (`platform`, `surface`, target, goal, formula/overlay/core refs,
voice/spine refs, ordered units, claim map, audit observations, lineage refs, and media IDs).
Signals overwrites all integrity and lifecycle fields: schema version, audit IDs/input hashes and
history, verdict, approval/risk, capability, materialized item ID, row body/type/model, and graph
edges. A create retry with the same launch-scoped `generationMetadata.requestHash` updates the
same variant. Materialization adopts an unqueued draft whose writing origin names that variant;
otherwise it creates one item, anchors both `variants.contentItemId` and `materialized_as`, and
returns an unchanged replay only after revalidating every current snapshot field. Explicit
revocation returns unqueued artifacts to draft; spine changes revoke all affected variants while
leaving queued, scheduled, publishing, and published content untouched. Invoke HTTP mappings are
409 for stale/blocked/approval/conflict errors, 400 for capability/target errors, and 503 for a
busy voice store.

Voice profiles are an approved voice-evidence source stored as immutable version documents under
`SIGNALS_DATA_DIR/writing/voice-profiles`; one atomically replaced index owns lifecycle state.
`upsert_voice_profile` can only register a draft. `approve_voice_profile` requires at least three
admissible, approved, self-authored samples and durable user evidence. Store contention and
optimistic conflicts are reported as `STORE_BUSY` and `STORE_CONFLICT`.

Personality source preview is read-only in this release. `GET /api/personality/sources` projects
only the self contact's public ARPP fields, one explicitly selected self-owned organization, an
approved voice profile owned by that self contact, and statements stored by
`upsert_personality_statements` or `PUT /api/personality/statements`. The response includes the
strict source snapshot, content-based source hash, revisions, and deterministic block bodies; it
does not read or write a RealTimeX workspace. Select the represented organization through
`GET/PUT /api/personality/represented-org`; agent tools cannot change that selection.

Voice resolution no longer falls back to a profile owned by another contact or to an unclaimed
profile. When approved profiles with `ownerContactId: null` are the only candidates,
`get_writing_context.voice.status` is `unclaimed_only` and returns their refs without activating
one. Claim a profile by sending its content through `upsert_voice_profile` with
`ownerContactId` set to the self contact, then approve the newly created version with
`approve_voice_profile`. There is no implicit backfill or separate claim tool.

Platform target tool errors are returned inside the successful invoke envelope as `{ error, code, details? }`. Codes include `TARGET_NOT_FOUND`, `TARGET_CAPABILITY_UNSUPPORTED`, `SESSION_LEASE_HELD`, `LEASE_LOST`, `LOGIN_REQUIRED`, and `TARGET_NOT_ACTIVE`. A shared connection is serialized for the whole operation; separate dedicated connections have independent leases.

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
