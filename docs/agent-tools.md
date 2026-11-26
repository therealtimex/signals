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
| `query_contacts` | contacts | Search/filter the default Contacts population (non-archived, non-platform-actor contacts; self included); `email` is an exact normalized match (incl. non-primary channels), `platformUserId` an exact identity match. Also filters by `tags[]` (all must match), `nicheId` (`belongs_to_niche` membership), `fitTier` and `minFitScore`, and sorts by `fitScore`. Results list their identities and ICP fit fields. Not a claim lookup — use `resolve_platform_claim` |
| `resolve_platform_claim` | contacts | Is this platform account already claimed, by a contact **or an org** identity? Same resolution `upsert_contact_identity` enforces. Returns `{claimed:false}` or `{claimed:true, claimant:{kind, …, archived}}` |
| `attest_snowball_linkedin_identity` | platforms | Verify a proposed LinkedIn identity in the run-bound authenticated browser; failed gates automatically enter candidate quarantine |
| `list_snowball_candidates` | contacts | List failed Snowball person/company proposals without exposing them as canonical graph records |
| `get_contact` | contacts | Full contact by ID, including ICP fit fields, `aliases[]`, and each identity's `provenance` |
| `get_contact_arpp` | contacts | Project a contact as ARPP with internal or public visibility |
| `create_contact` | contacts | Create a contact (`channels[]`, `employments[]` supported); optional `provenance` for its platform identity |
| `update_contact` | contacts | Update contact fields. `channels[]` is a full replace: a channel left out of the list is deleted, so send every channel to keep (or add one with `enrich_contact`'s `email` / `phone`) |
| `upsert_contact_identity` | contacts | Create or update a platform identity for a contact; optional `provenance` (`self_declared` / `agent_verified` / `inferred`). Account values are checked per platform; see "Identity values" below |
| `remove_contact_identity` | contacts | Remove one identity from a contact (`contactId` + `identityId`). Releases its claim and drops it from every lookup; see "Removing an identity" below |
| `enrich_contact` | contacts | Fill gaps without overwriting; appends name `aliases[]` |
| `score_contact_fit` | contacts | Batch-write ICP fit (`fitScore`, `fitTier`, `fitProduct`, `fitConfidence`, `fitRationale`, `fitScoreVersion`) for up to 200 contacts, with a result per row |
| `archive_contact` | contacts | Archive with reason |
| `find_duplicate_contacts` | contacts | Scan for duplicate contacts. Tier 1 = shared email or platform handle, tier 2 = matching name at the same org, tier 3 = shared employment node plus overlapping interaction threads. Read-only |
| `merge_contacts` | contacts | Merge duplicates into a surviving primary and archive each secondary with `mergedIntoContactId`. Idempotent; supports `options.dryRun` |
| `query_analytics` | analytics | Dashboard metrics; `totalContacts` uses the same default population as `query_contacts` and the Contacts page. `goals` gives goal counts by status and each active goal's `progressPct` and `deadline` |
| `query_workflows` | workflows | List workflow runs |
| `list_workflow_templates` | workflows | List startable templates |
| `start_workflow` | workflows | Launch a template through RTX with optional config, system prompt, and fresh-thread override; standalone fallback records a failed run |
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
| `get_personality_binding` | content | Read the configured workspace binding, drift, source freshness, history, proposals, and host capability |
| `propose_personality_projection` | content | Create an immutable all-file projection proposal; never approves or writes the workspace |
| `approve_personality_projection` | content | Record explicit thread-message approval and apply through the RealTimeX transaction writer |
| `reject_personality_projection` | content | Reject a proposal with durable user evidence; never writes the workspace |
| `retry_personality_projection` | content | Inspect, recover, resume, or explicitly retry a durable host attempt |
| `rollback_personality_projection` | content | Propose retained historical managed blocks over current unmanaged prose |
| `unbind_personality_projection` | content | Propose removal of Signals-managed blocks while preserving unmanaged prose |
| `query_goals` | goals | List goals, each with the dashboard's `progressPct` and its links (`nicheIds`, `launchIds`) |
| `upsert_goal` | goals | Create or update a goal. Retries land on the same goal (natural key), omitted fields are kept, and a goal can link to one niche and any number of launches; see "Goals" below |
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
| `query_niches` | graph | List/search niche clusters with member counts; `id` returns one exact niche (or none) |
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
| `set_target_representation` | platforms | Explicitly bind or unbind one acting target to the active Personality identity with user evidence |
| `prepare_platform_target` | platforms | Lease the connection, activate the target, and verify the live identity |
| `release_platform_target` | platforms | Release a target preparation lease |

Simulation run tool responses include additive fields (`populationSpec`, `error`, `workflowRunId`, `createdAt`, `updatedAt`, `transcriptsPrunedAt`) shared with the dashboard REST API (`specs/ui-4.1-rest-api.md`).

**ICP fit scoring** (#570). `score_contact_fit` writes first-class fit fields on contacts;
`enrichmentScore` keeps measuring profile completeness, not fit. Don't store fit in
`enrich_contact.metadata`: `get_contact` doesn't return metadata and `query_contacts` can't filter on it.

| Field | Type | Notes |
|---|---|---|
| `fitScore` | integer 0–100 | Required on every row |
| `fitTier` | `A` \| `B` \| `C` \| `unknown` | Required on every row |
| `fitProduct` | string ≤120 | Product slug, e.g. from the workspace `PRODUCTS.md`; free-form, not validated |
| `fitConfidence` | number 0–1 | Same scale as persona `confidence` |
| `fitRationale` | string ≤2,000 | |
| `fitScoreVersion` | string ≤64 | Scoring-rubric version. A batch-level `fitScoreVersion` applies to rows that omit it; a row's explicit `null` clears it |
| `fitScoredAt` | unix seconds | Set by the server; not accepted as input |

- Send `{ "fitScoreVersion"?: string, "items": [ { "contactId", "fitScore", "fitTier", ... } ] }` with
  1–200 rows. A malformed envelope (no `items`, an empty array, more than 200 rows) is a 400
  `VALIDATION_ERROR` and writes nothing.
- Each row is validated and resolved on its own. The result is
  `{ fitScoredAt, summary: { total, ok, skipped, error }, results: [ { index, contactId, status, reason?, message? } ] }`:
  - `ok`: written.
  - `skipped`: `self`, `archived` (a merged contact also returns `mergedIntoContactId`; score the
    survivor) or `platform_actor`. Same contact universe as the enrichment pipeline.
  - `error`: `invalid_input` (with `issues`), `not_found` or `duplicate_in_batch` (the first row
    for a contact wins).
- Rescoring overwrites all seven fields. An optional field left out becomes `null`, so a stale
  rationale never outlives its score. The exception is `fitScoreVersion`: left out, it takes the
  batch-level version when the batch sends one.
- `query_contacts` reads fit back. `fitTier` is an exact match, `minFitScore` is inclusive and never
  matches unscored contacts, and `sort: "fitScore"` puts the best fit first (`order` defaults to
  `desc`). Unscored contacts sort last in either direction, and the self contact is not pinned to
  the top for this sort. `tags` requires every listed tag (exact, case-sensitive). `nicheId`
  matches contacts with a `belongs_to_niche` edge to that niche. All filters combine with AND.

```bash
# Score a batch, then list Tier A cohort members in a niche, best first
curl -s -X POST http://localhost:3010/api/agent-tools/invoke -H 'Content-Type: application/json' \
  -d '{"tool":"score_contact_fit","input":{"fitScoreVersion":"icp-v1","items":[
        {"contactId":"<id>","fitScore":87,"fitTier":"A","fitProduct":"realtimex-desktop",
         "fitConfidence":0.8,"fitRationale":"Agency founder automating client ops"}]}}' | jq '.result.summary'
curl -s -X POST http://localhost:3010/api/agent-tools/invoke -H 'Content-Type: application/json' \
  -d '{"tool":"query_contacts","input":{"tags":["hackwithbay-4.0"],"nicheId":"<nicheId>",
        "fitTier":"A","sort":"fitScore","pageSize":100}}' | jq '.result.contacts[] | {id,name,fitScore,fitTier,fitProduct}'
```

**Identity provenance** (#571). Each contact identity records where it came from. All three
fields are null for identities written before #571 or without provenance, which means unknown.

| Field (in `provenance`) | Type | Notes |
|---|---|---|
| `kind` | `self_declared` \| `agent_verified` \| `inferred` | Required whenever `provenance` is sent |
| `sourceUrl` | http(s) URL ≤2,048 | Optional. The page showing the evidence. Login and auth-wall URLs are rejected with `VALIDATION_ERROR` (`details.field: "provenance.sourceUrl"`) before anything is written |
| `observedAt` | unix seconds | Optional; defaults to the write time |

- **Kinds.** `self_declared`: the subject linked the account on a profile they control (a Luma
  profile, personal site or X bio). `agent_verified`: an agent corroborated it against name plus
  company or role. `inferred`: a weaker match, such as a search result or a name match.
- **Downgrade rule.** Strength is a strict order: `self_declared` > `agent_verified` > `inferred` >
  null. A write with the same or a stronger kind replaces all three fields: an omitted `sourceUrl`
  clears it, and an omitted `observedAt` becomes now. A weaker kind leaves the stored provenance
  alone and still writes the rest of the identity. Leaving `provenance` out never changes it.
  `self_declared` outranks `agent_verified` because it is first-party ownership evidence, so a
  later verification must not erase the record that the subject linked the account themselves.
- **Writes.** `upsert_contact_identity.provenance` and `create_contact.provenance` (applied to the
  identity built from `platform`/`platformUserId`). `upsert_contact_identity` reports
  `provenanceWrite` as `applied`, `kept_existing` or `not_provided`. `create_contact` returns
  `identityProvenanceWrite` (`applied` or `kept_existing`) only when `provenance` is supplied.
  `signals-pp-cli import contacts` forwards CSV columns `provenance_kind`,
  `provenance_source_url`, `provenance_observed_at`, or a JSON `provenance` object.
- **Reads.** Every identity in `get_contact.identities[]` and `query_contacts.contacts[].identities[]`
  carries `provenance: {kind, sourceUrl, observedAt} | null`. The contacts REST payloads expose
  the raw columns `provenanceKind`, `provenanceSourceUrl` and `provenanceObservedAt`.

**Import dedupe across every identity** (#568). `signals-pp-cli import contacts --dedupe`,
`import contacts --dedupe --dry-run` and `reconcile` classify each row by its email
(`query_contacts.email`) and **every** platform identity on it (`resolve_platform_claim`, the same
resolution the `upsert_contact_identity` guard enforces), not just the primary one:

| `rows[].outcome` | When | Import does |
|---|---|---|
| `new` | Nothing matches | Creates the contact (`action: create`) |
| `match` | Exactly one existing contact, and every claimed identity and the email agree on it | Updates it and attaches the row's identities, each with its provenance (`action: update`); an archived owner is skipped (`action: skip`) |
| `conflict` | Claimed identities point at two or more contacts, an identity and the email disagree, the email alone matches several contacts, or an org holds one of the accounts | Skips the row and never creates it (`action: skip`); counted in `conflicts` and explained in `notes` |

Each row reports `contactId`, `matchedBy[]` (`platform`, `platformUserId`, `primary`,
`claimantKind`, `contactId` / `orgId`, `archived`) and `emailMatches[]`. `--dry-run` and
`reconcile` run the same read-only lookups and write nothing. They also account for the rows before
each row: a row that repeats an earlier row's identity or email matches that row, reported as
`contactId: "row:<n>"`, where a real run reports the ID of the contact row `<n>` created. A conflict
is skipped, not failed, so it doesn't change the exit code; read `conflicts`. Merging the duplicates
a conflict names is left to the merge flow (`reconcile --merge`, or the dedupe panel).
Outside a Network Snowball run, `create_contact` commits the contact, its identity and its fields in
one transaction, so a failure after the insert leaves nothing behind.

**Cohort import rows** (#567). Besides `name`, `email`, `company`, `title`, `notes` and the primary
identity columns, a row can carry:

| Field | JSON | CSV cell |
|---|---|---|
| `key` | string, or a whole number up to 2^53−1 (quote a larger one); keys the result's `mapping` | text |
| `bio`, `headline`, `website`, `location` | strings | text |
| `tags` | string array (≤50, each ≤100 characters) | a JSON array, or a `;`-separated list |
| `identities` | array (≤20) of `{platform, platformUserId \| handle, url?, provenance?}`; `provenance` is the identity provenance object above | the same JSON array |

- **How identities combine.** The legacy `platform` / `platform_user_id` / `platform_handle`
  columns are the primary identity, and `identities` adds to it. A row without them promotes
  `identities[0]` to primary. The flat `provenance_*` columns describe the primary; giving
  provenance twice for a promoted primary is a usage error.
- **Junk handles** (#569). Before dedupe, each identity's values get the same checks the server
  applies (see "Identity values" below). An identity that fails is dropped from the row and listed
  in the row's `rejectedIdentities[]` (`platform`, `field`, `value`, `rule`, `message`). The summary
  counts it in `identitiesRejected` and adds a note. The run carries on and the exit code doesn't
  change.
  - **A bad secondary** costs the row only that identity. The row's other identities and fields
    are imported as usual.
  - **A bad primary** is dropped together with its provenance, and the first valid secondary is
    promoted, as `identities[0]` is when a row has no legacy columns. If none is left, the row is
    matched and written by email and name alone.
  - Dropping happens before dedupe, so a row's junk `x:in` can't match or conflict with a guest who
    already holds `x:in`.
  - `--allow-unusual-handles` keeps values that fail only a heuristic rule and forwards
    `allowUnusualHandle: true` with them. `reconcile` takes the same flag and drops the same
    identities.
  - Snowball evidence rows aren't checked: the server derives those accounts.
- **Platforms and keys.** Every `platform` (primary or in `identities`) must be one of `x`,
  `linkedin`, `gmail`, `substack`, `instagram`, `facebook`, `threads`, `tiktok`, `youtube`,
  `bluesky`, `telegram`, `whatsapp`, case-insensitive. Anything else (`github`, a personal site)
  is a usage error naming the row, checked when the file is read and before any call, so it can't
  abort a run halfway through. Put a personal site in `website`. An identity given only by `handle`
  is keyed by the handle without `@`, both in dedupe and when it is attached.
- **Use `--dedupe` with `identities`.** Without it, rows are written without checking whether
  any of their identities already belongs to another contact. With it, such a row comes back as a
  `conflict` before any write.
- **CSV arrays are JSON-in-cell.** Repeated columns (`identity_1_platform`, …) would need a numbering
  scheme, cap the count at the header, and can't carry the nested `provenance` object. JSON-in-cell
  is the JSON row shape verbatim.
- **Writes.** Dedupe checks every identity (above). On a create or a match, each further identity
  is attached with `upsert_contact_identity` and its own provenance, so part A's downgrade rule
  applies. One the contact already holds is left alone unless the row brings provenance for it, and
  one another contact holds made the row a `conflict` before any write. `create_contact` gets
  `bio`, `headline`, `website` and `location`; on a match, `enrich_contact` fills only empty ones.
  `tags` are merged into the contact's JSON tag array. A legacy non-JSON value is kept and rewritten
  as an array, so `query_contacts { tags, nicheId }` finds the cohort.
- **`--niche <id>`** adds every created or matched contact to the niche with a `belongs_to_niche`
  edge (`nicheMembers` counts them). A rerun updates the same edge. A niche that doesn't exist
  stops the import with exit 3 before any row is written.
- **`mapping`** has one entry per row, keyed by the row's `key` (else its 1-based row number), with
  `{contactId, outcome, action}`. `contactId` is null for a skipped row (a conflict or an archived
  owner) and for a row that failed before reaching a contact. In a dry run, a contact the file will
  create is `"row:<n>"`. Keys must be unique.
- **Size.** One invocation takes up to 5,000 rows (a CLI guardrail; the server has no matching
  limit) and sends them in `--batch-size` chunks of up to 50. Without `--dedupe`, rows report
  `outcome: "unchecked"`.

**Identity values** (#569). `upsert_contact_identity` and `create_contact` check the
`platformUserId`, `platformHandle` and `platformUrl` a write introduces, after trimming and
dropping a leading `@`. A value that fails returns `VALIDATION_ERROR`; nothing is written. The
message names the platform, the field, the value and the rule. `details` carries `{field, platform,
value, rule, heuristic}`. The rules are in `src/lib/identity-handle-validation.ts`, and
`signals-pp-cli` mirrors them, pinned by shared test cases.

| Rule | Kind | Rejects |
|---|---|---|
| `foreign_url` | hard | A URL on another platform's host, in any field: `linkedin.com/in/…` in an X field, `x.com/…` on a LinkedIn identity |
| `syntax` | hard | Invalid account syntax, on the platforms whose syntax is fixed: X `^[A-Za-z0-9_]{1,15}$` (`platformUserId` may also be a numeric ID); Instagram and Threads `^[A-Za-z0-9._]{1,30}$`; TikTok `^[A-Za-z0-9._]{1,24}$` (or a numeric ID). An X profile URL in an X field fails here, and the message gives the bare handle to pass instead. Other platforms have no syntax rule, because LinkedIn vanity names, Substack and Bluesky custom domains, YouTube channel IDs and phone numbers vary too much. A value that is nothing but `@` (`@`, ` @@ `) fails this rule on every platform |
| `too_short` | heuristic | Two characters or fewer, unless all digits (X's numeric ID `12` is valid): `in`, `x`, `i`, `hi`, `v` |
| `placeholder` | heuristic | `none`, `null`, `nil`, `n/a`, `nope`, `unknown`, `notwitter`, `nolinkedin`, `noinstagram`, `twitter`, `linkedin`, `instagram`, `facebook`, case-insensitive |

- **Heuristic rules can be wrong.** `x`, `hi` and `v` are real, valid X handles. Pass
  `allowUnusualHandle: true` when the value really is the account; the error message says so.
  Nothing overrides a hard rule.
- **`platformUrl` gets `foreign_url` only.** The other rules are about account names, so they
  don't apply to a URL, and an avatar-like image URL isn't checked at all.
- **Only new values are checked.** Updating an identity in place (addressed by `id`, or the same
  `platform` + `platformUserId` on the contact that holds it) passes values equal to the stored
  ones, so identities stored before these checks stay readable, updatable and removable. Nothing
  is migrated or rewritten.
- **`create_contact` checks before dedupe**, with no in-place exemption. It finds its contact by
  these values, so a junk handle another contact already holds is rejected rather than routing
  the new person to that contact.
- Snowball evidence writes aren't checked: the server derives the account from browser evidence.

**Removing an identity** (#569). `remove_contact_identity {contactId, identityId}` deletes the
identity row. The unique index on `(platform, platformUserId)` is the claim, so deleting the row
is what frees the account for another contact. It also takes the identity out of every lookup:
`resolve_platform_claim`, `query_contacts {platform, platformUserId}`, import dedupe,
`get_contact` and research.
- **Scope.** `identityId` must belong to `contactId`, or the result is `NOT_FOUND` and nothing is
  removed. The self contact is refused (`VALIDATION_ERROR`): its identities are the owner's
  connected accounts, so remove those in the UI. Org identities are a separate table and this
  tool can't reach them.
- **Primary.** If the removed identity was primary, the contact's earliest-created remaining
  **active** identity becomes primary (`promotedIdentityId`), so research's primary-identity
  resolution and the profile resolver keep agreeing. An inactive identity is never promoted. With
  no active identity left, none is primary. If another **active** identity is still primary (legacy
  contacts can hold two, because `upsert_contact_identity {isPrimary: true}` doesn't clear the
  others), nothing is promoted: `promotedIdentityId` is null and `message` names the remaining
  primary.
- **Result.** `{contactId, removed, releasedClaim: {platform, platformUserId}, promotedIdentityId,
  message}`. `removed` is the deleted identity, provenance included: the record of what was there.
- **Deactivating is not removing.** `isActive: false` still claims the account; it marks an
  account that is still this person's but no longer in use. Use `remove_contact_identity` to
  release a wrong one.
- The dashboard's identity delete (`DELETE /api/contacts/:id/identities/:identityId`) uses the
  same function, so it promotes the same way.

**Name aliases** (#571). `get_contact.aliases` is a string array of other names the contact goes by,
such as "Sas P" on Luma for "Sasmita S" on LinkedIn. Add aliases with `enrich_contact.aliases`
(1–20 per call, each ≤120 characters after Unicode NFKC and whitespace normalization). They are appended, never replaced, and deduped
case-insensitively against stored aliases and the contact's own name; the first spelling wins.
A contact holds at most 50 aliases, and a write that would exceed the cap fails with
`VALIDATION_ERROR` before anything is written. `fieldsUpdated` includes `aliases` only when one
was added. There's no agent-tool for removing aliases yet.

**Goals** (#565). `upsert_goal` writes the same goal fields as the dashboard's goal form:
`name`, `goalType` (`audience_growth` | `lead_generation` | `content_engagement` |
`pipeline_progression`), `targetValue`, `currentValue`, `unit`, `platform` (`x` | `linkedin` | null),
`deadline` (unix seconds) and `status` (`active` | `achieved` | `missed` | `paused`).
Deleting a goal (`DELETE /api/goals/:id`) also deletes every graph edge touching it, so its niche
and launch links go with it.
- **Which goal.** With `id`, that goal is updated; an unknown `id` is `NOT_FOUND` and nothing is
  written. Without `id`, `name` and `goalType` are required, and an open (`active` or `paused`)
  goal with the same `goalType` and the same `name` (trimmed, ignoring case) is updated instead of
  creating a second one. An agent's retry therefore lands on the same goal. If several open goals
  match (the dashboard can create duplicates), the newest is updated and `note` names the others;
  pass `id` to choose. An `achieved` or `missed` goal never matches, so the same name starts a new
  goal. The result says what happened: `created: true | false` and
  `matchedBy: "id" | "natural_key" | null`.
- **Deliberately unlike `upsert_launch`.** Launches don't dedupe: without `id`, `upsert_launch`
  always creates. Goals do, because the call that records progress ("meeting 3 of 10 booked") is
  the one most likely to be retried.
- **Omitted fields are kept.** An update writes only the fields you send; a field you leave out
  keeps its stored value, and `null` clears `platform` or `deadline`. This differs from
  `score_contact_fit`, which overwrites every fit field on each row.
- **Create needs** `targetValue` and `unit` as well (`VALIDATION_ERROR` naming what's missing).
- **Validation matches the dashboard:** `targetValue` is a positive integer, `currentValue` an
  integer ≥ 0, `unit` non-blank. A past `deadline` is allowed.
- **Progress.** `currentValue` is the same mover as the dashboard's manual ±. Like the dashboard,
  it never changes `status`: reaching `targetValue` leaves an active goal active and writes no
  progress snapshot. Linked workflow templates are the other mover, and they do auto-achieve at
  the target. Send `status: "achieved"` to mark it achieved yourself.
- **Links are relationships only; they don't change how progress is counted.**
  - `nicheId` links the goal to the cohort it is about, with a `targets` edge goal → niche. A goal
    targets **at most one** niche: a different `nicheId` replaces the link, `null` removes it, and
    leaving it out keeps it.
  - `launchId` adds a `contributes_to` edge launch → goal, the catalogued launch link. A goal can
    have **several** launches, so each call adds one, and there's no unlink through this tool.
  - Re-sending a link is a no-op. A missing niche or launch is `NOT_FOUND` before anything is
    written, goal fields included.
- **Reads.** `query_goals` adds `progressPct` and the links, and `query_analytics.goals` gives
  `{total, byStatus: {active, achieved, missed, paused}, active: [{id, name, goalType,
  currentValue, targetValue, unit, progressPct, deadline}]}`, with active goals soonest deadline
  first (no deadline last), up to 50. `progressPct` is the dashboard's figure:
  `min(100, round(currentValue / targetValue × 100))`.

`create_contact` / `update_contact` with a `company` field also dual-write an `orgs` row and `works_at` edge (contacts projection unchanged).

Company profile agents should call `get_org` before research, write cited fields through
`update_org.fieldSources`, and use `upsert_org_identity` for verified social profiles. The
dashboard and agent tools share the same normalized company DTO; raw source tags remain
secondary provenance details rather than user-facing labels.

Contact web research is a seeded **Contact Web Research** template, dispatched from
`POST /api/contacts/:id/web-research`; it is not a new search agent tool. The RTX terminal agent
works in the persistent **Contact Enrich Profile** thread. Before dispatch, Signals selects the
default LinkedIn browse target (falling back to X only when LinkedIn has no eligible target),
prepares and leases its exact authenticated RealTimeX Browser session, and freezes that target,
session name, verified handle, start URL, and lease into the run brief. The agent attaches to that
already-running session; it must not create or substitute a profile. It then collects and visits
scored candidates and composes existing tools:
`get_contact`, `get_contact_arpp`, `upsert_contact_identity`, `enrich_contact`,
`link_contact_to_org`, `log_interaction`, and `complete_workflow_run`. Its structured completion
result may include `fieldsUpdated`, `unresolvedFields`, `identityLinked`, `visitedUrls`, `blockedUrls`,
`serpCandidates`, `ambiguous`, `partial`, `identityProvenanceUsed`, `aliasesAdded`, and `message`.
`identityProvenanceUsed` names the branch the brief ran for the primary identity's provenance
(`self_declared`, `agent_verified`, `inferred`, or `unknown`). `identityLinked: true` conditionally
cascades that contact into Contact profile pipeline. Login, auth-wall, and CAPTCHA URLs are never
identity evidence. `complete_workflow_run` returns a `leaseRelease` outcome for this lane after
browser teardown and before cascade dispatch.

Predicted business emails live only in `contact_email_candidates`; they are not contact channels
and are excluded from outreach by default. Use `update_email_candidate` with explicit evidence to
verify one. Verification promotes it to a sendable channel; catch-all or inconclusive probes never
do. Link people with `link_contact_to_org` rather than writing `works_at` graph edges directly.

Failed Network Snowball LinkedIn attestations live only in `snowball_candidates`; they are not
contacts, organizations, identities, employments, or graph edges. The attestation tool writes this
quarantine record automatically for a valid run scope. Use `list_snowball_candidates` to retrieve
the proposed person/company context and gate reason. When the profile page was read, `failureDetails`
may include `observedProfile` (top-card headline, affiliation line, and the first visible Experience
row) so operators can compare against the agent's proposed company/title without re-opening LinkedIn.
A later successful attestation followed by the
normal evidence-token Auto-commit path marks the matching candidate promoted. Operators can also
promote an unverified candidate from `/dashboard/quarantine` after confirming the LinkedIn profile;
that dashboard path does not mint an `identityEvidenceToken` and is not available as an agent tool.

The dashboard exposes this queue at `/dashboard/quarantine`. The sidebar badge counts only
`identity_unverified` rows. Reviewers can filter the queue, inspect attempt history and source-run
provenance, open the associated agent thread, dismiss an unverified candidate, reopen a dismissed
one, or promote a confirmed identity into Contacts and Companies. Promoted candidates are immutable
from quarantine because their canonical contact and organization lifecycle is managed by the CRM
surfaces.

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

**Account objective (#549).** On a workflow-composed launch, `get_writing_context` projects the
server-stamped scope as `launch.writing.composition` (`consumer`, `mandate`, `workflowRunId`,
`surfaces`, `objective`) and `launch.writing.objectiveSource` (`status`: `current` | `stale` |
`unavailable`, `changedPaths`, `observedAt`); each `variants[]` entry adds `intent` (`goal`,
`objective` reference, `ask`) and, when the stored approval carries one, `revokedReason`. Every
intent on such a launch must carry `objective: { objectiveId, hash }` copied from the stamped record
and an `ask`; `upsert_variant` rejects a missing or changed reference
(`writing_intent_objective_required`, `writing_intent_objective_mismatch`), a reference on a launch
stamped before #549 (`writing_intent_objective_not_permitted`), a missing ask
(`writing_intent_ask_required`), an illegal relation (`writing_intent_ask_relation_invalid`), and an
ask citing a claim or source outside the spine (`ask_claim_unknown`, `ask_source_unknown`). Reading
the context, the run proposals, or materializing re-reads the objective's saved brief and mentioned
files; a change revokes approved, unmaterialized proposals once with `objective_source_stale`.
The dispatch route `POST /api/workflows/templates/[id]/run` refuses an invalid
`config.accountObjective` with 422 `invalid_account_objective` and `details.reason`. Saved briefs and
the run dialog's preview use `GET /api/objectives`, `GET|PUT /api/objectives/[name]`,
`POST /api/objectives/preview` and `GET /api/objectives/mentions`; they are REST routes, not agent
tools. Contract: `docs/composable-writing-intent.md`.

The packaged `signals-writing` skill declares version 1.2.0 (account objective and ask, #549);
1.1.0 shipped with plugin 0.2.4 and introduced the Personality selector. Personality-aware `signals-writing` clients (version 1.1.0 and later) submit only
`metadata.writing.personality: { "bindingId": "pb_..." }`. The server resolves that selector
under the Personality and voice locks and replaces it with the complete binding, whole-file,
source, workspace, represented-identity, and target snapshot. Caller-supplied hashes, workspace
fields, target snapshots, and audit Personality fields are rejected. Versions 1.0.x may omit the
field during the explicit legacy-unbound compatibility window; absent lineage is never silently
backfilled and retains its pre-Personality audit hash.

When allowlisted Personality sources change but the bound files and represented identity remain
exactly the same, the server records one deterministic `core/voice/personality-source-stale`
warning. The resulting medium-risk audit requires fresh explicit user approval. Any later source,
binding, file, identity, or target change revokes the effective unqueued approval, returns an
approved item to draft, and blocks materialization or queueing. Queued, scheduled, publishing,
and published snapshots remain immutable after the queue transaction wins.

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

Personality sources come only from the self contact's public ARPP fields, one explicitly selected
self-owned organization, an approved same-owner voice profile, and statements stored by
`upsert_personality_statements` or `PUT /api/personality/statements`. Select the represented
organization through `GET/PUT /api/personality/represented-org`; agent tools cannot change it.

Platform targets are separate acting-identity decisions and default to `{ "kind": "unbound" }`,
including legacy account/profile targets. `set_target_representation` accepts `targetId`, the
active `bindingId`, an exact `self`/`org` representation (or `unbound`), and durable
`thread_message` evidence. It never infers identity from a handle, login, target kind, or browser
connection. The UI-equivalent `PUT /api/platform-targets/[id]/representation` accepts
`{ bindingId, represents }` and stamps UI evidence server-side. Target views expose normalized
`represents` and `personalityDecision`; writing context also exposes `compatible` and
`bindingIdAtDecision`.

Projection is proposal-first. `propose_personality_projection` records immutable exact UTF-8 files,
whole-file hashes, managed-block hashes, diffs, and current CAS tokens without requiring the writer
permission. It always covers `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md`; `AGENTS.md` is
included only when a dynamic Personality pointer is needed or already managed. No tool accepts an
arbitrary workspace slug. `approve_personality_projection` accepts only durable
`thread_message` evidence for the configured workspace and is the first operation allowed to call
the authenticated RealTimeX transaction writer. There is no direct filesystem-write fallback.

If RealTimeX moves the configured workspace to a new directory while retaining its slug, Signals
reports `workspace_mismatch` and blocks ordinary projection. When the status includes
`detail.recoveryAvailable: true`, an explicit
`propose_personality_projection` call with `recoverWorkspaceMismatch: true` creates a new proposal
for the current workspace only when the previous active binding represents the same Signals
identity. The proposal records both workspace identities and the previous binding ID, and a fresh
approval is required before any files change. The previous binding remains recorded for its old
workspace; the proposal becomes stale if that binding changes before approval. The same option is
available in Settings → Personality as **Create workspace recovery proposal**. An ID change at the
same directory has `recoveryAvailable: false` and remains blocked for separate identity repair.

Interrupted and failed host transactions remain visible by stable attempt ID.
`retry_personality_projection` inspects before resubmitting, requests restore for
`recovery_required`, and allocates a new attempt only after a separate retry has proven the prior
attempt restored. `rollback_personality_projection` and `unbind_personality_projection` also
create review-only proposals. REST equivalents live under `/api/personality/binding`,
`/api/personality/host`, `/api/personality/proposals`, proposal `approve|reject|retry` actions,
`/api/personality/rollback`, and `/api/personality/unbind`.

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
