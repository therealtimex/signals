# Settings tabs + Persona generation mode + PersonaAgentJob adapter

**Status:** Approved (System Design, 2026-08-27) — Dev implements this surface; land this file as `specs/persona-generation-mode.md` in the repo.
**Issue:** [#314](https://github.com/therealtimex/signals/issues/314) · **Backend issue:** [#317](https://github.com/therealtimex/signals/issues/317) (smoke slice merged in PR #318) · **Dedicated-thread follow-up:** [#325](https://github.com/therealtimex/signals/issues/325) · **Epic:** #62
**Loop:** `loop-issue-317-56d1dfd6` · **Base:** `main` @ `584bd5b`
**Parents:** `specs/persona-generation-workflow.md` (§3–§8 consumed as shipped; §9 + ADR-062-4 amended here), `specs/publish-via-terminal-agent.md` (job/dispatch/callback precedent, reused not redesigned)

---

## 0. Decisions at a glance

| # | Decision | Why (one line) |
|---|---|---|
| D1 | Mode is stored in `~/.signals/config.json` via a new shared typed config module; env `SIGNALS_PERSONA_GENERATION_MODE` overrides | Global scalar setting; matches every other app-level setting; no migration; env override = QA/CI lever |
| D2 | Effective mode is **derived**, never written: standalone → `structured_workflow`; backend missing → `structured_workflow` | Stored preference survives; UI shows stored vs effective honestly |
| D3 | `persona_jobs` is a first-class table (publish-jobs shape), linked to a `workflow_runs` row | Indexed status queries for polling/stale, one-active-job invariant, provenance snapshot at dispatch |
| D4 | Agent returns its JSON through a single agent-tool `complete_persona_job` | RTX exposes **no thread chat-history read** to Local Apps (verified: `/cli/get-thread` = metadata only; `get-terminal-session-context` = sanitized PTY tail). Polling is impossible; callback is the only reliable capture |
| D5 | Persona jobs share one dedicated **Persona Generation** RTX thread; every job still gets a fresh terminal runtime session and immutable brief | One audit timeline without thread sprawl; jobId + brief + callback preserve isolation |
| D6 | `generatePersona()` stays a **blocking facade** for all programmatic callers; only the Explore REST route goes async (202 + poll) | Tool / pipeline / sweeper contracts unchanged; blocking = natural serial concurrency cap of 1 |
| D7 | Persistence happens in the **callback handler**, not the awaiter | Explore's async path and the blocking path share one write; a Signals restart mid-await still lands the persona |
| D8 | Three PRs: A settings shell → B backend → C Explore UX + docs; A ∥ B | A has no migration and ships value alone; B needs owner sign-off on a migration; C needs B |

---

## 1. Problem and constraints

Settings mixes platform connectivity with an RTX permissions banner that is **not backed by real permission state** (`settings/page.tsx:347-355` gates only on `rtx.mode === "embedded"` from `/api/health`, which deliberately drops `permissions`). Persona generation has exactly one implementation (`generatePersona` → `rtxChat`, `src/lib/workflows/generate-persona.ts`) and no user-facing control over *how* it runs. #317's smoke lib proved the stateless per-contact agent contract but nothing in production dispatches it.

Hard constraints found in the code (not assumptions):

- **No app-settings table.** App config is `~/.signals/config.json`, re-implemented 7× with three different `SignalsConfig` shapes (`src/lib/mail/settings.ts:5-36` is the cleanest). `AGENTS.md:161-163`: config.json survives SQLite resets in tests.
- **Schema changes need owner confirmation** (`AGENTS.md:173-175`); migrations are additive-only, `npm run db:generate`.
- **Dispatch path amendment (#325):** the handoff is persisted to the dedicated thread with `appendRtxThreadMessage()`, then `launchTerminalCliAgent()` uses RealTimeX's `terminal-first` launch contract to create a fresh runtime session for that job. This bypasses same-thread chat-linked reuse while retaining the dedicated thread as the visible audit timeline. Persona launches require the workspace default terminal agent and retain the existing `TERMINAL_DISPATCH_REQUIRED` failure only when the lookup succeeds with no default configured; lookup transport and permission failures keep their own launch errors.
- **Callback auth is loopback-or-bearer** (`src/lib/agent-tools/auth.ts`); correlation is the job id round-tripping through the prompt. Same trust model as `complete_publish`.
- **Structured workflow also requires RTX**: `rtxChat` returns `RTX_NOT_CONFIGURED` without a fetch when `RTX_APP_ID` is unset (`llm.ts:272-278`). Standalone has *no* working persona backend; "Structured workflow only" in standalone means "selected, but will 503 until embedded".
- **No `radio-group` primitive** in `src/components/ui` (only `checkbox`, `switch`, `select`, `tabs`).
- **Explore card state is in-memory only** (`contact-explore-card.tsx:34`); a reload mid-generation loses the indicator. Agent mode needs a persisted in-flight marker — that is the job row.
- **Visual evidence is mandatory** for UI PRs (`AGENTS.md:250-255`): `.evidence/{before,after}_{view}_{desktop,mobile}_{light,dark}.png`, before-set from the unmodified build. `npm run doctor` is a blocking check.

---

## 2. Architecture

```
┌──────────────────────── Signals (Local App) ─────────────────────────────┐
│ Settings ?tab=agents                                                     │
│   RtxRuntimeCard  ──GET /api/rtx/status ──► bootstrap.permissions        │
│                   ──POST /api/rtx/status/refresh ──► re-register (D-§4.3)│
│   PersonaModeCard ──GET/PUT /api/settings/persona-generation             │
│                                    │                                     │
│              src/lib/settings/persona-generation-mode.ts                 │
│              resolvePersonaGenerationMode(env) → effective mode  (D1,D2) │
│                                    │                                     │
│  callers ─┬ generate_persona tool ─┤                                     │
│           ├ pipeline step          ├──► generatePersona(contactId, opts) │
│           ├ refresh sweep          │        (blocking facade, D6)        │
│           └ Explore route ─────────┘    ┌─────────────┴──────────────┐   │
│               (async 202 in agent mode) │                            │   │
│                            structured   ▼                 terminal   ▼   │
│                      StructuredBackend (rtxChat,      AgentJobBackend    │
│                      repair turn — today's code)      start → await      │
│                                                        │                 │
│   persona_jobs ◄── createPersonaJob ◄──────────────────┘                 │
│        │  brief: <ws-dir>/persona-jobs/<jobId>/brief.md                  │
│        │  resolve shared Persona Generation thread; fresh send (D5)      │
│        │                                                                 │
│   agent-tools (inbound): get_persona_job · complete_persona_job (D4)     │
│        └─► validate → persistPersonaSynthesis() → job completed (D7)     │
└──────────────────────────────────────────────────────────────────────────┘
```

Dependency direction: `src/lib/persona/*` (prompt, schema, persist) knows nothing about HTTP, RTX transport, or config files. `src/lib/persona/agent-job/*` (service) depends on `src/lib/rtx/*` ports and `src/lib/db/queries/persona-jobs.ts`. Routes and agent-tool handlers are adapters over the service. The mode resolver is the only module that reads config.

---

## 3. Persona generation mode (D1, D2)

### 3.1 Module `src/lib/settings/persona-generation-mode.ts`

```ts
export const PERSONA_GENERATION_MODES = ["structured_workflow", "terminal_agent"] as const;
export type PersonaGenerationMode = (typeof PERSONA_GENERATION_MODES)[number];
export const DEFAULT_PERSONA_GENERATION_MODE: PersonaGenerationMode = "structured_workflow";
export const PERSONA_GENERATION_MODE_ENV = "SIGNALS_PERSONA_GENERATION_MODE";

export type PersonaModeUnavailableReason = "standalone" | "backend_unavailable";
export type PersonaModeResolution = {
  storedMode: PersonaGenerationMode | null;      // config.json value, may be null
  requestedMode: PersonaGenerationMode;          // env ?? stored ?? default
  effectiveMode: PersonaGenerationMode;          // what generatePersona will actually do
  source: "env" | "config" | "default";
  embedded: boolean;
  options: Array<{ value: PersonaGenerationMode; available: boolean;
                   unavailableReason?: PersonaModeUnavailableReason }>;
};

export function getStoredPersonaGenerationMode(): PersonaGenerationMode | null;
export function setStoredPersonaGenerationMode(mode: PersonaGenerationMode | null): void;
export function resolvePersonaGenerationMode(env: EnvLike = process.env): PersonaModeResolution;
```

Rules:
- Storage key `personaGenerationMode` in `config.json`, through a **new shared module** `src/lib/settings/signals-config.ts` (`readSignalsConfig()`, `updateSignalsConfig(patch)`, typed `SignalsConfig` with the union of today's keys + `personaGenerationMode`). Migrating the other 6 duplicated read/write pairs onto it is a follow-up, not this issue — but new code must not add an 8th copy.
- `requestedMode`: env (validated against the enum; invalid env value → warn once, ignore) → stored → default.
- `effectiveMode = requestedMode` unless `terminal_agent` is unavailable: `!isRtxEmbedded(env)` → `standalone`; backend not registered (PR-A before PR-B) → `backend_unavailable`. Availability of the backend is a module-level registration (`registerPersonaAgentJobBackend()` called from the backend module's index in PR-B) — no env flag, no dead toggle.
- Reads `config.json` synchronously on every call; that is one `readFileSync` per generation in a single-user local app — acceptable; no cache (a cache would need invalidation across the PUT route and the worker).
- Tests: `resetPersonaGenerationModeForTests()` = `setStoredPersonaGenerationMode(null)`; unit tests for the env/config/default precedence and both unavailability reasons.

### 3.2 API `GET|PUT /api/settings/persona-generation`

```ts
// GET → 200 PersonaModeResolution (exact type above)
// PUT { mode: "structured_workflow" | "terminal_agent" }
//   200 PersonaModeResolution (after write)
//   400 VALIDATION_ERROR (zod)
//   409 PERSONA_MODE_UNAVAILABLE { error, code, unavailableReason } when the requested option is unavailable
//   409 PERSONA_MODE_ENV_LOCKED when env override is set (UI disables the control; API double-checks)
```

Pattern: `snowball-seed-scout/settings/route.ts` shape (zod + `NOT_JSON` sentinel + code-driven status), errors via `toErrorResponse`. Route test: precedence table + both 409s.

---

## 4. Settings UI

### 4.1 Structure

```
src/app/dashboard/settings/
  page.tsx                      ← Suspense + <SettingsPageClient/>; searchParams parse only
  settings-tabs.ts              ← VALID_SETTINGS_TABS = ["platforms","agents"], parseSettingsTab(), settingsTabHref()
  settings-page-client.tsx      ← Tabs shell + URL sync; hosts existing platform state/handlers unchanged
  platforms-tab.tsx             ← today's page body L364-497 moved verbatim (SocialPlatformCard×3, ComingSoon, Himalaya)
  ai-agents-tab.tsx             ← composes the two cards below
  rtx-runtime-card.tsx          ← runtime mode + permission rows + Re-check
  persona-generation-mode-card.tsx
src/components/ui/radio-group.tsx   ← shadcn radio-group over `radix-ui` (design-system addition, see §4.4)
```

The platform tab must be a **move, not a rewrite**: `runSessionAction`, `handleOAuthConnect/Disconnect`, `runTargetAction`, the parallel fetch (`page.tsx:110-121`) and all `SocialPlatformCard` props stay byte-identical. Regression-safety is the acceptance bar; component test asserts the same request URLs as before.

### 4.2 URL contract

- `/dashboard/settings?tab=platforms|agents`; missing or invalid → `platforms` (Help-page precedent `help/page.tsx:1022-1031`).
- Controlled `<Tabs value onValueChange>`; on change `router.replace(settingsTabHref(tab), { scroll: false })`. **`replace`, not `push`** (content-list uses `push` for filters; for tabs, Back should leave the page, not cycle tabs). Call out as an intentional divergence.
- OAuth callback params (`?connected=`, `?error=`) keep working: they are consumed exactly as today (`page.tsx:154-170`) and the cleanup `replaceState` targets `/dashboard/settings?tab=platforms` (OAuth always returns to the platforms tab). `tab` and `connected` may coexist in one URL; parse independently.
- Deep links used by Help: platform checklist items → `?tab=platforms`; RTX/LLM item → `?tab=agents`.

### 4.3 RTX runtime card (`rtx-runtime-card.tsx`)

Data: `GET /api/rtx/status` → `bootstrap: { mode, registered, pingOk, permissions: { granted, denied } | null, error }` (already returned; the UI just hasn't used it). Add **`POST /api/rtx/status/refresh`** → `resetRtxBootstrapState()` + `bootstrapRtxIfEmbedded()` → returns the same shape. Safe: RTX `/sdk/register` only prompts for permissions with no decision yet ("All permissions already processed" otherwise — verified in `server/endpoints/sdk/register.js:59-74`); denied ones are not re-prompted.

| Row | Rendering |
|---|---|
| Runtime | Badge `Embedded in RealTimeX` / `Standalone`; when standalone, one sentence: *"Persona generation and embeddings need Signals running as a RealTimeX Local App."* |
| `llm.chat` — Persona synthesis (structured workflow) | `Granted` (green) / `Denied` (destructive) / `Unknown` (muted, when `permissions` null) — text + color, never color alone |
| `llm.embed` — Semantic search & persona embeddings | same |
| `desktop.runtime-sessions` — Terminal agent jobs & publish | same |
| Footer | *"Approve permissions in RealTimeX → Settings → Local Apps → Signals."* + **Re-check** button (calls refresh; `aria-live="polite"` result line) |

This card **replaces** the inline banner at `page.tsx:347-355`; nothing about permissions remains on the platforms tab (AC: not duplicated).

### 4.4 Persona generation mode card (`persona-generation-mode-card.tsx`)

Data: `GET /api/settings/persona-generation`. Control: `RadioGroup` (add `src/components/ui/radio-group.tsx` from shadcn; `radix-ui` is already a dependency via `tabs.tsx` — same import style). If the team prefers not to add a primitive, the fallback is two `Card`s with `role="radio"` / `aria-checked` inside a `role="radiogroup"` — but the primitive is the right system move: it will be reused.

| Option | Title | Description |
|---|---|---|
| `terminal_agent` | Terminal agent | *"Signals builds a per-contact evidence brief and dispatches a stateless job to your RealTimeX terminal agent. Runs in the background; you can open the thread."* |
| `structured_workflow` | Structured workflow | *"Signals calls RealTimeX `llm.chat` directly with a schema-validated prompt. Runs synchronously while you wait."* |

States:
- Helper line under the group: *"Applies to every persona trigger: Explore card, `generate_persona` tool, pipelines, and scheduled refresh."*
- **Saving**: optimistic select → `PUT`; on failure revert + inline destructive text. `aria-live="polite"` "Saved" confirmation.
- **Option unavailable** (`available: false`): radio `disabled`, reason rendered as visible text under the option, not tooltip-only:
  - `standalone`: *"Not available in standalone mode — requires the RealTimeX Local App."*
  - `backend_unavailable`: *"Not available in this build."* (only ever visible between PR-A and PR-B)
- **Stored ≠ effective** (stored `terminal_agent` but unavailable): keep the stored radio visually selected but show a `Badge` "Using: Structured workflow" + the reason. Never silently rewrite the stored value.
- **Env override** (`source: "env"`): whole group `disabled`; note *"Set by `SIGNALS_PERSONA_GENERATION_MODE` in the environment."*
- Standalone: the card still renders (so users learn the control exists) with the above gating; no separate "standalone explainer" card — the runtime card's sentence plus the option reason is enough.

### 4.5 Accessibility, responsive, evidence

- Radix `Tabs` and `RadioGroup` give roving tabindex/arrow keys; every control has a `Label htmlFor`.
- `TabsList variant="line"` full-width `grid grid-cols-2` under `sm`; cards stack; long permission names wrap.
- Status is never color-only (badge text). Focus rings from the design system untouched.
- Evidence set: `settings-platforms` and `settings-agents` views × desktop/mobile × light/dark, before + after (before = current single page for both views).
- `npm run doctor` clean.

---

## 5. PersonaAgentJob backend (D3–D7)

### 5.1 Facade refactor — extract the seam first

Split `src/lib/workflows/generate-persona.ts` (behavior-preserving; existing tests must pass unchanged):

```ts
// src/lib/persona/generation/prepare.ts
export type PreparedPersonaGeneration =
  | { kind: "skip"; reason: "evidence_unchanged"; personaId: string }
  | { kind: "ready"; activePersona: SerializedContactPersona | null; bundle: PersonaEvidenceBundle };
export function preparePersonaGeneration(contactId, { force }): PreparedPersonaGeneration;
// = contact check + local_only guard + assemblePersonaEvidence + hash gate (today's L126-151)

// src/lib/persona/generation/persist.ts
export function persistPersonaSynthesis(input: {
  contactId; synthesis: PersonaSynthesisOutput; bundle; activePersona;
  qualifiedModel: string; workflowRunId: string;
  sourceWindowExtras?: Record<string, unknown>;   // generator, jobId, agentPromptVersion
  fetchImpl?; env?;
}): Promise<{ persona; nicheEdgesUpserted; embedded; embedErrors: string[] }>;
// = upsertPersona + projectPersonaInterestsToNiches + embedNodeIfStale (today's L182-227)

// src/lib/workflows/generate-persona.ts (facade)
export async function generatePersona(contactId, opts): Promise<GeneratePersonaResult> {
  const prepared = preparePersonaGeneration(contactId, { force: opts?.force });
  if (prepared.kind === "skip") return { generated: false, skipped: true, ... };
  const mode = resolvePersonaGenerationMode(opts?.env ?? process.env).effectiveMode;
  return mode === "terminal_agent"
    ? runPersonaAgentJobBlocking(contactId, prepared, opts)   // §5.4
    : runStructuredSynthesis(contactId, prepared, opts);       // today's L153-268, unchanged
}
```

`GeneratePersonaResult` type is **unchanged**. `GeneratePersonaOptions` is unchanged (no `mode` field — the mode is global by product rule; a per-call override would reintroduce exactly the flag ADR-062-2 refused).

### 5.2 Table `persona_jobs` (migration — needs owner confirmation per AGENTS.md)

```ts
export const personaJobs = sqliteTable("persona_jobs", {
  id: text("id").primaryKey(),                                   // pa_<nanoid>
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued","running","completed","failed","timeout","superseded"] })
    .notNull().default("queued"),
  trigger: text("trigger", { enum: ["user","scheduled","template"] }).notNull(),
  force: integer("force").notNull().default(0),
  promptVersion: integer("prompt_version").notNull(),            // PERSONA_PROMPT_VERSION
  agentPromptVersion: integer("agent_prompt_version").notNull(), // PERSONA_AGENT_PROMPT_VERSION
  evidenceHash: text("evidence_hash").notNull(),
  provenance: text("provenance").notNull(),                      // JSON PersonaEvidenceProvenance (frozen at dispatch)
  supersededPersonaId: text("superseded_persona_id"),            // active persona at dispatch, for the run result
  workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id),
  rtxWorkspaceSlug: text("rtx_workspace_slug"),
  rtxThreadSlug: text("rtx_thread_slug"),
  rtxRuntimeSessionId: text("rtx_runtime_session_id"),
  agentModel: text("agent_model"),                               // from dispatch descriptor / agent self-report
  attempts: integer("attempts").notNull().default(0),            // rejected synthesis submissions
  resultPersonaId: text("result_persona_id"),
  error: text("error"),
  errorCode: text("error_code"),
  createdAt, updatedAt, dispatchedAt: integer, completedAt: integer,
}, (t) => [index("idx_persona_jobs_contact_status").on(t.contactId, t.status),
           index("idx_persona_jobs_status").on(t.status)]);
```

Why not `workflow_runs.config` JSON (the template-run precedent): the Explore card polls by contact, the stale rule scans by status, and the one-active-job invariant needs an index — all of which the publish-jobs shape gives and JSON-in-config does not. The `workflow_runs` row still exists for cost/provenance parity with the structured path (`contact_personas.workflowRunId` keeps pointing at a run, never at a job).

Evidence is **not** stored on the job (24 KB × jobs); it lives in the brief file. `get_persona_job` re-assembles evidence on demand for degraded mode (§5.6) and cross-checks the hash.

### 5.3 State machine

| Event | From → To | Side effects |
|---|---|---|
| `startPersonaAgentJob` | — → `queued` | `createWorkflowRun({ workflowType:"persona", status:"running", trigger, config:{ contactId, force, promptVersion, backend:"terminal_agent", personaJobId } })`; provenance frozen |
| brief written + `send-message` accepted | `queued` → `running` | `dispatchedAt`, rtx refs, `agentModel` from `descriptor.metadata.canonicalAgent` + `resumeContract.modelSelection.modelId` when present |
| dispatch failure | `queued` → `failed` | `errorCode ∈ standalone \| permission_required \| rtx_unavailable \| terminal_dispatch_required \| launch_failed` (publish taxonomy §4.4, mapping in `send-to-agent.ts:236-245` reused); run → `failed` |
| `complete_persona_job` valid | `running` → `completed` | `persistPersonaSynthesis`; `resultPersonaId`; run → `completed` with `model = agentModel`, tokens 0/null |
| `complete_persona_job` invalid, `attempts+1 < PERSONA_AGENT_JOB_MAX_ATTEMPTS (2)` | `running` (stays) | `attempts++`; validation errors returned to the agent (the agent-side "repair turn") |
| `complete_persona_job` invalid, attempts exhausted | `running` → `failed` | `errorCode: synthesis_invalid`; run → `failed` |
| `complete_persona_job { success:false }` | `running` → `failed` | `errorCode: agent_failed`, `error` verbatim |
| awaiter deadline (`PERSONA_AGENT_JOB_TIMEOUT_MS`, default 300 000) | `queued\|running` → `timeout` | CAS update (`WHERE status IN (queued,running)`); run → `failed` `["agent_timeout"]` |
| late valid callback on `timeout` | `timeout` → `completed` | **documented exception to monotonicity**: timeout is a Signals-side guess, the evidence snapshot is still valid, persisting is strictly better than discarding. Run flips to `completed`. |
| late callback on `failed`/`superseded`/`completed` | no change | `completed` + same jobId → return recorded result (idempotent); otherwise `PERSONA_JOB_NOT_ACTIVE` — agent is told to stop |
| new start while a non-terminal job exists, `updatedAt` within `PERSONA_JOB_STALE_MS` (30 min) | — | **join**: return the existing job (no second dispatch, no 409). Explore already shows pending; batch callers await it |
| new start while a non-terminal job is older than 30 min | old → `superseded`; new → `queued` | a dead agent never blocks a contact forever; no sweeper needed |
| `POST /api/persona-jobs/:id/fail` | `queued\|running` (stale only) → `failed` | `errorCode: timeout`; publish precedent — human judgement, never automatic |

`stale` is computed at read like publish (`serializeJob`, `publish-jobs.ts:41-55`): non-terminal and `updatedAt` older than 30 min.

### 5.4 Service `src/lib/persona/agent-job/service.ts`

```ts
export async function startPersonaAgentJob(contactId, prepared: Ready, opts): Promise<PersonaJob>;
export async function awaitPersonaJob(jobId, { timeoutMs = PERSONA_AGENT_JOB_TIMEOUT_MS, pollMs = 1000 }):
  Promise<PersonaJob>;   // resolves on any terminal state; marks timeout itself
export async function runPersonaAgentJobBlocking(contactId, prepared, opts): Promise<GeneratePersonaResult> {
  const job = await startPersonaAgentJob(...);
  const done = await awaitPersonaJob(job.id, ...);
  if (done.status === "completed") return { generated: true, persona: getActivePersona(...), workflowRunId: done.workflowRunId,
                                            supersededPersonaId: done.supersededPersonaId, nicheEdgesUpserted, embedded };
  throw mapJobFailure(done);  // §5.7
}
```

`startPersonaAgentJob` sequence (mirrors `sendContentToAgent`, `send-to-agent.ts:68-275`):
1. `isRtxEmbedded` gate → `failed/standalone` (defensive; the resolver already prevents this).
2. Join/supersede check (§5.3).
3. Insert job `queued` + workflow run.
4. `ensureRtxWorkspace(getSignalsRtxWorkspaceSlug(env), "Signals")`; resolve or create the dedicated `Persona Generation` thread using the same presence/list/create/convergence contract as Network Snowball (D5).
5. Write brief to `<workspace working dir>/persona-jobs/<jobId>/brief.md` (`resolveRtxWorkspaceWorkingDir`, `storage-path.ts:44`).
6. Persist `buildPersonaJobBriefRoutingMessage(...)` to the shared thread with `appendRtxThreadMessage()`, then call `launchTerminalCliAgent({ workspaceSlug, threadSlug, message, requireWorkspaceDefaultAgent: true })` so this job cannot reuse another persona job's live session.
7. Persist rtx refs, `running`.
8. Any failure in 4–7 → `failed` + errorCode, run `failed`, rethrow as `PersonaGenerationUnavailableError`.

Polling the DB at 1 s is the in-process wait; the callback handler writes to the same SQLite. No EventEmitter in v1 — 1 s latency on a 30–120 s job is noise. Concurrency: the facade blocks, so the pipeline step (`for` loop, `generate-persona-step.ts:22-69`) and the sweep (`persona-refresh-sweep.ts:47-135`) are serial by construction — the "1–2 concurrent" cap from #317 is satisfied with cap = 1 and no scheduler. Cost of that choice: a pipeline batch of 20 takes ~20–40 min in agent mode. Reopen if a user needs faster batches (then: `PERSONA_AGENT_JOB_CONCURRENCY` + a small pool inside the step handler — the job table already supports it).

Teardown: on terminal state, `scheduleTerminalSessionRelease(rtxRuntimeSessionId)` (`resource-teardown.ts:115`) exactly as publish does. Only that job's runtime session is released; the shared `Persona Generation` thread is retained as the audit trail and recreated if the user deletes it.

### 5.5 Brief and routing message

Promote `buildAgentPrompt` from `src/lib/qa/persona-agent-job-smoke-lib.ts:21-70` to `src/lib/persona/agent-job/prompt.ts` (`buildPersonaAgentJobBrief`), the smoke lib re-exports it (smoke stays green, one prompt source). Changes versus the smoke prompt — bump `PERSONA_AGENT_PROMPT_VERSION = 1` (new constant; the structured `PERSONA_PROMPT_VERSION` is untouched):

- Rule 4 becomes: *"Do not call any Signals agent-tool to read evidence or write the persona. When your JSON is ready, call **`complete_persona_job`** exactly once with `{ jobId, success: true, synthesis }`. If it returns validation errors, correct the JSON and call it again (at most once more). If you cannot produce a persona, call it with `{ jobId, success: false, error }`."*
- Adds `Signals base URL: {baseUrl}` (`resolveSignalsBaseUrlFromRequest` for user triggers; env fallback for scheduled) and *"Load the `realtimex-signals` skill for the agent-tools API"* (publish precedent).
- Adds *"Optionally include `model` (e.g. `claude:claude-fable-5`) so Signals can record provenance."*
- Keeps: jobId/contactId/promptVersion block, stateless rule, JSON-only schema, calibration, `PERSONA_SYSTEM_PROMPT`, evidence JSON.

Routing message (`workspace-brief-files.ts` gets `buildPersonaJobBriefRoutingMessage`):

```
Signals persona handoff -> <contact name>
Job: <jobId>
Contact: <contactId>
State: ready
Type: persona-brief
Context: Follow workspace guidelines and operating model in AGENTS.md.
Required: Read the brief file before acting and follow its instructions. This job is stateless; ignore prior threads.
File: @<absolute brief path>
```

### 5.6 Agent tools (4-edit convention: schema → handler → registry → docs; then `npm run generate:agent-tools-openapi`)

**`get_persona_job`** `{ jobId }` → `{ jobId, contactId, status, promptVersion, agentPromptVersion, evidenceHash, stale, threadPath, evidence?: PersonaEvidence }`. `evidence` is re-assembled and returned only while the job is non-terminal **and** the fresh hash equals `evidenceHash`; on drift it returns `evidence: null, evidenceDrifted: true` (agent should use the brief, which is authoritative). Read-only. Purpose: degraded mode when the brief file is unreadable, and status introspection.

**`complete_persona_job`**
```ts
z.object({
  jobId: z.string().min(1),
  success: z.boolean(),
  synthesis: z.union([z.string(), z.record(z.unknown())]).optional(), // string → parsePersonaSynthesisJson (fence-tolerant)
  model: z.string().max(120).optional(),
  error: z.string().max(2000).optional(),
}).refine(v => v.success ? v.synthesis !== undefined : true)
```
Handler order: load job → terminal-state handling (§5.3) → `success:false` branch → parse/validate with `personaSynthesisSchema` → on invalid: `attempts++`, return envelope `success:false, code:"VALIDATION_ERROR", details:{ synthesisErrors: formatSynthesisValidationErrors(...), attemptsRemaining }` (this **is** the repair turn — the agent, not Signals, re-prompts itself) → on valid: `persistPersonaSynthesis({ ..., qualifiedModel: model ?? job.agentModel ?? "terminal-agent:unknown", sourceWindowExtras: { generator:"terminal_agent", jobId, agentPromptVersion } })` → job `completed`, run `completed` → return `{ accepted:true, personaId, supersededPersonaId, status:"completed" }` → schedule session release.

`sourceWindow.generator` becomes a three-value vocabulary: `"workflow"` (structured), `"terminal_agent"` (this), `"agent"` (manual `upsert_persona`, unchanged, still unenforced).

Auth/trust: unchanged loopback-or-bearer. Any loopback process can complete any job by id — identical to `complete_publish`; accepted for a local single-user app and documented in `docs/agent-tools.md` next to the existing statement.

### 5.7 Errors

`PersonaGenerationUnavailableError.rtxCode` widens from `RtxChatErrorCode` to `PersonaBackendErrorCode = RtxChatErrorCode | "TERMINAL_DISPATCH_REQUIRED" | "AGENT_TIMEOUT" | "AGENT_FAILED" | "LAUNCH_FAILED"`. HTTP mapping (`api/errors.ts:62-81`) unchanged: still 503; `synthesis_invalid` maps to the existing `PersonaSynthesisError` → 502. Actionable messages:

| errorCode | Message |
|---|---|
| `terminal_dispatch_required` | *"No default terminal agent for the Signals workspace. Set one in RealTimeX → workspace settings, or switch persona generation to Structured workflow."* |
| `permission_required` | *"Grant 'Desktop Runtime Sessions' to Signals in RealTimeX → Settings → Local Apps."* |
| `rtx_unavailable` | *"RealTimeX desktop isn't running."* |
| `agent_timeout` | *"The agent did not return a persona within 5 minutes. Open the thread to check on it, or retry."* |
| `synthesis_invalid` | validation detail verbatim |
| `agent_failed` | agent's `error` verbatim |

Pipeline step: `PersonaGenerationUnavailableError` still aborts the whole step (`generate-persona-step.ts:43-59`, spec §7.3) — correct for `terminal_dispatch_required`/`rtx_unavailable` (nothing later will succeed). `AGENT_TIMEOUT` and `AGENT_FAILED` are per-contact conditions; map them to the step's per-contact `failed` outcome instead of abort (small, explicit change in `runPersonaForContact`'s catch, with a test).

### 5.8 Persistence details worth stating

- `preparePersonaGeneration` runs at **dispatch**; the provenance snapshot is frozen on the job; the callback persists with that snapshot even if evidence drifted meanwhile (the smoke lib's "prepare-time provenance" rule, `persona-agent-job-smoke.test.ts` L130 — now production). Drift is caught by the next hash-gate.
- The `local_only` guard is re-checked in the callback (an operator may have re-scoped during the job) → `PersonaScopeError` → job `failed/scope_conflict`.
- `workflow_runs.model` = `agentModel`; tokens null; `costUsd` 0. Agent compute is outside Signals' cost accounting — say so in docs rather than fabricate numbers.

---

## 6. Explore card UX (agent mode)

### 6.1 API

- `POST /api/contacts/[id]/generate-persona` — mode-aware. Structured: unchanged (sync, returns projection). Terminal agent: `preparePersonaGeneration` (skip/409s exactly as today, pre-dispatch) → `startPersonaAgentJob` → **202** `{ generated:false, pending:true, job: PersonaJobView }`. Join semantics return the existing job with 202 too.
- `GET /api/persona-jobs/[id]` → `{ job: PersonaJobView, persona?: ContactExplorePersona }` (`persona` present when `completed`, so the client swaps without a second call). Lazy `stale` on read.
- `POST /api/persona-jobs/[id]/open-thread` → `openRtxRuntimeLauncher` + `{ threadPath }` (publish precedent, `open-thread/route.ts`).
- `POST /api/persona-jobs/[id]/fail` → guard stale-only (publish precedent).
- `ContactExplorePersona` gains `latestJob: PersonaJobView | null` and `generationMode: PersonaGenerationMode` (effective), so a reload mid-job shows the pending state and the card knows which affordance to draw.

```ts
type PersonaJobView = { id; contactId; status; stale: boolean; trigger; errorCode; error;
                        threadPath: string | null; createdAt; updatedAt; completedAt };
```

### 6.2 States (extends spec §9.3; structured mode rows are unchanged)

| State | Rendering |
|---|---|
| agent mode, idle | Same buttons as today; button label unchanged ("Generate persona"/"Refresh"/"Regenerate"); muted caption under the section: *"Mode: Terminal agent · [Change](/dashboard/settings?tab=agents)"* (structured shows *"Mode: Structured workflow"*) |
| agent mode, `queued` | Buttons replaced by a status row: `Badge` "Dispatching to agent…" (clock icon, no spinner) + **Open thread** (secondary, enabled once `threadPath` exists) |
| agent mode, `running` | `Badge` "Agent is working…" + **Open thread** |
| agent mode, `stale` | Warning tint row: *"No update in 30 min — check the thread; the agent may need input."* + **Open thread** + **Mark failed** |
| agent mode, `completed` (poll edge) | Swap in returned projection; toast *"Persona updated by agent"*; row disappears |
| agent mode, `failed`/`timeout` (newer than active persona) | Inline destructive text with the actionable message + **Retry** (calls `generate-persona` again; join/supersede logic handles it) + **Open thread** if a thread exists |
| structured mode | Exactly today's spinner behavior |

Polling: new `src/hooks/use-persona-job.ts` modeled on `use-publish-jobs.ts` — 5 s interval **only while** non-terminal, one job id, terminal-edge callback. The `generationRef` stale-response guard in `contact-explore-card.tsx:36` stays and also cancels polling on contact switch.

Accessibility: status row is `role="status"` (`aria-live="polite"`); state changes are text, not only icon/color; buttons keep their existing names so `contact-explore-card.test.ts` helpers (`buttonByText`) still apply.

---

## 7. Docs and help

- `guide/01-getting-started.md`: settings section (L62, 73-87, 119) → tabs; replace `guide/assets/settings-page.png` (both tabs); add "AI & agents" subsection: what each mode does, where permissions live.
- `src/app/dashboard/help/page.tsx`: checklist hrefs → `?tab=platforms` / `?tab=agents`; `llm.chat` copy at L235, 283-284, 993-994 → "Settings → AI & agents"; `rtxLlmReady` may now use real permission state from `/api/rtx/status` instead of `pingOk` (small, optional in PR-A).
- `docs/rtx-agent-orchestration.md` "Structured workflows inside Signals" → "Persona generation modes" paragraph (both backends, one global setting, provenance `generator` vocabulary).
- `docs/agent-tools.md`: two new tool rows + the trust statement; `docs/local-app.md` L52-62 boundary text mentions the terminal-agent backend; `.claude/skills/realtimex-signals/SKILL.md` + `reference.md`: new tools.
- `specs/persona-generation-workflow.md`: §9.1 "Synchronous in v1" → amended by this spec for agent mode; ADR-062-4 status → *Amended by ADR-314-1*.
- `.env.example`: `SIGNALS_PERSONA_GENERATION_MODE`, `PERSONA_AGENT_JOB_TIMEOUT_MS`.
- `rtx-manifest.json`: **no change** — `/cli/*` dispatch is authorized by `x-app-id` alone, `desktop.runtime-sessions` is already declared. Bumping the version is unnecessary.

---

## 8. Phasing (D8)

| PR | Branch | Content | Depends on | Gate |
|---|---|---|---|---|
| **A — Settings shell** | `issue-314-settings-tabs` | §3 module + API; §4 tabs, URL, runtime card + `/api/rtx/status/refresh`, mode card with availability gating (`backend_unavailable` until B); Help hrefs + copy; guide screenshots; tests (tab parsing, route precedence + 409s, component embedded/standalone/env-locked, platform-tab regression URLs); `.evidence/` set | — | `npm run check`, `npm run doctor` |
| **B — Backend** | `issue-317-persona-agent-job` | §5.1 facade split (behavior-preserving, first commit), `persona_jobs` migration (**owner confirms first**), service, brief/routing, two agent tools + openapi regen, error widening, pipeline per-contact mapping, `registerPersonaAgentJobBackend()` (flips availability), smoke lib re-export; tests: prompt builder, state machine (join/supersede/timeout/late-callback), callback validation attempts, blocking facade with mocked dispatch + simulated callback, isolation test (2 contacts sequential → distinct jobIds/threads, no shared prompt content) | A only for the resolver module (can be cherry-picked or B branches from A) | same + `check:agent-tools-openapi` |
| **C — Explore UX + docs** | `issue-314-explore-agent-mode` | §6 routes, projection fields, hook, card states; §7 docs/spec amendments; manual QA per #317 test plan (single contact, batch isolation, no `llm.chat` in logs for agent runs) | B | same + `.evidence/` for the Audience tab |

A and B proceed in parallel; C follows B. Settings-first is recommended over a monolith because A carries no migration and no RTX runtime dependency, so it can merge and ship value while B waits on schema sign-off. The one throwaway is nil: the `backend_unavailable` reason reuses the `standalone` gating path.

Acceptance mapping to #314: tabs (A), regression-safe platforms (A), mode persisted (A), permission status on AI tab only (A), URL-addressable (A), standalone gating (A), help/docs (A + C), Explore matches mode via #317 (B + C).

---

## 9. Tests (summary — each PR ships its own)

1. Mode resolver precedence table; standalone and backend-unavailable derivations; config reset helper.
2. Settings route: GET shape, PUT happy path, 400/409/409.
3. Settings component (happy-dom, `createRoot` + `act` pattern from `contact-explore-card.test.ts`): tab from URL, invalid tab fallback, `router.replace` on change, OAuth `?connected=` still processed, standalone disables Terminal agent with visible reason, env-locked group disabled, permission badges for granted/denied/unknown.
4. Platforms tab regression: same fetch URLs and card props as before the split.
5. Job state machine unit tests over the query layer (every row of §5.3, including CAS timeout vs concurrent completion and late-callback-after-timeout).
6. Service integration with mocked `fetch` for `/cli/*`: dispatch failure taxonomy → job/run/error; success path with a simulated `complete_persona_job` → facade result equals the structured path's `GeneratePersonaResult` shape.
7. Privacy sentinel scan over the brief file content (the §10 invariant extends to the agent prompt — it is rendered from `PersonaEvidence` only, same as today).
8. Explore route: 202 shape in agent mode, unchanged sync shape in structured mode, pre-dispatch 409s.
9. Hook + card states (§6.2), poll stops on terminal, stale row actions.

---

## 10. Open questions for the owner (non-blocking; defaults stated)

1. **Migration approval** for `persona_jobs` (AGENTS.md rule). Default assumption: approved as additive-only; B cannot merge without it.
2. **Thread retention.** Resolved by #325: keep one dedicated `Persona Generation` thread as the audit trail; do not delete it when individual jobs complete.
3. **`generate_persona` tool in agent mode** blocks up to 5 min and spawns a second agent. Default: allowed (issue rule: all triggers), documented in the tool description. Alternative: the tool forces structured mode — rejected here because it silently violates "one global mode".

---

## 11. ADRs

**ADR-314-1: Agent-mode persona generation is an async job with callback capture; the facade blocks for programmatic callers.** — Accepted. Context: ADR-062-4 chose synchronous generation to avoid a queue; agent dispatch is inherently asynchronous and RTX offers no way to read a thread's reply back into a Local App. Options: (a) poll RTX for the reply — impossible (no API); (b) agent calls `upsert_persona` itself — rejected: loses Signals-owned validation/provenance and reintroduces the tool-loop flakiness #317 exists to remove; (c) job table + `complete_persona_job` callback, facade awaits — chosen. Consequences: one new table and two tools; Explore gets a real pending state that survives reloads; a Signals restart mid-await still lands the persona; cost is a 1 s DB poll and a 5-minute wall in batch callers. Amends ADR-062-4 for agent mode only; structured mode stays synchronous.

**ADR-314-2: One global mode, resolved at call time from env → config.json → default, with derived (never stored) effectiveness.** — Accepted. Context: the issue fixes a single global mode; the codebase has no settings table and seven config.json copies. Options: (a) new kv table — rejected: a migration for one scalar, and settings would live in two places; (b) per-call `mode` option — rejected: reintroduces the flag ADR-062-2 refused and lets callers disagree with the user; (c) shared typed config module, env override, effective mode derived from embedded/backend availability — chosen. Consequences: no migration; tests must reset the key; stored preference is never clobbered by transient unavailability; the same gating explains standalone and pre-backend states to the user.

**ADR-314-3 (amended by #325): One dedicated RTX thread with a fresh runtime session per persona job.** — Accepted. Context: per-job threads provided isolation but flooded the workspace timeline. Options: (a) retain one thread per job — rejected after production feedback because thread count grows with every generation; (b) share one `Persona Generation` thread while retaining unique jobs, immutable brief files, fresh runtime sessions, and `jobId`-keyed callbacks — chosen. Consequences: handoffs can interleave in one audit timeline, so each message names the contact, job ID, and brief path and agents are explicitly instructed to ignore prior jobs/messages; session teardown never deletes the shared thread; first-use creation converges under concurrent dispatches and avoids creation when thread presence is unknown.
