# UI 4.1 — Dashboard REST API for Launches, Variants, and Simulation Runs

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface; route changes go back through design.
**Issue:** [#52](https://github.com/therealtimex/signals/issues/52) · **Epic:** [#51](https://github.com/therealtimex/signals/issues/51) · **Parents:** `schema-v0.5-phase-2.md` §4.2, `schema-v0.5-phase-3.md` §4.4/§8/§10

## 1. Scope & principles

- First-class HTTP routes for dashboard pages (#53–#56). Agent-tools (`/api/agent-tools/invoke`) remain the agent surface; nothing here replaces them.
- **Wrap, do not reimplement.** Every route is a thin adapter over the existing query layer. The single sanctioned query-layer addition is `getSimulationAgentTranscript` (§4.7) — everything else already exists.
- Conventions follow the `goals` route precedent: `NextRequest`/`NextResponse`, zod validation, list envelope `{ data, total }`, `page`/`pageSize` query params.
- Field naming is **camelCase**; timestamps are **unix seconds** (matching DB rows and agent-tool responses); JSON text columns are **parsed to objects at the API boundary** (never returned as strings).
- No auth layer: consistent with all existing dashboard routes (`goals`, `content`, `contacts`) in the local single-user app. Agent-tool auth stays where it is.

## 2. Route map (v1)

| # | Method | Path | Wraps (query layer) |
|---|--------|------|---------------------|
| 1 | `GET` | `/api/launches` | `listLaunches` |
| 2 | `POST` | `/api/launches` | `upsertLaunch` (create) |
| 3 | `GET` | `/api/launches/[id]` | `getLaunchWithDetails` |
| 4 | `PUT` | `/api/launches/[id]` | `getLaunchById` (404 guard) + `upsertLaunch` (update) |
| 5 | `POST` | `/api/launches/[id]/variants` | `getLaunchById` (404 guard) + `upsertVariant` (create) |
| 6 | `GET` | `/api/variants/[id]` | `getVariantById` |
| 7 | `PUT` | `/api/variants/[id]` | `getVariantById` (404 guard) + `upsertVariant` (update) |
| 8 | `GET` | `/api/simulations` | `listSimulationRuns` |
| 9 | `GET` | `/api/simulations/[id]` | `getSimulationRun` (with include flags) |
| 10 | `GET` | `/api/simulations/[id]/agents/[agentId]/transcript` | `getSimulationAgentTranscript` (new, §4.7) |
| 11 | `GET` | `/api/content/[id]/gtm-context` | `getContentItem` + `getVariantByContentItemId` + `getLaunchById` + `listSimulationRuns` + `getLatestCalibrationForRun`/`serializeCalibration` |

**Deferred (not in v1):**

- `POST /api/simulations/[id]/calibrate` — calibration stays agent-tools-only (`calibrate_simulation_run`). Rationale: the run lifecycle lives in the terminal agent (#56 explicitly renders a "run lives in terminal agent" note), and the calibration error surface still has untyped `Error` paths that 500 today (QA caveat in #47). Revisit when a dashboard "Calibrate now" button is actually scheduled.
- Simulation mutations (`create/start/record/complete`) — agent-tools-only by design (Phase 3 §10).
- Variant `status: "published"` via REST — rejected with 400 (§3.3). Publishing keeps its two existing sanctioned paths: agent-tool `upsert_variant` and `/api/content/publish` → `publishVariantForContentItem`. Dashboard v1 (#55) only *links* to published content, it does not publish.

### Answers to the seven design questions (from the Dev handoff)

1. **Route map** — as above. Confirmed the #52 proposal, added launch/variant writes and nested variant-create, moved calibrate POST to deferred, added the transcript lazy-load route and `gtm-context`.
2. **JSON shapes** — full-row DTOs with parsed JSON columns (§4); shared serializer module so REST and agent tools cannot drift (§5).
3. **Privacy** — default `shared` list filtering; `includeLocalOnly=true` opt-in query param, no admin gate (§6).
4. **Heavy payloads** — `includeAgents`/`includeTranscripts`/`includeCalibration` flags on run **detail** only; list stays slim; per-agent transcript route for #56 lazy expand (§4.6–4.7).
5. **Mutations in v1** — yes for launches/variants (thin `upsert*` wrappers, needed by #55 dialogs); no for simulations/calibration/publish.
6. **Content GTM context** — dedicated `GET /api/content/[id]/gtm-context` (§4.8), not nested under launches: #54 enters from the content page with only a `contentItemId` in hand, and keeping it off the launches surface keeps the content-detail fetch light.
7. **Error mapping** — shared helper, typed errors → 4xx, table in §7.

## 3. Requests

### 3.1 List endpoints

`GET /api/launches`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `search` | string | – | substring match on `name` |
| `status` | enum | – | `draft \| generating \| simulating \| ready \| live \| completed \| archived` |
| `page` | int ≥ 1 | 1 | |
| `pageSize` | int 1–100 | 20 | |
| `includeLocalOnly` | boolean (`"true"`) | false | §6 |

`GET /api/simulations`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `variantId` | string | – | |
| `launchId` | string | – | joins through variants |
| `batchId` | string | – | |
| `status` | enum | – | `pending \| running \| completed \| failed \| cancelled` |
| `page`, `pageSize` | int | 1 / 20 | as above |

The simulations **list** takes no include flags — it returns run rows only. #56's run timeline needs only these; agents/transcripts/calibration are detail-route concerns (this also avoids the per-row N+1 the agent tool accepts).

### 3.2 Detail endpoints

`GET /api/launches/[id]` — no params. Returns launch + variant summaries + `goalIds` (`getLaunchWithDetails`).

`GET /api/variants/[id]` — no params. Runs for the variant come from `GET /api/simulations?variantId=…` (two fetches; keeps the variant DTO stable).

`GET /api/simulations/[id]`

| Param | Default | Effect |
|-------|---------|--------|
| `includeAgents` | false | agent rows with grounding digest |
| `includeTranscripts` | false | implies `includeAgents`; embeds transcripts inline — bulk path; UI #56 should prefer route 10 |
| `includeCalibration` | false | `latestCalibration` via `serializeCalibration` |

### 3.3 Write endpoints

All writes validate with zod, importing enums from the registries — `PLATFORMS` (`@/lib/db/platforms`), `VARIANT_TYPES` (`@/lib/db/variant-types`) — never hand-copied literals.

`POST /api/launches` (201) / `PUT /api/launches/[id]` (200):

```jsonc
{
  "name": "Q3 dev-tools launch",          // required on POST; min 1
  "brief": "…",                            // optional, nullable
  "status": "draft",                       // optional; launch status enum
  "primaryPlatform": "x",                  // optional, nullable; PLATFORMS enum
  "audienceSpec": { "nicheIds": ["…"] },   // optional object
  "workflowTemplateId": null,               // optional, nullable
  "scope": "shared",                       // optional; "shared" | "local_only"
  "metadata": {},                           // optional object
  "launchedAt": null, "completedAt": null   // optional unix seconds, nullable
}
```

`PUT` requires `name` too (the query layer treats it as required; UI sends the full editable set). `PUT` pre-checks `getLaunchById` → 404 so the untyped `Launch not found` error can never surface as a 500.

`POST /api/launches/[id]/variants` (201) / `PUT /api/variants/[id]` (200):

```jsonc
{
  "label": "Hook A",                 // optional, nullable
  "variantType": "post",             // optional; VARIANT_TYPES enum; default "post"
  "body": "…",                       // optional, nullable
  "status": "draft"                  // optional; "draft" | "simulated" | "selected" | "rejected"
                                      // "published" is REJECTED here (400 VALIDATION_ERROR) — see §2 deferred
}
```

`launchId` comes from the path on create (route passes it to `upsertVariant`); `PUT /api/variants/[id]` takes `launchId` from the existing row — the dashboard cannot move a variant between launches. Prediction/generation fields (`predictedScore`, `predictedMetrics`, `generationModel`, …) are **not writable** over REST; they are owned by the simulation projection rule (Phase 3 §6) and agent tools.

## 4. Response shapes (DTOs)

Envelopes: lists → `{ "data": [...], "total": n }`; details and writes → the bare resource object; errors → `{ "error": string, "code": string, "details"?: … }`.

### 4.1 `LaunchDto` (list rows and detail share this shape)

```jsonc
{
  "id": "lch_…", "name": "Q3 dev-tools launch", "brief": "…",
  "status": "live", "primaryPlatform": "x",
  "audienceSpec": { "nicheIds": ["…"], "sampleSize": 100 },   // parsed
  "workflowTemplateId": null,
  "scope": "shared", "source": "agent",
  "metadata": {},                                              // parsed
  "launchedAt": 1755264000, "completedAt": null,
  "createdAt": 1755100000, "updatedAt": 1755264100,
  "variants": [                                                 // LaunchVariantSummary[]
    { "id": "var_…", "label": "Hook A", "status": "published", "predictedScore": 0.72 }
  ],
  "goalIds": ["goal_…"]
}
```

### 4.2 `VariantDto`

Full `Variant` row with `predictedMetrics`, `generationMetadata`, `metadata` parsed to objects; all other fields as stored (`id`, `launchId`, `label`, `variantType`, `body`, `contentItemId`, `status`, `predictedScore`, `predictionConfidence`, `predictionModel`, `simulatedAt`, `generationModel`, `createdAt`, `updatedAt`).

### 4.3 `SimulationRunDto`

The agent-tool `serializeSimulationRun` shape (graph-handlers.ts:379), **extended additively** with the fields the UI needs that it currently drops:

```jsonc
{
  "id": "run_…", "variantId": "var_…", "batchId": null,
  "status": "failed", "agentCount": 87,
  "predictionModel": "claude-sonnet-5",
  "predictedScore": null, "predictionConfidence": null,
  "predictedMetrics": {},                    // parsed
  "populationSpec": { "sampleSize": 100 },   // NEW: parsed (run timeline / detail)
  "error": "engine timeout",                 // NEW: #56 failed/cancelled states
  "workflowRunId": null,                      // NEW: provenance (§9 phase-3)
  "scope": "shared", "source": "agent",
  "startedAt": 1755264000, "completedAt": 1755264300,
  "createdAt": 1755263990, "updatedAt": 1755264300,          // NEW
  "transcriptsPrunedAt": null,                                // NEW: lets UI explain missing transcripts
  "agents": [ … ],                 // only when includeAgents
  "latestCalibration": { … }       // only when includeCalibration; serializeCalibration shape
}
```

### 4.4 `SimulationAgentDto` (inside `agents`)

Unchanged from the agent tool: `id`, `contactId`, `orgId`, `contactPersonaId`, `grounding` (the §8.2 allowlist digest — safe to render as-is), `engagementScore`, `outcome`, `predictedActions`, plus `transcript` only when `includeTranscripts`.

### 4.5 `CalibrationDto`

Exactly `serializeCalibration` (calibrations.ts:276). No re-shaping — #56 renders `calibration.metricComparisons` triples directly.

### 4.6 Transcript payloads

Inline (`includeTranscripts=true`): `transcript: { content, byteSize, tokenCount } | null` per agent, as today.

### 4.7 `GET /api/simulations/[id]/agents/[agentId]/transcript` — lazy-load contract for #56

Response 200: `{ "agentId": "…", "content": …, "byteSize": 12345, "tokenCount": 900 }`.
404 `RUN_NOT_FOUND` (unknown run), 404 `AGENT_NOT_FOUND` (agent missing or belongs to another run), 404 `TRANSCRIPT_NOT_FOUND` (agent exists, no transcript row — also the post-pruning case; UI shows "transcript pruned" if run's `transcriptsPrunedAt` is set, else "no transcript").

**Sanctioned query addition** in `queries/simulations.ts`:

```ts
export function getSimulationAgentTranscript(
  runId: string,
  agentId: string,
): SimulationAgentTranscript | null | undefined;
// undefined → agent not found in run; null → agent exists, no transcript; object → transcript
```

(Reuses the existing private `parseAgentTranscript`; ~10 lines, no new business logic.) This exists so #56 can expand one agent's transcript without pulling a 100-agent × N-KB payload through `includeTranscripts`.

### 4.8 `GET /api/content/[id]/gtm-context` — for #54

404 `NOT_FOUND` if the content item doesn't exist. Otherwise 200 with **progressive nulls** (each null is an empty state #54 must render):

```jsonc
{
  "contentItemId": "cnt_…",
  "variant": VariantDto | null,          // getVariantByContentItemId
  "launch": {                             // getLaunchById(variant.launchId); null if no variant
    "id": "…", "name": "…", "status": "live", "scope": "shared"
  } | null,
  "latestRun": SimulationRunDto | null,   // listSimulationRuns({ variantId, status: "completed", pageSize: 1 }) — no agents
  "latestCalibration": CalibrationDto | null   // getLatestCalibrationForRun(latestRun.id)
}
```

## 5. Shared serializer module (no shape drift)

Create `src/lib/serializers/gtm.ts` exporting `serializeLaunch`, `serializeVariant`, `serializeSimulationRun` (moved out of `graph-handlers.ts`, which now imports it — agent tools and REST share one implementation by construction). `serializeCalibration` stays in `queries/calibrations.ts` and is imported directly.

Dependency direction: routes (adapter) → serializers → query layer/types. Routes never import from `lib/agent-tools/*`; agent tools import the same serializer module. The `SimulationRunDto` field additions (§4.3) flow to agent-tool responses too — that is intentional and additive (existing consumers ignore unknown fields; `docs/agent-tools.md` gets a one-line note).

## 6. Privacy & scope rules

1. **Launch lists default to `scope = "shared"`.** `includeLocalOnly=true` is a plain opt-in query param — the dashboard is the local single-user surface, so the user's own `local_only` launches are legitimately viewable; there is no admin tier in this app and inventing one for a query param is astronautics. This mirrors the agent-tool flag exactly.
2. **Detail-by-ID routes do not scope-gate** (consistent with `getLaunchById` and every existing `[id]` route). A direct ID fetch of a `local_only` launch returns it — with `scope` in the DTO. UI contract: any surface rendering launch/variant data must badge `local_only` (same rule #53 applies to personas).
3. **Simulation routes need no scope handling.** Every run/agent/transcript/calibration descends from a shared launch by the §8.1 write-path guard; grounding is the §8.2 allowlist projection; transcripts are allowlist-derived (§8.4). Rendering these DTOs verbatim is privacy-safe.
4. **Writes accept `scope`** on launches (create + update). No REST path can create simulation data, so no REST path can violate §8.
5. §8.5 invariance: the route tests (see §8) reuse the existing invariant fixture where they touch grounding/calibration payloads — no new assertions beyond what the suite already owns, since routes add no new data paths.

## 7. Error contract

Envelope: `{ "error": string, "code": string, "details"?: unknown }`. Shared helper `src/lib/api/errors.ts` → `toErrorResponse(error): NextResponse`:

| Condition | Status | `code` |
|-----------|--------|--------|
| Invalid JSON body | 400 | `BAD_REQUEST` |
| `ZodError` | 400 | `VALIDATION_ERROR` (+ `details: error.flatten()`) |
| Route 404 pre-checks (launch/variant/run/agent/content) | 404 | `NOT_FOUND` (or the specific codes in §4.7) |
| `SimulationScopeError` | 409 | `SIMULATION_SCOPE_ERROR` |
| `SimulationRunStateError` | 409 | `SIMULATION_RUN_STATE_ERROR` |
| `CalibrationSourceError` | 409 | `CALIBRATION_SOURCE_ERROR` |
| `SimulationAgentOwnershipError` | 404 | `SIMULATION_AGENT_OWNERSHIP_ERROR` |
| Anything else | 500 | `INTERNAL_ERROR` (generic message; never leak `error.message`) |

Notes:
- The 409 rows are future-proofing (v1 routes cannot hit them), but the helper ships now so the deferred calibrate POST and any later mutation inherit correct mapping — this closes the "typed errors still 500" QA caveat for every route built on the helper.
- Untyped `Error("… not found")` throws from `upsertLaunch`/`upsertVariant` must be made unreachable by the 404 pre-checks — never mapped by message-string matching.
- The agent-tools invoke route keeps its own existing envelope; do not retrofit.

## 8. Acceptance criteria for Dev

1. Exactly the 11 routes in §2 — no extras, no renames. Handlers are thin: parse → validate → call query layer → serialize → respond; no business logic in routes.
2. Zod schemas per §3; enums imported from `PLATFORMS` / `VARIANT_TYPES` / schema status enums; variant write schema rejects `status: "published"`.
3. `src/lib/serializers/gtm.ts` exists; `graph-handlers.ts` imports `serializeSimulationRun` from it (grep proves no duplicate serializer body); JSON columns parsed in every DTO.
4. `getSimulationAgentTranscript` added to `queries/simulations.ts` with the §4.7 tri-state signature + unit test.
5. `src/lib/api/errors.ts` with the §7 table; all new routes use it.
6. Vitest route tests (pattern: `src/app/api/**/route.test.ts` with `resetCoreTables`, per `contacts/[id]/identities/route.test.ts`) covering at minimum:
   - launches list: pagination envelope, `status`/`search` filters, `local_only` excluded by default and included with `includeLocalOnly=true`;
   - launch detail: variants summary + `goalIds`; 404 unknown id; PUT 404 unknown id; POST 201 + zod 400 (bad platform);
   - variant: nested create 201 under launch, 404 unknown launch; PUT rejects `status: "published"` with 400; `launchId` immutable on PUT;
   - simulations list: `variantId`/`launchId`/`status` filters, slim rows (no `agents` key);
   - simulation detail: flag matrix (`includeAgents`, `includeTranscripts` implies agents, `includeCalibration`), 404 unknown id, `error` field present on a failed run;
   - transcript route: 200, and all three 404 codes from §4.7;
   - gtm-context: 404 unknown content; progressive-null cases (no variant / variant without completed run / run without calibration) and the full-lineage case.
7. `npm run check` green.
8. Optional (nice-to-have): extend the `e2e/smoke` manifest probe with `GET /api/launches` and `GET /api/simulations`.

## 9. Trade-offs accepted

- **Two fetches for variant detail + runs** (vs embedded runs): keeps `VariantDto` stable and reuses the simulations list route; the UI already needs that route for filtering.
- **Slim simulations list** (vs agent-tool-style include flags on list): dashboard timelines don't need per-row detail; avoids the N+1 the tool tolerates.
- **Writes in v1** (vs read-only): two extra thin routes now spare a second design→dev round-trip for #55's dialogs; risk is low because they wrap existing upserts with 404/enum guards.
- **`includeLocalOnly` exposed without gating** (vs never/admin-only): correct for a local single-user app; would need revisiting only if this API is ever served beyond localhost — flagged as the explicit reopening condition.
- **Calibrate POST deferred**: dashboard loses a "calibrate now" button in v1; the terminal agent already covers the workflow, and we avoid shipping a mutation whose error surface isn't fully typed yet.
