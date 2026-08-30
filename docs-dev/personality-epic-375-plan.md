# Signals #375 — System Design handoff: milestone plan for the Personality epic

**Loop:** `loop-issue-375-5a77c4d7` · **Role:** System Design → Dev · **Status:** approved (design complete; Dev may start M1)
**Date:** 2026-08-30 · **Base:** `origin/main@b81c73c` (PR #374 merged) · **Worktree:** `realtimex-dev/worktrees/loop-issue-375-5a77c4d7`, branch `issue-375` (local only, clean)
**Design authority (unchanged, not re-litigated here):** Signals #373, PR #374 → `specs/personality-projection.md` (ADR-373-1..10, X/W/C/D/E/S tests), `specs/signals-writing-system.md` (amended D5 / ADR-347-4, §5.4–5.6, G5, §5.9).
**Host prerequisite G:** realtimex-ai-app #1729 / MR !1782, merged at `6dbf8b5a23e790fc2d272fd49f229989a29de996` on `origin/realtimex-dev` (package `1.8.4`); contract doc `docs/local-apps/personality-writer.md`, design `docs/local-apps/personality-writer-design.md` (ADR-1729-1..8).

This document decomposes the epic into six dependency-ordered milestones mapped 1:1 onto the child issues that already exist (#376 A, #378 B, #379 C, #377 F, #380 D, #381 E), records the decisions the spec left open or that the shipped host contract changed (ADR-375-1..12), and specifies the first Dev slice (M1 = #376) file by file. Nothing here enables autonomous or scheduled posting, replies, comments, reactions, following, or browser access; §7 lists the guards that must stay true in every milestone.

---

## 0. Verdict at a glance

| Question from the Dev handoff | Answer |
|---|---|
| Already-landed Personality work in Signals? | **None.** Audit of `src/ test/ scripts/ realtimex-plugin/ .claude/ openapi/ docs/` finds zero `personality`/`pb_`/`prp_`/`PRESENCE_MANDATE`/`Rendered*Input` symbols; only incidental prose hits (`template-brief.ts:167`, `runtime-sessions.ts:791`) and `core/voice.md` filename matches. Every foundation the spec assumes exists at the cited path (§1.2). |
| Host G shape vs spec §5.4 sketch | Differs in 6 places (transaction id in URL path, hash-listing endpoint, capability probe, response envelope, error catalog, recovery route). §2 is the normative mapping for B; the spec's sketch is superseded by it. |
| Milestones | M1 #376 → M2 #378 → M3 #379 ∥ M4 #377 → M5 #380 ∥ M6 #381 (M5+M6 released together). One loop per milestone; this loop delivers M1. |
| First Dev slice | M1: `src/lib/personality/{contracts,sources,render,snapshot,statements}.ts`, `src/lib/store/locked-json-store.ts` (extracted from the voice store), voice-fallback removal + `unclaimed_only`, `upsert_personality_statements`, REST `/api/personality/{statements,sources,represented-org}`, config key `personalityProjection.representedOrgId`, id prefixes `prp|pb|pm`. No workspace file is read or written. Proof: X1–X7 + X8 + voice regression + `npm run check`. |
| Can Apply be QA'd on this machine? | Not against the installed desktop (`1.1.554-dev`, no `workspace.personality.transactions` bundle). M2 QA needs a dev RealTimeX built from `realtimex-dev` ≥ `6dbf8b5` (rtx-test-runner) or the contract fake in §3.2; both are required gates. |

---

## 1. Inputs and audit

### 1.1 Requirements restated as milestone-level gates

From #375 acceptance criteria, each row names the milestone whose proof gate owns it:

| Epic AC | Owner | Proof |
|---|---|---|
| Only self / explicitly-represented self-owned org / same-owner approved voice / user statements can enter managed content; sentinels never cross adapter or renderer | M1 | X1, X2, X3, X4, X5, X7 |
| Same inputs → byte-identical blocks/hashes across processes; proposals show exact immutable final bytes | M1 (blocks), M2 (files) | X6, X8, W1, W10 |
| UI and SDK writes share revision validation and one coordinator; no silent loss | G (done, host T1–T14/G1) | B consumes only the SDK transaction; no fallback (M2 H-tests) |
| Apply/rollback/unbind/compensation/crash recovery/terminal-attempt retry preserve unmanaged bytes and marker provenance | M2 | W1, W3, W6, W7 |
| Exact workspace slug/id/realpath + represented identity checked before every apply | M2 | W5 + H2 |
| Manual managed/unmanaged edits invalidate bound artifacts until an approved new projection | M2 (status), M3 (gates) | W8, C3 |
| Source changes invalidate older audits/approvals; continuing requires warned re-audit + fresh approval | M3 | C7 |
| Multiple accounts/targets cannot silently share an incompatible identity; unknown/legacy targets stay unbound | M3 | C6 |
| Legacy writing artifacts retain pre-Personality hashes/migration behavior | M3 | C1, L1 (frozen-hash test) |
| Studio/Settings, skill, materialization, publish gate, attribution expose one contract | M3, M5, M6 | C4, D1, E1 |
| Static + integration tests prove no autonomous external-action path | M3, M4 | S1, C5, P1 (frozen publish-caller set) |
| Backup, migration, capability/version, operator recovery, workspace-binding docs | M1 (backup), M2 (all), M5 (skill) | doc checklist per milestone |

### 1.2 What exists on `main@b81c73c` (reuse, do not reimplement)

| Capability | Where | Used by |
|---|---|---|
| Canonical JSON + sha256 (`sha256(string \| Buffer)`, `sha256Canonical`, `computeAuditInputHash` with the 12-field list) | `src/lib/writing/hash.ts:16–50` | every hash in M1–M3; raw-byte file hashing in M2 |
| Locked, immutable, generation-checked file store (O_EXCL `.store.lock` with pid liveness, `installImmutable` hard-link install, `commitIndex` CAS on `generation` + canonical hash, in-process mutex, `resetWritingStore`) | `src/lib/writing/voice-profile-store.ts:60–200, 434` | extracted in M1 to `src/lib/store/locked-json-store.ts` (ADR-375-4) |
| Writing contracts (`variantWritingSchema`, `writingAuditSchema`, `approvalStateSchema` with `revokedReason` enum, `approvalEvidenceSchema` `thread_message\|ui\|api`) — all `.passthrough()` | `src/lib/writing/contracts.ts:15–146` | M3 extends additively |
| Materialization sequence (12 steps) and G5 gate | `src/lib/writing/materialize.ts:79–157`, `publish-gate.ts:30–91` | M3 inserts the Personality gate as step 2a / gate check |
| Revocation primitives (`revokeVariantApproval`, `revokeVariantsForSpineChange`) | `src/lib/writing/variant-writing.ts:321–340` | M3 adds `revokeVariantsForPersonalityChange` beside them |
| Attribution key | `src/lib/writing/attribution-key.ts:5–80` | M3 adds `personalityBindingId` |
| Agent-tool registry, error codes and HTTP mapping | `src/lib/agent-tools/registry.ts:189`, `types.ts:22–34`, `src/app/api/agent-tools/invoke/route.ts:49–64` | new tools per milestone; `WORKSPACE_UNAVAILABLE` (503) in M2 |
| `get_writing_context` voice block (`resolveContextVoice`, statuses `pinned\|pinned_superseded\|missing\|active\|ambiguous\|none`) | `src/lib/agent-tools/content-item-handlers.ts:652–673, 757–786` | M1 adds `unclaimed_only`; M3 adds `personality`, `mandate` (M4), `targets[].represents` |
| Represented identity: `getOwnerContactId()` (single `isSelf` row), `orgs.ownerContactId` FK | `src/lib/db/queries/contacts.ts:532–540`, `src/lib/db/schema.ts:891` | M1 A1/A2 |
| ARPP public-mode projection (employment/identity selection, `contact_personas` structurally unreachable, negative-leak test precedent) | `src/lib/arpp/project-contact.ts:157`, `project-contact.test.ts:106` | M1 identity adapter reuses the same selection helpers |
| RTX host client (`x-app-id` headers, `/cli/*` + `/sdk/*` requests, `registerWithRtx` with `RTX_SDK_PERMISSIONS` from `rtx-manifest.json`) | `src/lib/rtx/{sdk,cli-provisioning,manifest,env}.ts` | M2 host client |
| Workspace resolution: `getSignalsRtxWorkspaceSlug(env)` (default `"signals"`), `resolveRtxStorageDir`, `resolveRtxWorkspaceWorkingDir` | `cli-provisioning.ts:61–63`, `storage-path.ts:33–44` | M2 workspace guard; the dispatch/projection resolver invariant |
| EOL detection precedent | `src/lib/rtx/heartbeat-task-block.ts:44 detectEol` | M2 block placement |
| Config scalars | `src/lib/settings/signals-config.ts:5–30` (`readSignalsConfig`/`updateSignalsConfig`) | M1 `personalityProjection` |
| Settings tab registry + card pattern | `src/app/dashboard/settings/settings-tabs.ts:1`, `persona-generation-mode-card.tsx` | M6 |
| Skill validator with frozen catalogs and "Never do" token enforcement; reference example tag list | `scripts/verify-signals-writing-skill.mjs:39–179` | M5 |
| Plugin template (`AGENTS.md` only, `managedPaths: ["AGENTS.md"]`, no `CLAUDE.md`) | `realtimex-plugin/templates/signals/AGENTS.md`, `realtimex.plugin.json` | M5 |
| Static-pin precedents (`PUBLISH_CAPABLE_PLATFORMS === PUBLISH_PLATFORM_TARGETS`, ARPP negative-leak assertion) | `src/lib/writing/capabilities.test.ts`, `src/lib/publish/payload.ts:5` | S1/C5/P1 pattern |
| Test infra: per-worker `SIGNALS_DATA_DIR` (`src/test/setup-env.ts`), `contract` vitest project gated on `SIGNALS_CONTRACT_PROBES=1`, `npm run check` composition | `vitest.config.ts`, `package.json:42` | all milestones |

Known coupling: `test:qa-local-app` asserts the checkout basename ends with `signals` (`scripts/qa/test-signals-qa-local-app.mjs:140`); in this worktree (`loop-issue-375-5a77c4d7`) that single step fails as it did for #374. Run it from the canonical checkout for the PR evidence.

### 1.3 Facts that changed since the spec was written

1. **G shipped with a different SDK surface** than the §5.4 sketch (details §2). The spec's `PUT …/transactions` body-id form is superseded.
2. **`signals-writing` SKILL.md already carries `version: "1.0.0"`** (frontmatter, validator-enforced semver). The epic's "0.3.0" therefore cannot be the frontmatter version, and the spec's gate `generationMetadata.skill.version >= 0.3.0` would fire for today's skill. Resolved by ADR-375-9.
3. **Signals has no host capability probe** and no persisted permission state; `/sdk/register` results are not stored. Resolved by ADR-375-3.
4. **`sha256Canonical`/`canonicalJson` drop `undefined` but keep `null`** — this is exactly the property legacy-hash compatibility depends on (ADR-375-7).
5. Installed desktop on this machine is `1.1.554-dev` without G; `origin/realtimex-dev` HEAD is the G merge.

---

## 2. Host G contract as shipped (normative for M2)

Source: `docs/local-apps/personality-writer.md`, `server/endpoints/sdk/personalityTransactions.js`, `server/endpoints/sdk/capabilities.js`, `server/utils/personality/writer/{constants,errors}.js` at `6dbf8b5`.

### 2.1 Endpoints

| Purpose | Route | Auth |
|---|---|---|
| Capability probe | `GET /sdk/capabilities` → `{ success, apiVersion: 1, capabilities: { "workspace.personality.transactions": { version: 1, schemaVersions: [1], permission: "workspace.personality.write", granted: boolean, fileHash: "sha256-hex", maxFiles: 16, maxFileBytes: 1048576, allowlist: { pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}\\.md$", excluded: ["HEARTBEAT.md","MEMORY.md","CLAUDE.md"] } } } }` | `x-app-id` only |
| Read hashes (+content) | `GET /sdk/workspaces/:slug/personality-files?include=content` → `{ success, workspace: { id, slug, dir }, files: [{ path, fileHash, size, content? }], claudeShim: "symlink"\|"regular_file"\|"missing"\|"copy", allowlist }` (consistent snapshot under the writer lock) | `x-app-id` + `workspace.personality.write` |
| Commit | `PUT /sdk/workspaces/:slug/personality-files/transactions/:transactionId` body `{ schemaVersion: 1, workspaceId: string\|null, files: [{ path, expectedFileHash: sha256\|null, proposedFile: string\|null, proposedFileHash: sha256\|null }], claudeShim: { createIfAbsent: boolean } }` → `200 { success: true, transaction }` | same |
| Inspect | `GET …/transactions/:transactionId` → `{ success, transaction }`; unknown id → `transaction.status === "not_started"` | same |
| Recover | `POST …/transactions/:transactionId/recover` `{ mode: "restore" }` (SDK may not `discard`) | same |
| Workspace id/slug without permission | `GET /cli/get-workspace/:slug` (`validApiKey`, any registered `x-app-id`) | `x-app-id` |

`transactionId` must match `^[A-Za-z0-9:_.-]{8,200}$`; the spec's `personality:<workspaceKey>:<proposalId>:attempt:<n>` fits. Same id + same app + same request → replayed terminal result with header `X-RealTimeX-Transaction-Replayed: true`; same id with a different request/app → `409 TRANSACTION_REQUEST_MISMATCH` / `TRANSACTION_OWNER_MISMATCH`.

`transaction` object: `{ transactionId, status: "committed"|"restored_failure"|"recovery_required"|"not_started", origin: "sdk", appId, workspace: { id, slug, key }, requestHash, files: [{ path, fileHash }], shim: { requested, created, state, error? }, reason?, startedAt, finishedAt, replayed }`.

Error envelope: `{ success: false, code, error, ...details }`; `WRITER_BUSY` carries `Retry-After: 2`. Terminal failure envelopes carry the `transaction`.

### 2.2 Signals-side mapping (ADR-375-1)

| Host outcome | HTTP | Signals proposal record | Tool/REST error |
|---|---|---|---|
| `FILE_CHANGED` (pre-mutation, nothing journaled) | 409 | `stale`, `attempt: null` | `STORE_CONFLICT` / `file_changed` (409) |
| `committed` with path set + hashes equal to the immutable proposal | 200 | `applying → applied`, binding committed (spec §5.4 step 7) | success |
| `committed` but path/hash set differs from proposal | 200 | `apply_failed` / `host_verification_mismatch`, keep attempt terminal, call `POST …/recover {mode:"restore"}` once and record its result in `failure.hostRecovery` | `STORE_CONFLICT` / `host_verification_mismatch` |
| `TRANSACTION_RESTORED_FAILURE` | 500 | `apply_failed`, attempt terminal (`phase: "terminal"`), approval retained | `STORE_CONFLICT` / `restored_failure` |
| `TRANSACTION_RECOVERY_REQUIRED` or `WORKSPACE_RECOVERY_REQUIRED` | 500 / 409 | `apply_failed` with `failure.hostRecovery = { transactionId, status: "recovery_required" }`; **no new attempt** may be allocated while it exists; explicit retry re-inspects and, if still `recovery_required`, calls `recover {restore}` and reports; operator `discard` is host-side only (docs link) | `STORE_CONFLICT` / `recovery_required` |
| `WRITER_BUSY` | 503 | attempt stays nonterminal `submitted`; one wait of `Retry-After` then one resubmit of the same id; still busy → return | `STORE_BUSY` (503) |
| `WORKSPACE_NOT_FOUND`, `WORKSPACE_UNAVAILABLE`, network error before submit | 404 / 503 / — | `prepared` attempt retained (nothing sent) or `submitted` (unknown) → retry inspects `GET …/transactions/:id` first | `WORKSPACE_UNAVAILABLE` (503) |
| `WORKSPACE_MISMATCH`, `WORKSPACE_NOT_ELIGIBLE` | 409 / 403 | `stale` | `CONFLICT` / `workspace_mismatch` |
| `PERMISSION_REQUIRED`, `PERMISSION_DENIED`, capability `granted: false` or key missing | 403 | untouched (`approved` retained); Apply disabled | `CAPABILITY_UNSUPPORTED` / `host_capability_unavailable` (400) |
| `VALIDATION_ERROR`, `PATH_NOT_ALLOWED`, `TRANSACTION_*_MISMATCH` (impossible with an immutable proposal) | 400 / 409 | `apply_failed` / `proposal_corrupt` | `STORE_CONFLICT` / `proposal_corrupt` |

Spec deviations this table replaces (all in `specs/personality-projection.md` §5.4): transaction id moves from body to path; a hash-listing endpoint exists and is used for the apply-time workspace guard (ADR-375-2); `recovery_required` is host-owned and resolved through the host recover route; the spec's `STORE_CORRUPT` wording maps to `STORE_CONFLICT` + `reason` because ADR-373-9 adds only `WORKSPACE_UNAVAILABLE` to `AgentToolErrorCode`.

---

## 3. Milestones

Dependency graph (unchanged from the epic; G is done):

```
M1 #376 A ──► M2 #378 B ──► M3 #379 C ──► M5 #380 D ┐
                      └──► M4 #377 F        M6 #381 E ┘ release together
```

Loop mechanics: this loop (`loop-issue-375-5a77c4d7`, branch `issue-375`) delivers **M1** through Dev → Review → QA → done; the M1 PR closes #376 and references #375. Each later milestone is its own coding loop bootstrapped from its child issue (`rtx-loop.js start --issue-id 378 …`, fresh worktree from `main` after the previous PR merges), citing this document as design authority. M3 and M4 may run concurrently on separate branches; M5 and M6 may run concurrently but merge/release together.

### M1 — #376 Represented sources, deterministic renderer, statements (this loop)

Scope, files, tests: §5. Rollout boundary: read-only. User-visible behavior change: the cross-owner/null-owner voice fallback is gone (`get_writing_context.voice.status` may now report `unclaimed_only` or `none` where it used to return another owner's profile) — release note required. Backup docs gain `SIGNALS_DATA_DIR/personality/`.

### M2 — #378 Projection store, propose, approve/apply, rollback, unbind, retry, drift

Delivers `src/lib/personality/{store,workspace,diff,apply,host-client,status}.ts`, `src/lib/rtx/capabilities.ts`, tools `get_personality_binding`, `propose_personality_projection`, `approve_personality_projection`, `reject_personality_projection`, `retry_personality_projection`, `rollback_personality_projection`, `unbind_personality_projection`, REST `/api/personality/{binding,proposals,proposals/:id,proposals/:id/approve|reject,rollback,unbind,retry,host}`, `AgentToolErrorCode` + `WORKSPACE_UNAVAILABLE` (503), permission `workspace.personality.write` added to `rtx-manifest.json` and `realtimex-plugin/marketplace/local-app.manifest.json` (byte-identical lists), OpenAPI regen, docs (`docs/local-app.md` backup + operator recovery, `docs/agent-tools.md`, workspace-slug reconciliation note from spec §9.1).

Rules that bind M2 (in addition to spec §4–5):
- **No direct workspace writes anywhere.** `src/lib/personality/**` must not import `node:fs` write APIs (`writeFile*`, `rename*`, `link*`, `unlink*`, `rm*`, `mkdir*`) except through `src/lib/store/locked-json-store.ts` for `SIGNALS_DATA_DIR/personality/`; a static test pins this (H1). Reads of workspace files (`readFileSync`, `lstat`, `realpath`) are allowed and synchronous (ADR-375-5).
- Apply-time guard (ADR-375-2): `GET /sdk/workspaces/:slug/personality-files` → `workspace.{id,slug,dir}`; require `slug === proposal.workspace.slug`, `id === proposal.workspace.id` when recorded, `realpath(dir) === proposal.workspace.dir === realpath(resolveRtxWorkspaceWorkingDir(slug))`, dir inside `resolveRtxStorageDir()/working-data/` without symlink ancestor; and every listed `fileHash` for the five paths equals the proposal's `currentFileHash` (absent ↔ `null`). Any difference → `stale` before the PUT.
- Capability gate (ADR-375-3): probe at status time (cached ≤ 30 s, surfaced as `PersonalityStatus.host`) and **uncached immediately before every PUT**.
- Byte fidelity (ADR-375-6): a current file whose raw bytes do not round-trip through UTF-8 decode/encode is refused at proposal time (`VALIDATION_ERROR` / `file_not_utf8`); `currentFileHash = sha256(rawBytes)`, `proposedFileHash = sha256(Buffer.from(proposedFile, "utf8"))`; BOM and original EOL preserved in unmanaged regions; managed block body is LF internally and re-joined with the file's detected EOL.
- Host transaction id: `personality:<workspaceKey>:<proposalId>:attempt:<attemptNo>`; `workspaceId` in the body is the recorded id or `null`; `claudeShim.createIfAbsent = proposal.shim.createClaudeSymlink`; `AGENTS.md` is a legal SDK path (matches the allowlist), `CLAUDE.md` never appears in `files[]`.
- Recovery semantics per §2.2; `retry_personality_projection` is the only path that allocates attempt N+1 and only after re-reading all original CAS tokens from the host listing.
- `PersonalityProposalRecord` gains an additive `hostResult: { status, shim, replayed } | null` written at terminal states (spec §5.1 record shape otherwise unchanged).

Proof gate: W1–W10 (spec §10) + host-mapping tests **H1** (static: no fs write import in `src/lib/personality/**`), **H2** (listing mismatch on slug/id/dir/hash → `stale`, no PUT), **H3** (each row of §2.2 through an in-process `HostPersonalityWriter` fake that implements `docs/local-apps/personality-writer.md` verbatim, including replay header and `Retry-After`), **H4** (capability `granted:false`/missing key/unreachable → Apply refused with `CAPABILITY_UNSUPPORTED`, proposal untouched), **H5** (UTF-8 round-trip refusal + BOM/CRLF preservation), **H6** (`contract` project, `SIGNALS_CONTRACT_PROBES=1`: propose → approve → committed → rollback → unbind against a dev RealTimeX ≥ `6dbf8b5`, on a disposable workspace slug set by `SIGNALS_RTX_WORKSPACE_SLUG`). QA runs H6 through rtx-test-runner; Review may accept H1–H5 alone for merge only if H6 is recorded as a rollout blocker in the PR.

Rollout boundary: Apply is capability-gated; ship with Apply reachable only where the probe reports `version ≥ 1 && granted`. Dogfood on one disposable workspace (spec rollout step 2) before any announcement. Between M2 and M5 a plugin redeploy (`managedPaths: ["AGENTS.md"]`) can remove the dynamic `index` pointer → status `drifted: index_pointer_missing`; documented, fixed by M5's static template section.

### M3 — #379 Bind writing artifacts, targets, and publish gates

Delivers, in `src/lib/writing/`: `contracts.ts` (`personality` on `variantWritingSchema` and `writingAuditSchema`, `revokedReason` + `personality_stale|personality_source_stale`), `hash.ts` (`personality` joins the `computeAuditInputHash` field list), `variant-writing.ts` (`persistWritingVariant` resolves the active binding, requires `bindingId` equality → `CONFLICT/personality_binding_stale`, stamps `personalityHash`/`workspaceSlug`; audit acceptance stamps `audit.personality` and inserts `core/voice/personality-source-stale`; `revokeVariantsForPersonalityChange(workspaceSlug, newBindingId | null, reason)`), `materialize.ts` (step 2a per writing-spec "Materialization algorithm" step 3), `publish-gate.ts` (G5 Personality clause; `PersonalityStatus` supplied by the caller, computed synchronously before the transaction), `attribution-key.ts` (`personalityBindingId`), `src/lib/personality/targets.ts` (`TargetRepresentation`, `set_target_representation`, REST `/api/personality/targets`), `get_writing_context.personality` + `voice.status` + `targets[].represents`, `content-item-handlers.ts` `auditStale` flag. `personality_binding_required` enforcement keyed on `PERSONALITY_SKILL_MIN_VERSION` (ADR-375-9).

Proof gate: C1–C7, S1 (static grep over `src/lib/personality/**` and the new routes for `createPublishJob`, `send-to-agent`, `publish_jobs`, `runtime-sessions`, `browser-sessions` imports), **L1** (frozen legacy hash: a checked-in fixture variant without `personality` must hash to the constant recorded before the change; a second fixture with `personality: null` must differ), **P1** (frozen set of modules allowed to create publish jobs; any new importer fails), **C8** (race: apply/unbind revocation and `materialize_variant` interleaved in two transactions — the loser sees `AUDIT_STALE`, no queued item is touched), **C9** (idempotent `materialize_variant` return re-evaluates the Personality gate; a stale key cannot return the previously materialized item).

Rollout boundary: gates apply only to variants carrying a binding; legacy variants untouched; with skill `1.0.0` the `personality_binding_required` gate is dormant (ADR-375-9).

### M4 — #377 Presence mandate (dormant, assist-only)

Delivers `src/lib/personality/mandate.ts` (`PRESENCE_MANDATE_MODES = ["assist_only"] as const`, `mandateSchema` requiring `cadence: null`, `approvalPolicy: "explicit"`, actions ⊆ `draft|audit|propose_reply`, `workspaceKey` + identity equal to the active binding when one exists, else stored `dormant: true`), `mandates.json` in the M1/M2 store, tools `get_presence_mandate`, `upsert_presence_mandate`, `get_writing_context.mandate`, `PresenceLedgerEntry` type only (spec §7.3). Static test C5 pins the mode array by value and asserts `src/lib/personality/mandate.ts` imports nothing from `src/lib/publish/**`, `src/lib/rtx/runtime-sessions.ts`, `src/lib/rtx/browser-sessions.ts`, or any scheduler/cron module; runtime test: no mandate operation creates a `publish_jobs` or `workflow_runs` row. Depends on M2 for `workspace.ts` (key) only; may start once M2's `workspace.ts` is merged. Rollout: nothing user-visible.

### M5 — #380 `signals-writing` Personality-first release + plugin template

Delivers SKILL.md `version: 1.1.0` (ADR-375-9), Personality-first flow (read four files first; `get_personality_binding`/`get_writing_context.personality` status; pass only `bindingId`; proposal/approval/stale cards from persisted records; "Never do" gains `IDENTITY.md`/`SOUL.md`/`VOICE.md`/`BRAND.md` write tokens), `core/voice.md` reworded (evidence source), `core/approval.md` (Personality card), `reference.md` new example tags (`personality-status`, `personality-proposal`, `upsert-variant-personality`) added to the validator's required list, `realtimex-plugin/templates/signals/AGENTS.md` permanent "Personality" section (same one-liner as the `index` block), versions `0.2.3 → 0.2.4` in `package.json`, `realtimex.plugin.json`, `rtx-manifest.json`, packaging test entries. Proof: D1, R7/R8 green, `npm run test:writing-skill`, `test:plugin-package`, `verify:marketplace-versions`, and a fixture test that `generationMetadata.skill.version` from the packaged SKILL.md satisfies `PERSONALITY_SKILL_MIN_VERSION`.

### M6 — #381 Settings → Personality

Delivers tab `personality` in `VALID_SETTINGS_TABS`, `src/app/dashboard/settings/personality-*.tsx` cards over M1–M3 REST only (no client-side hash/diff/drift computation; workspace card is host-derived read-only: slug from `getSignalsRtxWorkspaceSlug`, id/dir/name from `/cli/get-workspace` + status), diff viewer rendering `files[].diff`/`driftDiff` with managed/unmanaged shading computed from persisted marker line ranges, Approve/Reject/Retry/Rollback/Unbind, statements editor, represented-org picker (`PUT /api/personality/represented-org`), unclaimed-voice claim action (calls `upsert_voice_profile` semantics via a REST wrapper added here), target representation table. Disabled states per #381. Proof: E1 + component tests for each state in #381, React Doctor, desktop/mobile light/dark evidence per repo convention, rtx-test-runner smoke against a dev RealTimeX with G.

Release: M5 and M6 ship together (epic rollout step 5).

---

## 4. Architecture decision records (ADR-375-*)

Decisions the spec delegated to implementation or that the shipped host changed. ADR-373-1..10 stand; nothing here reopens them.

### ADR-375-1 — Adopt the shipped RealTimeX SDK transaction contract; §2.2 is the outcome mapping
**Context:** Spec §5.4 sketched the SDK surface before G existed; G shipped with the transaction id in the path, a hash-listing endpoint, a capability probe, a typed error catalog, and host-owned recovery. **Decision:** M2 codes against `docs/local-apps/personality-writer.md` at `6dbf8b5`; the §2.2 table is normative for proposal-state transitions; `STORE_CORRUPT` wording maps to `STORE_CONFLICT` + `reason`. **Consequences:** no Signals repair of files ever; `recovery_required` blocks new attempts until the host journal is resolved; the spec's sketch is annotated as superseded in the M2 PR (one-line note in `specs/personality-projection.md` §5.4, no other spec edits).

### ADR-375-2 — Apply-time workspace guard uses the host listing, not only local resolution
**Context:** Spec §5.4 step 1 resolves id via `/cli/get-workspace` and dir locally. G's listing returns `{id, slug, dir}` and every current `fileHash` under the writer lock. **Decision:** status/proposal flows use `/cli/get-workspace` + local fs (permission-free); apply uses the SDK listing and requires host `dir` realpath = local realpath = proposal dir and host hashes = proposal CAS tokens before the PUT. **Consequences:** a wrong `STORAGE_DIR`, a different desktop user, or a stale token is caught before any host mutation; `FILE_CHANGED` becomes a second line of defense, not the first.

### ADR-375-3 — Capability probe module and permission declaration
**Context:** Signals has no host capability probe; permission results from `/sdk/register` are not persisted. **Decision:** `src/lib/rtx/capabilities.ts` exports `probeHostCapabilities(env, fetch)` → `{ personalityTransactions: { state: "available" | "not_granted" | "unsupported" | "unreachable", version, maxFiles, maxFileBytes } }`; `PersonalityStatus` gains additive `host: { capability: state, version: number | null }`; `workspace.personality.write` is appended to both permission lists in M2 so `registerWithRtx` requests it. Apply requires `state === "available"` from an uncached probe. Status never becomes `unavailable` because of the host (fs reads still work); only Apply is disabled. **Consequences:** the desktop shows a new permission prompt on the first M2 registration; docs state the minimum host build (`realtimex-dev` ≥ `6dbf8b5`; package `1.8.4`) and that the probe, not the version string, is authoritative.

### ADR-375-4 — Extract the locked JSON store primitives in M1
**Context:** Spec §5.1 allows extraction if voice tests stay green; M1's statements store, M2's index/proposals, and M4's mandates all need the lock/immutable/CAS protocol. **Decision:** M1 adds `src/lib/store/locked-json-store.ts` (`acquireFileLock`, `withStoreLock(dir, mutexKey, fn)`, `installImmutable`, `atomicReplaceJson`, `commitIndex(base, next)` generic over `{generation}`, `fsyncDirectory`) by moving code from `voice-profile-store.ts:60–200`; `voice-profile-store.ts` imports it; `voice-profile-store.test.ts` is not edited; each store keeps its own `.store.lock` (no cross-store contention). **Consequences:** one mechanical refactor commit reviewed once; `resetWritingStore()` gains a sibling `resetPersonalityStore()` (M1) and both are called from the writing/personality test `beforeEach`.

### ADR-375-5 — `PersonalityStatus` resolution is synchronous and host-free
**Context:** Signals uses better-sqlite3 synchronous transactions; G5 and materialization must validate and transition in one transaction (writing spec G5). A host round-trip cannot sit inside them. **Decision:** `resolvePersonalityStatus(workspaceSlug)` reads the index (sync), the four workspace files (`readFileSync`/`lstatSync`), rebuilds the source snapshot (sync DB reads), and returns; `host` capability is a separate cached field. Gates in M3 call it immediately before opening the transaction and pass the value in. **Consequences:** no async gate; C8 race test covers the read-then-transact window (the loser fails on the index generation / approval state inside the transaction).

### ADR-375-6 — Byte fidelity rules for proposals
**Decision:** raw-byte hashing for CAS tokens; UTF-8 round-trip check with refusal (`file_not_utf8`); BOM preserved as the first unmanaged byte; EOL detected per file (`detectEol` precedent) and applied to the managed block on placement; block bodies and `blockHash` are LF-only and NFC is **not** applied anywhere (user statements and voice samples are verbatim code points; `Rendered*Input` strings are stored as received, trailing whitespace stripped per rendered line only). **Consequences:** W1's CRLF fixture, H5, and X6 pin the behavior; a mixed-EOL file is normalized only inside the block, never outside it.

### ADR-375-7 — Legacy hash compatibility is a frozen-constant test, and the server never injects `personality`
**Context:** `canonicalJson` drops `undefined` and keeps `null`. **Decision:** M3 adds `personality` to `computeAuditInputHash`'s field list; when a variant carries no `personality` key the server leaves it absent (never writes `null`); an agent that sends `personality: null` gets it stored and hashed. Test L1 freezes the pre-change hash of a checked-in legacy fixture. **Consequences:** every legacy audit/materialization snapshot keeps validating byte-for-byte; a skill that opts into the contract changes hashes deliberately.

### ADR-375-8 — Represented org is a config scalar set only by user surfaces
**Context:** Spec A2 validates a caller-supplied `representedOrgId`; the agent path should not be able to choose which org the workspace speaks for. **Decision:** `SignalsConfig.personalityProjection = { representedOrgId: string | null }`; set by `PUT /api/personality/represented-org` (M1, validated against `orgs.ownerContactId === self`) and the M6 picker; `loadPersonalitySources()` reads config only; `propose_personality_projection` (M2) accepts no org override. Voice selection is automatic (A3) with an optional `voiceProfileId` pin validated by A4. **Consequences:** an agent cannot widen representation; the proposal card shows the org so the user still approves it explicitly.

### ADR-375-9 — Personality-first skill release is `1.1.0`; enforcement keys on `PERSONALITY_SKILL_MIN_VERSION`
**Context:** SKILL.md frontmatter is already `version: "1.0.0"` (validator requires semver); the spec's `>= 0.3.0` threshold would classify today's skill as Personality-aware and enforce `personality_binding_required` the moment a binding exists, breaking the migration window. **Decision:** M3 defines `PERSONALITY_SKILL_MIN_VERSION = "1.1.0"` in `src/lib/writing/contracts.ts` and compares semver-numerically; M5 releases SKILL.md `1.1.0` and a fixture test asserts the packaged version satisfies the constant. The epic's "0.3.0" wording is read as "the Personality-first release"; the plugin/package bump stays `0.2.3 → 0.2.4`. **Consequences:** skill `1.0.0` variants remain legacy-unbound; PM may rename the release, the constant is the only coupling. Flagged in the handoff as a deviation from the issue text.

### ADR-375-10 — M1 ships an observable, workspace-free preview surface
**Context:** #376 renders "proposals only" but has no user-visible output until M2, which makes QA and the X6 cross-process proof abstract. **Decision:** `GET /api/personality/sources` returns `{ self, org, voice: { status, candidates }, statements, snapshot, sourceHash, sourceRevisions, blocks: { identity, brand, voice, boundaries }: { body, blockHash, bytes } }` computed purely from Signals data (no workspace read, no marker/binding id — markers are M2's, since they carry the proposal-time binding id). **Consequences:** QA can diff two server processes' responses for X6; M6 reuses the route for the "what would project" panel; nothing here can write.

### ADR-375-11 — Id prefixes and store layout are fixed in M1
**Decision:** `WRITING_ID_PREFIXES` gains `"prp" | "pb" | "pm"` (ids.ts:3; `newWritingId`/`isWritingId` unchanged). Store root `SIGNALS_DATA_DIR/personality/` with `statements.json` (M1), `index.json` + `proposals/` (M2), `mandates.json` (M4), `.store.lock` (M1). `resetPersonalityStore()` removes the directory. **Consequences:** M2/M4 add files, never rename.

### ADR-375-12 — Each milestone is one loop and one PR; the epic closes at M6
**Decision:** PR titles `feat(personality): <milestone> (#<child>)`, body ticks the matching #375 checklist rows; `Closes #<child>`; #375 closes with the M6 PR. Follow-up loops cite this document. Child issues are not re-filed. **Consequences:** review scope per PR stays at one workstream; the epic checklist is the progress record.

---

## 5. First Dev slice — M1 (#376) in detail

### 5.1 Files

| File | Change |
|---|---|
| `src/lib/writing/ids.ts` | `WRITING_ID_PREFIXES` + `"prp", "pb", "pm"` (test in `ids.test.ts`) |
| `src/lib/store/locked-json-store.ts` (+ `.test.ts`) | Extracted primitives (ADR-375-4): `acquireFileLock(dir, opts)`, `withStoreLock(dir, key, fn)`, `installImmutable(path, value)`, `atomicReplaceJson(path, value)`, `commitIndex(readCurrent, base, next)` generic over `{ generation: number }`, `fsyncDirectory`, `processAlive`. Behavior identical to `voice-profile-store.ts:93–200`; error codes stay `STORE_BUSY` / `STORE_CONFLICT`. |
| `src/lib/writing/voice-profile-store.ts` | Import primitives (no behavior change) **and** ADR-373-8: `getActiveVoiceProfileFor` (L397–407) drops the second `.find` at L406; `resolveActiveVoiceProfileContext` (L413–423) pools only `ownerContactId === self` and returns `{ status: "unclaimed_only", unclaimed: VoiceProfileRef[] }` when the only approved profiles have `ownerContactId: null`; `ownerContactId: null` never matches when self is `null` (no `isSelf` contact → `none`). Export `listUnclaimedVoiceProfiles()`. `voice-profile-store.test.ts` untouched; new assertions go in `voice-profile-store.personality.test.ts` (X4). |
| `src/lib/agent-tools/content-item-handlers.ts` | `resolveContextVoice` (L652–673) surfaces `unclaimed_only` with `candidates` = unclaimed refs; `voice.status` enum widened in the context output type. |
| `src/lib/personality/contracts.ts` | Zod + types for the **whole** epic so later milestones import, not redefine: `publicProfileInputSchema`, `renderedIdentityInputSchema` / `renderedBrandInputSchema` / `renderedVoiceInputSchema` (all `.strict()`, arrays bounded and sorted by the adapters, unexported `rendererInput` brand symbol added by `brand*()` helpers), `personalitySourcesSchema`, `personalityStatementsSchema` (≤12 × ≤280, verbatim), `personalitySourceSnapshotSchema`, `SOCIAL_PERSONALITY_FILES`, `PERSONALITY_SECTIONS` (`identity\|boundaries\|voice\|brand\|index`) with file mapping, `PERSONALITY_BLOCK_MAX_BYTES = 16384`, `markerStart/End` string builders, `personalityBindingSchema`, `personalityProposalSchema`, `personalityProposalRecordSchema` (+ `hostResult`), `personalityIndexSchema`, `personalityStatusSchema` (+ `host`), `targetRepresentationSchema`, `presenceMandateSchema` with `PRESENCE_MANDATE_MODES = ["assist_only"] as const`, `PersonalityStatusReason` unions. Types exported from here only. |
| `src/lib/personality/sources.ts` | `loadPersonalitySources({ voiceProfileId? })` → `PersonalitySources`; rules A1–A5 with the exact codes/reasons from spec §3.1; adapters `toRenderedIdentityInput(contact, orgsById, selectedOrg)`, `toRenderedBrandInput(org, domains, identities, selfTitle)`, `toRenderedVoiceInput(profile)` construct object literals, parse `.strict()`, sort/bound, brand. Identity selection reuses ARPP public-mode helpers from `src/lib/arpp/project-contact.ts` (shared-scope employment/identity only; no `local_only`, no email/phone/timezone). Imports DB row types only inside this module. |
| `src/lib/personality/render.ts` | Pure: `renderIdentityBlock`, `renderBrandBlock`, `renderVoiceBlock`, `renderBoundariesBlock`, `renderIndexBlock` → `{ body: string; blockHash: string; bytes: number }` per spec §4.2 content order; `blockHash = sha256(LF body)`; `block_too_large` refusal; representation-rule constants; exemplar rule (≤5, ≤600 chars, ascending `vs_` id, fenced). Accepts only `PersonalitySources` members (branded); **no import from `src/lib/db/**` or `src/lib/arpp/**`**. |
| `src/lib/personality/snapshot.ts` | `buildSourceSnapshot(sources, revisions)`, `computeSourceHash(snapshot)` (strips `revision` fields), `sourceRevisions(snapshot)`. |
| `src/lib/personality/statements.ts` | `readPersonalityStatements()`, `upsertPersonalityStatements({ values, boundaries })` under the store lock (`atomicReplaceJson`), hash = `sha256Canonical({ values, boundaries })`, limits enforced by the schema. |
| `src/lib/personality/store-paths.ts` | `personalityStoreDir()` (realpath of `SIGNALS_DATA_DIR/personality`, mkdir), `resetPersonalityStore()`. |
| `src/lib/settings/signals-config.ts` | `personalityProjection?: { representedOrgId: string \| null }`; read/update helpers `getRepresentedOrgId()`, `setRepresentedOrgId()` (validation lives in the route/tool, not the config module). |
| `src/lib/agent-tools/personality-handlers.ts` + `registry.ts` | Tool `upsert_personality_statements` (category `content`; input `{ values: string[], boundaries: string[] }`; returns the stored document). No `get_*` tool in M1 (the REST preview is the read surface; agents get `get_personality_binding` in M2). |
| `src/app/api/personality/statements/route.ts` | `GET` → document or empty default; `PUT` → same handler as the tool. |
| `src/app/api/personality/represented-org/route.ts` | `GET` → `{ selected, candidates: orgs where ownerContactId === self }`; `PUT { orgId: string \| null }` → A2 validation (`409 org_not_represented`), writes config. |
| `src/app/api/personality/sources/route.ts` | `GET` → ADR-375-10 payload; A1 failure → `404 self_contact_missing`; never touches the workspace. |
| `openapi/agent-tools.json` | regenerate (`npm run generate:agent-tools-openapi`). |
| `docs/agent-tools.md`, `docs/local-app.md` | new tool; backup section adds `SIGNALS_DATA_DIR/personality/`; voice section reworded "canonical" → "approved voice-evidence source"; release note for the removed fallback + `unclaimed_only` claim flow (claim = `upsert_voice_profile` with `ownerContactId = self` creating a new version, then `approve_voice_profile`; no new tool). |

Not in M1: markers with binding ids, proposals, diffs, any read of workspace files, any host call, `get_writing_context.personality`, skill or plugin changes, Settings UI.

### 5.2 Contracts fixed in M1 that later milestones import

- `PersonalitySources`, `Rendered*Input` (branded), `PersonalityStatements`, `PersonalitySourceSnapshot`, `sourceHash` rule, section/file map, block hash rule, size cap, representation-rule text, `PRESENCE_MANDATE_MODES`, id prefixes, store directory, config key. M2 adds only `store/workspace/diff/apply/host-client/status` modules and the marker rendering (`wrapBlock(section, body, bindingId, sourceHash12)`), never re-deriving block bodies.

### 5.3 Tests (all under `src/lib/personality/*.test.ts` unless noted)

| ID | Test | Shape |
|---|---|---|
| X1 | `render.ts` functions reject unbranded values: `// @ts-expect-error` calls with `ContactDTO`, `Org`, `VoiceProfile`, and a structurally identical unbranded literal fail `tsc --noEmit`; runtime `.strict()` rejects an extra key at every depth (`profiles[0].extra`, `currentRole.extra`, `signatureLines[0].extra`); serialized adapter output has exactly the named keys | type + schema |
| X2 | Fixture self contact + owned org + approved profile with the sentinel `SENTINEL_<field>` in every excluded field listed in spec §3.2 (personas, relationship/funnel/tags/metadata, identities `local_only`, employments `local_only`, email/phone/timezone, `org_email_patterns`, `contact_email_candidates`, MX evidence, `accountStage`, `fieldProvenance`, `ownerContactId`, niches/simulations/calibrations/metrics); assert `JSON.stringify(sources)` and all four block bodies contain no `SENTINEL_` | unit |
| X3 | `representedOrgId` → org with other owner → `VALIDATION_ERROR/org_not_represented`; missing org same; non-self contact can never become `identity` (no code path accepts a contact id) | unit |
| X4 | Approved profile owned by another contact and one with `ownerContactId: null`: `getActiveVoiceProfileFor()` → `null`; `resolveActiveVoiceProfileContext()` → `unclaimed_only` with the null-owner ref; `get_writing_context.voice.status === "unclaimed_only"`; no `isSelf` contact → `none` | unit (`voice-profile-store.personality.test.ts`, `content-item-handlers` test) |
| X5 | `IDENTITY.md` body excludes `local_only` identities/employments, email, phone, timezone; `BRAND.md` excludes `org_email_patterns`, `accountStage`, `ownerContactId` | unit |
| X6 | Same fixture rendered in the vitest worker and in a spawned `node` child (`execFileSync(process.execPath, [...])` over a tiny script that imports the built module via `tsx`/`vitest --project unit` fork) → identical `sourceHash` and every `blockHash`; bodies contain no timestamp/run-id pattern; and `GET /api/personality/sources` from two server processes is byte-identical (QA step) | unit + QA |
| X7 | Statements: 13 items or a 281-char item → `VALIDATION_ERROR`; verbatim rendering (leading/trailing/inner whitespace and Unicode preserved, no NFC) | unit |
| X8 | Determinism inputs: arrays sorted by the documented key (profiles by `network,url`; exemplars/signature lines by id; vocabulary as given), absent optional fields omit their line entirely, LF-only bodies, no trailing whitespace; a `contacts.updatedAt` touch without projected change leaves `sourceHash` equal while `sourceRevisions.self` changes | unit |
| V1 | `voice-profile-store.test.ts` passes unchanged after the extraction; `locked-json-store.test.ts` covers lock stale-reclaim, `STORE_BUSY` after deadline, CAS conflict, immutable install collision | unit |
| R1 | Route tests for the three REST routes (404/409/200 paths) and the tool via `invokeAgentTool` | route + tool |
| N1 | Static: `src/lib/personality/**` imports no `node:fs` write API and nothing from `src/lib/rtx/**` or `src/lib/publish/**` (the M1 form of H1/S1) | static |

### 5.4 Proof gate for M1 (Review and QA)

- `npm run check` green in the worktree except the known `test:qa-local-app` basename step; that step green from `/Users/realtimex/github/signals` on the same commit (record both in the PR, as #374 did).
- `openapi/agent-tools.json` regenerated and `check:agent-tools-openapi` green; `docs/agent-tools.md` lists `upsert_personality_statements`.
- Coverage thresholds unchanged (no `src/lib/writing/**` file is in the allowlist; do not add one in this PR).
- QA: (1) with a self contact, one owned org and one foreign-owned org, one approved self profile and one null-owner profile: `GET /api/personality/sources` shows `voice.status: "active"`, selecting the foreign org returns `409 org_not_represented`; (2) delete the self profile → `unclaimed_only`, `get_writing_context` agrees; (3) two server processes (different ports, same `SIGNALS_DATA_DIR`) return byte-identical `/api/personality/sources`; (4) `ls $SIGNALS_DATA_DIR/personality` shows only `statements.json` and `.store.lock`; the RTX workspace directory is untouched (`stat` mtimes unchanged); (5) grep the PR diff for `writeFile|renameSync|linkSync` outside `src/lib/store/` → none.
- PR: `feat(personality): represented sources, deterministic renderer, statements (#376)`; `Closes #376`; ticks the A rows in #375; release note paragraph for the voice-fallback change.

---

## 6. Contract details for M2–M6 that Dev should not have to re-derive

- **Marker line** (M2): `<!-- signals:personality:<section>:start v=1 binding=<pb_id> source=<sourceHash12> -->` … `<!-- signals:personality:<section>:end -->`; `blockHash` excludes both marker lines; the `index` block has `source=` omitted.
- **`workspaceKey`** (M2): `sha256Canonical([workspaceSlug, workspaceDirRealpath]).slice(0, 32)` — distinct from the host's realpath-only key; never compared.
- **`personalityHash`** (M2): `sha256Canonical(SOCIAL_PERSONALITY_FILES.map(p => [p, sha256(rawBytes) ?? null]))` in the fixed order `IDENTITY, SOUL, VOICE, BRAND`.
- **Drift reasons** (M2) exactly the spec §6.1 union; precedence `unavailable > drifted > source_stale > bound`; `unbound` when no active projection binding.
- **Eager revoke** (M3): `revokeVariantsForPersonalityChange` selects variants where `metadata.writing.personality.workspaceSlug === slug` and `bindingId !== newActiveId`, status unqueued, in the same transaction as the index commit's DB follow-up (spec step 8); legacy `personality` absent → untouched.
- **G5 clause** (M3): caller computes `PersonalityStatus` (ADR-375-5) and passes it; gate requires `status ∈ {bound, source_stale}`, binding id + `personalityHash` equal to the variant, `audit.personality.currentSourceHash === status.currentSourceHash`, `targetId ∈ compatibleTargets`; `source_stale` additionally requires `audit.personality.statusAtAudit === "source_stale"` and the warning finding; all else `WRITING_ARTIFACT_STALE`.
- **Target representation** (M3): `platform_targets.metadata.personality` per spec §8.3; every legacy kind and the relative string `"self"` read as `unbound`; `set_target_representation` requires `thread_message` evidence and `bindingIdAtDecision === active.id`.
- **Skill "Never do"** (M5): tokens `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md` may appear outside `## Never do` only in a read instruction — validator rule: any line containing one of them and a write verb (`write|edit|patch|append|create`) outside `## Never do` fails.
- **Settings workspace card** (M6): no workspace chooser; shows `slug` (Signals config), `id`/`name` (host), `dir` (local realpath), and the `SIGNALS_RTX_WORKSPACE_SLUG` reconciliation hint when the plugin-provisioned slug differs from the dispatch slug (spec §9.1).

---

## 7. Invariants every milestone must keep (Review checklist)

1. **Privacy:** `render.ts` imports no DB/ARPP types; adapters are `.strict()`; X2 sentinels re-run in every milestone that touches `sources.ts`.
2. **Determinism:** block bodies have no timestamps, run ids, or binding ids inside the hashed region; NFC never applied; LF inside blocks; original EOL/BOM outside.
3. **Explicit approval:** `approval.by === "user"` with evidence for every proposal; `writingApprovalPolicy` never applies to Personality; `noop`/`superseded`/`stale` cannot be approved.
4. **Whole-file drift:** any byte change to the four files (managed or unmanaged) is `drifted`; adoption is a new projection proposal with `driftDiff`; never reverse-written.
5. **Legacy hashes:** `personality` absent stays absent; L1 constant test stays green; `revokedReason` only widens.
6. **Workspace/identity guards:** slug + id + realpath + self contact checked before every apply (ADR-375-2); `SIGNALS_RTX_WORKSPACE_SLUG` resolver shared with dispatch (invariant test from spec §9.1).
7. **No direct writes / no fallback:** H1/N1 static tests; capability absent → Apply refused, everything else read-only.
8. **Non-goals:** S1, C5, P1 pass; no scheduler, cron, cadence, reply/comment/reaction/follow tool, browser-session import, or `send-to-agent` caller is added anywhere in `src/lib/personality/**`, `src/app/api/personality/**`, the skill, or the Settings tab. `PRESENCE_MANDATE_MODES` stays `["assist_only"]`.

---

## 8. Risks and defaults

| # | Risk | Default |
|---|---|---|
| 1 | Installed desktop lacks G; M2 QA H6 needs a dev RealTimeX from `realtimex-dev` ≥ `6dbf8b5` | rtx-test-runner with a disposable workspace; H1–H5 cover merge, H6 is the rollout gate |
| 2 | Permission prompt: adding `workspace.personality.write` re-prompts existing installs | documented in M2 release note; probe reports `not_granted` until accepted |
| 3 | Voice fallback removal changes `get_writing_context` for users who relied on it | M1 release note + claim flow; M6 adds the UI |
| 4 | Skill version wording (`0.3.0` vs `1.1.0`) | ADR-375-9; PM may rename, the constant is the coupling |
| 5 | Plugin redeploy removes the dynamic `AGENTS.md` pointer between M2 and M5 | status `index_pointer_missing`; static template section in M5 |
| 6 | Slug mismatch `"signals"` vs plugin UUID | bind to the dispatch slug; docs; plugin-passed env is a later follow-up (spec §13.1) |
| 7 | Store refactor (ADR-375-4) touches shipped #350 code | own commit; `voice-profile-store.test.ts` byte-unchanged; V1 |
| 8 | `.strict()` adapters vs future DTO fields | intended: new fields must be added to the allowlist deliberately |

---

## 9. Routing

Dev (this loop): implement M1 per §5 on `issue-375`; push the branch; open the PR against `main`; route to Review with the §5.4 evidence. Review: §5.3 table + §7 checklist. QA: §5.4 QA steps. On `done`, bootstrap the M2 loop from #378 with this document and `docs/local-apps/personality-writer.md@6dbf8b5` as authority.
