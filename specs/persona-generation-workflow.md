# Persona Generation Workflow

**Status:** Approved (System Design, 2026-08-15) — Dev implements exactly this surface.
**Issue:** [#63](https://github.com/therealtimex/signals/issues/63) · **Epic:** [#62](https://github.com/therealtimex/signals/issues/62) · **Parent schema epic:** [#22](https://github.com/therealtimex/signals/issues/22)
**Base:** `main` @ `512b4bd`
**Parents:** [`schema-v0.5.md`](./schema-v0.5.md) §6–7, [`schema-v0.5-phase-2.md`](./schema-v0.5-phase-2.md) §4.1 / §9 / ADR-022-9, [`schema-v0.5-phase-3.md`](./schema-v0.5-phase-3.md) §5 / §8.2 / §9, [`ui-4.2-contact-explore.md`](./ui-4.2-contact-explore.md)

This spec closes the §9 follow-on boundary from Phase 2: *"inputs = identities + content + shared-scope interactions; outputs = new `contact_personas` version + `belongs_to_niche` edges + `embeddings(kind='persona')` row. All storage hooks exist after slices 2.1/2.3; the epic owns prompting, cadence, cost, and supersede orchestration."* Storage is **not** redesigned here — `contact_personas`, `upsertPersona`, `getActivePersona`, the niche projection, and the embeddings table are consumed as shipped.

---

## 1. Scope & Constraints

| Concern | Owned here | Already shipped (wrap, don't touch) |
|---------|-----------|-------------------------------------|
| Evidence assembly allowlist | §3 `assemblePersonaEvidence` | §8.2 grounding pattern (`assembleAgentGrounding`) |
| RTX chat client | §4 `rtxChat` in `src/lib/rtx/llm.ts` | `rtxEmbed`, env resolution, error taxonomy |
| Synthesis prompt + output contract | §4 | — |
| Supersede + provenance | §5 (always full regeneration) | `upsertPersona` merge/supersede transaction |
| Niche + embedding side effects | §6 | `backfillNichesFromInterests` mapping, `embedNodeIfStale` |
| Execution paths + error contract | §7, §11 | agent-tools envelope, `toErrorResponse` |
| Refresh & staleness | §8 (implemented in #65) | — |
| Dashboard affordance | §9 (implemented in #66) | Explore card projection + Audience tab |
| Tests & docs | §12 (implemented in #67) | `PRIVACY_SENTINELS`, `assertNoPrivacySentinels` |

**Out of scope:** niche clustering/pruning (ADR-022-6 epic), model selection overrides (deferred to the proxy per Amendment C — system default engine only), persona editing UI, multi-contact batch generation UI, org personas.

---

## 2. Workflow Overview

```
 triggers ──┬─ agent tool `generate_persona`                    (trigger:"user")   #64
            ├─ POST /api/contacts/[id]/generate-persona          (trigger:"user")   #66
            └─ persona-refresh sweeper (opt-in, bounded batch)   (trigger:"scheduled") #65
                                   │
                                   ▼
        assemblePersonaEvidence(contactId)          — §3 allowlist projection, shared-scope only
                                   │
                 evidence sufficiency check ──(fail)──▶ PersonaEvidenceError (no workflow_runs row)
                                   │
                 evidenceHash == active sourceWindow.evidenceHash && !force
                                   ├──(yes)──▶ skip: { generated:false, reason:"evidence_unchanged" } — no LLM call
                                   ▼ (no)
        createWorkflowRun({ workflowType:"persona", status:"running" })
                                   │
        rtxChat(/sdk/llm/chat) ──▶ zod validate (1 repair retry) ──(fail)──▶ PersonaSynthesisError, run "failed"
                                   │
                                   ▼
        upsertPersona({ ...ALL fields explicit, scope:"shared", model:qualifiedModel,
                        sourceWindow, workflowRunId })            — supersedes prior active
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
    projectPersonaInterestsToNiches        embedNodeIfStale("contact", id, "persona")
    (additive edges, §6.1)                 (non-fatal on failure, §6.2)
                                   │
                                   ▼
        updateWorkflowRun({ status:"completed", model, tokens, result })
```

**External-agent path (unchanged provenance rule):** an RTX terminal agent calls the new read tool `get_persona_evidence` (same §3 digest), synthesizes with its own intelligence, and writes via `upsert_persona` — `workflow_run_id` stays NULL. Per phase-3 §9: *"`workflow_run_id` records Signals-side orchestration provenance; it is never fabricated for external (RTX-agent) compute."*

---

## 3. Evidence Assembly (input allowlist)

`assemblePersonaEvidence(contactId)` in `src/lib/db/queries/persona-evidence.ts` follows the §8.2 rule verbatim: **an allowlist projection, not filtered rows** — the digest is built field-by-field, no row spreads. It is the single contract for what persona synthesis may ever see; extending it is a reviewed code change to one function.

### 3.1 Allowlisted surfaces

| Surface | Fields projected | Filter / limit |
|---------|------------------|----------------|
| `contacts` | `name, title, company, location, bio` | the target contact only |
| `contact_identities` | `platform, platformHandle, displayName, bio, isVerified, followersCount, followingCount, postsCount, platformCreatedAt` | `isActive = 1` |
| latest `identity_metrics` per identity | `engagementRate, snapshotAt` (as `metricSnapshotAt`) | most recent snapshot; overrides denormalized counters when present (explore-card precedent) |
| `content_items` authored by contact | `contentType, title, body` (truncated to 500 chars), `publishedAt` (from joined `content_posts`) | `contactId = target`, `contentType NOT IN ('email','dm')`, must have a `content_posts` row with `publishedAt` set (i.e. actually public), newest 20 |
| `interactions` | `interactionType, direction, summary, isMeaningful, occurredAt` | **`scope = 'shared'` only**, newest 20; plus total shared count |
| org via `works_at` edge | `name, orgType, domain, description` | edge `scope = 'shared'` AND `orgs.scope = 'shared'` |
| niches via `belongs_to_niche` | `name, nicheType, weight` | edge shared AND niche shared (existing `sharedNichesForContact` double filter) |

### 3.2 Denied by construction (never in the digest, prompt, or output)

`contacts.email / phone / tags / funnelStage / score / metadata / enrichmentScore`, `contact_identities.platformData / syncErrors`, any `local_only` interaction (including its `summary`), any `local_only` edge or `properties_private`, `local_only` orgs/niches/personas, content of type `email` or `dm` regardless of direction, `engagementSnapshot` internals, CRM notes of any kind. The §12 sentinel suite seeds every one of these and scans the digest, the rendered prompt string, and the persisted persona row.

### 3.3 Types and budget

```ts
export type PersonaEvidence = {
  contact: { name; title; company; location; bio };
  identities: Array<{ platform; platformHandle; displayName; bio; isVerified;
                      followersCount; followingCount; postsCount; platformCreatedAt;
                      engagementRate: number | null; metricSnapshotAt: number | null }>;
  content: Array<{ contentType; title: string | null; body: string; publishedAt: number }>;
  interactions: Array<{ interactionType; direction; summary: string | null;
                        isMeaningful: boolean; occurredAt: number }>;
  org: { name; orgType; domain; description } | null;
  niches: Array<{ name; nicheType; weight: number | null }>;
};

export type PersonaEvidenceBundle = {
  evidence: PersonaEvidence;
  provenance: {                          // becomes sourceWindow, §5.2
    identityIds: string[];
    metricSnapshotAt: Record<string, number>;   // identityId → snapshot unix
    contentItemIds: string[];
    interactionWindow: { sharedCount: number; from: number; to: number } | null;
    orgIds: string[];
    nicheSlugs: string[];
    evidenceHash: string;                // sha256 of canonical digest JSON, §8.1
    assembledAt: number;
  };
};
```

Prompt budget: `MAX_EVIDENCE_CHARS = 24_000` over the serialized digest. Deterministic trimming order when exceeded: drop oldest `content` entries first, then oldest `interactions`; identities and contact fields are never trimmed. Limits (`20` content / `20` interactions / `500`-char bodies) are exported constants next to the assembler, not schema.

### 3.4 Evidence sufficiency

Generation requires at least one of: **≥1 active identity**, **≥1 public content item**, or **≥3 shared interactions**. Otherwise the assembler throws `PersonaEvidenceError` (message names what's missing and how to fix it: *"connect a platform identity, sync public posts, or log shared interactions"*). This precondition runs **before** any `workflow_runs` row is created — a run that never could have called the LLM leaves no provenance row (mirrors `CalibrationSourceError`: never write a row that masquerades as a result).

---

## 4. Synthesis Contract (RTX chat + output schema)

### 4.1 `rtxChat` client — `src/lib/rtx/llm.ts`

Mirrors `rtxEmbed` exactly: injectable `fetchImpl`/`env`, `x-app-id` header, discriminated result, never throws.

```ts
export type RtxChatErrorCode =
  | "RTX_NOT_CONFIGURED" | "PERMISSION_REQUIRED" | "PROVIDER_UNAVAILABLE"
  | "CHAT_ERROR" | "VALIDATION_ERROR" | "UNKNOWN";

export type RtxChatSuccess = {
  success: true;
  text: string;                 // raw model output
  provider: string; model: string;
  qualifiedModel: string;       // `${provider}:${model}` — Amendment C model identity rule
  inputTokens: number | null; outputTokens: number | null;
};
export type RtxChatResult = RtxChatSuccess | { success: false; code: RtxChatErrorCode; error: string };

export async function rtxChat(
  messages: Array<{ role: "system" | "user"; content: string }>,
  fetchImpl: typeof fetch = fetch,
  env: EnvLike = process.env,
): Promise<RtxChatResult>;
```

- Endpoint: `POST ${apiBase}/sdk/llm/chat` (permission-gated `llm.chat` per ADR-022-9). The exact wire body/response field names are confirmed against the RTX SDK during #64; **the mapping is owned entirely inside `rtxChat`** — callers see only the result type above. If the proxy reports token usage, it is surfaced; otherwise the token fields are `null` and `workflow_runs` cost columns stay 0.
- No model/provider override in v1 — system default engine, same deferral as embed (Amendment C).
- Error mapping mirrors `mapErrorCode`: proxy `PERMISSION_REQUIRED`/`PROVIDER_UNAVAILABLE` pass through, HTTP 403 → `PERMISSION_REQUIRED`, malformed request → `VALIDATION_ERROR`, other proxy failure → `CHAT_ERROR`. `actionableMessage` gains: *"Approve llm.chat for Signals in RealtimeX Settings → Local Apps."* Failure is explicit, never silent; there is no fallback provider path.
- **Manifest change (ADR-062-1):** `rtx-manifest.json` permissions gain `"llm.chat"`. Consequently `src/lib/rtx/sdk.test.ts` inverts its `not.toContain("llm.chat")` assertion to `toContain`, and `docs/local-app.md` replaces *"Signals intentionally does not request `llm.chat`"* with the §7 boundary statement (terminal agents still own open-ended intelligence; Signals requests chat solely for structured workflow synthesis).

### 4.2 Output contract

The prompt instructs the model to return **only** a JSON object validated by:

```ts
export const personaSynthesisSchema = z.object({
  archetype: z.string().min(1).max(80),
  tone: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  description: z.string().min(1).max(2000).optional(),
  interests: z.array(z.string().min(1).max(40)).max(12).default([]),
  conversionTriggers: z.array(z.string().min(1).max(80)).max(10).default([]),
  engagementFormats: z.array(z.string().min(1).max(40)).max(10).default([]),
  confidence: z.number().min(0).max(1),
});
```

Required: `archetype`, `tone`, `summary`, `confidence`. Fields map 1:1 to `contact_personas` columns (arrays JSON-stringified by `upsertPersona`, as today).

Parsing: strip markdown code fences if present, `JSON.parse`, `safeParse`. On failure, **one repair retry**: re-send with the flattened zod errors appended (*"Your previous output failed validation: … Return only corrected JSON."*). Second failure → `PersonaSynthesisError` (carries the validation detail); the workflow run is marked `failed` with the message in `errors`. Transport failures (`RtxChatResult.success === false`) are not retried in v1 — the actionable RTX error is surfaced verbatim (Amendment C precedent: *"the tool returns the client's actionable error verbatim rather than empty results"*).

### 4.3 Prompt rules

- `PERSONA_PROMPT_VERSION = 1` exported constant, recorded in `sourceWindow.promptVersion`; any prompt change bumps it (makes every persona traceable to the prompt that produced it).
- System message: role framing (GTM persona analyst), the output JSON schema, field semantics matching the explore card (archetype ≈ "Serial Consumer Tech Founder", tone ≈ "Casual and supportive"), and calibration guidance for `confidence` (thin evidence → ≤0.4; single platform → ≤0.7; rich multi-surface evidence → up to 1.0).
- User message: the serialized `PersonaEvidence` digest and nothing else. The prompt renderer takes `PersonaEvidence` as its only data input, so the §3 allowlist bounds the prompt by construction.
- Grounding instruction: synthesize only from provided evidence; never invent employers, follower counts, or interests not supported by it.

---

## 5. Persistence & Provenance

### 5.1 Supersede orchestration — always full regeneration

Generation always writes **every** persona field explicitly through `upsertPersona` (including `description: result.description ?? null`). The inherit-on-`undefined` merge in `upsertPersona` remains the contract for *manual* partial edits via the `upsert_persona` tool; generation never relies on it — a generated persona is a complete, self-consistent snapshot of current evidence, never a splice of two generations. Supersede-only versioning is inherited: prior active row → `superseded`, new row inserted, simulation pins (`simulation_agents.contact_persona_id`) stay truthful forever (phase-3 §5).

**Scope conflict guard:** if the contact's active persona has `scope = 'local_only'`, generation refuses with `PersonaScopeError` — silently superseding an operator's private persona with a generated shared one is a privacy-inverting write. The operator re-scopes manually (via `upsert_persona`) first. No force-flag bypass in v1 (§8 phase-3 "the door stays closed rather than flag-gated" stance).

### 5.2 `sourceWindow` shape (persisted on the persona row)

```json
{
  "promptVersion": 1,
  "generator": "workflow",
  "evidenceHash": "sha256-hex…",
  "identityIds": ["ci_…"],
  "metricSnapshotAt": { "ci_…": 1765400000 },
  "contentItemIds": ["item_…"],
  "interactionWindow": { "sharedCount": 12, "from": 1760000000, "to": 1765400000 },
  "orgIds": ["org_…"],
  "nicheSlugs": ["startup-operators"],
  "assembledAt": 1765401000
}
```

`generator` is `"workflow"` on the Signals path. External agents writing via `upsert_persona` are asked (docs, #67) to set `generator: "agent"` in their own `sourceWindow`, but it is not enforced — their compute is outside Signals' contract.

### 5.3 `workflow_runs` linkage

- `workflow_type` enum gains `"persona"` — code-only widen per phase-3 §9 (Drizzle text enums emit no CHECK; if drizzle-kit proposes a rebuild, escalate).
- Every Signals-side generation (tool-, REST-, or sweeper-triggered) creates a run row, because the LLM compute is Signals-side and needs cost accounting: `createWorkflowRun({ workflowType: "persona", status: "running", trigger: "user" | "scheduled", config: JSON({ contactId, force, promptVersion }), startedAt })`. On success: `status: "completed"`, `model: qualifiedModel`, `inputTokens/outputTokens/costUsd` when the proxy reports them, `result: JSON({ personaId, evidenceHash, supersededPersonaId })`. On failure: `status: "failed"`, message appended to `errors`.
- The persona row's `workflowRunId` points at this run — the first real producer of that FK. Hash-skips and evidence-insufficiency create **no** run row (nothing ran).
- The sweeper (#65) additionally sets `parentWorkflowId` on per-contact runs to its own sweep run (batch pattern, phase-3 §9).

---

## 6. Side Effects (additive, ordered after the persona write)

### 6.1 Niche projection

Extract the mapping loop from `backfillNichesFromInterests` into `projectPersonaInterestsToNiches(persona, source)` (query layer); the backfill becomes a caller with its existing `SOURCE = "backfill:persona-interests"`. Generation calls it with `source = "persona:" + workflowRunId` after every successful upsert:

- Each interest → `nicheSlugFromName` → `ensureNicheByName(name, { source, nicheType: "interest", scope: "shared" })` (empty-slug interests skipped, not fatal) → `upsertGraphEdge({ edgeType: "belongs_to_niche", weight: persona.confidence ?? undefined, scope: "shared", source })`.
- **Additive only, no confidence threshold** — identical semantics to the backfill (§4.1 phase-2: re-running *"adds new memberships; it never deletes"*; pruning belongs to the clustering workflow). `contact_personas.interests` stays populated (projection rule) so the explore card keeps rendering.

### 6.2 Persona embedding

Opens the three reserved hooks from slice 2.3:

1. `V1_EMBEDDING_KINDS` gains `"persona"`; the `assembleEmbedText` reserve-throw is replaced with the persona text assembly: `Archetype: …\nTone: …\nSummary: …\nInterests: …\nConverts on: …\nEngages with: …` from the **active** persona (fields match the §8.2 grounding allowlist — `description` excluded to keep embed text within limits and symmetrical with grounding).
2. `resolveEmbeddingSourceScope` for `("contact", id, "persona")` returns the active persona's scope; `assertSharedEmbeddingSource` therefore blocks embedding `local_only` personas (their vectors would leak through shared semantic search).
3. `semanticSearchSchema.kind` gains `"persona"`.

Generation calls `embedNodeIfStale("contact", contactId, "persona")` after upsert — `contentHash` dedup means an unchanged persona text costs no RTX call. **Non-fatal:** on `EmbeddingUnavailableError` the persona write stands, the message is appended to the workflow run's `errors`, and the run still completes (the embed heals on the next `embedNodeIfStale` — same self-healing shape as slice 2.3). Manual `upsert_persona` writes do **not** auto-embed in v1 (agents can already call `semantic_search`'s embed path; wiring embeds into every manual tool write is deferred — documented trade-off).

---

## 7. Execution Paths & Surfaces

### 7.1 Core function

`generatePersona(contactId, { force?, trigger?, fetchImpl?, env? })` in `src/lib/workflows/generate-persona.ts` (workflows own *when*; the §3 assembler in the query layer owns *how* — phase-3 boundary). Returns:

```ts
export type GeneratePersonaResult =
  | { generated: true; persona: SerializedContactPersona; workflowRunId: string;
      supersededPersonaId: string | null; nicheEdgesUpserted: number; embedded: boolean }
  | { generated: false; skipped: true; reason: "evidence_unchanged"; personaId: string };
```

Throws: `PersonaEvidenceError`, `PersonaScopeError`, `PersonaSynthesisError`, `PersonaGenerationUnavailableError` (wraps an unsuccessful `RtxChatResult`, carries its `code` and actionable message). All are `<Domain><Condition>Error` classes in the established mold.

### 7.2 Agent tools (#64)

| Tool | Category | Contract |
|------|----------|----------|
| `get_persona_evidence` | contacts | `{ contactId }` → the `PersonaEvidenceBundle` digest (§3). Read-only; lets terminal agents synthesize with their own intelligence without touching raw rows. Throws the §3.4 sufficiency error as `EXECUTION_ERROR` with the actionable message. |
| `generate_persona` | contacts | `{ contactId, force?: boolean }` → `GeneratePersonaResult` (persona serialized like `get_persona`'s hit shape). Manual trigger over `generatePersona` (calibrate-tool precedent), `trigger: "user"`. Requires RTX runtime + `llm.chat` — documented inline in `docs/agent-tools.md` exactly like the `semantic_search` precedent. |

Both use `zodToParameters()`; errors flow through the existing envelope (`success:false, code: EXECUTION_ERROR`, actionable message verbatim). `get_persona` / `upsert_persona` are unchanged.

### 7.3 Boundary statement (replaces `docs/local-app.md` line)

> Terminal agents own open-ended intelligence: they read evidence (`get_persona_evidence`) and write conclusions (`upsert_persona`) with their own reasoning, and no `workflow_runs` row is fabricated for that compute. Signals requests `llm.chat` solely for **structured, schema-validated workflow synthesis** it orchestrates itself (persona generation; future workflow migrations per ADR-022-9) — always provenance-tracked via `workflow_runs`, never conversational.

---

## 8. Refresh & Staleness (design here, implemented in #65)

### 8.1 Staleness definition

Canonical evidence hash: `evidenceHash = sha256(canonicalJson(evidence))` — stable key order, computed **after** trimming (truncation is part of identity, mirroring `sha256EmbedText`). A persona is **stale** when either:

1. `evidenceHash(assembleNow) !== sourceWindow.evidenceHash` (evidence drift — new posts, changed identity stats, new shared interactions all collapse into this one signal), or
2. `now - generatedAt > PERSONA_STALE_AFTER_SECONDS` (default 30 days; exported constant, config-not-schema like transcript retention).

`refreshPersonaIfStale(contactId)` assembles evidence (SQLite reads, no LLM), compares, and only calls `generatePersona` on drift/age — **this hash-gate is the cost guardrail**: unchanged contacts never spend tokens (the `embedNodeIfStale` shape applied to chat).

### 8.2 Triggers

| Trigger | Mechanism | v1 status |
|---------|-----------|-----------|
| Manual | `generate_persona` tool / `POST …/generate-persona` with `force: true` bypassing the hash-skip | #64 / #66 |
| Evidence drift / age | `refreshPersonaIfStale` — used by the sweeper; also callable directly | #65 |
| Scheduled sweep | Typed maintenance dispatch `maintenance:persona-refresh` (slice-3.3 registry, no fake template): selects contacts with an active **shared** persona, oldest `generatedAt` first, `PERSONA_REFRESH_BATCH = 10` per sweep, runs `refreshPersonaIfStale` on each. Each actual regeneration creates its own `workflow_type:"persona"` run (child of the sweep's run via `parentWorkflowId`) so LLM cost accounting stays on `workflow_runs` — the dispatch entry is only the *scheduler*, not the LLM work, honoring the "retention isn't LLM work" contrast. **Disabled by default**: no scheduled LLM spend without an explicit user-created `scheduled_jobs` row. | #65 |

Contacts with no persona are **not** auto-generated by the sweeper in v1 — first generation is an explicit human/agent decision (cost + consent posture). Per-sweep cost caps beyond batch size are deferred; reopening condition: a user reports surprise token spend from the sweeper.

---

## 9. Dashboard Affordance (design here, implemented in #66)

### 9.1 API

`POST /api/contacts/[id]/generate-persona`, body `{ force?: boolean }` (optional, default false). Synchronous in v1 — single-contact LLM call in a local app; the UI shows a pending state. Deferred: async/queued generation (reopen if p95 latency makes the dashboard unusable). Success 200:

```json
{ "generated": true, "persona": { …ContactExplorePersona }, "workflowRunId": "…" }
{ "generated": false, "skipped": true, "reason": "evidence_unchanged", "persona": { …ContactExplorePersona } }
```

Errors use the dashboard envelope `{ error, code }` via `toErrorResponse` (§11). The route returns the **explore-card projection** (not the raw row) so the Audience tab can render the response directly.

### 9.2 Explore card extension

`ContactExplorePersona` gains `stale: boolean | null` — `null` when `absent`/`local_only`, else `now - generatedAt > PERSONA_STALE_AFTER_SECONDS`. Age-only on the read path (no evidence assembly per page view — documented trade-off; drift staleness surfaces when the sweeper or a manual refresh runs).

### 9.3 UI states (Audience tab)

| State | Rendering |
|-------|-----------|
| `absent` | Existing empty state + **Generate persona** button |
| `shared`, fresh | Persona content + relative `generatedAt` + secondary **Regenerate** (sends `force: true`) |
| `shared`, `stale: true` | Same + "Stale" badge + primary **Refresh persona** |
| `local_only` | Existing "Private persona" badge; **no** generate button, tooltip: *"This contact has a private persona. Re-scope it before generating a shared one."* (mirrors the 409 the API would return) |
| In flight | Button disabled + spinner; on success, swap in the returned projection |
| Error | Inline error with the actionable message from `{ error }` |

---

## 10. Privacy

Spec §2 (signals-spec-v0.5): *"Private personal notes and relationship stages remain local and are excluded from public GTM simulations unless explicitly permitted."* Generation extends the same invariant to synthesis inputs **and** outputs:

1. **Input allowlist (§3)** — evidence is built field-by-field from shared-scope surfaces only; the §3.2 deny list is tested by construction, and the prompt renderer accepts only the `PersonaEvidence` type.
2. **Output scope** — generated personas are always `scope: "shared"`: every input byte was shared-safe, so the output is too. `local_only` personas are **never auto-created**; that scope remains a deliberate operator/agent act via `upsert_persona`.
3. **No local-only escape hatch on generation** — no `includeLocalOnly` parameter exists on `get_persona_evidence` or `generate_persona`, by design (the phase-3 §8 stance: the door stays closed rather than flag-gated).
4. **Scope-conflict refusal (§5.1)** — an active `local_only` persona blocks generation instead of being silently superseded by a shared row.
5. **Side effects inherit the boundary** — niche edges are written `scope: "shared"` from shared output; persona embeddings are scope-gated by `assertSharedEmbeddingSource` (§6.2).
6. **Invariant to test (#67):** a fixture DB seeded with every `PRIVACY_SENTINELS` value (plus a new `interactionSummary: "SENTINEL_LOCAL_INTERACTION"` sentinel on a `local_only` interaction) must produce **zero private bytes** through: the evidence bundle, the rendered prompt string, the generated persona row (all columns incl. `sourceWindow`), the niche edges, and the `generate_persona` / `get_persona_evidence` tool outputs.

---

## 11. Failure Modes & Error Contract

| Condition | Thrown | Agent tool | REST (`generate-persona`) |
|-----------|--------|-----------|---------------------------|
| Contact not found | untyped, pre-checked | `EXECUTION_ERROR` | 404 `NOT_FOUND` (pre-check, never message-matching) |
| Insufficient evidence (§3.4) | `PersonaEvidenceError` | `EXECUTION_ERROR` + actionable message | 409 `PERSONA_EVIDENCE_ERROR` |
| Active persona is `local_only` (§5.1) | `PersonaScopeError` | `EXECUTION_ERROR` | 409 `PERSONA_SCOPE_ERROR` |
| RTX not configured / permission denied / provider down | `PersonaGenerationUnavailableError` (carries `RtxChatErrorCode`) | `EXECUTION_ERROR`, RTX actionable message verbatim | 503 `PERSONA_GENERATION_UNAVAILABLE` (message names the fix, e.g. approve `llm.chat`) |
| LLM output fails schema after 1 repair retry | `PersonaSynthesisError` | `EXECUTION_ERROR` + validation detail | 502 `PERSONA_SYNTHESIS_ERROR` |
| Embed side effect fails | not thrown | — | — (persona stands; noted in `workflow_runs.errors`) |
| Invalid request body | zod | `VALIDATION_ERROR` | 400 `VALIDATION_ERROR` + `details` |

`src/lib/api/errors.ts` gains the three persona classes in `toErrorResponse` (class-mapped, codes from `error.code`, consistent with the simulation error tiers). Failed runs always leave a `failed` `workflow_runs` row **except** pre-run rejections (not-found, evidence, scope), which never create one.

---

## 12. Tests & Docs (design here, implemented in #67; slices ship their own unit tests earlier)

1. **Privacy sentinel suite** — the §10.6 invariant, in `persona-evidence.test.ts` + `generate-persona.test.ts`, using `assertNoPrivacySentinels` whole-payload scans (simulation-grounding precedent).
2. **Golden round-trip integration** — stub `fetchImpl` returns a fixture chat JSON → `generatePersona` → `get_persona` tool returns matching fields; asserts prior row superseded, new row active, `workflowRunId` set, `sourceWindow` complete, simulation pin on the old row untouched.
3. **Idempotency** — second call with unchanged evidence returns `skipped`, zero fetch invocations, no new `workflow_runs` row.
4. **Repair retry** — first response malformed → retried once with error feedback; both malformed → `PersonaSynthesisError` + `failed` run.
5. **Pre-run rejections** — insufficient evidence and `local_only` scope conflict throw before any run row exists.
6. **Side effects** — niche edges upserted additively (re-run adds, never deletes); `embeddings(kind='persona')` row with correct `contentHash`/scope; embed failure leaves persona intact and run `completed` with `errors` populated.
7. **Route tests** — status/code table of §11; explore `stale` flag; bounded-query budget on the evidence assembler (explore-card precedent).
8. **Docs** — `docs/agent-tools.md`: two new table rows + RTX/`llm.chat` requirement caveat (semantic_search precedent); `docs/local-app.md`: §7.3 boundary statement replaces line 42; in-app guide chapter "AI personas" (generate, refresh, privacy model); `rtx-manifest.json` version bump.

---

## 13. Sequenced Dev Slices

Each slice = one child issue = code + tests + docs touched by it, honoring §4 dependency rules. Suggested sequence: **#64 → #65 ∥ #66 → #67** (refresh and dashboard are independent consumers of the #64 core; the test/docs issue closes the epic gate).

| Slice | Issue | Content | Depends on |
|-------|-------|---------|-----------|
| G1 Generation core | #64 | `rtxChat` + manifest `llm.chat` (+ sdk.test/docs flip), evidence assembler + sufficiency + hash, synthesis schema + prompt v1 + repair retry, `generatePersona`, `workflow_type:"persona"` widen, tools `generate_persona` / `get_persona_evidence`, niche projection extraction + call, persona embedding enable (3 hooks) + non-fatal call, error classes + `toErrorResponse` mapping | — |
| G2 Refresh & staleness | #65 | `PERSONA_STALE_AFTER_SECONDS`, `refreshPersonaIfStale`, `maintenance:persona-refresh` typed dispatch (batch 10, disabled by default, `parentWorkflowId` linkage) | #64 |
| G3 Dashboard | #66 | `POST /api/contacts/[id]/generate-persona`, `ContactExplorePersona.stale`, Audience-tab states + buttons | #64 |
| G4 Tests & docs | #67 | §12 items 1–8 (integration + sentinel suite consolidation; per-slice unit tests already landed in G1–G3) | #64–#66 |

### Acceptance criteria

**#64 — generation core**
- [ ] `generate_persona` on a fixture contact (1 identity, 2 posts, 3 shared interactions) writes an active shared persona with all §4.2 fields, `model = ${provider}:${model}`, populated `sourceWindow` (§5.2), `workflowRunId` → a `completed` `workflow_type:"persona"` run
- [ ] Prior active persona superseded, not mutated; `get_persona` round-trip returns the new row
- [ ] Niche edges + `embeddings(kind='persona')` written per §6; embed failure non-fatal
- [ ] §11 error table holds for tool path; §3.4 and §5.1 rejections create no run row
- [ ] Privacy: sentinel scan green over evidence, prompt, persisted row
- [ ] `rtx-manifest.json` has `llm.chat`; `sdk.test.ts` and `docs/local-app.md` updated per §4.1
- [ ] `npm run check` green

**#65 — refresh & staleness**
- [ ] `refreshPersonaIfStale`: unchanged evidence → skip with zero LLM calls; drifted evidence or age > threshold → regeneration
- [ ] Sweep dispatch registered, disabled by default, batch-capped at 10, per-contact runs linked via `parentWorkflowId`; never touches `local_only`-persona or persona-less contacts
- [ ] `npm run check` green

**#66 — dashboard**
- [ ] Route implements §9.1 including `force`, returns explore projection; §11 status mapping tested
- [ ] `stale` flag per §9.2; all five §9.3 UI states render (component test)
- [ ] `local_only` persona: no generate affordance; API refusal is 409 `PERSONA_SCOPE_ERROR`
- [ ] `npm run check` green

**#67 — tests & docs**
- [ ] §12 items 1–7 all green in one integration suite; §10.6 invariant is a named test
- [ ] `docs/agent-tools.md`, `docs/local-app.md`, in-app guide chapter updated per §12.8
- [ ] `npm run check` green

---

## 14. Design Decisions (ADR Summary, epic #62)

**ADR-062-1: Persona synthesis runs inside Signals via RTX `llm.chat`; the terminal-agent path stays first-class through `get_persona_evidence` + `upsert_persona`.** — Accepted. Context: refresh (#65) and dashboard (#66) need generation without a terminal agent present, but `docs/local-app.md` and a test invariant deliberately excluded `llm.chat` ("terminal agents own intelligence"), while ADR-022-9 already planned chat migration through `src/lib/rtx/llm.ts`. Options: (a) agent-only generation (no manifest change) — rejected: #65/#66 become impossible and the epic's goal (personas from evidence, on demand, from the product) fails; (b) Signals-orchestrated `llm.chat` for structured synthesis only, agents keep the evidence-tool path — chosen; (c) proxy-side workflow execution — rejected: nothing exists on the RTX side for it. Decision: (b) with the §7.3 boundary statement: Signals uses chat solely for schema-validated, `workflow_runs`-tracked synthesis, never conversationally. Consequences: manifest gains a user-visible permission grant; the sdk test and local-app doc flip is an explicit, reviewed edit; cost is a broader permission surface, accepted because every call is provenance-tracked with token accounting.

**ADR-062-2: Evidence is a single explicit allowlist projection, and generated personas are always `scope: "shared"`.** — Accepted. Context: the §8.2 grounding precedent showed filtered-row reads leak; generation adds an output-scope question. Options: (a) reuse `assembleAgentGrounding` — rejected: grounding lacks content/interaction detail personas need and couples two contracts that will evolve separately; (b) new `assemblePersonaEvidence` allowlist + shared-only output, `local_only` never auto-set, generation refuses over an active private persona — chosen; (c) operator scope flag on generate — rejected: a flag that can silently produce private-from-shared or shared-over-private inverts expectations; the door stays closed rather than flag-gated. Consequences: two allowlists to maintain (each a single reviewed function); privacy is testable by construction; cost is that private-persona contacts cannot be generated until manually re-scoped — surfaced honestly in UI and API.

**ADR-062-3: Full regeneration with `evidenceHash` idempotency; side effects are additive and non-fatal.** — Accepted. Context: `upsertPersona` supports partial merges; when should generation merge vs regenerate, and how hard should niche/embedding writes bind? Options: (a) field-level merge of new evidence into the old persona — rejected: splices two generations into a row no single prompt produced, breaking provenance; (b) always full regeneration, gated by a canonical evidence hash so unchanged evidence costs zero tokens; niche projection stays additive (backfill parity), embedding failure never rolls back the persona — chosen. Consequences: every persona row is one prompt's coherent output with exact provenance; staleness, drift detection, and cost control collapse into one hash; cost is regenerating whole personas on small evidence changes — accepted at single-contact LLM prices, reopened if token spend says otherwise.

**ADR-062-4: Synchronous v1 generation; scheduled refresh is opt-in and batch-capped.** — Accepted. Context: LLM latency in a request path vs queue complexity, and unattended spend. Options: (a) async job + polling — rejected for v1: a queue, run-status UI, and notification surface for a local single-user app before latency is proven to hurt; (b) synchronous route + spinner, sweeper disabled by default with `PERSONA_REFRESH_BATCH = 10` and hash-gating — chosen. Consequences: #66 ships with trivial state handling; no scheduled token spend without an explicit user action; reopening conditions recorded: unusable p95 latency (→ async) or surprise sweep costs (→ cost caps).
