# #413 — Experience Contract pilot: Contact Nurture approval gate, run-page proposals, first executable contracts

**Status:** Accepted (System Design, 2026-09-02, loop `loop-issue-413-50edb420`)
**Issue:** [#413](https://github.com/therealtimex/signals/issues/413) · harness bar from [#301](https://github.com/therealtimex/signals/issues/301) · mandate boundary from [#377](https://github.com/therealtimex/signals/issues/377) / #373 ADR D12
**Base:** `main` @ `0927177` (v0.2.5), branch `issue-413`
**Design authority:** `specs/personality-projection.md` D2/D12, `docs/composable-writing-intent.md` (#410), `specs/signals-writing-system.md` D9/G1/G3/G4 and §UI ("Approve calls `materialize_variant` through a REST wrapper `POST /api/variants/[id]/materialize`, evidence `{ kind: "ui", route }`"), `scripts/app-automation/README.md` directory model, reviewer feedback (`experience-contract-review.txt`).

#413 is two things that must ship together: a **product fix** (the activation control lies and the run page hides the only artifacts that need a human) and the **first executable Experience Contract** that proves the fix at the UI ↔ persisted-state boundary where the bug lives. Neither waits for a general framework. The contracts are written first, the runner is the smallest thing that can execute one, and the convention is extracted into the README only after the three #413 contracts run green.

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| ADR-413-1 | **#413 does not add a publish-capable nurture surface.** Toggle OFF cannot mean autonomous publishing in this issue. | Every nurture surface is `assistOnlySurface` (`src/lib/writing/capabilities.ts`): `publish: draft_only`, `mandate: assist_only`. `WRITING_INTENT_MANDATES === ["assist_only"]` is pinned by a static test and D12 requires a new ADR + owner sign-off + separate issue for any other mode. `send-to-agent.ts` refuses assist-only intents even on publish-capable surfaces. `PublishJobKind` is `original \| repost \| quote`; `x-publish.cjs` has no reply flow. "OFF = publish" therefore needs a mandate ADR, a `reply` job kind, an X reply adapter, registry + static-test changes, and a product-risk decision about unattended replies under the workspace identity. That is an epic, and it is exactly what #377 exists to keep out of a bug fix. |
| ADR-413-2 | The activation control becomes a **capability-derived Approval gate**: `resolveNurtureApprovalGate(platform)` returns `mode: "locked_explicit" \| "operator_choice"`, a reason, and a per-surface row list. Today every platform resolves to `locked_explicit / assist_only_mandate`. The switch is rendered **checked and disabled** with the reason and the surface rows; it is never removed and never enabled while locked. | Issue acceptance: affordances derive from surface capabilities; draft-only surfaces cannot be configured as if they auto-publish; DM restrictions are visible before activation. Keeping the switch (locked) instead of deleting it makes the future unlock a registry change, not a UI rebuild. |
| ADR-413-3 | `requireApproval` stays in config for compatibility but is **validated, never silently converted**: dispatch (`runTemplateViaRtx`, before `createWorkflowRun`) rejects `requireApproval: false` when the gate is locked with HTTP 422 `approval_gate_locked`. The run row persists a server-owned `approvalGate` block; a caller-supplied `approvalGate` is stripped. `seedTemplates` rewrites a stored `requireApproval: false` on the nurture template to `true` once (logged), the same way it merges the writing opt-in. | Issue: "Never silently convert `requireApproval: false` into explicit approval." Rejection at the API is the only non-silent behaviour; the seed migration is the one visible normalisation of stale template rows. |
| ADR-413-4 | Channel matrix recorded now for the future ADR: `x/reply`, `linkedin/comment`, `facebook/comment` are the **only candidates** for a future operator-choice (`auto_low_risk`) mode, gated on an adapter existing; `*/direct_message` is **explicit-only permanently**. Expressed in code as `NURTURE_SURFACE_APPROVAL_FLOOR` (`explicit` for DMs, `capability` for public replies/comments), consumed by the gate derivation. | Answers the handoff's second question in a form the UI renders and a static test pins, rather than prose that drifts. Private 1:1 channels have no public audit trail and are irreversible. |
| ADR-413-5 | **Proposals are a run-anchored read model**, `listWorkflowRunProposals(runId)`, discovered through the server-stamped `launches.metadata.writing.composition.workflowRunId` (immutable, minted from the dispatch token) — never through caller-owned `writing.runs` or `generationMetadata.agent.workflowRunId` alone. Exposed as `GET /api/workflows/[id]/proposals`; a `proposalSummary` is added to `GET /api/workflows/[id]` and `/progress`. | Issue: "derived from authoritative persisted variants associated with the run." The composition scope is the only run pointer the server minted; everything else is a selector (`docs/composable-writing-intent.md`). |
| ADR-413-6 | UI approval is a **REST wrapper over the existing use-cases**, not a new approval path: `POST /api/variants/[id]/materialize` → `materializeVariant({ approval: { by: "user", evidence: { kind: "ui", route } } })`; `POST /api/variants/[id]/reject` → new `rejectWritingProposal`; `POST /api/variants/[id]/request-revision` → persists a server-owned `writing.revisionRequest` and returns the run's thread ref for the existing `open-thread` route. No agent-tool schema, OpenAPI, or DDL change. | Every gate (audit staleness, Personality guard, target, capability, assist-only ⇒ user evidence) already lives in `materializeVariantWithRunner`; the wrapper inherits them. Spec §UI already names the endpoint and evidence shape. `effectiveApproval` returns the stored approval when the agent later calls `materialize_variant` on an already-approved variant, so UI and thread approval cannot overwrite each other. |
| ADR-413-7 | The run header distinguishes generation from review: `Completed · N awaiting review` (also `Running · N awaiting review`), where N = `proposalSummary.pendingReview`. The page never renders "published" for a proposal; a materialized draft-only proposal reads **Materialized · export only**. | Issue: "does not imply that drafts were published." |
| ADR-413-8 | **Contracts are `.contract.mjs` modules** beside their scenario under `scripts/app-automation/scenarios/`, built with `defineContract()` from `flows/experience-contract.mjs`. Each checkpoint has a stable `id` and an `assert({ ui, data })` function. The ledger fails the run on an **undeclared** recorded checkpoint, a **declared but unrecorded** checkpoint, an assertion failure, or a required capture that was not produced. No YAML dependency, no new package. | Reviewer: "the IDs are the contract"; Dev: importable without a dependency. Assertions as functions let a checkpoint compare UI text to API state in one place. `automation:test` already globs `**/*.test.mjs`, so contract shape validation joins `npm run check` without a Dev app. |
| ADR-413-9 | **Three contracts, one of them blocked by design.** `issue-413-review-path` (kind `review`, reachable), `issue-413-capability-path` (kind `negative`, reachable), `issue-413-autonomous-path` (kind `path`, `reachability: { status: "blocked", by: "assist_only_mandate" }`). The blocked contract's scenario is a **guard**: it asserts the preconditions for autonomy are absent and records `blocked` in the manifest — not `skipped`, not `passed`. A vitest bridge test pins the contracts' declared matrix and `reachability.by` to the live registry and `WRITING_INTENT_MANDATES`. | Reviewer asked for three; the product can only reach two. Declaring the third as blocked keeps the future spec executable and turns "someone widened the mandate without updating the experience" into a failing test instead of a surprise. |
| ADR-413-10 | Evidence profiles: `assertions` (default) and `visual` (required for #413 because the change touches autonomy, approval, materialize, and hidden state). `gtm` is an opt-in derivative from a clean `visual` capture and is **out of scope** for #413: no captions, no music, no encoder work. | Reviewer: GTM is a consumer of QA, not a peer. The existing tour pipeline stays as is. |
| ADR-413-11 | Run output goes to `.evidence/experience/<contractId>/<stamp>/` with a `manifest.json` (schema below) and is **gitignored**; the PR links the manifest path and pastes the checkpoint table. The committed `.evidence/after_<view>_<form>_<theme>.png` convention (AGENTS.md §10) is produced *by* the runner's `visual` profile through `evidenceFileName`, not by hand. | Reviewer: do not commit raw QA evidence. AGENTS.md's committed stills stay, but generated. |
| ADR-413-12 | The review-path fixture is a **server-side seed** (`scripts/seed-experience-fixture.ts` → `src/lib/db/seed-fixtures/nurture-proposals.ts`) behind `demo-seed-guard`, that mints a real scope token, creates the launch through `upsert_launch` (so the composition is server-stamped) and the variants through `upsertVariantUseCase` with valid intents, audits, and Personality snapshots. It **requires** an existing bound Personality and a represented acting target and fails with `fixture_precondition_unmet` otherwise. It never writes rows around the use-cases. | The scenario proves UI ↔ persisted-state agreement and the approval path, not the LLM. A fixture that bypassed the use-cases would prove nothing about the gates the approve button must pass. |
| ADR-413-13 | The nurture brief's N5 no longer branches on `requireApproval`. It states the persisted gate and tells the agent that approvals, rejections, and revision requests may arrive from the Signals run page, so it must **re-read persisted variant state** before `materialize_variant` and before `complete_workflow_run`. | Two approval channels, one persisted truth. Idempotent materialization already handles the race; the brief has to stop the agent from re-presenting an already-decided proposal. |

---

## 1. What is already on `main` (do not rebuild)

Verified at `0927177`:

- **Mandate and composition:** `WRITING_INTENT_MANDATES = ["assist_only"]`, `WRITING_INTENT_APPROVAL_POLICY = "explicit"`, `NURTURE_WRITING_SURFACES` (6 send-less surfaces), `readWritingIntentComposition` (`src/lib/writing/writing-intent.ts`). Scope token minted at dispatch, hash persisted under `_writingScopeTokenHash`, launch composition stamped and immutable (`src/lib/agents/run-template-via-rtx.ts:388-420`, `src/lib/writing/launch-writing.ts`).
- **Capability registry:** `WRITING_SURFACE_CAPABILITIES`, `isAssistOnlySurface`, `canReachPublishAdapter`, `PUBLISH_CAPABLE_PLATFORMS` (`src/lib/writing/capabilities.ts`). `PUBLISH_PLATFORM_TARGETS = ["x","linkedin","facebook"]` (`src/lib/publish/payload.ts`).
- **Approval + materialization:** `approvalEvidenceSchema` already accepts `{ kind: "ui", route }`; `materializeVariant` / `materializeVariantWithRunner` enforce spine, audit-hash, audit verdict, Personality guard, `explicit`/assist-only ⇒ `by: "user"`, and return `nextAction: "export"` for `draft_only` (`src/lib/writing/materialize.ts`). `revokeVariantApproval(variantId, "user", note)`. `persistWritingVariant` accepts `status: "rejected"` and writes a `rejected` approval state (`variant-writing.ts:341`).
- **Run page:** `src/app/dashboard/workflows/[id]/page.tsx` + `workflow-run-live.tsx` render status, stat cards, agent cards, duration, contacts/orgs created, prune results, steps. `GET /api/workflows/[id]` and `/progress` (polled while running by `useWorkflowPolling`). `POST /api/workflows/runs/[id]/open-thread` focuses the run's RTX thread.
- **Launch UI:** `/dashboard/launches/[id]` and `/variants/[variantId]` display variants read-only (no approve/materialize action anywhere in `src/app`).
- **Activation:** `contact-nurture-fields.tsx` renders the switch labelled "Require confirmation before publishing … Toggle off for full autonomous execution." `readContactNurtureConfig` defaults `requireApproval` to `true`. `useActingTargets` returns `{ id, platform, name, handle, status }`.
- **Harness:** `scripts/app-automation/{flows,scripts}` with `resolveSignalsTarget`, `resolveCaptureOrigin`, `hideDevOverlay`, `waitForVisualSettle`, `evidenceFileName`, Playwright (`^1.58.2`) launched or connected over CDP; `automation:test` runs `**/*.test.mjs` inside `npm run check`. No `scenarios/` directory exists yet.
- **QA isolation:** `scripts/qa/provision-signals-qa-local-app.mjs --issue 413 --worktree … --loop-id loop-issue-413-50edb420`, teardown + hygiene verifier (AGENTS.md §10). `seed:demo` pattern via `vite-node` behind `demo-seed-guard`.

---

## 2. Product architecture

### 2.1 Approval gate derivation (domain, pure)

New module `src/lib/workflows/nurture-approval-gate.ts` (no DB, no React, importable from the client bundle):

```ts
export const NURTURE_APPROVAL_GATE_VERSION = 1;
export type NurtureApprovalGateMode = "locked_explicit" | "operator_choice";
export type NurtureApprovalGateReason = "assist_only_mandate" | "no_publish_adapter" | "explicit_floor" | "publish_capable";

/** Floor per surface, independent of adapters: DMs never become operator-choice. ADR-413-4 */
export const NURTURE_SURFACE_APPROVAL_FLOOR: Record<(typeof NURTURE_WRITING_SURFACES)[number], "explicit" | "capability">;

export interface NurtureApprovalGateSurface {
  surface: SurfaceId; publish: PublishCapability; mandate: "assist_only" | null;
  floor: "explicit" | "capability"; approval: "explicit" | "operator_choice"; reason: NurtureApprovalGateReason;
}
export interface NurtureApprovalGate {
  schemaVersion: 1; mode: NurtureApprovalGateMode; reason: NurtureApprovalGateReason;
  platform: Platform | null; surfaces: NurtureApprovalGateSurface[];
}
export function resolveNurtureApprovalGate(platform: Platform | null): NurtureApprovalGate;
export function readNurtureApprovalGate(config: Record<string, unknown>): NurtureApprovalGate | null;
export const NURTURE_APPROVAL_GATE_CONFIG_KEY = "approvalGate";
```

Rules: a surface is `operator_choice` only when `floor === "capability"`, `mandate !== "assist_only"`, and `canReachPublishAdapter(publish)`. `mode` is `operator_choice` only if **at least one** surface in scope is `operator_choice`; otherwise `locked_explicit` with the dominant reason (`assist_only_mandate` when any surface carries the mandate, else `no_publish_adapter`). With `platform === null` the scope is all `NURTURE_WRITING_SURFACES`. Static test pins: for `x`, `linkedin`, `facebook`, and `null` the mode is `locked_explicit / assist_only_mandate` at this commit, and every `*/direct_message` row is `explicit / explicit_floor` regardless of registry values.

### 2.2 Config, validation, persistence

- `ContactNurtureConfig` keeps `requireApproval: boolean`. `readContactNurtureConfig` is unchanged except it also returns nothing new — the gate is derived by callers from the acting platform, not stored on the template.
- **Dispatch validation** in `runTemplateViaRtx`, before `createWorkflowRun`, for `isContactNurtureTemplateConfig(mergedConfig)`: resolve the acting target (already done later in the function — hoist the lookup), compute `gate = resolveNurtureApprovalGate(actingTarget?.platform ?? null)`; if `gate.mode === "locked_explicit"` and `mergedConfig.requireApproval === false` → return `{ success: false, httpStatus: 422, errorCode: "approval_gate_locked", error: "<reason text>" }` with **no run row created**. Both `/activate` and `/run` already surface `result.errorCode` and `httpStatus`.
- **Server-owned stamp:** on success, `runtimeConfig.approvalGate = gate` (strip any caller-supplied `approvalGate` first, like the composition scope) so the run row is assertable. `readNurtureApprovalGate(run.config)` is the read side.
- **Seed migration** (`src/lib/db/seed-templates.ts`, existing `CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME` branch): if the stored template config has `requireApproval === false`, rewrite to `true` and log one line naming the template id. Test: a template seeded with `false` reads back `true` after `seedTemplates`, sliders untouched.
- `buildContactNurtureTemplateConfig` default stays `requireApproval: true`.

### 2.3 Activation UI (`contact-nurture-fields.tsx`)

- Derive `gate = resolveNurtureApprovalGate(selectedTarget?.platform ?? null)` from `useActingTargets()` + `value.targetId`.
- Replace the block with an **Approval** control:
  - Label: **Require approval before anything is sent** (rename; "publishing" implied a path that does not exist).
  - `locked_explicit`: `<Switch checked disabled aria-describedby="nurture-approval-reason">`; helper text *"Locked: every nurture surface on {Platform} is draft-only. The agent drafts and audits; you approve each proposal in the thread or on the run page."* and a compact list of `gate.surfaces` rows: `x/reply · Draft only · approval required`, `x/direct_message · Draft only · always explicit`. The reducer forces `requireApproval: true` whenever the gate is locked (so the client never submits `false`).
  - `operator_choice` (unreachable today, must still render correctly under a mocked gate in the unit test): switch enabled; helper text names which surfaces will send without a second prompt and which stay explicit.
  - `data-testid="nurture-approval-gate"` with `data-mode` and `data-reason` attributes — the contract's UI probe reads these rather than parsing copy.
- Fix the `maxActionsPerRun` hint: "Maximum comments, spotlights, or DMs to **propose** in this run." (it says "execute").
- i18n: strings inline like the rest of the dialog (this app does not route dashboard copy through i18next).

### 2.4 Run-anchored proposals read model

New `src/lib/writing/workflow-run-proposals.ts`:

```ts
export interface WorkflowRunProposal {
  variantId: string; launchId: string; launchName: string;
  platform: Platform; surface: SurfaceId; contentType: "reply" | "dm" | "post" | "thread";
  recipient: { contactId: string; handle: string | null; name: string | null; href: string } | null;
  goal: { relationshipGoal: RelationshipGoal; writingGoal: WritingGoal } | null;
  body: string;                     // units joined with "\n\n"; the full draft, never truncated
  audit: { verdict: "pass" | "warn" | "block"; findings: Array<{ code; severity; message }> } | null;
  approval: { state; policy; riskTier; by?; at?; evidenceKind?: "thread_message" | "ui" | "api"; note?; revokedReason? };
  capability: { publish: PublishCapability };
  mandate: "assist_only" | null;
  materializedContentItemId: string | null;
  revisionRequest: { requestedAt: number; note: string } | null;
  variantStatus: Variant["status"];
  href: string;                     // /dashboard/launches/<launchId>/variants/<variantId>
}
export interface WorkflowRunProposalSummary {
  total: number; pendingReview: number; approved: number; materialized: number; rejected: number; blocked: number; revoked: number;
}
export function listWorkflowRunProposals(workflowRunId: string): { launches: Array<{ id; name; href }>; proposals: WorkflowRunProposal[]; summary: WorkflowRunProposalSummary };
export function summarizeWorkflowRunProposals(workflowRunId: string): WorkflowRunProposalSummary | null; // null when the run is not writing-composed
```

- Launch discovery: `select … from launches where json_extract(metadata, '$.writing.composition.workflowRunId') = ?` (SQLite JSON1; the table is small — no index in #413, note it as a follow-up trigger if `listWorkflowRuns` ever needs summaries for a page of runs).
- Variants: `listVariantsByLaunchId` filtered by `isWritingVariant`; parse `metadata.writing` with `variantWritingSchema.safeParse`; a variant that fails parsing is **listed as `invalid`** with the zod path, not dropped — the run page must not hide a proposal because it is malformed.
- Counting rules: `pendingReview` = `approval.state ∈ {pending, revoked}` and `audit.verdict !== "block"` and `variantStatus !== "rejected"` (a revision-requested proposal stays pending); `blocked` = `verdict === "block"`; `materialized` = `materializedContentItemId` set; `approved` = approved but not materialized (transient); `rejected` = `variantStatus === "rejected"` or `approval.state === "rejected"`.
- Recipient names resolve through `getContactsByIds` in one query. Proposals are **not** folded into `workflow-run-subjects` (those are config/step-derived contacts); the anchor differs.

### 2.5 API

| Route | Behaviour |
|---|---|
| `GET /api/workflows/[id]/proposals` | `listWorkflowRunProposals`. 404 when the run is missing; `{ launches: [], proposals: [], summary: null }` when the run is not writing-composed. |
| `GET /api/workflows/[id]`, `GET /api/workflows/[id]/progress` | add `proposalSummary` (nullable). `useWorkflowPolling` already re-renders from `/progress`. |
| `POST /api/variants/[id]/materialize` | body `{ route: string; note?: string }`; `route` must match `^/dashboard/(workflows|launches)/[A-Za-z0-9_-]+` else 400. Calls `materializeVariant({ variantId, approval: { by: "user", evidence: { kind: "ui", route }, note } })`. Returns `{ contentItemId, created, updated, nextAction, capability, proposal }` (refreshed DTO). Errors: `toErrorResponse` has no `AgentToolError` branch today — add one that reuses the status map in `src/app/api/agent-tools/invoke/route.ts` (404 `NOT_FOUND`; 400 `VALIDATION_ERROR`/`CAPABILITY_UNSUPPORTED`/`TARGET_REQUIRED`; 409 `CONFLICT`/`AUDIT_STALE`/`AUDIT_BLOCKED`/`APPROVAL_REQUIRED`; 503 `STORE_BUSY`/`WORKSPACE_UNAVAILABLE`), extracted to one shared `agentToolErrorStatus(code)` so the two routes cannot drift; `code` and `details.reason` pass through. |
| `POST /api/variants/[id]/reject` | body `{ route; note? }`. New `rejectWritingProposal(variantId, { evidence, note })` in `variant-writing.ts`: allowed from `pending`/`revoked`/`approved-not-materialized`; sets `approval = { schemaVersion: 1, state: "rejected", by: "user", at, evidence, note, policy, riskTier, auditId }` and `variants.status = "rejected"`; `CONFLICT` when materialized or in the publish lane. Returns `{ proposal }`. |
| `POST /api/variants/[id]/request-revision` | body `{ route; note: string (1..2000) }`. Persists server-owned `metadata.writing.revisionRequest = { schemaVersion: 1, requestedAt, note, evidence: { kind: "ui", route } }` (optional key added to `variantWritingSchema`; stripped from `variantWritingInputSchema` so agents cannot set it; carried over by `persistWritingVariant` when the body is unchanged, cleared when a new body lands). Returns `{ proposal, thread: { workspaceSlug, threadSlug, threadPath } | null }` from `getRtxRefsFromRunConfig(run.config)` of the anchoring run; the client then calls the existing `open-thread` route. No LLM call in Signals. |

All three write routes are dashboard-local like the rest of `src/app/api` (no new auth surface); they call use-cases, never repositories directly.

### 2.6 Run page

- New client component `src/app/dashboard/workflows/[id]/workflow-run-proposals.tsx`, rendered by `WorkflowRunLive` when `proposalSummary !== null`. Fetches `/api/workflows/[id]/proposals` on mount, after every action, and on each polling tick while the run is running; a manual **Refresh** control after completion (thread approvals can land later).
- Section title **Proposals** with the summary strip: `3 total · 1 awaiting review · 1 materialized · 1 rejected`. Empty state for a composed run with no variants: *"No proposals were created. Open the thread for the agent's report."* + open-thread button.
- Card (one per proposal): recipient (link to contact) + surface chip (`X reply`, `LinkedIn DM`…), full body in a `<pre>`-like block, audit verdict chip + findings list (severity, code, message), approval chip (`Awaiting review`, `Approved`, `Materialized · export only`, `Rejected`, `Revoked · <reason>`, `Blocked by audit`, `Revision requested`), capability chip (`Draft only` / `Beta` / `Direct`), links **Open variant** (`href`) and **Open content** (when materialized → `/dashboard/content/<id>`).
- Actions when `pendingReview`-eligible: **Approve & materialize**, **Request revision** (note dialog), **Reject** (note optional). Buttons are disabled while a request is in flight; errors render the server `details.reason` text inline (`Audit is stale — ask the agent to re-audit`), never retry automatically. No **Send/Publish** action on a proposal card in #413 (materialized draft-only content shows the export affordance the content page already has).
- Header badge (`workflow-run-live.tsx`): when `proposalSummary.pendingReview > 0` render `{Status} · {N} awaiting review` with `data-testid="workflow-run-status"` and `data-pending-review={N}`.
- Workflow list card chip (`workflow-run-card.tsx`) `N awaiting review` is **optional (P2)**; it needs `listWorkflowRuns` to carry summaries and is not required by the acceptance list.

### 2.7 Brief text (`contact-relationship-nurture.ts`)

- N0 gains: `Approval gate: ${gate.mode} (${gate.reason})` read from `readNurtureApprovalGate(config)`; falls back to `locked_explicit / assist_only_mandate` when absent (older runs).
- N5 becomes one branch-free step: present proposals in batches of 3–5 and wait for explicit approval; *"Approvals, rejections, and revision requests may also be made on the Signals run page (`/dashboard/workflows/<runId>`). Before `materialize_variant` and before `complete_workflow_run`, re-read each variant through `get_writing_context` (`variants[]` carries approval, materialization, and `revisionRequest`) and act on its persisted state: skip materialized ones, do not re-present rejected ones, and produce a revision for any `revisionRequest` before asking again. Never manufacture approval evidence."*
- Tests in `contact-relationship-nurture.test.ts` that assert the old `requireApproval: false` wording are updated: the brief must contain neither "Toggle off" nor "still required" branching, and must contain the run-page sentence for both config values.

---

## 3. Experience Contract pilot (harness)

### 3.1 Files

```
scripts/app-automation/
  flows/experience-contract.mjs            defineContract, validateContract, createCheckpointLedger, buildManifest, CONTRACT_KINDS, EVIDENCE_PROFILES
  flows/experience-contract.test.mjs       shape validation, ledger failure modes, manifest determinism
  flows/run-experience-contract.mjs        CLI runner (side-effect free on import; argv[1] guard)
  flows/run-experience-contract.test.mjs   arg parsing, exit codes, manifest writing with a fake scenario
  scenarios/issue-413-review-path.contract.mjs
  scenarios/issue-413-review-path.mjs
  scenarios/issue-413-capability-path.contract.mjs
  scenarios/issue-413-capability-path.mjs
  scenarios/issue-413-autonomous-path.contract.mjs
  scenarios/issue-413-autonomous-path.mjs  (guard)
  scenarios/contracts.test.mjs             imports every *.contract.mjs, validates, asserts unique ids across contracts
scripts/seed-experience-fixture.ts         vite-node entry: --fixture nurture-proposals [--json]
src/lib/db/seed-fixtures/nurture-proposals.ts (+ .test.ts)
```

`package.json`: `"automation:contract": "node scripts/app-automation/flows/run-experience-contract.mjs"`, `"seed:fixture": "vite-node --config vitest.config.ts scripts/seed-experience-fixture.ts"`. `.gitignore`: `.evidence/experience/`.

### 3.2 Contract shape

```js
// scenarios/issue-413-review-path.contract.mjs
import { defineContract } from "../flows/experience-contract.mjs";
export default defineContract({
  id: "issue-413-review-path",
  issue: 413,
  kind: "review",                                   // "path" | "review" | "negative"
  reachability: { status: "reachable" },            // or { status: "blocked", by, unblockedBy }
  fixture: "nurture-proposals",
  evidence: { profile: "visual", gtm: false },      // "assertions" | "visual"
  promise: "A completed nurture run shows every proposal it created, says how many still need me, and lets me approve, revise, or reject each one here — and what I decide is what Signals persists.",
  checkpoints: [
    {
      id: "run-header-awaiting-review",
      ui: "status badge reads 'Completed · 3 awaiting review'",
      data: "GET /api/workflows/:id proposalSummary.pendingReview === 3 === fixture.variantIds.length",
      capture: "workflow-run-proposals",            // visual profile: required capture name
      never: ["header reads only 'Completed'", "any 'published' wording on the page"],
      assert: ({ ui, data }) => { /* return { ok, detail } or throw */ },
    },
    // …
  ],
});
```

`defineContract` validates synchronously and throws on: unknown `kind`, missing `promise`, duplicate or non-kebab checkpoint ids, a checkpoint without `assert`, a `visual` profile checkpoint whose `capture` name is not unique, a `blocked` reachability without `by` and `unblockedBy`. It returns a frozen object with `sha256` of the canonical JSON (functions replaced by their source text) so the manifest can pin the contract content.

### 3.3 Ledger and runner semantics

- Scenario module default export: `async function run(ctx)`; `ctx = { origin, page, api(path, init), record(id, { ui, data }), capture(name), fixture, log }`.
- `record(id, payload)` throws immediately on an undeclared id or a duplicate; it runs the checkpoint's `assert` and stores `{ ok, detail }`. In the `visual` profile a checkpoint with `capture` must call `ctx.capture(name)` before `record`, or the ledger marks it `evidence_missing`.
- `finalize()` marks declared-but-unrecorded checkpoints `missing`; the run is `failed` if any checkpoint is not `passed` — except a `blocked` contract, whose guard scenario records each checkpoint as `blocked` and whose run result is `blocked`. Exit codes: `0` passed, `1` failed, `2` blocked, `3` target/fixture not ready (`resolveSignalsTarget` code echoed).
- Runner flow: parse args → `resolveCaptureOrigin` (reuse) → `git rev-parse HEAD` + `git status --porcelain` (dirty flag) → import contract + sibling scenario → (optional) run fixture via `npm run seed:fixture -- --fixture <name> --json` with `SIGNALS_DATA_DIR` from `--data-dir` or the QA receipt (`signals-qa-local-app-issue-413.json`) → Playwright (`chromium.launch()` against `origin`, same as `capture-guide-assets`; `--cdp` to connect over the Dev app instead) → `hideDevOverlay`, `waitForVisualSettle` before every capture → write manifest → exit.
- `capture(name)` writes `<out>/<name>.png` (1440x900 light) in the `visual` profile; `--promote-evidence` additionally writes the four `after_<name>_<form>_<theme>.png` cells through `evidenceFileName`/`FORM_FACTORS`/`THEMES` into `.evidence/` for the PR.

### 3.4 Manifest (`manifest.json`, schema 1)

```json
{
  "schemaVersion": 1,
  "contract": { "id": "issue-413-review-path", "issue": 413, "kind": "review", "path": "scripts/app-automation/scenarios/issue-413-review-path.contract.mjs", "sha256": "…" },
  "commit": { "sha": "…", "dirty": false },
  "target": { "origin": "http://127.0.0.1:3010", "source": "base-url", "healthApp": "signals" },
  "profile": "visual",
  "fixture": { "name": "nurture-proposals", "workflowRunId": "…", "launchIds": ["…"], "variantIds": ["…", "…", "…"] },
  "startedAt": "2026-09-02T…Z", "finishedAt": "…",
  "result": "passed",
  "checkpoints": [
    { "id": "run-header-awaiting-review", "status": "passed", "assertion": { "ok": true, "detail": "ui=3 api=3 fixture=3" }, "evidence": ["workflow-run-proposals.png"] }
  ],
  "failures": []
}
```

`status ∈ passed | failed | missing | undeclared | evidence_missing | blocked`. The PR description links the manifest path and pastes the `checkpoints` table; nothing under `.evidence/experience/` is committed.

### 3.5 Fixture `nurture-proposals` (ADR-413-12)

Preconditions (checked first, reported together as `fixture_precondition_unmet` with the exact remedy for each): `SIGNALS_DATA_DIR` set and non-default (`demo-seed-guard`); an active Personality binding readable through the same guard the product uses; at least one active X acting target with a representation compatible with that binding; ≥3 contacts with relationship goals `follow_back`, `mutual_engagement`, `warm_conversation` (created by the fixture when absent, tagged `fixture:nurture-proposals`).

Steps (all through use-cases): `createWorkflowRun` (`workflowType: "agent"`, `status: "completed"`, config = `buildContactNurtureRunConfig({ targetId, requireApproval: true, … })` + `templateName` + `approvalGate` via `resolveNurtureApprovalGate("x")` + `rtx` refs pointing at a placeholder thread) → `mintWritingScopeToken(run.id)` and persist the hash exactly as dispatch does → `invokeAgentTool("upsert_launch", { name: "Contact Relationship Nurture - Run <id>", writingScopeToken, writing: { goal, surfaces, sources, spine, approvalPolicy: "explicit" } })` → three `upsert_variant` calls (`x/reply`, `x/reply`, `x/direct_message`) each with a valid `metadata.writing.intent`, `personality: { bindingId }`, a `pass` audit (one with a `warn` finding), `generationMetadata.agent.workflowRunId = run.id` → output `{ workflowRunId, launchId, variantIds, contactIds }` as JSON. Idempotent per `--label` (default `issue-413`): re-running removes the previous fixture run/launch/variants first. The `.test.ts` runs it against the fake host from `src/test/personality-writing-fixture.ts` and asserts `listWorkflowRunProposals` returns three pending proposals and that `materializeVariant` with `{ kind: "ui" }` evidence succeeds for the `x/reply` one.

### 3.6 The three #413 contracts

Checkpoint ids are the contract. Assertions name the authoritative source; the UI probe reads `data-testid` attributes and visible text.

**`issue-413-capability-path`** (kind `negative`, reachable, profile `visual`)

| id | UI | Authoritative data | never |
|---|---|---|---|
| `activation-gate-locked` | `[data-testid=nurture-approval-gate]` has `data-mode=locked_explicit`, `data-reason=assist_only_mandate`; switch is checked + disabled; six/two surface rows for the selected X target show `Draft only`; DM row says `always explicit` | `resolveNurtureApprovalGate("x")` re-derived by the bridge test; template config via `GET /api/workflows/templates/:id` has `requireApproval: true` | an enabled switch; the words "autonomous" or "publish" as a promise |
| `run-config-rejects-off` | — | `POST /api/workflows/templates/:id/run { config: { requireApproval: false, targetId } }` → 422 `errorCode: "approval_gate_locked"`; `GET /api/workflows?templateId=` count unchanged | a run row created; a 201 |
| `composition-pinned` | — | fixture run config: `writingIntent.mandate === "assist_only"`, `approvalPolicy === "explicit"`, `approvalGate.mode === "locked_explicit"`; launch `metadata.writing.composition.mandate === "assist_only"` | `approvalPolicy` other than `explicit` |
| `variants-draft-only` | each proposal card shows the `Draft only` chip | every proposal `capability.publish === "draft_only"`, `approval.policy === "explicit"`, `mandate === "assist_only"` | a `Send`/`Publish` action on a card |
| `materialized-is-export-only` | after approving one proposal the card reads `Materialized · export only` | materialize response `nextAction === "export"`; `GET /api/content/:id` status `approved`, `contentType: "reply"`; `POST /api/content/send-to-agent` for that item is refused (assist-only intent) | a publish job for the item (`GET /api/content/publish-jobs?contentItemId=`) |

**`issue-413-review-path`** (kind `review`, reachable, profile `visual`)

| id | UI | Authoritative data | never |
|---|---|---|---|
| `run-header-awaiting-review` | `[data-testid=workflow-run-status]` text `Completed · 3 awaiting review`, `data-pending-review=3` | `GET /api/workflows/:id .proposalSummary.pendingReview === 3` and `=== fixture.variantIds.length` | header reads only `Completed` |
| `proposals-listed` | three cards; per card recipient name, surface chip, full body text, audit verdict, `Awaiting review`, `Draft only`, **Open variant** href | `GET /api/workflows/:id/proposals` ids equal the fixture set; card body text equals `proposal.body` byte-for-byte; href equals `proposal.href` | a card missing from the page while present in the API (or vice versa) |
| `approve-materializes` | click **Approve & materialize** on proposal 1 → card `Materialized · export only` + **Open content** link; header `2 awaiting review` | `GET /api/variants/:id` `metadata.writing.approval` = `{ state: "approved", by: "user", evidence: { kind: "ui", route: "/dashboard/workflows/<runId>" } }`, `materializedContentItemId` set; content item exists | approval `by: "policy"`; `evidence.kind !== "ui"` |
| `reject-persists` | **Reject** proposal 2 with note → card `Rejected`; header `1 awaiting review` | `approval.state === "rejected"`, `by: "user"`, `evidence.kind === "ui"`, `note` persisted; `variant.status === "rejected"` | the proposal still counted as pending |
| `revise-requests` | **Request revision** on proposal 3 with note → card `Revision requested`; header still `1 awaiting review`; response `thread.threadPath` present | `metadata.writing.revisionRequest.note` persisted with `evidence.kind === "ui"`; `approval.state` still `pending` | approval state changed by a revision request |
| `launch-roundtrip` | `/dashboard/launches/<launchId>` lists the same three variants with the same statuses | `GET /api/launches/:id` variants ids equal the proposal ids | a variant visible on one page and absent on the other |
| `thread-approval-idempotent` | — | after the UI approval, `POST /api/agent-tools/invoke materialize_variant` with `thread_message` evidence for proposal 1 returns `created: false` and the stored approval still carries `evidence.kind === "ui"` | evidence overwritten |

**`issue-413-autonomous-path`** (kind `path`, `reachability: { status: "blocked", by: "assist_only_mandate", unblockedBy: "ADR widening WRITING_INTENT_MANDATES + a reply publish adapter + operator sign-off (#377 D12)" }`, profile `visual`)

Declared checkpoints (the future spec): `activation-operator-choice` (switch enabled for a publish-capable low-risk surface, DM rows still `always explicit`), `run-config-off-honored` (`requireApproval: false` persisted with `approvalGate.mode === "operator_choice"`), `composition-autonomous` (composition mandate per the future ADR), `published-result` (variant materialized, publish job `completed`, run page shows `Published` with the platform URL, never `awaiting review`), `dm-still-explicit` (a DM proposal in the same run is `Awaiting review`).

Guard scenario: for every active acting target platform, `POST …/run { requireApproval: false }` must return 422 `approval_gate_locked`; asserts `GET /api/workflows/templates/:id` shows `requireApproval: true`; records each declared checkpoint as `blocked` with `reason: "assist_only_mandate"`; manifest `result: "blocked"`. The bridge test (`src/lib/workflows/nurture-approval-gate.test.ts`) imports this contract and asserts `reachability.by === WRITING_INTENT_MANDATES[0] + "_mandate"` and that `PUBLISH_CAPABLE_PLATFORMS ∩ nurture operator-choice surfaces` is empty. If a later change widens the mandate or adds a reply adapter, that test fails and the contract must be rewritten as reachable — the intended tripwire.

---

## 4. Tests (all part of `npm run check` unless marked live)

- `nurture-approval-gate.test.ts`: matrix pins (§2.1), DM floor, mocked-registry `operator_choice` case, `readNurtureApprovalGate` round trip; bridge assertions against the three `.contract.mjs` files (vitest imports `.mjs` ESM).
- `run-template-via-rtx.test.ts`: `requireApproval: false` + locked gate → 422 and **no** `createWorkflowRun` call; caller-supplied `approvalGate` stripped; persisted `approvalGate` equals the derivation.
- `seed-templates.test.ts`: stale `false` rewritten once, sliders preserved.
- `contact-nurture-fields.test.ts`: locked render (checked+disabled, reason, rows, reducer forces `true`), operator-choice render under a mocked gate, hint copy.
- `workflow-run-proposals.test.ts`: discovery by composition only (a launch naming the run in `writing.runs` without a stamped composition is **not** returned), counting rules, invalid-variant surfaced as `invalid`, recipient resolution.
- Route tests: `proposals` GET, `materialize` (evidence shape, route regex, error mapping), `reject` (states, CONFLICT after materialize), `request-revision` (server-owned field, stripped from agent input, cleared on new body, carried over on unchanged body).
- `materialize.test.ts`: UI approval then agent `materialize_variant` with `thread_message` evidence → `created: false`, evidence unchanged.
- `contact-relationship-nurture.test.ts`: brief no longer branches; run-page sentence present.
- `experience-contract.test.mjs`, `run-experience-contract.test.mjs`, `scenarios/contracts.test.mjs` under `automation:test`.
- **Live (not CI):** the three scenarios against `Signals issue-413 QA` in the RealTimeX Dev app; manifests linked from the PR; teardown + hygiene verifier per AGENTS.md §10.

---

## 5. Sequencing and PR shape

Single branch `issue-413`, two stacked PRs so Review can approve the harness independently:

1. **PR A — harness + contracts (no product change).** `flows/experience-contract.mjs`, runner, tests, the three `.contract.mjs` files, the three scenario files (review/capability scenarios fail at their first checkpoint against `main`, which is the point; the guard scenario passes as `blocked`), `.gitignore`, package scripts, README section "Experience Contracts" (directory model row for `scenarios/`, the ledger rules, manifest schema, and the #301 bar restated: no contract may be added without a scenario that runs it).
2. **PR B — product fix + fixture + green scenarios.** §2 in the order 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 → 2.7, then §3.5, then run all three contracts in the QA Local App, promote evidence stills, link manifests.

If Dev prefers one PR, keep the commit order the same; Review reads the contracts before the fix either way.

---

## 6. Explicitly out of scope (do not build here)

- Any publish/send adapter, `reply` publish job kind, mandate widening, `auto_low_risk` for nurture, or changes to `WRITING_SURFACE_CAPABILITIES` / `PUBLISH_PLATFORM_TARGETS`.
- Agent-tool additions (`reject_variant`, `request_variant_revision`), OpenAPI regeneration, DDL/migrations, JSON indexes.
- GTM derivative: captions, music, H.264 conversion, tour changes, a music-library manifest.
- A YAML/markdown contract parser, DB access from `scripts/app-automation`, CI gating of live scenarios, a generic "scenario framework" beyond the ledger + runner.
- Rewriting proposals inside Signals (revision stays agent work through the writing pipeline).
- Workflow-list "awaiting review" chips (P2; needs list-query summaries).

---

## 7. Open items left to Dev discretion (defaults stated)

| Item | Default |
|---|---|
| Where `resolveNurtureApprovalGate` is called client-side | Directly in `contact-nurture-fields.tsx`; the module imports only `capabilities.ts` and `writing-intent.ts` constants (both dependency-free). If bundling drags in server code, expose `GET /api/writing/approval-gate?consumer=contact_relationship_nurture&platform=x` instead and keep the pure module for tests. |
| `revisionRequest` visibility to the agent | Returned by `get_writing_context.variants[]`/variant reads as part of `metadata.writing` (it is already passthrough); no new tool field. |
| Materialize route body vs Referer | Explicit `route` in the body (testable, no header trust). |
| Runner browser mode | `chromium.launch()` against the resolved origin (matches `capture-guide-assets`); `--cdp` connects to the Dev app page for the capability contract's activation dialog only if the launched browser cannot reach the Local App origin. |
| Fixture contacts | Created by the fixture when missing, tagged; removed on re-run; never removed by teardown of the Local App (the data dir is disposable). |
| Before-state stills for AGENTS.md §10 | Run the capability contract's `activation-gate-locked` capture on `main` with `--promote-evidence --prefix before` for the activation view only; other views are new and have no before state. |
| Pending count while `running` | Shown; approval during a run is allowed and idempotent. |
