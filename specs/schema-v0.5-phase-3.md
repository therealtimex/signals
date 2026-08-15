# Schema v0.5 — Phase 3 Design Addendum: Wind Tunnel Simulation-Run Storage

**Status:** Proposed (System Design deliverable for [#43](https://github.com/therealtimex/signals/issues/43), epic [#22](https://github.com/therealtimex/signals/issues/22) Phase 3)
**Date:** 2026-08-15
**Base:** `main` @ `b965622` (Phase 2 complete via PRs #38–#42)
**Extends:** [`specs/schema-v0.5.md`](./schema-v0.5.md) (§4 Migration Rules and §6 Privacy Boundary apply verbatim) and [`specs/schema-v0.5-phase-2.md`](./schema-v0.5-phase-2.md) (§4.2 variant hooks, §9 boundary, ADR-022-7)
**Revision 2** (2026-08-15, resolves Review pass 1): launch-scope guard + public-grounding allowlist contract (§4.4, §8.1–8.2); shared-only calibration event reads + value-invariance testing (§7, §8.5); run-ownership enforcement for results, transcripts derive their run through the agent FK (§4.2, §4.4); calibration precedence/window/multi-post rules (§7); typed maintenance-job dispatch for the retention scheduler (§4.2, slice 3.3).
**Revision 3** (2026-08-15, resolves Review pass 2): explicit run-lifecycle state machine — the `create_simulation_run` tool starts atomically, `completeSimulationRun` owns all terminal transitions with `status`/`error` in its signature (§4.4); calibration windows anchor on per-post `content_posts.published_at`, never the overwritable `published_as` edge property, with a typed error for published-but-postless variants (§7.2c–d, §4.3); §8.5 invariant assertions assigned to their owning slices (§8.5, §11).

---

## 1. Scope & Constraints

Phase 2 shipped `launches` + `variants` with **latest-value Wind Tunnel hook columns** on `variants` (`predicted_score`, `prediction_confidence`, `predicted_metrics`, `prediction_model`, `simulated_at`) and deliberately deferred simulation-run storage (Phase 2 §9, ADR-022-7). This addendum designs that deferred slice — spec `signals-spec-v0.5.md` §D (Wind Tunnel: "Agent populations grounded in real Contact + Org data. Multi-variant simulation, predicted engagement + confidence, real-outcome feedback"):

1. **`simulation_runs`** — one row per simulation execution of one variant; status lifecycle; batch grouping for multi-variant sessions (§4.1)
2. **`simulation_agents`** — per-run synthetic population, grounded on real contacts/orgs with pinned `contact_personas` versions (§4.1, §5)
3. **`simulation_transcripts`** — per-agent dialogue/outcome records with a size + retention policy (§4.2, ADR-022-11)
4. **`simulation_calibrations`** — predicted vs real outcomes after publish, computed from existing pipes (§4.3, §7, ADR-022-12)
5. **Projection rule** — the five `variants.predicted_*` columns become a projection of the latest completed run (§6), completing the plan recorded in ADR-022-7
6. **Privacy** — the §6 zero-private-bytes invariant extends to simulation grounding and transcript export paths (§8)
7. **workflow_runs linkage** — when a run is workflow-orchestrated vs direct agent-tool invocation (§9)
8. **Agent tools** — additive only, registry sketch (§10); sequenced Dev slices (§11); ADRs 022-10/11/12 (§12)

Constraints unchanged and quoted in every PR: **additive-only DDL** (new tables, new indexes, new nullable/defaulted columns; enum *widening* is the only permitted column mutation — and per the Amendment D audit, Drizzle text enums in this codebase emit no CHECK constraint, so widens are code-only with zero DDL), **agent-tools API frozen** (all 27 registered tools untouched; new capabilities are new tools), **`contacts` remains a projection** (and `variants.predicted_*` now joins it as a projection surface), **SQLite + Drizzle, no graph/vector database**, **privacy defaults conservative** (scope filtering in the query layer; `properties_private` never serialized outward), **all LLM compute via the RTX SDK proxy** (ADR-022-9 — no provider keys; the simulation *engine* consumes `llm.chat` through `src/lib/rtx/llm.ts` conventions when workflow-orchestrated).

Out of scope for Phase 3 design (per handoff): Wind Tunnel UI, persona *generation* workflow, niche clustering workflow, Relationship Management product Phase 3, and any implementation before Review approves this spec.

---

## 2. Target ERD — Phase 3 additions

**New tables: `simulation_runs`, `simulation_agents`, `simulation_transcripts`, `simulation_calibrations`.** Existing tables are context.

A load-bearing decision up front: **simulation tables are *not* graph nodes** (no `graph_edges` enum widen, no new node types). Like `embeddings`, they are *derived computational artifacts* addressed by typed FKs, not entities anything traverses to generically. Run → variant is an intra-aggregate FK (same rationale as variant → launch in ADR-022-7); run → contact/persona grounding is provenance, not connectivity; calibration → content flows through the variant's existing `published_as` edge. Nothing in the Wind Tunnel needs `query_graph` to reach a run, so we don't pay the polymorphic-endpoint integrity cost (ADR-022-10).

```mermaid
erDiagram
    SIMULATION_RUNS {
        text id PK
        text variant_id FK "NOT NULL, cascade"
        text batch_id "nullable opaque group key for multi-variant sessions"
        text status "pending|running|completed|failed|cancelled"
        text population_spec "JSON — audience selection inputs (niche ids, filters, sample size, seed)"
        int agent_count
        text prediction_model "provider-qualified, Amendment C convention"
        text config "JSON — engine params, rounds, temperature"
        real predicted_score "0-100 aggregate"
        real prediction_confidence "0-1"
        text predicted_metrics "JSON keyed like engagement_metrics columns"
        text error
        text scope "shared|local_only — v1 always shared"
        text source "agent|workflow"
        text workflow_run_id FK "nullable"
        int transcripts_pruned_at "retention marker"
        int started_at
        int completed_at
    }
    SIMULATION_AGENTS {
        text id PK
        text simulation_run_id FK "NOT NULL, cascade"
        text contact_id FK "nullable, set null — real-contact grounding"
        text org_id FK "nullable, set null — org grounding"
        text contact_persona_id FK "nullable, set null — PINNED persona version (ADR-022-3)"
        text grounding "JSON — exact shared-scope digest fed to the agent"
        real engagement_score "per-agent predicted engagement"
        text outcome "open vocab: ignore|impression|like|reply|share|click|convert|..."
        text predicted_actions "JSON"
        text metadata "JSON"
    }
    SIMULATION_TRANSCRIPTS {
        text id PK
        text simulation_agent_id FK "NOT NULL UK, cascade — run derived via agent, no second FK"
        text content "JSON message array"
        int byte_size
        int token_count "nullable"
    }
    SIMULATION_CALIBRATIONS {
        text id PK
        text simulation_run_id FK "NOT NULL, cascade"
        text variant_id FK "NOT NULL, cascade (denormalized query key)"
        text content_item_id FK "nullable, set null"
        text content_post_id FK "nullable"
        int observed_from
        int observed_until
        real actual_score "same 0-100 scale as predicted_score"
        text actual_metrics "JSON keyed like engagement_metrics columns"
        real score_error "actual - predicted at compute time"
        text calibration "JSON per-metric errors"
        text workflow_run_id FK "nullable"
        text source "agent|workflow"
        int computed_at
    }

    VARIANTS ||--o{ SIMULATION_RUNS : "has runs (predicted_* = latest completed run)"
    SIMULATION_RUNS ||--o{ SIMULATION_AGENTS : "population"
    SIMULATION_AGENTS ||--o| SIMULATION_TRANSCRIPTS : "one transcript per agent (prune-by-run joins through here)"
    SIMULATION_RUNS ||--o{ SIMULATION_CALIBRATIONS : "append-only accuracy snapshots"
    CONTACTS ||--o{ SIMULATION_AGENTS : "grounds (set null on delete)"
    ORGS ||--o{ SIMULATION_AGENTS : "grounds (set null on delete)"
    CONTACT_PERSONAS ||--o{ SIMULATION_AGENTS : "pinned version"
    WORKFLOW_RUNS ||--o{ SIMULATION_RUNS : "orchestration provenance"
    CONTENT_POSTS ||--o{ SIMULATION_CALIBRATIONS : "actuals source"
```

### Node type registry (delta)

No delta. `simulation_run` / `simulation_agent` are **not** added to `graph_edges.src_type`/`dst_type`, `NODE_TYPES`, or `nodeTable()` — see §2 preamble and ADR-022-10. `graph-integrity` gains FK-backed sweeps only where SQLite can't enforce (none here — every Phase 3 reference is a real FK), so the integrity job needs **no new checks** for this phase.

### Edge catalog additions

None. The existing `published_as` (variant → content) edge is the bridge from simulation predictions to real outcomes; `contributes_to` (launch → goal) remains the goal linkage. Adding `grounded_on` edges (run → contact) was considered and rejected: it duplicates the typed `simulation_agents.contact_id` FK as thousands of polymorphic rows with zero traversal use case.

---

## 3. Gap Matrix — current `main` @ `b965622` vs Phase 3 target

| Spec v0.5 concept | Current `main` | Gap | Resolution |
|---|---|---|---|
| Simulation run (§D "multi-variant simulation") | ❌ only latest-value `predicted_*` columns on `variants`, writable via `upsert_variant` | No run history, no lifecycle, no reproducibility (population/config/seed unrecorded), no way to compare runs or audit a prediction | **`simulation_runs`** (§4.1); `variants.predicted_*` demoted to projection (§6) |
| Agent populations "grounded in real Contact + Org data" | ❌ nothing | Which contacts/orgs/personas grounded a prediction is unrecoverable | **`simulation_agents`** with typed FKs + `grounding` digest (§4.1) |
| Persona version pinning (ADR-022-3: "simulation runs can pin the persona version they were grounded on") | ⚠️ `contact_personas` is versioned/supersede-only — the *pinnable* half exists, nothing pins it | Pin storage absent | **`simulation_agents.contact_persona_id`** FK to the immutable version row (§5) |
| Per-agent transcripts | ❌ nothing | Dialogue/rationale unauditable; no size control if naively stored | **`simulation_transcripts`** separate prunable table + retention policy (§4.2, ADR-022-11) |
| "Real-outcome feedback" / calibration (§D; §G "Simulation Performance"; §H "Simulation Accuracy" goal) | ⚠️ real outcomes exist (`engagement_metrics`, `interactions` ∪ `content_activities`, `published_as` edge) but nothing joins them back to predictions | Predicted-vs-actual unrepresentable | **`simulation_calibrations`** computed from existing pipes — no new metrics ingestion (§4.3, §7) |
| Projection rule for `variants.predicted_*` | ⚠️ columns exist as free-write latest-value fields (ADR-022-7 called them "a projection-in-waiting") | No defined writer, ordering, or consistency rule | **Latest-completed-run projection** with one choke-point writer (§6) |
| Simulation privacy (§6 invariant: "excluded from public GTM simulations") | ⚠️ central scope filter + zero-private-bytes test exist for `query_graph`/export/`semantic_search`; simulation grounding path doesn't exist yet — and existing contact/identity readers return full rows with no public serializer | Invariant must cover grounding + transcripts *before* they exist (Phase 1 precedent); whole-row reads are unusable as grounding | **Launch-scope guard + explicit grounding-field allowlist; no `includeLocalOnly` on simulation tools at all; calibration values immune to `local_only` events** (§8, §7.2a) |
| Workflow-tracked simulation | ⚠️ `workflow_runs` exists; `workflow_type` enum lacks simulation values | Orchestrated runs can't be typed | **Code-only enum widen** `workflow_type` + `"simulate"`, `"calibrate"` (§9) |
| Simulation Accuracy goal type (§H) | ❌ `goals.goal_type` still the narrow 4-value enum | Calibration can't feed a typed goal | **Deferred** — calibration rows are queryable now; wiring a `simulation_accuracy` goal type is a product decision left to the goals epic (§7 note) |
| Simulation agent tools | ❌ `upsert_variant` prediction fields are the only surface | Agents can't create runs, record results, or read history | **Five additive tools** (§10); 27 → 32 |

---

## 4. Phase 3 Drizzle Sketch

Additions to `src/lib/db/schema.ts`, matching existing style (text PKs, unixepoch timestamps, JSON-as-text, `...timestamps`). Migrations are next-in-sequence: `0013` (runs + agents, slice 3.1), `0014` (transcripts, slice 3.3), `0015` (calibrations, slice 3.4). Slice 3.2 ships no DDL. All tables are new → invisible to N-1 binaries (rule 8 satisfied by construction); the only enum widens are code-only (§9). If `drizzle-kit generate` proposes anything beyond the three CREATE TABLE migrations, stop and escalate (Amendment D guard).

### 4.1 Simulation Runs & Agents (migration `0013`)

```ts
// --- Simulation Runs (Wind Tunnel executions; spec §D, ADR-022-10) ---
// One row per simulation of ONE variant. Multi-variant sessions share a batch_id.
// Runs are derived artifacts, not graph nodes — addressed only via typed FKs.

export const simulationRuns = sqliteTable("simulation_runs", {
  id: text("id").primaryKey(),
  variantId: text("variant_id")
    .notNull()
    .references(() => variants.id, { onDelete: "cascade" }),
  batchId: text("batch_id"),               // opaque group key; one Wind Tunnel session over N variants = N runs, same batch_id
  status: text("status", {
    enum: ["pending", "running", "completed", "failed", "cancelled"],
  }).notNull().default("pending"),
  populationSpec: text("population_spec").default("{}"),
    // JSON — the selection INPUT: niche ids, org ids, filters, sampleSize, seed.
    // simulation_agents rows are the materialized OUTPUT of this spec.
  agentCount: integer("agent_count").notNull().default(0),
  predictionModel: text("prediction_model"), // provider-qualified "provider:model" (Amendment C convention)
  config: text("config").default("{}"),    // JSON — engine params (rounds, temperature, scoring recipe version)
  // Aggregate outputs — the projection source for variants.predicted_* (§6):
  predictedScore: real("predicted_score"),           // 0–100
  predictionConfidence: real("prediction_confidence"), // 0–1
  predictedMetrics: text("predicted_metrics").default("{}"),
    // JSON — keys MUST use engagement_metrics column names (likes, comments, shares,
    // impressions, clicks, bookmarks, quotes, retweets) so calibration compares like-for-like (§7)
  error: text("error"),
  scope: text("scope", { enum: ["shared", "local_only"] })
    .notNull().default("shared"),          // v1 always writes 'shared' — truthful because createSimulationRun
                                           // rejects non-shared launches (§8.1) and grounding is allowlist-only
                                           // (§8.2); transcripts inherit run scope
  source: text("source").notNull().default("agent"), // "agent" | "workflow"
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id), // set iff workflow-orchestrated (§9)
  transcriptsPrunedAt: integer("transcripts_pruned_at"), // set by retention job; results remain valid after pruning
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  ...timestamps,
}, (table) => [
  index("idx_sim_runs_variant_completed").on(table.variantId, table.completedAt), // latest-completed lookup (§6)
  index("idx_sim_runs_batch").on(table.batchId),
  index("idx_sim_runs_status").on(table.status),
]);

// --- Simulation Agents (per-run synthetic population; spec §D grounding) ---
// Populations are RUN-OWNED: a batch simulating 5 variants against the same 100
// contacts writes 500 agent rows. Accepted duplication (ADR-022-10) — each run is
// self-contained and auditable, and local-first scale makes the cost trivial.

export const simulationAgents = sqliteTable("simulation_agents", {
  id: text("id").primaryKey(),
  simulationRunId: text("simulation_run_id")
    .notNull()
    .references(() => simulationRuns.id, { onDelete: "cascade" }),
  contactId: text("contact_id")
    .references(() => contacts.id, { onDelete: "set null" }),   // real-contact grounding; survives contact deletion as history
  orgId: text("org_id")
    .references(() => orgs.id, { onDelete: "set null" }),
  contactPersonaId: text("contact_persona_id")
    .references(() => contactPersonas.id, { onDelete: "set null" }),
    // THE PIN (ADR-022-3, §5): the immutable persona VERSION row that grounded this
    // agent. Never repointed; persona regeneration supersedes rows, it doesn't mutate them.
  grounding: text("grounding").default("{}"),
    // JSON — the exact shared-scope digest fed to the synthetic agent (name, bio,
    // persona archetype/tone/interests, identity stats, niche labels). Assembled
    // under the §8 privacy rule; doubles as the audit surface and survives
    // contact/persona deletion so old runs stay explainable.
  engagementScore: real("engagement_score"),  // per-agent predicted engagement, 0–100
  outcome: text("outcome"),
    // open vocabulary, write-path validated against SIMULATION_OUTCOMES registry (§4.4):
    // "ignore" | "impression" | "like" | "reply" | "share" | "click" | "convert" | ...
  predictedActions: text("predicted_actions").default("[]"), // JSON — richer per-action detail
  metadata: text("metadata").default("{}"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_sim_agents_run").on(table.simulationRunId),
  index("idx_sim_agents_contact").on(table.contactId),
  index("idx_sim_agents_persona").on(table.contactPersonaId),
]);
```

Design notes:

- **Batch grouping is a key, not a table.** "Optional launch-level grouping" (handoff item 1) is served by `batch_id`: the launch of a batch is derivable through any member's `variant_id` join, and a `simulation_batches` table would hold nothing but an id today. If batches later grow their own lifecycle/config, promote then (additive). Launch-level rollups ("best variant this session") are one indexed query on `batch_id`.
- **`contact_id` is nullable** to admit archetype-level agents (grounded on a niche or persona archetype rather than a specific person) without schema change; `grounding` records what actually grounded them. Real-contact grounding is the primary v1 path per spec §D.
- **Deletion semantics:** run history is preserved when source entities disappear (`set null` + `grounding` snapshot); runs themselves die only with their variant (cascade), which matches variant → launch cascade already in place.

### 4.2 Simulation Transcripts (migration `0014`)

```ts
// --- Simulation Transcripts (per-agent dialogue; ADR-022-11) ---
// Separate table so retention can prune dialogue WITHOUT touching runs, agents,
// or results. One row per agent, whole transcript as a JSON message array —
// per-message rows rejected (no query ever addresses individual messages).
// The transcript's run is DERIVED through the agent FK. A denormalized
// simulation_run_id was considered and rejected (Review pass 1): two independent
// FKs would let the database hold a transcript whose run id disagrees with its
// agent's run — cross-run contamination and mis-scoped pruning. One FK, one truth.

export const simulationTranscripts = sqliteTable("simulation_transcripts", {
  id: text("id").primaryKey(),
  simulationAgentId: text("simulation_agent_id")
    .notNull()
    .references(() => simulationAgents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),      // JSON — [{ role, text, ... }] message array
  byteSize: integer("byte_size").notNull(), // length of content at write time; retention accounting
  tokenCount: integer("token_count"),      // nullable — engine-reported when available
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("idx_sim_transcripts_agent").on(table.simulationAgentId),
]);
```

Prune-by-run is one indexed subquery — `DELETE FROM simulation_transcripts WHERE simulation_agent_id IN (SELECT id FROM simulation_agents WHERE simulation_run_id = ?)` — using `idx_sim_agents_run`; per-run transcript reads join the same way. No second FK, no inconsistency class.

**Size & retention policy (ADR-022-11).** Expected envelope: ~50–200 agents/run × ~2–10 KB transcript ≈ 0.1–2 MB per run — fine for dozens of runs, unbounded growth over hundreds. Policy:

- Transcripts are **never load-bearing**: `engagement_score`, `outcome`, `predicted_actions`, and run aggregates survive pruning; a pruned run stays fully comparable and calibratable.
- **Retention default:** keep transcripts for (a) the latest completed run per variant (the projection source stays explainable) and (b) any run younger than 30 days. Everything else is prunable.
- **Prune job** (`simulation-transcript-retention`): idempotent maintenance task in the `graph-integrity` mold; deletes qualifying transcripts via the agent-join subquery above and sets `simulation_runs.transcripts_pruned_at`. Report (rows/bytes freed) surfaces in Sync Health alongside graph-integrity output. Thresholds live in the job's config, not the schema.
- **Scheduler dispatch is real work, not just a row** (Review pass 1 audit fact: the current runner ignores `job_type`, hard-requires `templateId`, and always calls `startAgentWorkflow` — inserting a `scheduled_jobs` row alone would fail with "Scheduled job has no templateId"). Slice 3.3 therefore ships a **typed maintenance dispatch path** in `src/lib/scheduler/runner.ts`: a code-level registry of maintenance handlers keyed by `job_type` (e.g. `maintenance:simulation-transcript-retention` → `pruneSimulationTranscripts`), checked *before* the template path; maintenance jobs need no `templateId` and no workflow run. This is additive runner behavior (existing template jobs unchanged) and comes with runner tests: maintenance job dispatches its handler, recurring reschedule works, template jobs still behave, unknown `job_type` without `templateId` fails cleanly. Modeling retention as a workflow template was rejected — it isn't LLM/agent work, and faking a template would put a permanent no-op config row in the product's template list.

### 4.3 Simulation Calibrations (migration `0015`)

```ts
// --- Simulation Calibrations (predicted vs real; ADR-022-12) ---
// Append-only snapshots joining a run's predictions to real post-publish outcomes.
// Actuals are COMPUTED from existing pipes (engagement_metrics, interactions ∪
// content_activities) — this table stores results, it never ingests platform data.

export const simulationCalibrations = sqliteTable("simulation_calibrations", {
  id: text("id").primaryKey(),
  simulationRunId: text("simulation_run_id")
    .notNull()
    .references(() => simulationRuns.id, { onDelete: "cascade" }),
  variantId: text("variant_id")
    .notNull()
    .references(() => variants.id, { onDelete: "cascade" }), // denormalized: "accuracy by variant/launch" without a run join
  contentItemId: text("content_item_id")
    .references(() => contentItems.id, { onDelete: "set null" }), // the materialized publish target at compute time
  contentPostId: text("content_post_id")
    .references(() => contentPosts.id),
    // set iff exactly ONE post grounded the actuals (the common case); NULL when
    // actuals aggregate across multiple posts of the content item — the per-post
    // breakdown then lives in the calibration JSON (§7.2 aggregation rule)
  observedFrom: integer("observed_from").notNull(),
    // MIN(eligible posts' content_posts.published_at) — earliest evidence bound;
    // authoritative per-post windows live in the calibration JSON (§7.2c).
    // Never sourced from the published_as edge property (overwritable on re-publish)
  observedUntil: integer("observed_until").notNull(), // window end (caller horizon)
  actualScore: real("actual_score"),       // 0–100, same scoring recipe as predicted_score (recipe version in calibration JSON)
  actualMetrics: text("actual_metrics").default("{}"),
    // JSON — engagement_metrics column names, same keyspace as predicted_metrics
  scoreError: real("score_error"),         // actual_score − run.predicted_score at compute time (sortable accuracy analytics)
  calibration: text("calibration").default("{}"),
    // JSON — per-metric predicted/actual/error triples, scoring recipe version, notes
  workflowRunId: text("workflow_run_id").references(() => workflowRuns.id),
  source: text("source").notNull().default("workflow"), // "workflow" | "agent"
  computedAt: integer("computed_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_sim_calibrations_run_window").on(table.simulationRunId, table.observedUntil),
  index("idx_sim_calibrations_variant").on(table.variantId),
]);
```

Append-only like `engagement_metrics` / `goal_progress`: recalibrating at a longer horizon adds a row (new `observed_until`); "current accuracy" reads the latest row per run. No unique window key — horizons are caller-chosen and overlapping snapshots are harmless history.

### 4.4 Query-layer boundaries

New module `src/lib/db/queries/simulations.ts` (single owner of all four tables' writes) plus a small open-vocabulary registry `src/lib/db/simulation-outcomes.ts` (`SIMULATION_OUTCOMES`, write-path validated, mirroring `variant-types.ts` — adding an outcome is a code edit, not a migration):

| Function | Responsibility |
|---|---|
| `createSimulationRun({ variantId, populationSpec, batchId?, predictionModel?, config?, workflowRunId? })` | **Launch-scope guard first** (§8.1): load the variant's parent launch and reject with a typed `SimulationScopeError` unless `launch.scope = 'shared'` — v1 runs are always `'shared'`, and this guard is what makes that stamp truthful. Then insert run (`pending`) and **materialize the population**: resolve `populationSpec`, pin each agent's active persona version (§5), assemble `grounding` digests **only** through the public-grounding projection (§8.2 allowlist); set `agentCount`. Returns run + agents with grounding (the payload a simulating agent role-plays from). |
| `startSimulationRun(runId)` | `pending → running`, sets `startedAt`. Idempotent: calling on a run already `running` is a no-op. The **`create_simulation_run` tool handler calls this atomically** after creation, so tool callers always receive a `running` run (§4.4a); workflow orchestration calls it when execution actually begins. |
| `recordSimulationAgentResults(runId, results[])` | Batch per-agent writes (`engagementScore`, `outcome` validated against `SIMULATION_OUTCOMES`, `predictedActions`, optional transcript → `simulation_transcripts` with `byteSize`). **Ownership is enforced, not assumed**: in the same transaction, every `agentId` must satisfy `simulation_agents.simulation_run_id = runId`; any mismatch rejects the whole batch with a typed `SimulationAgentOwnershipError` (no partial writes). Idempotent per `agentId` (re-record overwrites, including its transcript row). Rejected unless run is `running`. |
| `completeSimulationRun(runId, { status?: "completed" \| "failed" \| "cancelled", predictedScore?, predictionConfidence?, predictedMetrics?, error? })` | **The single owner of every terminal transition, and the projection choke point** (§6). `status` defaults to `"completed"`, which requires `predictedScore` + `predictionConfidence`: sets `completedAt` + aggregates, then in the same transaction projects onto the parent variant iff this run is now the latest completed one. `"failed"` requires `error`; `"cancelled"` takes optional `error`; neither projects nor requires scores. Signature matches the `complete_simulation_run` tool one-for-one — Dev invents nothing. |
| `listSimulationRuns({ variantId?, launchId?, batchId?, status?, page? })`, `getSimulationRun(id, { includeAgents?, includeTranscripts? })` | Reads. Transcripts load only on explicit request (size). `launchId` filter joins through `variants`. |
| `pruneSimulationTranscripts({ keepDays?, dryRun? })` | Retention job entry point (§4.2); deletes via the agent-join subquery. |
| `calibrateSimulationRun(runId, { observedUntil? })` | §7. Resolves the run's variant → `content_item` → its `content_posts`; computes `actual_metrics` per the §7.2 precedence, per-post window, and aggregation rules from **shared-scope** evidence only (§7.2a); scores with the same recipe as predictions; inserts calibration row. Typed failures: variant unpublished, or published with no eligible platform post (`CalibrationSourceError`, §7.2d) — never a zero row. |

#### §4.4a Run lifecycle state machine (Review pass 2)

Legal transitions, enforced in the query layer with a typed `SimulationRunStateError` for everything else:

| From | To | Via | Notes |
|---|---|---|---|
| `pending` | `running` | `startSimulationRun` | idempotent when already `running` |
| `pending` | `cancelled` \| `failed` | `completeSimulationRun` | abort-before-start; no scores required, no projection |
| `running` | `completed` | `completeSimulationRun` | requires scores; fires the §6 projection |
| `running` | `failed` \| `cancelled` | `completeSimulationRun` | `failed` requires `error` |
| terminal | same terminal | `completeSimulationRun` | idempotent no-op (safe retry); *different* terminal status throws |

`recordSimulationAgentResults` requires `running` (as before). The two invocation paths both satisfy this by construction:

- **Direct agent path:** the `create_simulation_run` **tool** wraps `createSimulationRun` + `startSimulationRun` in one transaction and returns the run already `running` — the documented tool sequence `create_simulation_run → record_simulation_results → complete_simulation_run` needs no separate start step, and there is deliberately **no start tool** (a tool-created run that the agent won't immediately work is not a real use case; `pending` exists for orchestrated runs, not tool runs).
- **Workflow path:** the orchestrator calls `createSimulationRun` (run queued as `pending`) and `startSimulationRun` when execution begins, mirroring `workflow_runs.status` semantics.

Tests (slice 3.2): direct-agent happy path through the three tools end-to-end; invalid transitions (`record` on `pending`/terminal, `complete("completed")` without scores, `failed` without `error`, conflicting terminal re-completion); idempotent retry of `start` and of same-status `complete`.

Boundary rules, mirroring Phase 2 precedent: agent-tool handlers and workflow steps call these functions and never touch the tables directly; direct `variants.predicted_*` writes outside `completeSimulationRun` (other than the frozen `upsert_variant` contract, §6) are an architectural smell; grounding assembly is the only place simulation code reads CRM data, and it reads exclusively through the §8.2 public-grounding projection — never raw table access, never whole query-layer rows (Review pass 1 audit fact: existing contact/identity readers return complete rows including email, phone, funnel stage, tags, `platformData`, `syncErrors` — sufficient for local UI, categorically wrong as a simulation payload).

---

## 5. Persona Pinning (ADR-022-3 fulfilled)

`contact_personas` was designed versioned precisely for this moment (ADR-022-3: "Wind Tunnel can pin the persona version it was grounded on"; schema-v0.5.md §5: "simulation runs can pin the persona version they were grounded on"). The mechanism:

- **Pin = FK to the immutable version row.** `simulation_agents.contact_persona_id` references the specific `contact_personas.id` that grounded the agent — which, by the supersede-never-update rule, is a frozen snapshot. At `createSimulationRun` time the population assembler selects each contact's **active** persona row and stores that row's id; later regeneration supersedes the row but never mutates it, so the pin stays truthful forever.
- **Runs record version(s), plural, for free:** different agents in one run may pin different persona versions (e.g. a run created mid-regeneration), and "which persona versions grounded run X" is `SELECT DISTINCT contact_persona_id FROM simulation_agents WHERE simulation_run_id = ?`.
- **Belt and braces:** the `grounding` JSON also embeds the persona fields actually used (archetype, tone, interests…), so even if the persona row is cascade-deleted with its contact (`set null` on the pin), the run remains explainable and calibration remains meaningful.
- Personas with `scope = 'local_only'` are **never** selected for grounding (§8); an agent whose contact has only a local-only persona is grounded on identity/public data alone, `contact_persona_id` NULL.

---

## 6. Projection Rule — `variants.predicted_*`

ADR-022-7 declared the five prediction columns "a projection-in-waiting for Phase 3 simulation runs." This section makes them a projection, following the `contacts` projection rule (schema-v0.5.md §4 rule 2: dual-write in the write path, same transaction, logic in TypeScript).

**Rule:** `variants.predicted_score`, `prediction_confidence`, `predicted_metrics`, `prediction_model`, `simulated_at` are a **projection of the latest completed `simulation_runs` row for that variant**, ordered by `completed_at` (ties broken by `id`).

Mechanics:

1. **Single writer:** `completeSimulationRun` (§4.4). On transition to `completed` it checks (via `idx_sim_runs_variant_completed`) whether this run is now the latest completed for its variant; if so, in the same transaction it copies `predicted_score → variants.predicted_score`, `prediction_confidence`, `predicted_metrics`, `prediction_model`, and sets `variants.simulated_at = run.completed_at`.
2. **Status interplay:** the same transaction sets `variants.status = 'simulated'` iff current status is `'draft'` — never downgrading `selected` / `published` / `rejected` (a re-simulation of a selected variant refreshes numbers, not workflow position). This mirrors the publish choke point's exclusive ownership of `'published'` (Phase 2 Amendment B).
3. **Frozen-contract carve-out:** `upsert_variant` keeps accepting prediction fields (the 27-tool API is frozen). Its writes are now documented as **manual override**: they set the columns directly, create no run, and the next completed run overwrites them. The tool description gains a pointer to the new simulation tools; nothing breaks.
4. **Failed/cancelled runs never project.** A variant whose only runs failed keeps its previous projection (or NULLs).
5. **No recompute path in v1:** runs are deleted only by variant cascade (which deletes the projection target too), so projection-repair logic is unnecessary. If a targeted run-delete capability ever ships, it must recompute the projection from the remaining latest completed run — noted here so the invariant travels with the feature.
6. **Read rule:** variant-comparison surfaces (existing `query_launches` variant summaries, future Wind Tunnel UI) keep reading the variant columns — one indexed read, unchanged contract. Run *history* reads go to `simulation_runs`.

---

## 7. Calibration Model — real outcomes through existing pipes

Calibration closes spec §D's "real-outcome feedback" loop **without any new ingestion**. The full path already exists on `main`; Phase 3 only adds the join-and-snapshot step:

```
variant ──published_as──▶ content_item ──▶ content_posts ──▶ engagement_metrics   (metric snapshots)
                                            └──▶ interactions ∪ content_activities (shared-scope event counts, §7.2a)
simulation_runs (predicted) ──▶ simulation_calibrations ◀── actuals computed from the above
```

1. **Trigger:** a variant reaches `published` through the Phase 2 choke point (`publishVariant` / `publishVariantForContentItem`), which guarantees `content_item_id` + `published_as` edge exist. Calibration becomes *possible* for every completed run of that variant.
2. **Compute** (`calibrateSimulationRun`, §4.4). Windows are **per post**, anchored on `content_posts.published_at` — *not* on the `published_as` edge's `published_at` property, which is one overwritable value per variant/content pair (re-publish refreshes it, so with staggered posts it would silently exclude earlier posts' events or mislabel the persisted window). `observed_until` is the caller horizon (default "now"), enforced on **every** evidence source. Four rules pin down the actuals (Review passes 1–2):
   - **(a) Shared-scope evidence only.** The existing `listEngagementEventsByContentPost` union is deliberately an *unfiltered local analytics read* (`interactions` even defaults `scope = 'local_only'`), so calibration must not consume it as-is: a private relationship event would silently move `actual_metrics` / `actual_score` / `score_error` on a shared row — a derived-value leak even with no private string serialized. Slice 3.4 adds a scope-aware variant (`listEngagementEventsByContentPost(postId, { scope: 'shared' })` or a `listSharedEngagementEventsByContentPost` wrapper; existing callers unchanged), and calibration reads only that. Rule: **`local_only` rows never influence any derived calibration value.** `engagement_metrics` needs no filter — it is platform-snapshot data with no scope column, aggregate public counters by construction.
   - **(b) Precedence — metric snapshots are canonical, events are fallback.** Event rows are derived from the same platform engagements that feed the metric snapshots, so summing both double-counts. Per counter key (likes, comments, shares, impressions, clicks, bookmarks, quotes, retweets): use the latest in-window `engagement_metrics` snapshot (`snapshot_at ≤ observed_until`) as the value; fall back to shared-event counts (`occurred_at` within the window) for a key **only when no in-window snapshot exists for that post**. Event rows never *add to* a snapshot counter; the `calibration` JSON records which source grounded each key so mixed-provenance rows are auditable.
   - **(c) Multi-post aggregation with per-post windows.** `content_posts` is one-to-many per content item. **Eligible posts** are those with `published_at` NOT NULL and `published_at ≤ observed_until`; each eligible post's window is `[post.published_at, observed_until]`, applied to its snapshots and fallback events under rules (a)/(b). Posts with NULL `published_at` are excluded and listed as `skipped_posts` in the `calibration` JSON (visible, not silent). Actuals for the run are the element-wise **sum across eligible posts** — the honest per-variant comparison, since the prediction was made for the variant, not a single post. Persisted columns: `observed_from` = MIN(eligible posts' `published_at`) (the earliest evidence bound; the authoritative per-post windows live in the `calibration` JSON breakdown), `content_post_id` set iff exactly one post grounded the row (else NULL).
   - **(d) No eligible post → typed error, not a zero row.** `publishVariant` can mark a variant `published` and write the `published_as` edge without any `content_posts` row existing (agent-tool external publish). Calibrating such a run throws a typed `CalibrationSourceError` ("variant is published but has no platform post with a publish timestamp — sync the post or calibrate later"); it never writes an all-zero calibration row that would masquerade as "no engagement."
   Then normalize into `actual_metrics` using the **same keyspace** as `predicted_metrics` (the §4.1 alignment rule exists for exactly this comparison), compute `actual_score` with the same scoring recipe used for predictions (recipe version recorded in `calibration` JSON so recipe drift is detectable), and store `score_error`.
3. **Cadence & horizons:** append-only; typical use is one snapshot at publish+48h and one at publish+14d. The calibration workflow (§9) owns cadence; the schema is horizon-neutral.
4. **Goals:** "Simulation Accuracy" (spec §H) consumption is **deferred** — `goals.goal_type` widening to `simulation_accuracy` is a code-only enum widen available whenever the goals epic wants it, and calibration rows are already queryable for `goal_progress` computation via the existing machinery. No goal wiring ships in Phase 3 (kept out to avoid product-scope creep; noted in the gap matrix).
5. **Ownership (ADR-022-12):** calibration *computation* is workflow-owned (like clustering, ADR-022-6) — a `workflow_type: "calibrate"` run that sweeps published variants with uncalibrated or stale-horizon runs. The agent tool (§10) is a manual trigger over the same query-layer function, `source: 'agent'`.

---

## 8. Privacy — §6 invariant extended to simulation

Spec §2: *"Private personal notes and relationship stages remain local and are excluded from public GTM simulations unless explicitly permitted."* Simulation is the **canonical** "leaves the private context" consumer that §6 of `schema-v0.5.md` was written for. Rules:

1. **Launch-scope guard: no simulation of non-shared launches in v1.** `launches.scope` can be `'local_only'`, and existing lookups (`getLaunchById`) deliberately don't scope-filter — so "runs are always `'shared'`" is only truthful if the write path enforces it. `createSimulationRun` rejects any variant whose parent launch is not `scope = 'shared'` with a typed `SimulationScopeError` ("mark the launch shared, or keep it out of the Wind Tunnel"). Consequence: every run, agent, transcript, and calibration row descends from a shared launch, and `query_simulations` (which has no scope flag) cannot surface local-only campaign material. The alternative — runs inheriting launch scope with default filtering — is deferred to the same future decision as item 3's "unless explicitly permitted"; v1 takes the guard because it is enforceable with one check and zero filter surface.
2. **Grounding is an allowlist projection, not filtered rows.** "Read through the scope-filtered query layer" is not enough: existing contact/identity readers return complete rows (email, phone, `funnelStage`, `tags`, `notes`-class fields, raw `platformData`, `syncErrors`) with no public serializer. Slice 3.1 therefore ships `assembleAgentGrounding` in `queries/simulations.ts` building the `grounding` digest from an **explicit field allowlist** — the single contract for what simulation may ever see:
   - `contacts`: `name`, `title`, `company`, `location`, `bio`
   - `contact_identities` / `org_identities`: `platform`, `platformHandle`, `displayName`, `bio`, `isVerified`, `followersCount`, `followingCount`, `postsCount`, `platformCreatedAt`
   - `contact_personas` (active, `scope = 'shared'` only): `archetype`, `tone`, `summary`, `interests`, `conversionTriggers`, `engagementFormats`
   - `orgs` (`scope = 'shared'` only): `name`, `orgType`, `domain`, `description`
   - `niches` (`scope = 'shared'` only): `name`, `nicheType`; membership via `shared` `belongs_to_niche` edges' `weight`
   - `graph_edges`: `shared` rows' `properties` only — never `properties_private`, never `local_only` rows; `interactions`: `shared` rows only, summary-level
   Everything not listed is denied by construction — the projection builds the digest field-by-field (no row spreads, the §6 "spread the whole object" bug class cannot occur). Extending the allowlist is a reviewed code change to one function.
3. **No `includeLocalOnly` on simulation tools — by design.** Unlike `query_graph` (where an RTX agent acting for the local user may legitimately need private data), simulation grounding is *definitionally* the public-GTM context. The five new tools take no scope flag; there is no code path from `local_only` rows or `properties_private` into `grounding`, transcripts, or predictions. "Unless explicitly permitted" (spec §2) is deliberately **not implemented** in v1 — permitting private grounding would need its own reviewed design (per-run consent recording, exportability implications) and an ADR amendment; until then the door stays closed rather than flag-gated.
4. **Transcripts and exports.** Transcript `content` is generated from `grounding` + variant body + engine output — all allowlist-derived, so transcripts are exportable wherever the run is (`scope` inherited from the run, `'shared'` in v1, guaranteed by item 1). Every export/serialization path for simulation data (tool responses, future UI export) runs the same central scope filter as other consumers; if a `local_only` run ever exists (future), its transcripts and agents are excluded by the run-scope join.
5. **Invariant test suite: begins in slice 3.1, extended by each owning slice.** The suite (shared fixture + harness) ships in 3.1 with every assertion its surfaces support; each later slice **must** extend the same suite for the surfaces it introduces — the extension is part of that slice's acceptance criteria, not optional hardening. Fixture: the §6 DB (`local_only` edges + interactions + `properties_private` + a `local_only` persona) plus sentinel strings seeded in allowlist-excluded fields (email, phone, tags, `platformData`, `syncErrors`). Assertion-to-slice ownership:

   | Slice | §8.5 assertions it owns |
   |---|---|
   | **3.1** | Zero sentinel/private bytes through `createSimulationRun` grounding output and `query_simulations` (runs + `includeAgents`). Negative guards: `local_only` launch → `SimulationScopeError`; contact whose only persona is `local_only` grounds with `contact_persona_id` NULL and no persona fields in the digest. |
   | **3.2** | Zero private bytes through `record_simulation_results` / `complete_simulation_run` round-trips and the post-projection variant read (results/aggregates echo nothing beyond what 3.1's grounding admitted). |
   | **3.3** | Zero private bytes through transcript `content` on `query_simulations includeTranscripts` and every transcript export path. |
   | **3.4** | Zero private bytes through calibration rows; **value invariance** — seeding additional `local_only` interactions/activities against a published post leaves `actual_metrics`, `actual_score`, `score_error`, and event-derived counts **numerically identical** (§7.2a; string-scanning alone cannot catch a private event shifting a shared number). |

---

## 9. workflow_runs Linkage

**Enum widen (code-only, rule 4):** `workflow_runs.workflow_type` gains `"simulate"` and `"calibrate"` (current: `sync | enrich | search | prune | sequence | agent`). Per the Amendment D audit, Drizzle text enums here have no CHECK constraint — this is a `schema.ts` edit with zero DDL; if drizzle-kit proposes a rebuild, escalate.

**When is a simulation workflow-tracked vs direct?**

| Path | `workflow_run_id` | `source` | When |
|---|---|---|---|
| **Workflow-orchestrated** | set (FK to a `workflow_type: "simulate"` run) | `"workflow"` | Signals' own engine executes the simulation: multi-agent LLM loops via the RTX proxy (`llm.chat`, ADR-022-9), batch sessions over a launch, scheduled re-simulation. Token/cost accounting lands on `workflow_runs` (existing columns); per-agent steps may log as `workflow_steps` with existing `tool_call`/`decision` step types — no step-type widen needed in v1. |
| **Direct agent-tool invocation** | NULL | `"agent"` | An RTX terminal agent drives the loop itself: `create_simulation_run` → role-plays each agent in its own runtime → `record_simulation_results` → `complete_simulation_run`. Its compute happens outside Signals, so there is no `workflow_runs` row to link; the model used is recorded in `simulation_runs.prediction_model` and `config`. |

Calibration mirrors this exactly (`workflow_type: "calibrate"` vs tool-triggered, §7.5). The rule of thumb, consistent with how `contact_personas.workflow_run_id` and `niches.source = 'clustering:<run>'` already work: **`workflow_run_id` records Signals-side orchestration provenance; it is never fabricated for external (RTX-agent) compute.**

The batch pattern composes: one `workflow_type: "simulate"` workflow run may own N `simulation_runs` sharing a `batch_id`, all pointing `workflow_run_id` at the same orchestration row.

---

## 10. Agent-Tool Impact (additive only; 27 → 32)

The 27 registered tools are untouched (one *description* clarification on `upsert_variant` per §6.3 — descriptions are not contract). New tools (registry + schemas + handlers + `realtimex-signals` skill docs):

| Tool | Purpose | Notes |
|---|---|---|
| `create_simulation_run` | create run + materialize grounded population for a variant | `{ variantId, populationSpec?, batchId?, predictionModel?, config? }` → run + agents with `grounding` digests. Handler hardcodes `source: 'agent'`, surfaces `SimulationScopeError` verbatim for non-shared launches (§8.1), and **atomically starts the run** — callers receive it `running`, ready for `record_simulation_results` (§4.4a). Slice 3.1 |
| `query_simulations` | run history + results per variant/launch/batch | `{ variantId?, launchId?, batchId?, status?, includeAgents?, includeTranscripts?, page?, pageSize? }`. **No `includeLocalOnly`** (§8.3). Transcripts only on explicit flag; also surfaces latest calibration per run once 3.4 lands. Slice 3.1 |
| `record_simulation_results` | batch per-agent outcomes (+ optional transcripts) | `{ runId, results: [{ agentId, engagementScore, outcome, predictedActions?, transcript? }] }`. Idempotent per agent; `outcome` validated against `SIMULATION_OUTCOMES`; run-ownership violations surface `SimulationAgentOwnershipError` and write nothing (§4.4). Slice 3.2 (transcript param activates in 3.3) |
| `complete_simulation_run` | finish run, write aggregates, fire the §6 projection | `{ runId, status?: "completed"\|"failed"\|"cancelled", predictedScore?, predictionConfidence?, predictedMetrics?, error? }` — a 1:1 passthrough to `completeSimulationRun` (§4.4a transition rules, typed errors surfaced verbatim). The only tool path that touches `variants.predicted_*` (via the choke point). Slice 3.2 |
| `calibrate_simulation_run` | compute predicted-vs-actual for a published variant's run | `{ runId, observedUntil? }` → calibration row. `source: 'agent'`. Fails with an actionable error when the variant is unpublished. Slice 3.4 |

`query_launches` needs no signature change — its variant summaries already expose `predicted_score`, which simply becomes projection-backed. `upsert_edge` / `query_graph` are untouched (no new node types, §2).

---

## 11. Sequenced Implementation Slices

Each slice = one Dev child issue = DDL (if any) + query layer + tests + agent tools, honoring the §4 rules of `schema-v0.5.md` (DDL and backfill separate — note: **no backfills exist in Phase 3** (no pre-existing simulation data to lift), so rules 5–6 are untriggered; old-binary test per repo convention; `npm run check` green).

| Slice | Content | DDL | Depends on |
|---|---|---|---|
| **3.1 Runs & populations** | `simulation_runs` + `simulation_agents` DDL; `SIMULATION_OUTCOMES` registry; `queries/simulations.ts` create/start/list/get with population materialization, launch-scope guard (`SimulationScopeError`, §8.1), persona pinning (§5), `assembleAgentGrounding` allowlist projection (§8.2), `SimulationRunStateError` + transition table (§4.4a); §8.5 suite bootstrap with the 3.1-owned assertions (grounding/query surfaces + negative guards); tools `create_simulation_run` (atomic create+start), `query_simulations`; `workflow_type` widen (`simulate`, `calibrate` — both here, one code edit) | `0013` | — |
| **3.2 Results, completion & projection** | `recordSimulationAgentResults` with transactional run-ownership enforcement (`SimulationAgentOwnershipError`, §4.4) + `completeSimulationRun` with terminal `status`/`error` contract (§4.4a); §6 projection rule incl. latest-completed ordering, status interplay, failed/cancelled non-projection; `upsert_variant` description note; tools `record_simulation_results`, `complete_simulation_run`; tests: projection, direct-agent happy path through the three tools, invalid/idempotent transitions (§4.4a), cross-run-ownership rejection, §8.5(3.2) surfaces | — | 3.1 |
| **3.3 Transcripts & retention** | `simulation_transcripts` DDL (agent-FK only, §4.2); transcript writes through `record_simulation_results`; `includeTranscripts` read flag (agent-join reads); `simulation-transcript-retention` prune job + **typed maintenance dispatch path in the scheduler runner** (§4.2 — the current runner cannot execute template-less jobs) + runner tests + Sync Health report line; byte accounting; §8.5(3.3) transcript surfaces | `0014` | 3.2 |
| **3.4 Calibration** | `simulation_calibrations` DDL; shared-only engagement-event read (§7.2a, default-safe scope option on the union reader); `calibrateSimulationRun` over existing pipes with precedence/per-post-window/aggregation/no-post rules (§7.2a–d) and scoring-recipe versioning; calibrate workflow runner (`workflow_type: "calibrate"`); tool `calibrate_simulation_run`; `query_simulations` calibration surfacing; tests: duplicate evidence (snapshot+events), no-snapshot fallback, staggered multi-post with repeated-publish edge overwrite, published-with-no-post → `CalibrationSourceError`, NULL `published_at` exclusion, horizon boundaries, §8.5(3.4) incl. value invariance | `0015` | 3.2 (parallel with 3.3) |

Suggested sequence: **3.1 → 3.2 → {3.3 ∥ 3.4}**. 3.1+3.2 alone deliver a working Wind Tunnel storage loop (agent-driven simulation with projected predictions); 3.3 and 3.4 are independent enrichments.

---

## 12. ADR Summary (Phase 3)

**ADR-022-10: Simulation storage as normalized run/agent tables with JSON leaves; runs are derived artifacts, not graph nodes; populations are run-owned.** — Proposed. Context: Wind Tunnel needs run history, grounded populations, and auditability under additive-only SQLite constraints; options were (a) one JSON blob per run on `variants`, (b) fully normalized tables down to per-message rows, (c) normalized run/agent skeleton with JSON at the leaves (`population_spec`, `grounding`, `predicted_metrics`, transcript content), (d) modeling runs as graph nodes with `grounded_on` edges. Decision: (c); JSON only where no query addresses the interior; runs/agents addressed exclusively by typed FKs like `embeddings` — not graph nodes (d rejected: thousands of polymorphic edge rows duplicating typed FKs, integrity-sweep cost, zero traversal use case; a rejected (a) would make history unqueryable and re-projection impossible). Populations are run-owned rather than batch-owned — a batch re-simulating N variants duplicates agent rows per run; accepted at local-first scale in exchange for self-contained, independently auditable runs and no batches table (batch = opaque `batch_id` key, promotable later, additively, if batches acquire lifecycle). Consequences: every prediction is reproducible and explainable; comparison/projection are indexed reads; cost is agent-row duplication across batches and JSON-blind interiors, both revisitable additively.

**ADR-022-11: Transcripts in a separate prunable table; results never depend on transcripts.** — Proposed. Context: per-agent dialogue is the largest artifact (~0.1–2 MB/run) and the least queried; storing it inline on agents makes every population read heavy and retention destructive to results. Options: (a) `transcript` column on `simulation_agents`, (b) separate one-row-per-agent transcript table, (c) per-message rows. Decision: (b) — `simulation_transcripts` with `byte_size` accounting, unique per agent, run membership derived solely through the agent FK (a denormalized run id was rejected in Review pass 1: two independent FKs admit run/agent disagreement, enabling cross-run contamination and mis-scoped pruning); prune-by-run is an indexed subquery through `simulation_agents`. Retention default keeps the latest completed run per variant plus a 30-day window, enforced by an idempotent maintenance job dispatched through a typed template-less scheduler path (§4.2) that sets `transcripts_pruned_at` and reports to Sync Health; (c) rejected as pure overhead (no message-level queries exist), (a) rejected because pruning would rewrite result rows. Consequences: reads stay light by default (`includeTranscripts` opt-in), disk growth is bounded by policy not schema, and pruned runs remain fully comparable/calibratable; cost is one extra join when transcripts *are* wanted and a job to operate.

**ADR-022-12: Calibration is workflow-owned computation over existing outcome pipes; the schema stores append-only snapshots.** — Proposed. Context: spec §D requires real-outcome feedback; real outcomes already flow through `published_as` → `content_posts` → `engagement_metrics` and `interactions` ∪ `content_activities` (consumed shared-scope only with snapshot-canonical precedence, §7.2); the question is who computes accuracy and where it lives. Options: (a) compute-on-read (views/queries joining predictions to live metrics), (b) calibration rows written by the publish path, (c) append-only `simulation_calibrations` written by a `workflow_type: "calibrate"` workflow (agent tool as manual trigger). Decision: (c) — (a) rejected: accuracy must be pinnable to an observation window and stable under later metric churn and scoring-recipe evolution (recipe version is recorded per row); (b) rejected: publish time is exactly when actuals don't exist yet, and coupling calibration cadence to publishing conflates two lifecycles. Ownership lands with the Signals workflow engine (consistent with clustering ADR-022-6 and persona-generation boundaries): workflows own *when* and *for which horizon*; the query layer owns *how* (one function both paths share); no new metrics ingestion ever — calibration reads pipes, it doesn't fill them. Consequences: predicted-vs-actual is a stable, sortable record (`score_error`) usable by future Simulation Accuracy goals and engine tuning; cost is snapshot staleness between calibration passes and one more workflow type to schedule.
