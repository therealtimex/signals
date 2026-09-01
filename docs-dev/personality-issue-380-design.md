# #380 — Personality-first `signals-writing` release (skill 1.1.0, plugin 0.2.4)

**Status:** Accepted (System Design, 2026-09-01, loop `loop-issue-380-5f722c3f`)
**Issue:** [#380](https://github.com/therealtimex/signals/issues/380) · epic [#375](https://github.com/therealtimex/signals/issues/375) (workstream D of `specs/personality-projection.md` §12)
**Base:** `main` @ `67efa8f` (branch `issue-380`)
**Design authority:** `specs/personality-projection.md` (ADR-373-1..10), `specs/signals-writing-system.md` §5.4/§5.5/§6, `docs-dev/personality-epic-375-plan.md` (ADR-375-9), merged #379 (PR #396) and #381 (PR #407) code.

Everything this issue needs on the server side is already merged. #380 ships **content, packaging,
fixtures, and tests only**: the skill package, the plugin template/versions, one instructional line
in the brief builder, and the tests that pin all of it. No schema, migration, agent-tool input
schema, OpenAPI, or REST change is in scope.

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| ADR-380-1 | The release named "signals-writing 0.3.0" in #380 ships as **SKILL.md `version: "1.1.0"`** and **plugin artifacts `0.2.4`** (package.json, realtimex-plugin/realtimex.plugin.json, rtx-manifest.json). | Settled by ADR-375-9 and now enforced by merged code: `PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION = "1.1.0"` (`src/lib/writing/personality-lineage.ts:7`). A literal `0.3.0` parses as *below* the gate → `isPersonalityAwareWritingSkillVersion` is false → the server would treat the new skill as legacy-unbound forever: a silent Personality bypass. Do not reopen. |
| ADR-380-2 | New always-relevant gate in `SKILL.md` + new module `core/personality.md` (80–200 lines) loaded by `draft`, `adapt/revise/humanize`, `audit`, `approve`, and a new `personality` mode. | The gate decision (read files, check status, pick lane) is needed by every mode; the card formats, proposal lifecycle, and error recovery are bulky and belong in a progressive load. |
| ADR-380-3 | Legacy-unbound lane follows the **merged** #379 semantics, which are stricter than spec §6.2 prose: an aware (≥1.1.0) skill on an **unbound** workspace may create only **targetless, unaudited** drafts (`variant-use-cases.ts:68`); `targetId` or `audit` → `VALIDATION_ERROR / personality_binding_required`. The skill presents this as a labelled "legacy-unbound sketch" lane and directs the user to bind (Settings → Personality or the projection flow) for the full draft→audit→approve→materialize lane. | The code is the migration contract #380 is told to follow. The skill must not paper over it, and must never downgrade its declared version to escape the gate (new never-do). |
| ADR-380-4 | The skill passes **only** `metadata.writing.personality = { bindingId }` (`variantPersonalityInputSchema`, strict) and never any hash/snapshot; audit input never carries `personality` (server schema is `z.never()`). `writing-cli.cjs precheck` gains two local deterministic checks: `personality_selector_invalid` (selector present but not exactly `{ bindingId: "pb_…" }`) and `audit_personality_forbidden`. | Server-derived hashes (ADR-350, ADR-373-7). The precheck catches the mistake before a server round-trip, with zero context knowledge needed. |
| ADR-380-5 | The template `realtimex-plugin/templates/signals/AGENTS.md` gains a permanent, **unmanaged** (no HTML markers) `## Personality` section whose body contains `PERSONALITY_INDEX_TEXT` **verbatim** (`src/lib/personality/render.ts:26`). The template never gains a `CLAUDE.md` file. | `unmanagedAgentsMentions`/`pointerPresent` short-circuit on that exact sentence, so proposals against provisioned workspaces never add the dynamic `index` block, and status never reports `index_pointer_missing`. A template `CLAUDE.md` would be copied as a regular file and permanently block the apply-time `CLAUDE.md → AGENTS.md` symlink shim (`proposal.ts:485`), leaving `claude_md_not_symlink` warnings. Marker comments in the template would parse as managed spans and force `includeIndex`. |
| ADR-380-6 | Every Personality surface the skill renders is a projection of persisted records: binding/status card from `get_writing_context.personality` / `get_personality_binding`; proposal card from `proposals[]` incl. `record.actions.approvalBlockers`; audit line from the server-stamped `audit.personality`; stale-state card from `PersonalityStatus.detail`. The skill never reconstructs state from prose and never authors the `core/voice/personality-source-stale` finding (server strips and re-inserts it byte-exactly). | Issue acceptance: "All displayed binding/proposal/audit state comes from persisted server records." |
| ADR-380-7 | Fixture strategy: the existing four `test/fixtures/signals-writing/*.variant.json` **stay at `skillVersion 1.0.0`** and keep passing unchanged — they are now the executable proof of the legacy migration window. The bound lane is tested with in-test overrides (version → 1.1.0, `personality: { bindingId }`) on top of the same fixture JSONs, seeded through `src/test/personality-writing-fixture.ts`. `reference.md` examples move to 1.1.0 + selector. | Keeps R7/R8 green as-is, adds D1 coverage, avoids new fixture files that would churn the exact-catalog verifiers. |
| ADR-380-8 | One instructional line each in the brief builder (`src/lib/workflows/signals-writing.ts`): tool-sequence step "read the four Personality files first; treat `get_writing_context.personality` as the gate; submit only the active `bindingId`" and a matching hard rule "never edit workspace Personality files". | The brief is the dispatch-time orchestration contract the skill itself declares authoritative; leaving it Personality-silent invites divergence. Text-only change, no behavior. |

---

## 1. What is already on `main` (do not rebuild)

Verified at `67efa8f`:

- Version gate + selector/snapshot schemas: `src/lib/writing/personality-lineage.ts` (`PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION = "1.1.0"`, `variantPersonalityInputSchema = { bindingId } .strict()`, `writingAuditPersonalitySchema`, deterministic `personalitySourceStaleFinding`).
- Enforcement: `src/lib/writing/variant-use-cases.ts` (aware+bound requires selector; unbound+aware allows only targetless unaudited drafts; previously-bound may not regress), `src/lib/writing/personality-guard.ts` (all gate reasons), `src/lib/writing/materialize.ts`, `src/lib/writing/publish-gate.ts`, `src/lib/publish/send-to-agent.ts` (G5).
- Read models: `get_writing_context.personality` = full `PersonalityStatus` (incl. `binding.id`, `compatibleTargets`, `host.capability`), `targets[].represents/compatible`, `variants[].personality` + `personalityState: "legacy_unbound" | "stale" | <status>`; `get_personality_binding` = `PersonalityBindingView` with `proposals[].actions` (from #407).
- Projection lifecycle tools (all registered): `propose/approve/reject/retry/rollback/unbind_personality_projection`, `upsert_personality_statements`, `set_target_representation`; documented for agents in `.claude/skills/realtimex-signals/reference.md`.
- Error surface the skill must handle (exact `details.reason` values): `personality_binding_required`, `personality_binding_stale`, `personality_drifted`, `personality_identity_mismatch`, `personality_source_stale`, `target_identity_mismatch`, `workspace_mismatch`, `personality_workspace_unavailable` — carried on `VALIDATION_ERROR`/`CONFLICT`/`AUDIT_STALE`/`WORKSPACE_UNAVAILABLE`; plus `APPROVAL_REQUIRED` ("source-stale audits require fresh explicit approval") at materialization.
- Test seeding helper: `src/test/personality-writing-fixture.ts` (fake host client, capability, propose→approve→bind, `setTargetRepresentation`).

Ownership boundary between the two skills stays as merged: `realtimex-signals` documents the
projection tool catalog and generic flow; `signals-writing` (this issue) owns the **writing-run
orchestration**: read-first doctrine, lane selection, bindingId discipline, cards during writing
work, and refusal behavior.

---

## 2. File-level implementation plan

### 2.1 Skill package `.claude/skills/signals-writing/`

**`SKILL.md`** (currently 142 lines; hard cap 250 — budget ~55 new lines):
- Frontmatter: `version: "1.1.0"`; description extended to name the approved workspace Personality as the live voice (keep ≥ 80 chars; `name`/`author`/`license`/`coreVersion`/`allowed-tools` are frozen by the verifier).
- "Start here": new step after the brief read — *"Read `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md` from the workspace root (whole files, managed and unmanaged prose) before any evidence or drafting work; they are the canonical live identity and voice."*
- New compact **Personality gate** section (the always-loaded decision table):

  | `personality.status` | Lane |
  |---|---|
  | `bound` | Full lane. Pass `{ bindingId }` from the context you just read into every `upsert_variant`. |
  | `source_stale` | Full lane with the server's warning; materialization will demand a fresh explicit approval of the warned audit. Say so on the card. |
  | `unbound` | Legacy-unbound lane only: targetless, unaudited drafts, clearly labelled; offer the binding flow for the full lane. |
  | `drifted` / `unavailable` / host capability not `available` | Refuse Personality-required writing; render the stale-state card; never edit files to "fix" drift. |

- Modes table: add `core/personality.md` to the Load column of `draft`, `adapt/revise/humanize`, `audit`, `approve/export/publish`; add row `personality` → load `core/personality.md`, tools `get_personality_binding`, `propose_personality_projection`, `approve_personality_projection`, `reject_personality_projection`, `retry_personality_projection`, `rollback_personality_projection`, `unbind_personality_projection`, `set_target_representation`.
- Run contract: insert "Personality" step between **Context** and **Voice** (read files → gate → record `bindingId`); amend the **Voice** step: when a binding is active, `VOICE.md` is the live voice and the approved profile is evidence/attribution (D5 as amended).
- Contract ownership table, new row: *Agent supplies `personality.bindingId` only* | *Signals derives personalityHash, workspace, identity, target snapshot, audit personality, and the source-stale warning*.
- Approval card: add one line (see core/approval.md below) — card template changes in both places must stay identical.
- **Never do** additions (kept inside the section; the four file names also appear in the gate section, so they get a presence-only verifier check, not the retired-token absence check):
  1. Never create, edit, patch, or delete `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md`, or `AGENTS.md`; Personality changes go through `propose_personality_projection` and user approval only.
  2. Never manufacture Personality snapshots, hashes, workspace, identity, or target fields; submit only the active `bindingId`.
  3. Never author or copy the `core/voice/personality-source-stale` finding; the server inserts it.
  4. Never declare a different skill version to bypass the Personality gate, and never present legacy-unbound output as Personality-bound.

**`core/personality.md`** (new; must be 80–200 lines):
- Doctrine: the four files are the canonical live voice; read them whole before evidence synthesis and platform rendering; agents compose Personality ▸ mandate ▸ overlay ▸ conversation ▸ ledger and a lower layer never overrides identity/boundaries (projection spec §7.1).
- Status reads: `get_writing_context.personality` during runs; `get_personality_binding` for lifecycle work; the two agree byte-for-byte (C4). Report capability honestly from `host.capability`.
- bindingId discipline: copy `personality.binding.id` from the *current* context read; on `personality_binding_stale` re-read context and re-submit; never cache across a rebind; retries keep ids/request hashes per existing retry discipline.
- Lifecycle flows (agent side): propose → render the **proposal card** from persisted fields only → wait → `approve_personality_projection`/`reject_personality_projection` with verbatim `thread_message` evidence; `retry_personality_projection` for interrupted attempts; rollback/unbind are proposals too. Approval blockers come from `proposals[].actions.approvalBlockers`, never inferred.
- Proposal card (projection spec §5.6 shape) and binding/stale-state card formats.
- Target representation: show `targets[].represents` + `compatible`; on `target_identity_mismatch` offer an explicitly user-evidenced `set_target_representation` or a different target; `unbound` is never compatible.
- Error table: each `details.reason` above → required agent action (stop / re-read / re-audit / ask user).
- Legacy-unbound lane rules and labelling.

**`core/voice.md`**: reword per amended D5 — the voice store is the *approved voice-evidence source*; when a binding is active, `VOICE.md` (whole file) is the live voice and the profile ref remains for attribution. Add `unclaimed_only` context handling (ask the user to claim/build; never use another owner's voice). Add rule record to the tagged `signals-writing:rules` block:
```json
{ "id": "core/voice/personality-source-stale", "class": "voice", "severity": "warning",
  "statement": "Server-inserted when an audit knowingly retains unchanged Personality bytes after sources changed; requires fresh explicit approval.",
  "applies": ["core"], "source": [{ "kind": "spec", "path": "specs/personality-projection.md" }], "status": "active" }
```
with prose stating it is server-owned and never agent-authored.

**`core/approval.md`**: approval card gains a `Personality` line, e.g.
`Personality  <pb_id> · <bound|source_stale|legacy-unbound> · self <name> (org <name|none>) · target represents <self|org|unbound>`.
Error handling additions: `AUDIT_STALE` with a `personality_*`/`target_identity_mismatch` reason → re-read context, render the stale-state card, follow the core/personality.md action for the reason (the server already revoked the approval in-transaction); `APPROVAL_REQUIRED` after a `source_stale` audit → explain that a fresh explicit approval of the warned audit is required; publish-gate `WRITING_ARTIFACT_STALE` personality reasons are terminal for the item until re-audit/re-approval.

**`core/lineage.md`**: persistence order gains "read the four Personality files and the context `personality` status" before the spine step, and "include `personality: { bindingId }` for bound-lane variants; read the server-stamped snapshot and `personalityState` back from the response; never copy hashes into any working file".

**`core/audit.md`**: bound audits are stamped server-side (`audit.personality` with `currentSourceHash`/`statusAtAudit`); the agent's audit input must not contain `personality`; expect the deterministic warning on `source_stale` and account for it when predicting verdict (`warn`) and risk.

**`reference.md`**: update `variant-input` (add `"personality": { "bindingId": "pb_demo001" }`; bump embedded `auditor.skillVersion` to `"1.1.0"`), `generation` (`skill.version: "1.1.0"`), leave `audit-input` without personality (schema forbids it). Add exactly one new tagged example `signals-writing:example:approve-personality-input` validated against `approvePersonalityProjectionSchema`. Update the per-mode call sequences (read Personality first; approve flow includes proposal approval).

**`scripts/writing-cli.cjs`**: precheck additions per ADR-380-4 (pure local shape checks; no context dependency). Help text unchanged (verifier smoke checks `id|measure|verdict|precheck`).

**`overlays/*`**: untouched (platform overlay contract is unchanged by design — D2 of #373).

### 2.2 Plugin template and versions

- `realtimex-plugin/templates/signals/AGENTS.md`: new section (unmanaged prose, no markers, exact constant sentence):

  ```markdown
  ## Personality

  Read IDENTITY.md, SOUL.md, VOICE.md, and BRAND.md when present; they are the canonical identity and voice for this workspace. HEARTBEAT.md is scheduling, not personality.

  Personality binding, proposals, drift, and rollback are managed in Signals (Settings → Personality
  or the projection agent tools). Never edit these files or their managed blocks by hand; propose a
  new projection instead.
  ```
  Also extend the existing "Session checklist" item 3 with "…and treat the workspace Personality as the canonical voice for writing runs (read the files above first)".
- Versions `0.2.3 → 0.2.4` in: `package.json`, `realtimex-plugin/realtimex.plugin.json`, `rtx-manifest.json` (all three must match; `verify-marketplace-versions.mjs` and `test-realtimex-plugin-package.mjs` enforce equality; release tag will be `v0.2.4`).
- No change to `marketplace/local-app.manifest.json` (runtime-pinned only), `managedPaths`, slugs, or config schema.

### 2.3 Brief builder (text only)

- `src/lib/workflows/signals-writing.ts`: tool-sequence gains step "0.5" (or renumbered step 1): *"Read the workspace Personality files (IDENTITY.md, SOUL.md, VOICE.md, BRAND.md) first, then treat get_writing_context.personality as the binding gate; bound work submits only the active bindingId."* Hard rules gain: *"Do not edit workspace Personality files; Personality changes are proposals approved by the user."*
- `src/lib/workflows/signals-writing.test.ts`: extend the brief assertions.

### 2.4 Tests and verifiers

| ID | Where | Asserts |
|---|---|---|
| T1 | `scripts/verify-signals-writing-skill.mjs` | `expected` += `core/personality.md` (80–200 line bound applies automatically); `requiredTags` += `approve-personality-input`; `coreCatalog` += `core/voice/personality-source-stale`; new presence-only check: the SKILL.md Never-do section names all four Personality files and `propose_personality_projection`. |
| T2 | `src/lib/writing/signals-writing-skill.test.ts` (package half) | `markdownFiles` += `core/personality.md`; `nonToolTokens` += the reason/status tokens used in prose (`legacy_unbound`, `source_stale`, `thread_message`, `personality_binding_required`, `personality_binding_stale`, `personality_drifted`, `personality_identity_mismatch`, `personality_source_stale`, `personality_stale`, `target_identity_mismatch`, `workspace_mismatch`, `personality_workspace_unavailable`, `host_capability_unavailable`, `unclaimed_only` — final list from the authored prose); frontmatter pin `isPersonalityAwareWritingSkillVersion(frontmatter.version) === true` (imports the real gate, so the 1.1.0 floor can never drift from the server); new example parses with `approvePersonalityProjectionSchema`; `variant-input` example's `personality` strict-parses to `{ bindingId }`. |
| T3 | same file (fixture-integration half) | Existing legacy run **unchanged** (1.0.0 fixtures; proves the migration window). New bound describe: seed binding via `src/test/personality-writing-fixture.ts`; upsert ≥ 2 surfaces with in-test overrides (`skill.version: "1.1.0"`, `personality: { bindingId }`); assert server-stamped `metadata.writing.personality.personalityHash`/identity/target and `audit.personality.statusAtAudit === "bound"`; distinct-body/spine-hash invariants (R8 in the bound lane); materialize one variant. Negatives: aware+bound+no-selector → `personality_binding_required`; wrong `bindingId` → `personality_binding_stale`; aware+unbound+audit (run before seeding) → `personality_binding_required`. |
| T4 | `scripts/test-realtimex-plugin-package.mjs` | zip entry list += `skills/signals-writing/core/personality.md`; zip `templates/signals/AGENTS.md` contains the index sentence; zip `skills/signals-writing/SKILL.md` frontmatter version `1.1.0`. |
| T5 | new `src/lib/personality/template-pointer.test.ts` | repo template `AGENTS.md` contains `PERSONALITY_INDEX_TEXT` verbatim (imports the constant — template and renderer can never diverge silently) and contains no `signals:personality` marker; a projection proposal built against the template content yields `includeIndex === false`. |
| T6 | `src/lib/workflows/signals-writing.test.ts` | brief contains the Personality step and hard rule; ordinary briefs unchanged. |
| T7 | precheck unit (in T2 file or CLI smoke) | `precheck` flags `personality_selector_invalid` for a manufactured snapshot (selector with extra `personalityHash` key) and `audit_personality_forbidden` for audit-embedded personality. |

Gates to run: `npm run test:writing-skill`, `npx vitest run src/lib/writing/signals-writing-skill.test.ts src/lib/workflows/signals-writing.test.ts src/lib/personality/template-pointer.test.ts`, `npm run test:plugin-package`, `npm run test:provision-verifier`, `node scripts/verify-marketplace-versions.mjs`, then full `npm run check` before handoff to review.

### 2.5 Docs

- `docs/qa/signals-writing-skill.md`: add a **Personality-bound path** (bind via Settings → Personality first; verify the agent reads the four files, the card shows the Personality line, materialization succeeds), a **drift scenario** (hand-edit `VOICE.md` → agent refuses with the stale-state card, approval revoked on materialize attempt), and a **legacy-unbound scenario** (unbound workspace → only labelled targetless sketches; binding unblocks the full lane).
- `docs/realtimex-marketplace-plugin.md`: 0.2.4 notes — Personality-first writing skill, template Personality pointer, and the redeploy note below.
- `docs/agent-tools.md` "Personality-aware clients": one line that the packaged skill now declares 1.1.0 (shipped in plugin 0.2.4).
- Release notes must carry the two migration facts from §3.

---

## 3. Compatibility and migration decisions

1. **Version semantics** (ADR-380-1): plugin 0.2.3 installs keep the 1.0.0 skill → legacy-unbound lane keeps working untouched (variant-use-cases early return; hashes byte-identical). Upgrading to 0.2.4 flips the workspace into the aware regime immediately.
2. **Unbound workspace after upgrade**: full lane blocked by the server until a binding exists (ADR-380-3). This is deliberate (#379 contract); the skill's job is to explain and route to binding, not to soften it. QA covers the wording.
3. **`AGENTS.md` redeploy drift (named risk)**: the plugin declares `managedPaths: ["AGENTS.md"]`, so a 0.2.4 redeploy rewrites `AGENTS.md` from the template. A workspace whose binding includes a **dynamic** `index` block (bound before 0.2.4) will then report `drifted` / `index_pointer_missing` — the managed span is gone even though the static pointer text is present (`status.ts` `indexDrift` requires the recorded span when the binding carries an `AGENTS.md` file entry). Expected recovery: one new approved projection (which, with the static pointer now present, will not re-add the block). Document in release notes + QA; no code workaround in this issue.
4. **Legacy variants**: `personality: null` variants are never revoked by a first binding, remain visible as `legacy_unbound`, and keep their audit hashes (canonicalization drops absent fields) — already server-enforced; the skill labels them.
5. **No re-numbering** of overlays, formulas, rules, request-hash format, or working-file layout: adaptation/revision flows are untouched except for the selector.

## 4. No-new-authority proof (issue acceptance, last bullet)

- The packaged skill's file set is exact (T1/T4): the only executable remains `scripts/writing-cli.cjs` (local hashing/measurement; two added pure shape checks).
- No new tool, REST route, schema, or permission is introduced; the tools the skill newly *names* are all already registered and localhost/bearer-gated; approval evidence remains verbatim `thread_message`.
- Publishing still flows only through the existing explicit `send-to-agent` instruction (never-do #9 unchanged); presence mandate remains dormant `assist_only` (untouched, C5/S1 still pin it); no scheduler/cadence text anywhere in the new prose.
- Personality files are never written by the skill (never-do #1, T1 presence check, D1); the only Personality mutation path remains the server-owned proposal→user-approval→host-CAS pipeline.

## 5. Sequencing

Single PR on `issue-380`. Suggested commit order: (1) template + three version stamps; (2) skill content (SKILL.md, core/*, reference.md, writing-cli); (3) verifier/test updates T1–T7; (4) brief builder + test; (5) docs. No cross-repo dependency: #379/#381/host #1729/#1754 are merged; release coordination with workstream E (#381) is already satisfied. Tag `v0.2.4` after merge per the existing marketplace release flow.

## 6. Open items left to Dev discretion (defaults stated)

- Exact prose wording/line budgeting of `SKILL.md` (stay ≤ 250 lines) and `core/personality.md` (80–200); the section inventory above is the contract, the sentences are not.
- The final `nonToolTokens` additions list — derive from the authored prose, don't over-add.
- Whether `guide/03-content-and-publishing.md` gets a one-liner (default: yes, one sentence, no screenshots).
