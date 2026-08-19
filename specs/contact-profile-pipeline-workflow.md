# Contact Profile Pipeline Workflow (Thread-Attached Pipelines)

**Status:** Approved (System Design, 2026-08-18) — Dev implements exactly this surface.
**Issue:** [#172](https://github.com/therealtimex/signals/issues/172) · **X hydration extension:** [#183](https://github.com/therealtimex/signals/issues/183) · **Related:** [#62](https://github.com/therealtimex/signals/issues/62) persona epic · [#7](https://github.com/therealtimex/signals/issues/7) automation migration
**Base:** `main` @ `0af7f58`
**Parents:** [`persona-generation-workflow.md`](./persona-generation-workflow.md) (§4 synthesis, §7.3 boundary, §8 refresh — consumed as shipped, **not** redesigned here), `src/lib/db/contact-profile-embed-sweep.ts` (batch + `remaining` + re-enqueue precedent), `src/lib/agents/run-template-via-rtx.ts` (thread provisioning + run-config RTX refs contract).

---

## 1. Scope & Constraints

| Concern | Owned here | Already shipped (wrap, don't touch) |
|---------|-----------|-------------------------------------|
| Pipeline executor model (`code` / `llm` / `agent`) + step registry | §2 | heartbeat `executor: shell` vs `agent` split (conceptual model only) |
| Thread-attached run lifecycle, `appendRtxThreadMessage` | §3 | `ensureRtxWorkspace`, `createRtxPublishThread`, `openRtxRuntimeLauncher`, `getRtxRefsFromRunConfig`, `POST /api/workflows/runs/[id]/open-thread` |
| Backlog / plan / batch semantics | §4 | `contact-profile-embed-sweep.ts` shape |
| Run config/result contract | §5 | `workflow_runs` / `workflow_steps` schema (no columns added) |
| X profile hydration handler | §5.4 | X OAuth credentials, archive numeric user IDs, X API v2 client/rate limiter |
| Avatar enrich handler v1 | §6 | `resolveContactAvatar`, `validateIdentityAvatarUrl`, `recalcContactEnrichment`, platform mappers, `backfillIdentityAvatars` |
| Persona step wiring | §7 | `generatePersona`, `refreshPersonaIfStale`, all persona errors/prompting (`persona-generation-workflow.md` §3–§5 — **frozen**) |
| Gallery + contact-detail UI contract | §8 | template gallery card layout, run detail page |
| Scheduled drain + `runUntilCaughtUp` | §9 | `scheduled_jobs`, `MAINTENANCE_HANDLERS` registry, `schedule-policy.ts` |

**Out of scope (v1):** terminal-agent avatar fetch (agents keep the existing enrich path), persona prompt/synthesis changes, processing the whole universe in one run, agent-driven contact discovery for code pipelines, `agent` executor inside pipelines (reserved, §2.2), avatar byte download into media assets (recorded as deferred, §6.5), teaching `resolveContactAvatar` to read `metadata.legacyAvatarUrl` on the read path (§6.5).

---

## 2. Pipeline Executor Model

### 2.1 Template declaration

Pipelines are ordinary `workflow_templates` rows. **`templateType` stays within the existing enum** (the seeded pipeline uses `"enrichment"` — it *is* enrichment; category drives gallery grouping and the `TEMPLATE_TO_WORKFLOW_TYPE` mapping `enrichment → "enrich"` unchanged). What makes a template a pipeline is a declarative `pipeline` block in `config` (ADR-172-1):

```jsonc
// workflow_templates.config for the seeded "Contact profile pipeline"
{
  "pipeline": {
    "version": 2,
    "planner": "contact_profile",          // §4 planner registry key
    "batchSize": 20,                        // default; request may override, hard-capped
    "filters": { "needsAvatar": true, "needsPersona": true, "personaStale": false },
    "scheduleDrain": false,                 // §9 opt-in
    "steps": [
      { "id": "hydrate", "executor": "code", "handler": "hydrate_x_profiles" },
      { "id": "avatar",  "executor": "code", "handler": "enrich_contact_avatars" },
      { "id": "persona", "executor": "llm",  "handler": "generate_persona" }
    ]
  }
}
```

Seeded via `seed-templates.ts` (`SEED_VERSION` bump, `isSystem: 1`, `templateType: "enrichment"`, no `systemPrompt` — pipelines have no agent brief). Duplicated user templates carry the `pipeline` block and run identically.

### 2.2 Executors and the handler registry

| Executor | Meaning | v1 handlers |
|----------|---------|-------------|
| `code` | Deterministic in-process handler. No LLM, no terminal agent. May make bounded, non-LLM HTTP calls. | `hydrate_x_profiles` (§5.4), `enrich_contact_avatars` (§6) |
| `llm` | Structured Signals workflow calling RTX `llm.chat` — always schema-validated, always provenance-tracked on `workflow_runs` (extends the §7.3 boundary statement of the persona spec; ADR-062-1 posture unchanged). | `generate_persona` (§7) |
| `agent` | Reserved. The existing terminal-agent brief path (`runTemplateViaRtx`) stays a *separate* execution mode for whole templates. A pipeline declaring an `agent` step fails template validation in v1 with `PIPELINE_STEP_UNSUPPORTED`. | — |

```ts
// src/lib/workflows/pipeline/types.ts
export type PipelineExecutor = "code" | "llm" | "agent";

export type PipelineStepDecl = {
  id: string;
  executor: PipelineExecutor;
  handler: string;                      // registry key
  options?: Record<string, unknown>;
};

export type PipelineContactOutcome = {
  contactId: string;
  status: "updated" | "generated" | "verified" | "skipped" | "failed";
  reason?: string;                      // skip/fail reason from the step's taxonomy (§6.3 / §7.2)
  detail?: Record<string, unknown>;     // e.g. { source: "platform_data" }, { personaWorkflowRunId }
};

export type PipelineStepReport = {
  stepId: string;
  outcomes: PipelineContactOutcome[];
  aborted: boolean;                     // §7.3 llm-unavailable break — remaining contacts unprocessed
  abortReason?: string;
};

export type PipelineStepContext = {
  workflowRunId: string;                // the pipeline run — parentWorkflowId for child runs
  trigger: "template" | "scheduled";
  forcePersona: boolean;
  fetchImpl: typeof fetch;
  env: EnvLike;
  runScope?: {
    contactIds: readonly string[];
    resources: Map<string, unknown>;
    deferCleanup(cleanup: () => void | Promise<void>): void;
  };
  appendThreadMessage: (markdown: string) => Promise<void>;  // no-op when thread absent (§3.4)
};

export type PipelineStepHandler = (
  contactIds: string[],
  ctx: PipelineStepContext,
) => Promise<PipelineStepReport>;

// src/lib/workflows/pipeline/handlers/index.ts
export const PIPELINE_STEP_HANDLERS: Record<string, PipelineStepHandler>;
```

Execution is **contact-major**: each selected contact runs through X hydration, avatar enrichment, and persona generation before the next contact starts. Hydration can therefore supply identity data immediately to the same contact's avatar and persona steps, while persona work naturally spaces anonymous X traffic between contacts. The run scope preserves operations that must span the batch: authenticated X lookup is prepared in chunks of up to 100, while anonymous hydration lazily reuses one resolver, pacer, breaker, cooldown, and request budget until final cleanup. The thread still gets one coherent aggregate message per configured step; an `llm`-unavailable abort (§7.3) stops remaining contacts without discarding already-recorded deterministic work.

### 2.3 Observability mapping (`workflow_runs` / `workflow_steps` — no schema change)

Existing enums cover everything; **no enum widening** (the persona `workflow_type` widen was the last one needed):

| Record | Values |
|--------|--------|
| Pipeline run | `workflow_runs`: `workflowType` from `TEMPLATE_TO_WORKFLOW_TYPE[templateType]` (`"enrich"` for the seeded template), `trigger: "template"` (manual/gallery/Agent Flow) or `"scheduled"` (drain), `templateId` set |
| Plan step | `workflow_steps`: `stepType: "decision"`, `tool: "profile_pipeline_planner"`, `output`: the §4.4 plan JSON |
| Per-contact X hydration step | `stepType: "tool_call"`, `tool: "x_profile_hydrate"`, `contactId` set, `output`: the contact outcome |
| Per-contact avatar step | `stepType: "tool_call"`, `tool: "avatar_enrich"`, `contactId` set, `input: { contactId }`, `output`: the contact outcome, `status`: `completed` / `skipped` / `failed` |
| Per-contact persona step | `stepType: "tool_call"`, `tool: "generate_persona"`, `contactId` set, `output` includes `personaWorkflowRunId` when generated |
| Step summary | `stepType: "decision"`, `tool: "profile_pipeline_step_summary"`, `output`: the step's aggregate counts |
| Final summary | `stepType: "decision"`, `tool: "profile_pipeline_summary"`, `output`: the §5.2 result JSON |

Per-contact persona LLM detail (model, tokens, cost) lives on the **child** `workflow_type: "persona"` runs created by `generatePersona` with `parentWorkflowId = <pipeline run id>` — exactly the sweeper precedent (persona spec §5.3). The pipeline run's own token columns stay 0.

---

## 3. Thread-Attached Run Lifecycle

### 3.1 Entry points

| Trigger | Mechanism | `trigger` value |
|---------|-----------|-----------------|
| Manual (gallery Run) | `POST /api/workflows/templates/[id]/run` — existing route; body `config` accepts §4.3 input keys. The route branches: `template.config.pipeline` present → `runPipelineTemplate(...)`; absent → `runTemplateViaRtx(...)` unchanged. | `template` |
| Contact detail ("Run for this contact") | Same route, `config.contactIds: [id]` (§4.5) | `template` |
| RTX Agent Flow / external scheduler | Same route via HTTP. Consistent with `schedule-policy.ts`: recurring *cron* schedules for templates live in Agent Flows, not in Signals. An Agent Flow that wants a recurring pipeline POSTs this endpoint on its own schedule. | `template` |
| Scheduled drain (opt-in, one-shot re-enqueue) | `maintenance:profile-pipeline-drain` job (§9) | `scheduled` |

### 3.2 Asynchronous execution (ADR-172-2)

Unlike the synchronous single-contact persona route (persona spec ADR-062-4), a pipeline run makes up to `batchSize` LLM calls — minutes of wall time. The run route therefore returns **after plan + run creation + thread provisioning**, and step execution continues in-process on a detached promise (same process-lifetime assumptions as the 60 s scheduler interval, which already keeps background work in this local app):

```
POST /api/workflows/templates/[id]/run
  1. plan = planProfilePipelineRun(input)              // cheap SQL, §4
  2. createWorkflowRun({ status:"running", config: §5.1 })
  3. provision thread (§3.3) — non-fatal
  4. respond 201 { workflowRunId, plan, threadPath? }   // §3.5
  5. void executePipelineRun(...)                       // steps, summaries, result, drain check
```

The detached promise is wrapped in a top-level try/catch that marks the run `failed` with the error — a pipeline run can never be left `running` by a thrown handler. Progress is observable through the existing run-detail polling and the thread itself (that is the point of thread attachment). **Concurrency guard:** a new non-explicit run for a template is refused with 409 `PIPELINE_RUN_ACTIVE` while another run of the same template is `running`; explicit `contactIds` runs are exempt (batch of 1 from contact detail must not be blocked by a background drain).

### 3.3 Thread provisioning (same contract as `runTemplateViaRtx`)

```
workspaceSlug = ensureRtxWorkspace(getSignalsRtxWorkspaceSlug(env), "Signals", env, fetchImpl)
threadSlug    = createRtxPublishThread(workspaceSlug, buildAgentWorkflowThreadName(template.name), env, fetchImpl)
```

The RTX refs are stored in `workflow_runs.config` under the **exact keys `runTemplateViaRtx` uses** — `rtxWorkspaceSlug`, `rtxThreadSlug` (`rtxRuntimeSessionId: null`; no agent session exists) — so `getRtxRefsFromRunConfig` and the existing `POST /api/workflows/runs/[id]/open-thread` route work on pipeline runs **unchanged**. No new open-thread API.

**No terminal agent is dispatched and no brief file is written.** The thread is an audit/UX surface, not a compute surface.

### 3.4 Structured step summaries — `appendRtxThreadMessage`

New helper in `src/lib/rtx/runtime-sessions.ts`:

```ts
export async function appendRtxThreadMessage(
  input: { workspaceSlug: string; threadSlug: string; message: string; reason?: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: true } | { success: false; error: string }>;
```

Posts a plain chat message to the thread **without** dispatching an agent. The exact moderator-SDK wire endpoint/body is confirmed against the RTX SDK during implementation; **the mapping is owned entirely inside the helper** (same posture as `rtxChat`, persona spec §4.1). Failures are non-fatal: logged into the run's `errors` array, execution continues.

Exactly **2 + N messages per run** (N = step count; never per-contact — per-contact detail belongs in `workflow_steps`):

1. **Kickoff:** `**Contact profile pipeline** — backlog **300**, processing **20** this run (weakest scores first).`
2. **Per step:** hydration reports `hydrated`, `not found`, other skips, and failures; avatar/persona retain their existing aggregates. Credential-wide hydration skips add an actionable connect/reconnect/retry hint.
3. **Final:** `Processed **20** · hydrated **12** · avatars **14** · personas **8** · **280** remaining. Run <workflowRunId> completed.`

### 3.5 Degradation policy

| Condition | Behavior |
|-----------|----------|
| Thread provisioning fails | Run **continues thread-less**: no `rtx*` keys in config, provisioning error appended to `workflow_runs.errors`, `appendThreadMessage` becomes a no-op, `open-thread` returns its existing 400. Differs deliberately from `runTemplateViaRtx` (there the agent *is* the compute; here compute is local). |
| `!isRtxEmbedded(env)` (standalone) | Run is **allowed**: thread skipped as above, `code` steps execute fully, the `llm` step aborts on first contact with the actionable `PersonaGenerationUnavailableError` message (§7.3). Enables CLI/dev avatar-only runs. |
| Backlog empty, non-explicit run | Run is still created and completes immediately with zero counts and `complete: true` (cheap, keeps an audit row). The UI should disable Run at 0 anyway (§8.1). |

---

## 4. Backlog, Planning & Batch Semantics

New query module `src/lib/db/queries/profile-pipeline-backlog.ts`. Planner registry `PIPELINE_PLANNERS: Record<string, { countBacklog; planRun }>` with one v1 key, `contact_profile`.

### 4.1 Universe

Non-archived, non-self contacts: `json_extract(contacts.metadata, '$.archived') IS NOT 1 AND contacts.is_self = 0` (the existing archived predicate from `queries/contacts.ts`).

### 4.2 Eligibility predicates (SQL, not agent queries)

A contact is **in the backlog** when any enabled predicate matches:

**`needsAvatar`** — all of:
- ≥ 1 active identity (`contact_identities.is_active = 1`) — contacts with no identity are unfixable by the v1 handler (§6) and stay out of the avatar backlog;
- no active identity has `avatar_url NOT NULL`;
- no media attachment with `role = 'avatar'` for the contact (the upload path, cf. `loadContactAvatarUploadAssetId`);
- `json_extract(metadata, '$.avatarEnrich.gravatarVerifiedAt') IS NULL` (§6.2 — a verified gravatar resolves on the read path already);
- `json_extract(metadata, '$.avatarEnrich.exhaustedAt')` is `NULL` **or** older than `AVATAR_ENRICH_RETRY_SECONDS` (30 days, exported constant) — exhausted contacts must not loop through every run (§6.4).

**`needsPersona`** — both of:
- no active `contact_personas` row of **any** scope (an active `local_only` persona means generation is blocked by `PersonaScopeError` — persona spec §5.1 — so those contacts are *not* backlog);
- SQL approximation of evidence sufficiency (mirrors persona spec §3.4 so persistently-insufficient contacts don't loop): ≥ 1 active identity **or** ≥ 1 public content item (has a `content_posts` row with `published_at` set, `content_type NOT IN ('email','dm')`) **or** ≥ 3 `scope = 'shared'` interactions.

**`personaStale`** (opt-in flag, default off) — active **shared** persona with `generated_at < now - PERSONA_STALE_AFTER_SECONDS`. Age-only in SQL; drift staleness is resolved authoritatively at execution time by `refreshPersonaIfStale` (which passes `force: ageStale` through the hash-skip, so age-stale contacts always clear the backlog when regenerated).

Additional filters narrow the backlog conjunctively: `platform` (has an active identity on that platform), `maxEnrichmentScore` (`contacts.enrichment_score <=`).

### 4.3 API

```ts
export type ProfilePipelineFilters = {
  platform?: string;
  maxEnrichmentScore?: number;
  needsAvatar?: boolean;      // default true
  needsPersona?: boolean;     // default true
  personaStale?: boolean;     // default false
};

export type ProfilePipelineRunInput = {
  batchSize?: number;         // default template config (20); clamped to [1, PROFILE_PIPELINE_MAX_BATCH = 50]
  contactIds?: string[];      // explicit mode, §4.5
  filters?: ProfilePipelineFilters;
  forcePersona?: boolean;     // §7; ignored on trigger:"scheduled" (§9)
};

export function countProfilePipelineBacklog(filters?: ProfilePipelineFilters): number;
export function planProfilePipelineRun(input?: ProfilePipelineRunInput): ProfilePipelineRunPlan;
```

### 4.4 Batch selection & priority

```sql
SELECT c.id FROM contacts c
WHERE <universe> AND <enabled backlog predicates>
ORDER BY c.enrichment_score ASC, c.updated_at ASC, c.id ASC
LIMIT :batchSize
```

Weakest, stalest profiles first; `contacts.id ASC` as the stable tie-breaker across runs.

```ts
export type ProfilePipelineRunPlan = {
  backlogTotal: number;            // countProfilePipelineBacklog(filters) at plan time
  batchSize: number;               // resolved, clamped
  selectedContactIds: string[];    // ≤ batchSize
  filters: ProfilePipelineFilters; // resolved (defaults applied)
  orderBy: "enrichmentScore ASC, updatedAt ASC, id ASC";
  explicit: boolean;               // §4.5
};
```

`planProfilePipelineRun` runs **before** any work; the runner executes exactly `selectedContactIds` and never re-queries mid-run (contacts entering the backlog mid-run wait for the next plan).

### 4.5 Explicit single-contact / explicit-ids mode

`contactIds` present → global backlog is **ignored**: `backlogTotal = contactIds.length`, `selectedContactIds` = the given ids validated to exist and be non-archived (unknown/archived ids → 400 `VALIDATION_ERROR` naming them), `explicit: true`, `batchSize = contactIds.length` (still capped at 50). Per-step eligibility (§6.3, §7.2) still applies — selection never guarantees both steps mutate. `remainingBacklog` for explicit runs re-queries eligibility **restricted to those ids** (0 when the contact was fully cleared).

---

## 5. Run Config / Result Contract

### 5.1 `workflow_runs.config` (persisted at run creation, RTX refs merged after provisioning)

```jsonc
{
  "templateName": "Contact profile pipeline",
  "templateCategory": "enrichment",
  "pipeline": { "planner": "contact_profile", "steps": ["hydrate", "avatar", "persona"] },
  "backlogTotal": 300,
  "batchSize": 20,
  "selectedContactIds": ["…20 ids…"],
  "filters": { "needsAvatar": true, "needsPersona": true, "personaStale": false },
  "explicit": false,
  "forcePersona": false,
  "rtxWorkspaceSlug": "signals",       // §3.3 — same keys as runTemplateViaRtx
  "rtxThreadSlug": "…",
  "rtxRuntimeSessionId": null
}
```

### 5.2 `workflow_runs.result` (written at completion)

```jsonc
{
  "backlogTotal": 300,
  "batchSize": 20,
  "selected": 20,
  "processed": 20,                     // contacts actually evaluated (< selected only after an abort)
  "profilesHydrated": 12,              // contacts with at least one X identity refreshed
  "avatarsUpdated": 14,                // identity avatar writes + gravatar verifications (detail below)
  "personasGenerated": 8,
  "skipped": {                         // per-reason counts, only keys that occurred
    "avatar_present": 3, "no_identity": 0, "no_source": 2,
    "insufficient_evidence": 5, "evidence_unchanged": 2, "local_only": 1,
    "not_eligible": 4, "fresh": 0
  },
  "failed": 1,                         // contacts with ≥1 failed step
  "aborted": 0,                        // contacts left unprocessed by an llm abort (§7.3)
  "avatarOutcomes": { "updated": 12, "gravatarVerified": 2 },
  "hydrationOutcomes": { "updated": 12, "notFound": 3 },
  "cleared": 18,                       // selected contacts no longer matching backlog predicates post-run
  "remainingBacklog": 280,             // RE-QUERY after run — never backlogTotal - batchSize
  "complete": false                    // remainingBacklog === 0
}
```

`remainingBacklog` **must** be `countProfilePipelineBacklog(filters)` re-executed after the run (restricted to `contactIds` in explicit mode): some of the 20 skip without clearing the backlog, and new contacts may enter mid-run. Arithmetic subtraction is a spec violation with a dedicated test (§12).

### 5.3 Column mapping

| `workflow_runs` column | Value |
|---|---|
| `totalItems` | `selected` |
| `processedItems` | `processed` |
| `successItems` | contacts with ≥ 1 successful mutation (X profile hydrated, avatar updated/verified, **or** persona generated) |
| `skippedItems` | contacts where every applicable step skipped |
| `errorItems` | contacts with ≥ 1 failed step |
| `status` | `failed` only when the run itself could not execute (planner threw, every processed contact failed, or the detached promise threw); per-contact failures with any progress → `completed` with `errors` populated |
| `errors` | JSON array: per-contact error messages + thread-provisioning/append warnings |

### 5.4 X Profile Hydration (`hydrate_x_profiles`, executor `code`)

This deterministic first step resolves archive-imported X identities by stable numeric `platformUserId`. Usable OAuth credentials prefer X API v2 `GET /2/users?ids=…`, with IDs deduplicated and sent in chunks of at most 100. When credentials are absent, the step uses the bounded anonymous-web fallback specified in [`x-anon-web-hydration.md`](./x-anon-web-hydration.md): a dedicated logged-out `signals-x-anon` browser resolves numeric ID to handle, then a credential-free HTTP request parses public profile metadata. It never uses the connected `signals-publish` session.

- Only active X identities with numeric IDs and missing profile fields (or an archive-derived placeholder contact name) are candidates.
- A successful lookup fills identity gaps for name, handle, bio, location, website, avatar, and canonical profile URL; refreshes public metrics and timestamps; deep-merges the raw X fields into `platformData`; and changes only archive-placeholder contact names. User-edited contact and identity fields are preserved.
- `platformData.profileHydratedAt` and `platformData.profileHydrationMiss = { at, status: "not_found" | "suspended" }` are 30-day success/miss caches. Explicit API not-found and confidently classified anonymous-web terminal states create the miss marker. Transient, credential, tier, challenge, rate-limit, and parse errors do not.
- No OAuth credentials engage the anonymous fallback (unless `webFallback:false` explicitly preserves `x_not_connected`); expired credentials → `x_reauth_required`; rate limit → `x_rate_limited` with `retryAfter`; unavailable API tier → `x_access_restricted`. Anonymous-web outcomes use the bounded `x_web_*` taxonomy in the linked spec. These are skips so avatar/persona work can continue. Other request/write failures are contact-scoped failures.
- The handler never writes `contacts.metadata.avatarEnrich`; the existing avatar step remains the sole owner of that retry contract.

The X client stores batch-lookup rate limits under the stable `/users` endpoint key and preserves typed `RateLimitError` / `TierRestrictedError` behavior. Seed migration version 5 replaces pipeline structural fields (`version`, `planner`, `steps`) while preserving customized `batchSize`, `filters`, and `scheduleDrain` values.

---

## 6. Avatar Enrich Handler v1 (`enrich_contact_avatars`, executor `code`)

`src/lib/workflows/pipeline/handlers/enrich-contact-avatars.ts`. Deterministic; **no terminal agent, no LLM**. One bounded HTTP probe maximum per contact (gravatar).

### 6.1 Source order (per contact)

1. **Already resolvable** → skip `avatar_present`: an avatar upload attachment exists, **or** any active identity has `avatar_url`. (Unverified gravatar does *not* count — verifying it is this handler's job.)
2. **No active identity** → skip `no_identity` (defensive; the §4.2 predicate normally excludes these).
3. **Platform sync metadata recovery** (`source: "platform_data"`): for each active identity with `avatar_url NULL`, re-extract known avatar keys from the stored `platform_data` JSON (`profile_image_url` — X, upscaled `_normal → _400x400` per the X mapper convention — `picture`, `photoUrl`). First hit is validated through `validateIdentityAvatarUrl` and written to that identity's `avatar_url`. Outcome `updated`.
4. **Legacy metadata recovery** (`source: "legacy_metadata"`): `json_extract(contacts.metadata, '$.legacyAvatarUrl')` (written by `backfillIdentityAvatars` when no identity existed at backfill time) — if a valid http(s) URL, write to the **primary** identity's `avatar_url` (primary selection = `pickPrimaryIdentity` semantics). Outcome `updated`.
5. **Gravatar probe** (`source: "gravatar"`): if a primary-or-any email channel exists, `HEAD https://www.gravatar.com/avatar/<md5>?d=404` (same hash construction as `resolveContactAvatar`, 5 s timeout).
   - **200** → outcome `verified`: set `metadata.avatarEnrich.gravatarVerifiedAt = now`. Nothing else to write — the read path (`resolveContactAvatar`) already serves the gravatar URL for email contacts; the marker's job is to clear the §4.2 backlog predicate. The gravatar URL is **not** copied onto an identity (it is contact-level, email-derived data, not platform truth — keeping identities platform-pure).
   - **404** → record `metadata.avatarEnrich.gravatarMissAt = now`, fall through.
   - Network error → outcome `failed` with the message; **no** `exhaustedAt` marker (transient failures must retry next run).
6. **All sources exhausted** → skip `no_source`: set `metadata.avatarEnrich.exhaustedAt = now`. The §4.2 TTL (30 days) re-admits the contact later — a future platform sync may repopulate `avatar_url` at any time and clears the predicate anyway.

After any `updated` outcome: `recalcContactEnrichment(contactId)` (avatar contributes to `enrichmentScore` via `calculateEnrichmentScore`).

### 6.2 Metadata contract

`contacts.metadata.avatarEnrich = { gravatarVerifiedAt?: number, gravatarMissAt?: number, exhaustedAt?: number }`. `contacts.metadata` is already in the persona-evidence deny list (persona spec §3.2) — no privacy surface change.

### 6.3 Outcome taxonomy

| Outcome | `status` | `reason` | Clears avatar backlog |
|---|---|---|---|
| Identity avatar written | `updated` | — (`detail.source`) | ✅ |
| Gravatar verified | `verified` | — | ✅ (marker) |
| Already resolvable | `skipped` | `avatar_present` | already clear |
| No active identity | `skipped` | `no_identity` | n/a (outside backlog) |
| Nothing found | `skipped` | `no_source` | ✅ for 30 days (marker) |
| Probe/write error | `failed` | message | ❌ (retries next run) |

### 6.4 Loop safety

Every non-error path either clears the predicate or sets a TTL'd marker, so repeated scheduled drains cannot re-select the same hopeless contacts each batch. This is the avatar-side analogue of the SQL sufficiency approximation in `needsPersona` (§4.2).

### 6.5 Deferred (recorded, not built)

Downloading avatar bytes into a media asset (survives remote URL rot) and reading `legacyAvatarUrl` directly in `resolveContactAvatar` for identity-less contacts. Reopen when URL rot or identity-less contacts show up as a real report.

---

## 7. Persona Step (`generate_persona`, executor `llm`)

`src/lib/workflows/pipeline/handlers/generate-persona-step.ts`. A thin wrapper — **all prompting, evidence, validation, supersede, and side-effect behavior is the shipped persona contract** (persona spec §3–§6, frozen).

### 7.1 Per-contact dispatch

Evaluated at execution time (not plan time — avatar step and concurrent writes may have changed state):

| Contact state | Call | Child run linkage |
|---|---|---|
| `forcePersona: true` | `generatePersona(id, { force: true, trigger, parentWorkflowId })` | ✅ |
| No active persona (`needsPersona`) | `generatePersona(id, { force: false, trigger, parentWorkflowId })` — **first generation** (ADR-172-3) | ✅ |
| Active shared persona + `personaStale` filter enabled | `refreshPersonaIfStale(id, { trigger, parentWorkflowId })` — owns drift/age gate, forces through hash-skip on age | ✅ when regenerated |
| Active shared persona, `personaStale` off | skip `not_eligible` (avatar-only selection) | — |

`trigger`: `"user"` on `trigger:"template"` runs (operator-initiated), `"scheduled"` on drain runs. `parentWorkflowId` = the pipeline run id — sweeper precedent, persona spec §5.3.

### 7.2 Outcome mapping

| Underlying result | `status` | `reason` |
|---|---|---|
| `generated: true` | `generated` | — (`detail.personaWorkflowRunId`) |
| `skipped, reason: "evidence_unchanged"` | `skipped` | `evidence_unchanged` |
| `refreshPersonaIfStale → reason: "fresh"` | `skipped` | `fresh` |
| `PersonaEvidenceError` thrown | `skipped` | `insufficient_evidence` (race-window guard; the §4.2 SQL approximation makes this rare — no run row exists, per persona spec §3.4) |
| `PersonaScopeError` thrown | `skipped` | `local_only` |
| `PersonaSynthesisError` thrown | `failed` | message (contact-scoped; loop continues) |
| `PersonaGenerationUnavailableError` thrown | **step abort**, §7.3 | — |

### 7.3 Abort on provider unavailability

`PersonaGenerationUnavailableError` (RTX not configured / permission denied / provider down) affects every remaining contact identically. The handler records the failing contact as `failed`, marks the step `aborted: true` with the actionable message (e.g. *"Approve llm.chat for Signals in RealtimeX Settings → Local Apps."*), and stops — remaining contacts count as `aborted` in §5.2, the run completes with `errors` populated, and **no drain re-enqueue happens** (§9; mirrors the embed sweep's `EmbeddingUnavailableError` break).

### 7.4 Consent & cost posture (ADR-172-3)

The passive `maintenance:persona-refresh` sweeper still **never** first-generates personas (persona spec §8.2 stance unchanged). The pipeline *may* first-generate because both of its triggers are explicit operator decisions: a manual Run click, or a drain the operator opted into per-template (`scheduleDrain`). Cost guards: batch hard-cap 50, `evidenceHash` skip intact, `forcePersona` is **ignored on `trigger:"scheduled"`** (a forced drain would burn tokens on every cycle), drain disabled by default.

---

## 8. Gallery + UI Contract

### 8.1 Backlog preview

`GET /api/workflows/templates/[id]/backlog` (pipeline templates only; 404 `NOT_A_PIPELINE` otherwise) → `{ backlogTotal, batchSize, filters }` via `countProfilePipelineBacklog`. The gallery card / run dialog shows:

> **300** contacts need profile work · this run will process up to **20** (weakest scores first)

At `backlogTotal === 0`: Run disabled, copy "All contacts are up to date". The pipeline card keeps the standard gallery chrome (`totalRuns`, `lastRunAt`, Duplicate) with a "Pipeline" badge replacing the est-cost line.

### 8.2 Post-run summary

Run detail (and the thread's final message, §3.4) renders from `result`:

> Processed **20** · hydrated **12** · avatars **14** · personas **8** · **280** remaining

plus the existing **Open thread** button (works via the unchanged open-thread route when RTX refs exist). While `status: "running"`, run detail shows the plan numbers from `config` ("processing 20 of 300…") — the async contract (§3.2) means the user usually lands here before completion.

### 8.3 Contact detail

**"Run for this contact"** on the contact profile header → `POST /api/workflows/templates/[id]/run` with `config.contactIds: [contactId]` (the seeded template id resolved by name/`isSystem`). Batch of 1, explicit mode (§4.5), then link to the run / thread. No backlog copy shown.

---

## 9. Scheduled Drain

### 9.1 One-shot re-enqueue (embed-sweep pattern)

`src/lib/db/profile-pipeline-drain.ts`:

```ts
export const PROFILE_PIPELINE_DRAIN_JOB_TYPE = "maintenance:profile-pipeline-drain";
export function ensureProfilePipelineDrainJob(templateId: string, now?: number): boolean;
```

Mirrors `ensureContactProfileEmbedSweepJob`: no-op when a `pending`+`enabled` job of this type for the same template already exists, or when the backlog is 0. **The job's `templateId` column stays `NULL`** — the template id lives in `payload: { templateId }`. This is load-bearing: `schedule-policy.ts` treats any `templateId`-bearing job as a removed agent-template schedule (`isAgentTemplateSchedule`) and blocks re-enabling it; a maintenance job must not trip that policy (§ADR-172-4 consequence).

Registered in `MAINTENANCE_HANDLERS` (`scheduler/runner.ts`): the handler reads `payload.templateId` and calls `runPipelineTemplate` with `trigger: "scheduled"`, template-config batch size, `forcePersona: false`.

### 9.2 Re-enqueue condition

After **any** pipeline run (manual or drain) for a template with `config.pipeline.scheduleDrain: true`, re-enqueue **iff**:

```
remainingBacklog > 0  AND  errors.length === 0  AND  cleared > 0
```

`cleared > 0` is the progress guard: a batch that only skipped (nothing left the backlog) must not schedule itself into an infinite skip-loop — the §4.2/§6.4 predicate design makes this state rare, and the guard makes it terminal. Opt-in switch: `scheduleDrain` in template config (default `false`, editable via existing template editing; a run-level `scheduleDrain` boolean in `ProfilePipelineRunInput` may override per-run).

### 9.3 `runUntilCaughtUp` (dev/CLI only)

```ts
export async function runProfilePipelineUntilCaughtUp(
  templateId: string,
  opts?: { maxBatches?: number /* default 5 */; batchSize?: number; fetchImpl?; env? },
): Promise<ProfilePipelineDrainReport>;  // last run's result + batches executed
```

Loops `runPipelineTemplate` until `complete`, errors, `cleared === 0`, or `maxBatches` — the `runContactProfileEmbedSweepUntilCaughtUp` shape. Not exposed over HTTP in v1.

---

## 10. Failure Modes & Error Contract

| Condition | Where | Behavior / code |
|---|---|---|
| Template not found / not a pipeline where required | route | 404 `not_found` / `NOT_A_PIPELINE` |
| Invalid input (bad ids, batchSize type) | route (zod) | 400 `VALIDATION_ERROR` + details |
| Concurrent non-explicit run for template | route | 409 `PIPELINE_RUN_ACTIVE` |
| `agent` step in pipeline declaration | template validation | 400 `PIPELINE_STEP_UNSUPPORTED` |
| Unknown handler key | template validation | 400 `PIPELINE_STEP_UNSUPPORTED` |
| Thread provisioning / message append fails | runner | non-fatal, §3.5 |
| X disconnected / reauth / tier / rate limit | hydration handler | actionable skip; no hydration cache marker (§5.4) |
| X partial not-found response | hydration handler | cache only the explicit missing IDs for 30 days; hydrate successes (§5.4) |
| Other X request/write failure | hydration handler | per-contact failure; unresolved profiles retry (§5.4) |
| Gravatar probe network error | avatar handler | per-contact `failed`, retry next run (§6.1.5) |
| Persona per-contact errors | persona handler | §7.2 mapping |
| `PersonaGenerationUnavailableError` | persona handler | step abort, §7.3; no re-enqueue |
| Detached execution throws | runner | run `failed`, error persisted (§3.2) |
| Planner throws | route | 500, run not created |

Per-contact failures never fail the run (§5.3): partial progress is progress, and the failed contacts remain in the backlog for the next batch.

---

## 11. Privacy

No new persona evidence surface: the persona step consumes the frozen §3 allowlist. X hydration sends only stable numeric X user IDs to the already-connected X API and stores public profile data on the matching identity; it never includes profile values in thread messages. The avatar handler writes only `contact_identities.avatar_url` (already public-platform data), `contacts.metadata.avatarEnrich` (metadata is deny-listed from persona evidence), and enrichment scores. Thread messages contain **aggregate counts only — never contact names, emails, or ids** (the thread lives in an RTX workspace outside Signals' scope model; `workflow_steps.contactId` keeps per-contact audit *inside* Signals). The gravatar probe sends only the md5 of an email the read path already sends to gravatar today.

---

## 12. Tests

Fixture: **700 / 300 / 20** — 700 contacts (universe), 400 fully profiled, 300 matching backlog predicates in mixed combinations (avatar-only, persona-only, both, stale-only), batch 20.

1. **Planner:** `countProfilePipelineBacklog()` = 300 on the fixture; `planProfilePipelineRun({ batchSize: 20 })` returns exactly 20 ids ordered by (`enrichmentScore ASC`, `updatedAt ASC`, `id ASC`); filters (`platform`, `maxEnrichmentScore`, flag toggles) narrow correctly; archived/`isSelf` never selected.
2. **Second-plan exclusion:** after clearing N of the first batch (write avatars/personas directly), the next plan contains none of the cleared ids and `countProfilePipelineBacklog()` = 300 − N.
3. **Explicit mode:** `contactIds: [one]` → `backlogTotal: 1`, plan ignores global backlog, per-step eligibility still applied, `remainingBacklog` restricted to that id; unknown id → 400.
4. **Loop safety:** insufficient-evidence contacts absent from `needsPersona` backlog (SQL approximation); `no_source` contacts excluded for the TTL then re-admitted; a run with `cleared === 0` does not re-enqueue.
5. **Result contract:** run config stores `backlogTotal`/`batchSize`/`selectedContactIds` at start; result stores §5.2 keys; `remainingBacklog` is a re-query (test seeds a new backlog contact mid-run and asserts it is counted — subtraction would fail this).
6. **X hydration:** batch lookup caps at 100 IDs (including a 120-ID 100+20 fixture), partial successes/errors, fill-gaps-only writes, placeholder rename, archive metadata preservation, success/miss TTL caches, avatar validation, and credential/rate/tier skip mappings.
7. **Avatar handler:** each §6.1 source in isolation (platform_data recovery incl. X `_400x400` upscale, legacy metadata → primary identity, gravatar 200/404/network-error via injected `fetchImpl`), each skip reason, `validateIdentityAvatarUrl` rejection path, `recalcContactEnrichment` called on update.
8. **Persona step:** each §7.2 mapping with a stubbed `generatePersona`/`refreshPersonaIfStale`; child runs carry `parentWorkflowId`; abort leaves remaining contacts `aborted` and blocks re-enqueue; `forcePersona` ignored when `trigger:"scheduled"`.
9. **Thread lifecycle:** RTX refs stored under the `runTemplateViaRtx` keys and readable by `getRtxRefsFromRunConfig`; open-thread works on a pipeline run; provisioning failure → thread-less completion; exactly 2+N messages with aggregate-only content (privacy scan for fixture contact names/emails in message bodies).
10. **Drain:** `MAINTENANCE_HANDLERS` entry runs the pipeline from `payload.templateId`; job row has `templateId` column `NULL` (schedule-policy assertion `canReactivateScheduleLocally` = true); re-enqueue only under §9.2; `runUntilCaughtUp` respects `maxBatches` and no-progress stop.
11. **Concurrency:** second non-explicit run 409s while first is `running`; explicit run allowed.

---

## 13. File Map & Dev Slices

| Slice | Content | Files |
|---|---|---|
| P1 Backlog + planner | §4 predicates, count, plan, filters, explicit mode + tests (fixture builder) | `src/lib/db/queries/profile-pipeline-backlog.ts` |
| P2 X hydration | §5.4 batch client, handler, seed migration, aggregation + tests | `src/lib/platforms/x/client.ts`, `src/lib/workflows/pipeline/handlers/hydrate-x-profiles.ts`, `src/lib/db/seed-templates.ts` |
| P3 Avatar handler | §6 + `recalcContactEnrichment` wiring + tests | `src/lib/workflows/pipeline/handlers/enrich-contact-avatars.ts` |
| P4 Pipeline runner + thread | §2 types/registry, §3 lifecycle, `appendRtxThreadMessage`, §5 contract, run-route branch, backlog route, §7 persona handler | `src/lib/workflows/pipeline/{types,run-pipeline-template}.ts`, `handlers/{index,generate-persona-step}.ts`, `src/lib/rtx/runtime-sessions.ts`, `src/app/api/workflows/templates/[id]/{run,backlog}/route.ts` |
| P5 Gallery + contact UI | §8 preview/summary/badge, contact-detail button, seed template (`SEED_VERSION` bump) | `src/app/dashboard/workflows/template-gallery.tsx`, contact profile header, `src/lib/db/seed-templates.ts` |
| P6 Drain + CLI | §9 job type, `MAINTENANCE_HANDLERS` entry, `runUntilCaughtUp` | `src/lib/db/profile-pipeline-drain.ts`, `src/lib/scheduler/runner.ts` |
| P7 Integration tests | §12 items 5, 9, 10, 11 end-to-end | test files alongside |

Suggested order P1 → P2 → P3 → P4 → (P5 ∥ P6) → P7; each slice lands with its unit tests, `npm run check` green.

---

## 14. Acceptance Matrix (issue #172 AC → spec → test)

| Issue AC | Spec | Test (§12) |
|---|---|---|
| `countProfilePipelineBacklog()` + `planProfilePipelineRun()` server-side | §4.3 | 1, 2 |
| Run config stores `backlogTotal`, `selectedContactIds`, `batchSize` at start | §5.1 | 5 |
| Run result stores per-outcome counts + `remainingBacklog` | §5.2 | 5 |
| Gallery shows backlog total and batch size before Run | §8.1 | 4 (route), UI component test in P4 |
| Scheduled re-enqueue when `remainingBacklog > 0` (opt-in) | §9.1–9.2 | 9 |
| Thread-attached pipeline template + hydration + avatar + persona steps | §2, §3, §5.4, §6, §7 | 6, 7, 8, 9 |
| Tests: 300/20 selects 20; cleared excluded on second plan; single-contact mode | §12 fixture | 1, 2, 3 |

---

## 15. Design Decisions (ADR Summary)

**ADR-172-1: Pipelines are a `config.pipeline` block on existing templates, not a new `templateType`.** — Accepted. Context: the gallery, `TEMPLATE_TO_WORKFLOW_TYPE`, and category UI all key off `templateType`; heartbeat's model makes the executor a property of the *step*, not the campaign category. Options: (a) widen the enum with `"pipeline"` — rejected: forces category churn everywhere for what is an execution mode, not a domain category; (b) declarative `pipeline` block in `config`, run route branches on its presence — chosen; (c) separate `pipelines` table — rejected: duplicates the whole template surface (gallery, duplicate, run counts) for one JSON column's worth of difference. Consequences: pipeline templates inherit gallery/duplication/observability for free; cost is an untyped JSON contract, mitigated by zod validation at the run route and seed time.

**ADR-172-2: The run route returns after plan + provisioning; steps execute on a detached in-process promise.** — Accepted. Context: up to 50 LLM calls per run cannot sit inside one HTTP request (persona's synchronous ADR-062-4 was explicitly single-contact); a job queue is over-machinery for a local single-user app. Options: (a) synchronous — rejected: multi-minute request, unusable gallery; (b) detached promise + status polling + the thread as the live surface — chosen (the scheduler interval already establishes in-process background work); (c) full job queue — rejected for v1, reopen if process-lifetime interruptions corrupt runs in practice. Consequences: instant Run feedback, thread is the progress UX; costs are a concurrency guard (409) and a mandatory catch-all that marks interrupted runs `failed`.

**ADR-172-3: The pipeline may first-generate personas; the passive refresh sweeper still never does.** — Accepted. Context: persona spec §8.2 forbade unattended first generation (cost + consent); the pipeline's whole point is draining `needsPersona` backlog. Options: (a) refresh-only pipeline — rejected: fails the issue's goal (Ceora Ford keeps initials *and* the 300-backlog never drains); (b) first-generation allowed because every pipeline trigger is an explicit operator act (manual Run, or per-template opt-in drain), with hard batch cap, hash-skip intact, `forcePersona` ignored on scheduled runs, drain off by default — chosen. Consequences: the consent boundary moves from "per contact" to "per explicit run/opt-in", honestly surfaced in the pre-run backlog copy; the sweeper's stance is unchanged.

**ADR-172-4: Scheduled drain is a `maintenance:*` one-shot re-enqueue job (payload-carried template id), not a cron template schedule.** — Accepted. Context: `schedule-policy.ts` deliberately exiled recurring agent-template schedules to RTX Agent Flows; the embed sweep established the compliant in-process pattern. Options: (a) cron `scheduled_jobs` row with `templateId` column set — rejected: trips `isAgentTemplateSchedule` policy and reintroduces the exiled pattern; (b) one-shot `maintenance:profile-pipeline-drain` re-enqueued only on progress (`cleared > 0`, no errors), template id in `payload`, `templateId` column `NULL` — chosen; recurring wall-clock scheduling remains an Agent Flow POSTing the run route. Consequences: drain is self-limiting and dies out at backlog-zero, errors, or no-progress; cost is that "every night at 3am" lives in Agent Flows, not Signals — consistent with the existing migration direction.

**ADR-172-5: Backlog predicates are loop-safe by construction.** — Accepted. Context: `remainingBacklog`-driven re-enqueue turns any contact that is *selected but never clearable* into an infinite scheduled loop. Options: (a) naive predicates (`avatar_url IS NULL`, `no persona`) + rely on the progress guard — rejected as primary defense: the guard would stop the drain entirely while one hopeless contact starves the batch of useful work each run; (b) predicates that mirror clearability — SQL evidence-sufficiency approximation inside `needsPersona`, TTL'd `exhaustedAt`/`gravatarVerifiedAt` markers inside `needsAvatar`, age-only staleness force-cleared by `refreshPersonaIfStale(force: ageStale)` — chosen, with the `cleared > 0` guard as backstop. Consequences: every selected contact has a plausible clearing path; cost is two metadata markers and a 30-day retry latency for exhausted contacts, both documented in §6.
