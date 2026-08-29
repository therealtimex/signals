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
| `get_contact_arpp` | Agent-readable ARPP projection by `contactId`; supports `visibility` |
| `create_contact` | New contact (requires `name`; optional `channels[]`, `employments[]`) |
| `update_contact` | Overwrite fields on existing contact |
| `upsert_contact_identity` | Create or update a platform identity for a contact |
| `enrich_contact` | Fill gaps only; needs `contactId` |
| `archive_contact` | Archive with `reason` |
| `find_duplicate_contacts` | Find duplicate contact groups (tiers 1-3) with a suggested primary |
| `merge_contacts` | Merge duplicates into `primaryContactId`; idempotent, `options.dryRun` previews |
| `query_analytics` | Dashboard metrics |
| `query_workflows` | List workflow runs |
| `list_workflow_templates` | Templates available to start |
| `start_workflow` | Start run from `templateId` |
| `query_content` | List content items |
| `get_content` | Untruncated content detail; private email/DM/inbound bodies need a durably approved launch source |
| `create_content_draft` | Idempotently create a single-platform writing draft with ordered units |
| `update_content_draft` | Revise an editable writing draft; use `expectedUpdatedAt` for concurrency |
| `get_writing_context` | Privacy-filtered Launch sources, niches, targets, variants, capabilities, and approval policy |
| `list_voice_profiles` / `get_voice_profile` | Read immutable voice-profile versions and authoritative lifecycle state |
| `upsert_voice_profile` | Register new immutable voice content as a draft version |
| `approve_voice_profile` | Approve the latest admissible draft with durable user evidence |
| `materialize_variant` | Create or refresh one approved content artifact from a current audited writing variant |
| `revoke_variant_approval` | Revoke approval and return an unqueued writing artifact to draft |
| `query_goals` | List goals |
| `create_task` | Follow-up task |
| `create_simulation_run` | Wind Tunnel: create + start a simulation run for a variant |
| `query_simulations` | List runs; `includeAgents: true` returns public grounding |
| `record_simulation_results` | Per-agent scores/outcomes on a running simulation |
| `complete_simulation_run` | Finish run and project `variants.predicted_*` |
| `get_persona_job` | Inspect a PersonaAgentJob and recover matching evidence when its brief is unavailable |
| `complete_persona_job` | Submit the JSON synthesis or failure for the current stateless persona job |
| `query_orgs` | Search company nodes |
| `get_org` | Read a company by `orgId` or normalized `domain` |
| `get_org_aroo` | Agent-readable AROO projection by `orgId`; supports `visibility` |
| `create_org` | Create a company with agent provenance |
| `update_org` | Update company profile fields and attach cited field evidence |
| `get_org_relationships` | Relationship strength, coverage, and introduction paths |
| `list_org_contacts` | Company people with employment, strength, and email status |
| `link_contact_to_org` / `unlink_contact_from_org` | Maintain structured employment links |
| `get_org_email_intelligence` | Domains, patterns, and predicted-email counts |
| `infer_org_email_pattern` / `set_org_email_pattern` | Learn or override the business-email rule |
| `generate_org_email_candidates` | Generate non-sendable predicted addresses |
| `list_email_candidates` / `update_email_candidate` | Inspect and explicitly verify predictions |
| `add_org_domain_alias` | Add an alternate company mail domain |
| `list_org_activity` / `log_org_activity` | Read or write the unified company feed |
| `follow_org` | Toggle company signal tracking |
| `query_org_identities` | List company social identities |
| `upsert_org_identity` | Create or update a verified company social identity |

For an automated PersonaAgentJob, follow the brief exactly: do not call
`get_persona_evidence` or `upsert_persona`. Submit the final JSON through
`complete_persona_job`; one validation failure permits one corrected retry.

## Company intelligence

Use `get_org` before researching a company. Write only cited facts with `update_org`, passing
`workflowRunId` and `fieldSources.<field>.evidenceUrl` during enrichment. Use
`upsert_org_identity` only for profiles you verified belong to the company. Company domains are
normalized to lowercase hostnames such as `acme.com`; invalid local or IP hosts are rejected.
Use `link_contact_to_org`, not `upsert_edge`, for employment. Predicted email candidates are
never contact channels and must not be used for outreach until explicit verification promotes
them. Catch-all and inconclusive probe results remain uncertain.

## Wind Tunnel simulation flow

1. `upsert_launch` + `upsert_variant` on a **shared** launch
2. `create_simulation_run` with `variantId` and optional `populationSpec`
3. `record_simulation_results` while status is `running`
4. `complete_simulation_run` with `predictedScore` (0–100), `predictionConfidence` (0–1), and `predictedMetrics` (engagement_metrics keyspace, e.g. `{ "likes": 120 }`). All three are required when completing (default `status`).

Scores and metrics are validated at the query layer. Grounding uses shared-scope CRM data only — no `local_only` rows or `properties_private`.

## Signals Writing flow

1. Read the privacy-filtered spine, voice, target, capability, and variant state with
   `get_writing_context`.
2. Persist a complete hash-stamped spine with `upsert_launch`; partial updates deep-merge and
   preserve durable approvals.
3. Persist each native draft and structured audit with `upsert_variant` and
   `generationMetadata.kind: "signals-writing"`. Signals derives audit hashes, verdict, risk,
   approval, capability, and owned lineage.
4. Call `materialize_variant` only for a current non-blocked audit. Explicit/high-risk approvals
   require real user evidence. The tool never queues publishing.
5. Use `revoke_variant_approval` when the user withdraws approval. Publish only through the
   separate `send-to-agent` route after materialization.

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
