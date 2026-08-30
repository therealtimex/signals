# Workspace Personality as the canonical Signals social voice

**Status:** Accepted (System Design, 2026-08-30, loop `loop-issue-373-87ae3e25`) — product-direction change for the Agentic Social Presence direction; amends `specs/signals-writing-system.md` D5 / ADR-347-4.
**Issue:** [#373](https://github.com/therealtimex/signals/issues/373) · **Amends:** [#347](https://github.com/therealtimex/signals/issues/347) spec (epic [#346](https://github.com/therealtimex/signals/issues/346))
**Base:** `main` @ `8f66c2d`
**Companion change in this PR:** `specs/signals-writing-system.md` (D5 row, ADR-347-4 status, `revokedReason`, §4.1 voice row)

This document is the durable contract for how Signals feeds the RealTimeX workspace Personality
and how Signals agents consume it. Nothing here adds product code; every code change lands in the
child issues in §12. Nothing here enables unattended posting, replies, comments, reactions, or
account access.

---

## 0. Decisions at a glance

| # | Decision | Why (one line) |
|---|---|---|
| D1 | **The RealTimeX workspace Personality is the canonical live identity and voice** of the Signals agents that run in that workspace. The Signals voice-profile store is retained unchanged as the *approved voice-evidence source*; it is no longer "canonical" (amends ADR-347-4). | Agents already run with `cwd = working-data/<slug>/` and natively read the Personality files; a second voice system in Signals would compete with what the agent actually reads. |
| D2 | Four contracts stay distinct and separately owned: **Personality** (RTX files), **presence mandate** (Signals, dormant `assist_only` in this epic), **platform overlay** (skill overlays, unchanged), **action/conversation ledger** (Signals tables, unchanged). | Mixing "who I am" with "what I may do" is how autonomous posting sneaks in through a prose file. |
| D3 | Only four represented-identity sources may project into Personality: the `contacts.isSelf` ARPP → `IDENTITY.md`; an explicitly selected org whose `ownerContactId` is that self contact (AROO) → `BRAND.md`; the approved voice profile owned by that self contact → `VOICE.md`; user-authored statements plus fixed representation boundaries → `SOUL.md`. The projection input type carries no persona, relationship, audience, or third-party fields. | Exclusion must be structural (like `ContactDTO` for ARPP), not a filter that a later field can bypass. |
| D4 | Projection = deterministic **managed blocks** inside Personality files, delimited by `<!-- signals:personality:<section>:start/end -->` markers. Everything outside a block is preserved byte-for-byte. Signals never writes `USER.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`, or `memory/`. | RealTimeX already uses this marker pattern (`realtimex:companion-identity`) and the plugin `managedPaths` model; users keep authoring their own Personality around the managed parts. |
| D5 | Proposal-based lifecycle: `sources → source snapshot + hash → rendered blocks → per-file diff → explicit user approval → compare-and-swap apply → binding record`. Rollback is a proposal whose blocks are the previous binding's blocks. | Every write is reviewable, hash-bound, and reversible through one code path. |
| D6 | **Signals applies the write itself, directly on the workspace directory** (`resolveRtxWorkspaceWorkingDir`), with temp-file + rename per file, hash re-check immediately before each rename, post-write verification, and compensating restore from a pre-apply snapshot. No terminal agent is in the write path. | RealTimeX has no Local-App-authenticated personality write API, no revision/etag/lock, and an LLM in the write path cannot be deterministic; Signals already writes briefs and `HEARTBEAT.md` this way. |
| D7 | A binding is exact: `{ workspaceSlug, workspaceId?, workspaceDir (realpath), selfContactId, representedOrgId, sourceHash, sourceRevisions, files[{path, fileHash, blockHash}], approval, appliedAt }`. Proposal and apply refuse a workspace whose slug, directory realpath, or self contact differ from the recorded binding. | "Exact workspace" is the safety property that keeps voices from crossing workspaces. |
| D8 | After application the Personality is authoritative. Manual edits to Personality files are **detected** (`drifted`) and surfaced; they are never reverse-written into contacts, orgs, or voice profiles. | Facts flow one way; the user's own prose in the workspace is theirs. |
| D9 | Writing variants record the Personality binding they were produced under (`metadata.writing.personality`). A new binding revokes pending approvals of variants bound to an older binding (`revokedReason: "personality_stale"`); `materialize_variant` and the G5 publish gate reject stale bindings. Queued/published artifacts are untouched. | Same mechanism as spine changes (§5.6 of the writing spec); no new state machine. |
| D10 | One workspace represents exactly one self contact and at most one org. The cross-owner fallback in voice-profile resolution is removed; profiles owned by another contact or by nobody are never eligible. Different people or incompatible brands use different workspaces (and, today, different `SIGNALS_DATA_DIR`s). A target-bound Personality model is named as a later option, not built. | "Incompatible voices cannot silently share a Personality" is enforced at the binding, the voice resolver, and the target. |
| D11 | Persistence is a Signals file store under `SIGNALS_DATA_DIR/personality/` (immutable proposals, atomically committed index, one lock) plus scalar keys in `config.json`. No DDL. New agent tools and REST routes only; no existing tool input schema changes. | Same reasoning as ADR-347-3/-4 and ADR-350-1; the store is a straight projection of any future table. |
| D12 | The presence mandate contract is defined with exactly one legal mode, `assist_only`, pinned by a static test. Adding any other mode requires a new ADR and owner sign-off. | The direction is agentic presence; this issue explicitly does not enable it. |

---

## 1. Problem and constraints

### 1.1 What exists today

**RealTimeX side** (verified in `realtimex-ai-app` at design time):

- A workspace's Personality is the set of markdown files at the workspace working directory root — `working-data/<slug>/` — following the "OpenClaw Agent Workspace" model: `AGENTS.md` (entry point; `CLAUDE.md` is a symlink to it), `SOUL.md`, `USER.md`, `IDENTITY.md`, `TOOLS.md`, `MEMORY.md`; `HEARTBEAT.md` is explicitly *not* Personality. `VOICE.md` and `BRAND.md` do not exist anywhere in the product today; they are new files this spec introduces, referenced from `AGENTS.md`.
- Terminal agents receive the Personality only through `cwd`: RealTimeX does not assemble a prompt from these files. Claude Code reads `CLAUDE.md`, Codex-style agents read `AGENTS.md`; other files are read only when `AGENTS.md` points at them. Changes are visible at the next spawn or when a running agent re-reads a file.
- Write surfaces: `PUT /api/workspace/:slug/personality-files/file` (whole-file replace, no etag, no lock, desktop-principal auth that **does not accept `x-app-id`**), `PUT /api/workspace/:slug/ambient-agent/files/content` (mtime `expectedUpdatedAt`, one file per call), and the `realtimex-pp-cli setup-personality` guide (read-only). No revision history, snapshot, rollback, diff UI, approval flow, MCP tool, `/sdk` endpoint, or permission exists for Personality.
- Managed-content precedents: `<!-- realtimex:companion-identity:start/end -->` in the global `IDENTITY.md`; plugin `workingDirectory.managedPaths` (Signals' plugin manages `AGENTS.md` on redeploy); the loops plugin's "AGENTS.md shim delegates to LOOP_ROLE.md" pattern.
- Workspace Personality directories are not scaffolded; a workspace may have zero Personality files.

**Signals side:**

- Signals has no Personality concept. The nearest things are the plugin's managed `openAiPrompt` and the `templates/signals/AGENTS.md` operating doctrine.
- Voice profiles (`src/lib/writing/voice-profile-store.ts`, ADR-347-4/ADR-350) are immutable versioned JSON documents with a content hash, user approval evidence, and `ownerContactId`. `getActiveVoiceProfileFor` and `resolveActiveVoiceProfileContext` fall back to **another owner's** approved profile when the self contact has none — a voice-leak path this spec closes.
- Represented identity: `contacts.isSelf` (one row, maintained by write-path swap, `getOwnerContactId()`); `orgs.ownerContactId` must reference a self contact (`OrgValidationError: "Company owner must be one of your profiles."`). ARPP/AROO are read-path JSON-LD projections with `meta.revision = updatedAt` and no content hash. `contact_personas` are structurally unreachable from ARPP (`ContactDTO` has no personas field).
- Workspace identity: Local Apps receive no workspace binding from the host. Signals resolves its workspace by `SIGNALS_RTX_WORKSPACE_SLUG` (default `"signals"`, `getSignalsRtxWorkspaceSlug`) and get-or-creates it; every dispatch (`run-template-via-rtx`, `send-to-agent`, persona jobs) uses that resolver. Signals already resolves the workspace *directory* (`resolveRtxWorkspaceWorkingDir`, `src/lib/rtx/storage-path.ts`) and writes into it directly (`workspace-brief-files.ts`, `deploy-snowball-seed-scout.ts` → `HEARTBEAT.md` task block).
- The plugin provisions a workspace with slug `f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f`; the runtime default is `"signals"`. These can be two different workspaces (§9.1).
- `platform_targets` have no owner/identity link; `metadata` JSON is the extension point. `platform_accounts` is read as a singleton per platform.

### 1.2 Requirements (from #373, restated as testable statements)

- **P1** Personality owns represented identity, values, boundaries, and voice; Signals owns mandates, overlays, opportunities, execution/session state, ledger, outcomes, and projection lineage.
- **P2** Only the self ARPP, an explicitly represented self-owned org AROO, an approved self-owned voice profile, and explicit user statements may project. `contact_personas`, CRM notes/stage/warmth/tags, `persona_jobs` output, niches, simulations, calibrations, non-self contacts, non-owned orgs, and other owners' voice profiles never do.
- **P3** Projection is exact-workspace-bound, diffable, explicit-approval-gated, applied with compare-and-swap and verification, provenance/hash-backed, rollback-capable, and preserves unmanaged content.
- **P4** Pending writing artifacts are re-audited when their bound Personality or source revision goes stale.
- **P5** Materially different people/brands cannot silently share a workspace Personality.
- **P6** Existing #346 contracts have a migration path; nothing enables autonomous external action.

---

## 2. Architecture overview

```
┌──────────────────────── Signals (Local App, owner of facts & lineage) ────────────────────────┐
│  contacts(isSelf) ─┐                                                                          │
│  orgs(ownerContactId=self, selected) ─┤  PersonalitySourceSnapshot  ──► render ──► blocks     │
│  voice profile (approved, owner=self) ─┤  (allowlisted, typed)          (pure)      (md)      │
│  statements.json (user-authored) ─────┘        │ sourceHash                   │ blockHash     │
│                                                ▼                              ▼               │
│  personality/ store: proposals/<prp>.json (immutable) · index.json (bindings) · snapshots/    │
│        propose ──► diff vs workspace files ──► approve(user evidence) ──► apply (CAS) ──► bind │
│  variants.metadata.writing.personality { bindingId, personalityHash }  ◄── upsert_variant     │
│  mandates (assist_only, dormant) · platform_targets.metadata.personality.represents           │
└───────────────┬────────────────────────────────────────────────────────────────▲──────────────┘
                │ direct fs (temp+rename, hash CAS)            agent-tools (localhost/bearer) │
┌───────────────▼──────────────────────────────────────────────────────────────┴──────────────┐
│  RealTimeX workspace working-data/<slug>/            (Personality = canonical live identity) │
│   AGENTS.md ──► (static pointer) IDENTITY.md · SOUL.md · VOICE.md · BRAND.md                  │
│                 each: [unmanaged user prose] + <!-- signals:personality:*:start/end --> block │
│   CLAUDE.md → AGENTS.md          HEARTBEAT.md (separate; Signals task block, not Personality) │
│                                                                                              │
│  Terminal agent (cwd = this dir): reads Personality natively; composes                       │
│   Personality ▸ mandate ▸ overlay ▸ conversation ▸ ledger for every decision (§7)             │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Ownership after this spec:

| State | Owner | Where | Notes |
|---|---|---|---|
| Represented identity, values, boundaries, voice (live) | **Workspace Personality** | `working-data/<slug>/{IDENTITY,SOUL,VOICE,BRAND}.md` | managed blocks come from Signals; unmanaged prose is the user's |
| Self facts, org facts | Signals | `contacts`, `orgs`, `org_domains`, `contact_identities` | never reverse-written from Personality |
| Voice evidence (samples, fingerprint, approval, versions) | Signals | voice-profile store | unchanged storage; demoted from "canonical voice" to "voice source" |
| User statements (values/boundaries) | Signals | `SIGNALS_DATA_DIR/personality/statements.json` | user-authored, hashed |
| Projection lineage (proposals, bindings, snapshots) | Signals | `SIGNALS_DATA_DIR/personality/` | §5 |
| Presence mandate | Signals | `SIGNALS_DATA_DIR/personality/mandates.json` | dormant, `assist_only` only (§7.2) |
| Platform overlay | `signals-writing` skill | overlays | unchanged |
| Opportunities, execution/session state, leases, targets | Signals | existing tables | unchanged |
| Action/conversation ledger, outcomes | Signals | `workflow_runs`, `publish_jobs`, `content_posts`, `engagement_metrics`, variants | unchanged |
| Operational doctrine, tools, memory, heartbeat | Workspace | `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md` | Signals writes only the `AGENTS.md` pointer block when missing (§4.4) and the existing `HEARTBEAT.md` task block |

---

## 3. Represented-identity sources and exclusions

### 3.1 Allowlist (the only inputs to the projection)

```ts
// src/lib/personality/sources.ts — the projection input. No other type may be passed.
type PersonalitySources = {
  self: {                       // contacts.isSelf === true; exactly one (getOwnerContactId())
    contact: ContactDTO;        // same DTO ARPP uses — it has no personas/relationship fields
    orgsById: Map<string, Org>; // for current employment title/org name only
  };
  org: {                        // present only when config.personalityProjection.representedOrgId is set
    org: Org;                   // MUST satisfy org.ownerContactId === self.contact.id
    domains: OrgDomain[];
    identities: OrgIdentity[];
  } | null;
  voice: VoiceProfile | null;   // MUST satisfy status === "approved" && ownerContactId === self.contact.id
  statements: PersonalityStatements | null;  // user-authored (§3.3)
};
```

Selection rules (`loadPersonalitySources()`; each is a tested refusal):

| Rule | Refusal | Code / reason |
|---|---|---|
| A1 | No `isSelf` contact | `NOT_FOUND` / `self_contact_missing` |
| A2 | `representedOrgId` names an org whose `ownerContactId !== self.id` (or a missing org) | `VALIDATION_ERROR` / `org_not_represented` |
| A3 | Voice profile candidates are only `listVoiceProfiles("approved")` filtered by `ownerContactId === self.id`; `ownerContactId: null` is **not** self | none eligible → `voice: null` and IDENTITY/BRAND/SOUL still project; `VOICE.md` block is removed if previously managed |
| A4 | A caller-supplied `voiceProfileId` that resolves to another owner, a draft, or a rejected version | `VALIDATION_ERROR` / `voice_not_self_owned` |
| A5 | Any `PersonalitySources` field other than the four above | TypeScript: the type is closed; the renderer takes only this type |

### 3.2 Exclusions (structural + tested)

The following never reach the renderer because the input type cannot carry them, and a sentinel
test (§10, X1–X7) proves the rendered files do not contain them:

- `contact_personas` (every field: `archetype`, `tone`, `summary`, `description`, `interests`, `conversionTriggers`, `engagementFormats`, `confidence`) and any `persona_jobs` output;
- relationship stage, warmth, notes, `funnelStage`, tags, raw `contacts.metadata`, private companion fields (the ARPP "never projected" list);
- any contact where `isSelf === false`; any org where `ownerContactId !== self.id`; any voice profile where `ownerContactId !== self.id`;
- niches, audience specs, simulation runs, calibrations, engagement metrics, recommendations;
- `org_email_patterns`, `contact_email_candidates`, MX evidence, `accountStage`, `fieldProvenance`;
- email addresses, phone numbers, timezone (even the self contact's — agents must not paste contact details into public posts);
- `local_only`-scoped identities and employments of the self contact (public-safe identity, §4.2);
- private launch sources, private claims, CRM-derived "conversion triggers" of any kind.

### 3.3 User statements

```ts
// SIGNALS_DATA_DIR/personality/statements.json
type PersonalityStatements = {
  schemaVersion: 1;
  values: string[];        // ≤ 12 items, ≤ 280 chars each, verbatim user text
  boundaries: string[];    // ≤ 12 items, ≤ 280 chars each, verbatim user text
  updatedAt: number;
  hash: string;            // sha256Canonical({ values, boundaries })
};
```

Statements are entered by the user (Settings UI or `upsert_personality_statements`), never
generated. They are the only free text Signals projects into `SOUL.md`.

---

## 4. Managed-block contract

### 4.1 Markers and block semantics

```
<!-- signals:personality:voice:start v=1 binding=pb_7f3a… source=1c9e0b2f4a71 -->
## Voice (managed by Signals)
…rendered markdown…
<!-- signals:personality:voice:end -->
```

- One block per `(file, section)`: `IDENTITY.md` ↔ `identity`, `VOICE.md` ↔ `voice`, `BRAND.md` ↔ `brand`, `SOUL.md` ↔ `boundaries`, `AGENTS.md` ↔ `index` (§4.4 only).
- `blockHash` = SHA-256 of the LF-normalized text strictly between the marker lines. The start-marker attributes (`binding`, `source`) are provenance for humans and drift diagnostics and are excluded from the hash, so rebinding identical content does not change `blockHash`.
- Everything outside the markers is **unmanaged** and is copied byte-for-byte (original EOL preserved, same as `heartbeat-task-block.ts`'s `detectEol`).
- Placement: an existing block is replaced in place; a missing block is appended after one blank line at end of file; a new file contains only the block. Duplicate blocks (manual copy-paste) are collapsed to the first, and the proposal reports `repair: "duplicate_block"`.
- Removal: when a section's source disappears (org deselected, voice profile rejected) the proposal removes the block; if the remaining file is whitespace-only the file is deleted (it was fully managed), otherwise the file stays without the block.
- Size cap: 16 KiB per block (`PERSONALITY_BLOCK_MAX_BYTES`); rendering beyond it is a `VALIDATION_ERROR` / `block_too_large` — bounded fingerprint arrays and the exemplar rule (§4.2) keep real blocks far below this.
- Signals never writes outside these five files in a Personality context and never touches `USER.md`, `TOOLS.md`, `MEMORY.md`, `memory/`, or `HEARTBEAT.md` here (the existing `HEARTBEAT.md` task-block writer keeps its own marker-free `tasks:` contract).

### 4.2 Rendered content (deterministic, pure functions of `PersonalitySources`)

`src/lib/personality/render.ts` exports one pure renderer per section. Determinism rules: sorted
keys, stable list order (by id or by the source's own order), no timestamps or run ids inside a
block (they live in the binding), LF line endings, no trailing whitespace.

| Section | File | Content (in this order) | Source fields |
|---|---|---|---|
| `identity` | `IDENTITY.md` | `## Identity (managed by Signals)`; Name; Preferred name (when distinct); Headline; Bio; Current role → "`<title>` at `<org.name>`" (highest-priority *shared* current employment, same selection rule as ARPP public mode); Website; Profiles list "`<network>` — `<url>`" for active, shared-scope identities; "Represents: self" and, when an org is selected, "Also represents: `<org.name>` (see BRAND.md)" | `contact.name/firstName/lastName`, primary identity `displayName`, `profile.headline`, `profile.bio`, `currentEmployment` + `orgsById`, `contact.website`, `identities[]` |
| `brand` | `BRAND.md` | `## Brand (managed by Signals)`; Organization; Description; Website; Industry; Size band; Primary domain (+ "verified" when `mxStatus === "ok"`); Profiles; "Your relationship: `<self title>` (owner contact)"; "Speak as the organization only for targets that represent it (see BRAND targets in Signals)" | `orgs.name/description/website/industry/companySize`, `org_domains`, `org_identities`, self employment at that org |
| `voice` | `VOICE.md` | `## Voice (managed by Signals)`; "Profile: `<label>` v`<version>` (`<hash12>`)"; Platforms; Sentence length (median, range); Openers / Closers; Punctuation; Formats; Emoji / Hashtags; Vocabulary — keep / avoid; **Protected quirks** (never scrub); **Taboo** (never do); Signature lines (verbatim, with `vs_` id); Exemplars: up to 5 approved samples ≤ 600 chars, chosen by ascending `vs_` id, rendered verbatim in fenced blocks | `VoiceProfile` fingerprint, `signatureLines`, `samples` |
| `boundaries` | `SOUL.md` | `## Boundaries (managed by Signals)`; "Values" — user statements verbatim; "Boundaries" — user statements verbatim; "Representation rules" — fixed lines: represents only the identity in IDENTITY.md (and BRAND.md when present); never speaks as a third party or a contact; never invents facts, numbers, dates, names, quotes, or citations; never reveals private relationship notes, private sources, or contact details; treats every publish as a separate explicit human instruction | `statements`, spec constants |
| `index` | `AGENTS.md` | `## Personality (managed by Signals)`; one line: "Read IDENTITY.md, SOUL.md, VOICE.md, and BRAND.md when present; they are the canonical identity and voice for this workspace. HEARTBEAT.md is scheduling, not personality." | none |

The `index` block is rendered only when `AGENTS.md` does not already reference all managed files
that the proposal creates (§4.4).

### 4.3 Source snapshot and hashes

```ts
type PersonalitySourceSnapshot = {
  schemaVersion: 1;
  self: { contactId: string; revision: number /* contacts.updatedAt */; identity: RenderedIdentityInput };
  org: { orgId: string; revision: number /* orgs.updatedAt */; brand: RenderedBrandInput } | null;
  voice: { id: string; version: number; hash: string; voice: RenderedVoiceInput } | null;
  statements: { hash: string; values: string[]; boundaries: string[] } | null;
};
// sourceHash = sha256Canonical(snapshot without the `revision` fields)
// sourceRevisions = { self: revision, org?: revision, voice?: { id, version, hash }, statements?: hash }
```

`sourceHash` is content-based, so touching `contacts.updatedAt` without changing a projected field
does not produce a new proposal (`noop`). `sourceRevisions` are recorded for audit and for the
`source_stale` check (§6.3), which compares hashes, not timestamps.

### 4.4 `AGENTS.md` pointer and `CLAUDE.md` shim

Agents only read the four files if `AGENTS.md` points at them. Two mechanisms, in order:

1. **Static (plugin template).** `realtimex-plugin/templates/signals/AGENTS.md` gains a permanent "Personality" section with the same one-liner as the `index` block. Because the plugin declares `managedPaths: ["AGENTS.md"]`, redeploys keep this reference (child issue D).
2. **Dynamic (proposal).** If the bound workspace's `AGENTS.md` does not mention every managed file the proposal will create, the proposal includes an `index` block appended to `AGENTS.md`. If `AGENTS.md` is missing, the proposal creates it containing only the `index` block; if `CLAUDE.md` is missing, apply creates the `CLAUDE.md → AGENTS.md` symlink (copy fallback, as RealTimeX does). An existing regular-file `CLAUDE.md` is never replaced; the proposal reports `warnings: ["claude_md_not_symlink"]`.

---

## 5. Proposal, approval, apply, rollback

### 5.1 Store

```
SIGNALS_DATA_DIR/personality/
  index.json                       # bindings by workspace key + proposal states (atomic replace, generation + hash CAS)
  proposals/<prp_id>.json          # immutable proposal documents
  snapshots/<pb_id>/<file>         # pre-apply copies of every touched file (rollback/restore source)
  statements.json                  # §3.3
  mandates.json                    # §7.2
  .store.lock                      # same pid/host/token lock protocol as voice-profiles/.store.lock
```

`src/lib/personality/store.ts` reuses the voice store's lock, immutable-install, and
generation-checked index commit. Dev may extract those primitives into a shared
`src/lib/store/` module if the voice-store tests keep passing unchanged; otherwise duplicate them
(the lock file identity is per store, so the two stores never contend).

```ts
type WorkspaceKey = string;  // sha256Canonical([workspaceSlug, workspaceDirRealpath]).slice(0, 32)

type PersonalityIndex = {
  schemaVersion: 1;
  generation: number;
  bindings: Record<WorkspaceKey, {
    workspaceSlug: string; workspaceId: string | null; workspaceDir: string;   // realpath at bind time
    active: PersonalityBinding | null;
    history: PersonalityBinding[];          // newest first, ≤ 50; older entries pruned with their snapshots
  }>;
  proposals: Record<`prp_${string}`, { state: ProposalState; workspaceKey: WorkspaceKey; at: number }>;
  updatedAt: number;
};

type ProposalState = "proposed" | "approved" | "applied" | "apply_failed" | "rejected" | "superseded" | "stale";
```

### 5.2 Proposal document (immutable)

```ts
type PersonalityProposal = {
  schemaVersion: 1;
  id: `prp_${string}`;
  kind: "projection" | "rollback" | "unbind";
  workspace: { slug: string; id: string | null; dir: string /* realpath */; key: WorkspaceKey };
  identity: { selfContactId: string; representedOrgId: string | null };
  basedOnBindingId: `pb_${string}` | null;       // active binding when proposed
  sourceSnapshot: PersonalitySourceSnapshot;      // rollback/unbind: the previous binding's snapshot / null
  sourceHash: string;
  files: {
    path: "IDENTITY.md" | "SOUL.md" | "VOICE.md" | "BRAND.md" | "AGENTS.md";
    section: "identity" | "boundaries" | "voice" | "brand" | "index";
    exists: boolean;
    currentFileHash: string | null;               // sha256 of the whole current file (CAS token)
    currentBlockHash: string | null;
    proposedBlock: string | null;                 // null = remove block
    proposedBlockHash: string | null;
    proposedFileHash: string | null;              // sha256 of the whole file after apply; null = delete file
    unmanagedBytes: number;                       // size of preserved content, for the UI
    diff: string;                                 // unified diff, whole file, for review
    repair?: "duplicate_block" | "missing_end_marker";
  }[];
  shim: { createClaudeSymlink: boolean };
  preflight: { warnings: string[] };              // e.g. claude_md_not_symlink, agents_md_plugin_managed
  proposalHash: string;                           // sha256Canonical({ sourceHash, files: [{path, currentFileHash, proposedBlockHash}] })
  noop: boolean;                                  // every file unchanged
  proposedBy: { kind: "ui" | "tool"; workflowRunId?: string; rtxThreadSlug?: string; at: number };
};
```

`propose` is idempotent: an existing `proposed` proposal for the same `workspace.key` with the
same `proposalHash` is returned. Any other `proposed` proposal for that workspace becomes
`superseded`. A `noop` proposal is returned but cannot be approved (`CONFLICT` / `proposal_noop`).

### 5.3 Approval

Approval is a user decision recorded on the proposal, never inferred:

```ts
approval: { by: "user"; at: number; evidence: ApprovalEvidence }   // same schema as the writing system
```

- UI: `POST /api/personality/proposals/:id/approve` with `{ kind: "ui", route }`.
- Agent: `approve_personality_projection` with `{ kind: "thread_message", workspaceSlug, threadSlug, note }` — the agent must render the diff card (§5.6) first, and the same MVP caveat as the writing spec §12.1 applies (the thread is auditable; the UI path is preferred).
- There is **no** policy-based approval for Personality; `writingApprovalPolicy` does not apply.
- Approval and apply happen in one call (like `materialize_variant`): approve validates, then applies (§5.4). If apply fails, the proposal is `apply_failed` and keeps its approval evidence for the retry (`retry_personality_projection` re-runs §5.4 with fresh CAS tokens only if the current files still match; otherwise → `stale`).

### 5.4 Apply algorithm (compare-and-swap, verify, compensate)

Under the personality store lock (`STORE_BUSY` after the bounded wait):

1. Resolve the workspace: `getSignalsRtxWorkspaceSlug(env)` → `GET /cli/get-workspace/:slug` (id, slug) → `resolveRtxWorkspaceWorkingDir` → `realpath`. Require slug, id (when previously recorded), and realpath to equal the proposal's `workspace`; require the realpath to be inside `resolveRtxStorageDir()/working-data/` with no symlink ancestor (mirror RealTimeX's containment rule). Else `CONFLICT` / `workspace_mismatch`; unresolvable directory → `WORKSPACE_UNAVAILABLE` (503).
2. Identity guard: if an active binding exists and its `selfContactId` differs from the proposal's → `CONFLICT` / `identity_mismatch` (the user must `unbind` first, §5.5).
3. Snapshot: copy every touched file that exists into `snapshots/<pb_id>/` and fsync.
4. For each file, in a fixed order (`AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md`): re-read; require `sha256(current) === currentFileHash` (and non-existence when `exists: false`); else abort → step 7 with `STORE_CONFLICT` / `file_changed`. Write the new content to a unique sibling temp file, fsync, and `rename` over the target (or `unlink` for deletion). The window between re-read and rename is the residual race with RealTimeX's own blind PUT; it is bounded by one file write and caught by step 5.
5. Verify: re-read every touched file and require `sha256 === proposedFileHash` (or absence). Create the `CLAUDE.md` symlink if requested and absent.
6. Commit the binding (generation-checked index replace):

```ts
type PersonalityBinding = {
  schemaVersion: 1;
  id: `pb_${string}`;
  proposalId: `prp_${string}`;
  kind: "projection" | "rollback" | "unbind";
  workspace: { slug: string; id: string | null; dir: string; key: WorkspaceKey };
  identity: { selfContactId: string; representedOrgId: string | null };
  sourceHash: string;                      // null-equivalent "" for unbind
  sourceRevisions: { self: number; org?: number; voice?: { id: string; version: number; hash: string }; statements?: string };
  files: { path: string; section: string; fileHash: string | null; blockHash: string | null }[];
  personalityHash: string;                 // sha256Canonical(files.map(f => [f.path, f.blockHash]))
  approval: { by: "user"; at: number; evidence: ApprovalEvidence };
  appliedAt: number;
  previousBindingId: `pb_${string}` | null;
  snapshotDir: string;
};
```

   The previous active binding moves to `history[0]`. The proposal becomes `applied`.
7. On any failure after step 3: restore every touched file from the snapshot with the same
   temp+rename discipline, verify, mark the proposal `apply_failed` with `{ step, reason }`, and
   keep the snapshot. If the restore itself fails, the proposal records `restore_failed` with the
   per-file state and the UI shows a manual-recovery panel listing snapshot paths; nothing else is
   mutated.
8. After commit (outside the lock, in the DB): revoke pending writing approvals bound to any older
   binding of this workspace (§6.2).

Atomicity statement: a multi-file write cannot be atomic on POSIX; the guarantee is *no partial
state survives* — either every file verifies against the proposal and the binding commits, or
every file is restored and no binding commits. Tests inject failures at each step (§10, W6).

### 5.5 Rollback and unbind

- `rollback_personality_projection { bindingId }` creates a `kind: "rollback"` proposal whose
  `proposedBlock` per file is that binding's block content (read from `snapshots/<bindingId>` for the
  files it changed, or from the binding's recorded block hashes when the current block still matches)
  and whose `currentFileHash` is the *current* file. It therefore preserves unmanaged content
  edited after the target binding and goes through the same approve/apply path. Rolling back to
  "no binding" is `kind: "unbind"`: every managed block is removed, `AGENTS.md`'s `index` block is
  removed, files that become empty are deleted, and the active binding becomes an `unbind` binding
  (history keeps everything).
- Rollback never restores unmanaged bytes from a snapshot (that would overwrite the user's later
  prose); snapshots exist for apply-failure compensation and for reading old block contents.

### 5.6 Review surfaces

- **Settings → Personality** (child issue E): workspace card (slug, directory, status, active binding, history), per-file unified diff with managed/unmanaged shading, Approve / Reject / Rollback, statements editor, represented-org picker, target representation table.
- **Thread card** (skill, child issue D): one card per proposal —

```
Personality proposal <prp_id>  ·  workspace <slug>  ·  self <name>  ·  org <name|none>
Sources   self rev <n> · org rev <n> · voice <label> v<version> (<hash12>) · statements <hash12>
Files     IDENTITY.md +12/-3 · VOICE.md new · BRAND.md removed · SOUL.md +4/-0 · AGENTS.md pointer added
Preserves <bytes> of unmanaged content across <n> files
Warnings  <list or none>
Next      approve <prp_id> | reject <prp_id>
```

The card is a projection of the persisted proposal; it never contains anything not persisted.

---

## 6. Consumption, binding of artifacts, and staleness

### 6.1 Runtime read

Agents read the four files from `cwd` natively. Signals reads the same files directly (fs) for
diff and drift. `get_personality_binding` and `get_writing_context.personality` report:

```ts
type PersonalityStatus = {
  workspace: { slug: string; dir: string | null };
  binding: Pick<PersonalityBinding, "id" | "sourceHash" | "personalityHash" | "appliedAt" | "identity" | "files"> | null;
  status: "bound" | "source_stale" | "drifted" | "unbound" | "unavailable";
  detail?: {
    sourceStale?: { self?: boolean; org?: boolean; voice?: boolean; statements?: boolean };  // hash comparisons
    drifted?: { path: string; reason: "block_edited" | "block_missing" | "file_missing" | "duplicate_block" }[];
    unavailable?: string;   // workspace dir unresolvable
  };
  compatibleTargets: string[];   // platform_targets ids whose `represents` matches the binding (§8.3)
};
```

`status` precedence: `unavailable` > `drifted` > `source_stale` > `bound`; `unbound` when no active
projection binding. `drifted` means the workspace files no longer match the binding (the user
edited a managed block, removed it, or deleted the file); `source_stale` means Signals facts
changed since the binding (a new proposal would not be `noop`).

### 6.2 Binding writing artifacts

`VariantWriting` (writing spec §5.4) gains an optional additive field:

```ts
personality?: { bindingId: `pb_${string}`; personalityHash: string; workspaceSlug: string } | null;
```

- The agent passes only `{ bindingId }`; `upsert_variant` resolves the active binding, requires
  `bindingId` to equal it (else `CONFLICT` / `personality_binding_stale`), and stamps
  `personalityHash` and `workspaceSlug` server-side (hashes are server-derived, ADR-350).
- `personality` joins the audit `inputHash` field list (§5.5 of the writing spec). Canonicalization
  drops `undefined`, so legacy variants without the field keep their existing hashes.
- Enforcement: when the workspace has an active projection binding and
  `generationMetadata.skill.version >= 0.3.0`, a `signals-writing` variant without `personality` is
  `VALIDATION_ERROR` / `personality_binding_required`. Older skill versions are accepted with
  `personality: null` (migration window, §9).
- Eager revocation (apply step 8): for every unqueued variant in this workspace whose
  `personality.bindingId` is not the new active binding → `approval.state = "revoked"`,
  `revokedReason: "personality_stale"`, materialized `approved` items return to `draft` (same
  transaction as spine-change revocation). Legacy variants with `personality: null` are **not**
  revoked by the first binding (they were never bound); they are flagged `personality: "unbound"` in
  context and Studio.
- Lazy checks: `materialize_variant` requires `personality.bindingId === active binding id` and
  `status ∈ {bound, source_stale}` (a `drifted` workspace blocks materialization with
  `AUDIT_STALE` / `personality_drifted` until re-applied or rolled back; `source_stale` only warns —
  facts changed, the voice the agent used is still what the workspace says). G5 rejects a writing
  item whose materialization snapshot's binding is no longer active with `WRITING_ARTIFACT_STALE`.
  Queued/publishing/published items are never mutated.

### 6.3 Stale sources

`source_stale` is computed on read by rebuilding the source snapshot and comparing per-source hashes
against the binding. It surfaces as: a Settings banner with "Review new proposal", a
`get_writing_context.personality.status` value the skill echoes on its approval card, and a
warning-class audit finding `core/voice/personality-source-stale` the skill records. It does not
revoke anything by itself — the user decides whether to re-project.

---

## 7. Runtime composition model

### 7.1 Composition order per decision or writing action

| Layer | Source | Owner | Read how | Authority |
|---|---|---|---|---|
| 1. Personality | `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md` (whole files, managed + unmanaged) | Workspace | cwd read, always first | who I am, how I sound, what I will not do |
| 2. Presence mandate | `mandates.json` via `get_writing_context.mandate` / `get_presence_mandate` | Signals | tool | what I may do, for which targets, under which approval policy (`assist_only` only) |
| 3. Platform overlay | `signals-writing/overlays/<platform>.md` | skill | skill load | how this network constrains the form |
| 4. Conversation context | thread, brief file, launch sources | Signals + thread | brief/tool | what this task is about |
| 5. Action/conversation ledger | variants, publish jobs, posts, metrics, workflow runs | Signals | tools | what already happened, what is pending |

Rules: a lower layer never overrides a higher one on identity or boundaries (an overlay may shorten
a sentence, never change who is speaking or lift a `SOUL.md` boundary); the mandate never expands
what Personality forbids; the ledger informs but never authorizes. Precedence among writing rule
classes is unchanged (`hard` > `claim` > `voice` > `heuristic` > `aesthetic`); `VOICE.md` is the
`voice` class's source of truth when a binding is active, with the voice profile ref kept for
attribution.

### 7.2 Presence mandate (defined, dormant)

```ts
// SIGNALS_DATA_DIR/personality/mandates.json
type PresenceMandate = {
  schemaVersion: 1;
  id: `pm_${string}`;
  workspaceKey: WorkspaceKey;
  mode: "assist_only";                             // PRESENCE_MANDATE_MODES = ["assist_only"] — static test pins this
  targets: { targetId: string; actions: ("draft" | "audit" | "propose_reply")[] }[];   // no execute/publish/react
  cadence: null;                                    // reserved; must be null in this epic
  approvalPolicy: "explicit";                       // reserved; must be "explicit" in this epic
  updatedAt: number; hash: string;
};
```

`assist_only` means: agents may observe, draft, audit, and propose; every external action remains
an explicit human instruction executed through the existing publish lane. The type exists so that
Creative Studio, the skill, and future issues speak one contract; enabling any other mode is a new
ADR with owner sign-off and is explicitly out of scope here (D12).

### 7.3 Ledger read-model (defined, not implemented)

`PresenceLedgerEntry = { at, workspaceKey, targetId?, kind: "observed" | "decided" | "drafted" | "approved" | "executed" | "verified" | "learned", ref: { variantId? | contentItemId? | publishJobId? | contentPostId? | workflowRunId? }, personality?: { bindingId }, mandateId? }` — a query-module projection over existing tables for later issues; no storage is added by this spec.

---

## 8. Multi-identity and multi-account isolation

### 8.1 Model

- **One workspace ↔ one self contact ↔ at most one represented org.** The binding records both;
  proposals for a different self contact are refused until the workspace is unbound (§5.4 step 2).
- **Different people → different workspaces.** Signals holds one `isSelf` contact per data
  directory, so representing two people today means two `SIGNALS_DATA_DIR`s and two workspaces.
  This is stated in docs; no multi-self model is added.
- **Brand vs person.** A self-owned org may share the person's workspace (BRAND.md next to
  IDENTITY.md) because the org's public voice is authored by that person. A brand with materially
  different voice or its own accounts should be a separate workspace with its own Signals data
  directory; a *target-bound Personality* (per-target `VOICE.md` variants) is named as a later option
  and not designed here.

### 8.2 Voice resolution (behavior change to #350 code)

- `getActiveVoiceProfileFor` drops the cross-owner fallback; `resolveActiveVoiceProfileContext`
  pools only `ownerContactId === self` profiles; `ownerContactId: null` profiles are reported as
  `unclaimed` candidates and are not eligible until claimed (§9.2).
- `get_writing_context.voice.status` gains `unclaimed_only` for that case; the skill asks the user
  to claim or build a profile instead of silently using someone else's voice.

### 8.3 Targets

`platform_targets.metadata.personality = { represents: "self" | `org:${orgId}` | "unbound", setAt, by }`
(JSON metadata, no DDL), set by `set_target_representation` or the Settings table.

- Defaults on first read: kind `account`/`profile` → `self`; kind `page`/`organization` → `unbound`.
- `PersonalityStatus.compatibleTargets` lists targets whose `represents` is `self`, or
  `org:<representedOrgId>` when the binding has that org.
- `materialize_variant` refuses a target outside `compatibleTargets` with `CONFLICT` /
  `target_identity_mismatch`; the skill's approval card shows the target's representation.
- Targets representing a different org than the bound one are the "incompatible voice" case: they
  are visible, clearly labelled, and unusable from this workspace until re-assigned or moved to a
  workspace bound to that org.

---

## 9. Migration and compatibility

### 9.1 Workspace slug reconciliation (risk)

Signals dispatches to `SIGNALS_RTX_WORKSPACE_SLUG` (default `"signals"`); the plugin provisions
`f3a8c2e1-…`. Personality binds to **the workspace Signals dispatches to** — that is where agents
run — using the same resolver as every dispatch path (invariant tested: projection and
`run-template-via-rtx` call `getSignalsRtxWorkspaceSlug`). Docs must say: when the plugin
provisioned the workspace, set `SIGNALS_RTX_WORKSPACE_SLUG` to its slug so provisioning, dispatch,
and Personality agree. Follow-up (not this epic): the plugin's Local App manifest passes the
provisioned slug as `SIGNALS_RTX_WORKSPACE_SLUG` automatically.

### 9.2 Voice profiles

- Storage, tools, V1–V7, and the store lock are unchanged. Semantics change: "canonical voice" →
  "approved voice-evidence source". `docs/local-app.md` and `core/voice.md` are reworded.
- Profiles with `ownerContactId: null` (created before a self contact existed) must be claimed:
  Settings shows "Unclaimed voice profiles"; claiming registers a new version with
  `ownerContactId = self` (content hash unchanged apart from that field, so V2 allocates a version)
  and the user re-approves it. No silent backfill.
- The removed fallback can change which profile `get_writing_context` returns for users who relied
  on it; the context reports `unclaimed_only`/`none` instead. Listed as a migration risk.

### 9.3 Writing runs, drafts, approvals

- Additive `metadata.writing.personality`; legacy variants unchanged and never revoked by the
  first binding. `revokedReason` enum widens with `personality_stale` (enum widening only).
- `materialize_variant`/G5 checks apply only to variants that carry a binding.
- `AttributionKey` gains optional `personalityBindingId` (null for legacy); #352 must not pool
  across bindings when both are present.

### 9.4 Skill, Creative Studio, calibration, platform adapters

- `signals-writing` 0.3.0 (child D): reads the four files before drafting, echoes
  `personality.status` and the binding on the approval card, passes `bindingId` to
  `upsert_variant`, renders the proposal card, and never edits Personality files itself.
- Creative Studio (#351): brief panel shows `PersonalityStatus`; variant board shows the binding
  and a `stale`/`drifted` badge; approve button disabled on `drifted`. #351 should rebase on child
  C's context fields.
- Calibration (#352): optional key field only.
- Platform adapters (#353): unaffected; new platforms get `represents` defaults by kind.
- Plugin: template `AGENTS.md` static Personality section; `realtimex.plugin.json`/`package.json`/
  `rtx-manifest.json` bump `0.2.3 → 0.2.4` with child D.

### 9.5 Concurrency with RealTimeX editors

RealTimeX's Personality UI PUT is a blind whole-file replace. The apply CAS + verify step makes a
lost update detectable, not impossible: if a UI save lands between step 4's re-read and rename,
step 5 fails verification and the apply is compensated. Users are told (Settings copy) not to edit
the workspace Personality while approving a proposal. A RealTimeX-side write API with etag and
`x-app-id` permission is the durable fix (§12, later item G).

---

## 10. Testable requirements

| ID | Requirement | Test shape | Owner |
|---|---|---|---|
| X1 | `PersonalitySources` cannot be constructed with a persona, relationship, niche, or simulation field (type-level `satisfies` test) and the renderer accepts only that type. | type test | A |
| X2 | A self contact with two `contact_personas` (sentinel strings in every persona field), relationship notes, tags, and funnel stage renders four files containing none of the sentinels. | unit | A |
| X3 | `representedOrgId` naming an org with `ownerContactId ≠ self` → `VALIDATION_ERROR` / `org_not_represented`; a non-self contact can never be the identity source. | unit | A |
| X4 | Voice candidates exclude other owners and `null` owners; `getActiveVoiceProfileFor` no longer falls back across owners (regression test for the removed branch). | unit | A |
| X5 | `local_only` identities/employments, email, phone, timezone never appear in `IDENTITY.md`; `org_email_patterns`, `accountStage`, `ownerContactId` never appear in `BRAND.md`. | unit | A |
| X6 | Rendering is deterministic: same sources → byte-identical blocks and hashes across two processes; no timestamp/run id inside a block. | unit | A |
| X7 | Statements are rendered verbatim and only from `statements.json`; a statement > 280 chars or > 12 items is rejected. | unit | A |
| W1 | Proposal against a file with unmanaged prose before and after the block preserves that prose byte-for-byte (CRLF fixture included) and the diff touches only the block. | unit | B |
| W2 | Apply with a changed `currentFileHash` → `STORE_CONFLICT` / `file_changed`, no file modified, proposal `stale`. | unit | B |
| W3 | Apply verifies every file's `proposedFileHash`; an injected mismatch triggers restore of all touched files to their snapshot and `apply_failed`. | fault injection | B |
| W4 | Two concurrent applies for one workspace serialize; the second sees `STORE_CONFLICT` or `STORE_BUSY`, never a mixed state; index generation increments once. | multi-process | B |
| W5 | Workspace mismatch (slug ok, realpath differs; or symlink ancestor) → `CONFLICT` / `workspace_mismatch`; unresolvable storage dir → `WORKSPACE_UNAVAILABLE`. | unit | B |
| W6 | Crash injection after each rename and before index commit leaves either fully-restored files with no new binding, or fully-applied files with the binding committed on retry (retry re-verifies file hashes). | fault injection | B |
| W7 | Rollback proposal restores the previous block while keeping unmanaged prose edited after the target binding; unbind removes all blocks, deletes fully-managed files, keeps files with unmanaged content. | unit | B |
| W8 | Drift detection: editing a managed block, deleting a block, deleting a file, duplicating a block each yield `drifted` with the right reason; `source_stale` reflects per-source hash changes and ignores a bare `updatedAt` touch. | unit | B |
| W9 | `AGENTS.md` pointer block is proposed only when the file lacks references; a missing `CLAUDE.md` becomes a symlink; an existing regular `CLAUDE.md` is untouched with a warning. | unit | B |
| W10 | Approval requires `by: "user"` with evidence; `noop` proposals cannot be approved; approving a `superseded` proposal → `CONFLICT`. | tool | B |
| C1 | `upsert_variant` with a stale `bindingId` → `CONFLICT` / `personality_binding_stale`; with the active one stamps server-derived `personalityHash`; legacy variants' `inputHash` is unchanged by the new field. | tool | C |
| C2 | A new binding revokes pending approvals of variants bound to the old binding and returns their unqueued `approved` items to `draft`; queued/published untouched; `personality: null` variants untouched. | unit | C |
| C3 | `materialize_variant` refuses `drifted` (`AUDIT_STALE` / `personality_drifted`) and target mismatch (`CONFLICT` / `target_identity_mismatch`); G5 refuses a stale binding with `WRITING_ARTIFACT_STALE`. | tool + route | C |
| C4 | `get_writing_context.personality` and `get_personality_binding` agree byte-for-byte on status for the same workspace state. | tool | C |
| C5 | `PRESENCE_MANDATE_MODES` equals `["assist_only"]`; a mandate with `cadence !== null`, `approvalPolicy !== "explicit"`, or an action outside `draft|audit|propose_reply` fails validation; no code path creates publish jobs from a mandate. | static + unit | C/F |
| D1 | The skill's proposal and approval cards contain only persisted fields; the packaged plugin zip contains the template `AGENTS.md` Personality section; `signals-writing` 0.3.0 passes `bindingId` and never writes `*.md` in the workspace root. | package + fixture | D |
| E1 | Settings diff view renders managed vs unmanaged regions from the proposal's `files[]` only; Approve is disabled for `noop`/`superseded`/`stale`. | component | E |
| S1 | Nothing in this epic creates a publish job, reply, comment, or reaction without the existing `send-to-agent` user path (static grep test over the new modules for `createPublishJob`/`send-to-agent` callers). | static | C |

---

## 11. Architecture decision records

### ADR-373-1: Workspace Personality is the canonical live social identity and voice; the voice store is an evidence source
**Status:** Accepted. Amends ADR-347-4 (its storage decision stands; its "canonical" clause is superseded). **Context:** Agents run with the workspace directory as `cwd` and read Personality natively; the writing system made a Signals file store canonical because RealTimeX could not read it. Two authorities would diverge the moment a user edits `SOUL.md`. **Options:** (a) keep the Signals store canonical and have the skill ignore Personality — rejected: the agent reads Personality anyway, so drift is guaranteed; (b) move voice evidence into RealTimeX files — rejected: samples, approvals, and versions need a structured, lockable store and Signals UI reads them; (c) Personality canonical for the live voice, Signals store as the approved evidence that *proposes* Personality content — chosen. **Consequences:** Signals never reverse-writes; variants bind to a Personality revision; the voice profile ref stays for attribution; `core/voice.md` and docs are reworded.

### ADR-373-2: Structural allowlist of represented-identity sources
**Status:** Accepted. **Context:** ARPP's `contact_personas` exclusion works because `ContactDTO` cannot carry personas. **Options:** (a) filter a rich context object — rejected: a new field later becomes a leak; (b) a closed `PersonalitySources` type with four members and refusal rules A1–A5, plus sentinel tests — chosen. **Consequences:** representing an org requires both ownership (`orgs.ownerContactId` is a self contact) and explicit selection; voice profiles owned by others or by nobody are never eligible; statements are the only free text and are user-authored.

### ADR-373-3: Managed blocks with HTML-comment markers; unmanaged content preserved
**Status:** Accepted. **Context:** Personality files are user-authored prose; RealTimeX already uses marker blocks and plugin `managedPaths`. **Options:** (a) whole-file ownership of the four files — rejected: users lose their own prose and the plugin's `managedPaths` would fight it; (b) separate Signals-only files (`SIGNALS_IDENTITY.md`) — rejected: agents would not read them and #373 names the target files; (c) one marker-delimited block per file, hash over the block body, everything else preserved — chosen. **Consequences:** deterministic renderers, per-file diffs, block-level drift detection, `AGENTS.md` gets only a pointer (static in the plugin template, dynamic only when missing).

### ADR-373-4: Signals applies directly to the workspace directory with compare-and-swap, verification, and compensation
**Status:** Accepted. **Context:** No Local-App-authenticated Personality write API exists; the REST PUT is blind; a terminal agent in the write path is non-deterministic; Signals already writes briefs and `HEARTBEAT.md` directly. **Options:** (a) terminal-agent-mediated apply — rejected for the write itself (kept for approval evidence and cards); (b) loopback REST without auth — rejected: undocumented contract, one file per call, no hash CAS; (c) new RealTimeX SDK endpoint — deferred (cross-repo, §12 G); (d) direct fs with whole-file hash CAS, temp+rename, post-verify, snapshot restore — chosen. **Consequences:** apply needs the desktop storage layout (`WORKSPACE_UNAVAILABLE` otherwise); residual race with RealTimeX editors is detected and compensated, not prevented; the store lock serializes Signals-side writers across processes.

### ADR-373-5: Exact binding = slug + workspace id + directory realpath + self contact
**Status:** Accepted. **Context:** Slugs are stable but the runtime default and the plugin slug can name different workspaces; Local Apps get no host binding. **Options:** (a) bind by slug only — rejected: a re-pointed `STORAGE_DIR` or a different desktop user would apply to the wrong directory; (b) bind by slug, id (when RealTimeX returns it), realpath, and identity, refusing any mismatch — chosen. **Consequences:** moving Signals to another machine/user requires an explicit re-bind (unbind + propose); the same resolver as dispatch is an invariant.

### ADR-373-6: Rollback is a proposal
**Status:** Accepted. **Context:** Restoring whole files from a snapshot would overwrite unmanaged prose written after the binding. **Options:** (a) snapshot restore — rejected; (b) a `rollback`/`unbind` proposal carrying the previous block contents through the same approve/apply path — chosen. **Consequences:** one write path to test; history is append-only; snapshots serve compensation and old-block reads only.

### ADR-373-7: Artifact binding, eager revocation on rebinding, lazy gates
**Status:** Accepted. **Context:** The writing system already revokes on spine change and gates at materialization and G5. **Options:** (a) a personality revision inside the audit `inputHash` only — rejected: the variant's own ref never changes, so staleness needs an explicit comparison; (b) additive `metadata.writing.personality`, eager revoke at apply, lazy checks at materialize/G5 — chosen. **Consequences:** `revokedReason: personality_stale`; `drifted` blocks materialization, `source_stale` warns; legacy unbound variants are grandfathered.

### ADR-373-8: One self and at most one org per workspace; no cross-owner voice fallback; target representation in metadata
**Status:** Accepted. **Context:** `getActiveVoiceProfileFor` falls back to another owner's profile; targets carry no identity link; `platform_accounts` is a per-platform singleton. **Options:** (a) target-bound Personality now — rejected: no product need yet, doubles the projection surface; (b) workspace-level identity guard + remove the fallback + `platform_targets.metadata.personality.represents` with defaults by kind and a materialization gate — chosen. **Consequences:** two people = two workspaces (and two data dirs today); pages default to `unbound` until assigned; the target-bound model remains an explicit later option.

### ADR-373-9: File store under `SIGNALS_DATA_DIR/personality/`, no DDL, new tools only
**Status:** Accepted. **Context:** ADR-347-3/-4, ADR-350-1, `AGENTS.md` migration gate, frozen agent-tool input schemas. **Options:** (a) tables now — rejected; (b) reuse the voice store's lock/immutable/CAS protocol in a sibling store, scalars in `config.json`, output-only extensions to `get_writing_context`, new tools/routes for everything else — chosen. **Consequences:** `AgentToolErrorCode` gains `WORKSPACE_UNAVAILABLE` (503); backups must include `personality/` (docs); a `personality_bindings` table is a later straight projection if cross-machine sync is needed.

### ADR-373-10: Presence mandate exists as a contract with a single legal mode
**Status:** Accepted. **Context:** #373 forbids autonomous external action while pointing at agentic presence. **Options:** (a) omit the mandate until needed — rejected: Studio, skill, and context would each invent one; (b) define the type now, pin `assist_only` with a static test, forbid `cadence`/policy values, and require a new ADR for any other mode — chosen. **Consequences:** future issues extend an existing contract; nothing in this epic can schedule or execute an external action.

---

## 12. Dependency-ordered implementation plan

```
#373 (this spec + writing-spec amendment; Dev lands as spec-only PR)
  └─► A sources+render ─► B projection store/apply/rollback/tools/REST ─► C writing binding + gates ─► D skill 0.3 + plugin template
                                                                          └─► F mandate contract (dormant)      └─► E Settings → Personality UI
#351 Creative Studio rebases on C · #352 reads the optional attribution field · #353 unaffected
Later (own ADRs): G RealTimeX SDK personality write endpoint (etag + x-app-id permission) · H target-bound Personality · I any non-assist mandate mode
```

Child issues (file from these bodies; each gets its own loop; none expands the #373 PR):

| Order | Issue | Title | Delivers | Tests |
|---|---|---|---|---|
| 1 | **A** | Personality sources, exclusions, and deterministic renderers | `src/lib/personality/{sources,render,snapshot,statements}.ts`, `contracts.ts` (Zod: statements, snapshot, proposal, binding, status, mandate), config key `personalityProjection { representedOrgId }`, voice-resolver fallback removal + `unclaimed_only`, `upsert_personality_statements` + `GET/PUT /api/personality/statements`, docs | X1–X7, voice regression |
| 2 | **B** | Personality projection store: propose, approve/apply, rollback, drift | `src/lib/personality/{store,workspace,diff,apply}.ts`, `AGENTS.md` pointer + `CLAUDE.md` shim, tools `get_personality_binding`, `propose_personality_projection`, `approve_personality_projection`, `retry_personality_projection`, `rollback_personality_projection`, `unbind_personality_projection`, REST `/api/personality/{binding,proposals,proposals/:id/approve|reject,rollback,unbind}`, `WORKSPACE_UNAVAILABLE`, `docs/agent-tools.md` + OpenAPI, backup note in `docs/local-app.md` | W1–W10 |
| 3 | **C** | Bind writing artifacts to Personality; stale re-audit; target representation | `metadata.writing.personality` (contracts + `inputHash` field list), `upsert_variant` binding validation, eager revoke on rebinding, `materialize_variant`/G5 checks, `get_writing_context.personality` + `voice.status` values + `targets[].represents`, `set_target_representation` + REST, `AttributionKey.personalityBindingId`, `revokedReason: personality_stale` | C1–C4, S1 |
| 3′ | **F** | Presence mandate contract (dormant) | `mandates.json` store, `PRESENCE_MANDATE_MODES`, `get_presence_mandate`/`upsert_presence_mandate` (assist_only only), `get_writing_context.mandate`, ledger read-model type only | C5 |
| 4 | **D** | `signals-writing` 0.3.0: Personality-first drafting, proposal/approval cards; plugin template | `SKILL.md`/`core/voice.md`/`core/approval.md` updates, `personality` in `reference.md`, cards, `templates/signals/AGENTS.md` Personality section, package test, version `0.2.4` | D1, R7/R8 still green |
| 5 | **E** | Settings → Personality: workspace status, diff review, approve/rollback, statements, org picker, target table | routes/components over B/C REST; no new writing state | E1 |

Acceptance for #373's own PR: this file, the writing-spec amendment, and no product code.
Acceptance for the epic (after E): #373's checklist items all satisfied by A–E's tests; no autonomous
posting path exists (S1 + C5).

---

## 13. Risks and open questions (non-blocking; defaults stated)

1. **Slug mismatch** (§9.1). Default: bind to the dispatch slug; document `SIGNALS_RTX_WORKSPACE_SLUG`; plugin passes it later.
2. **Editor race** (§9.5). Default: detect + compensate; RealTimeX write API later (G).
3. **Removed voice fallback** (§9.2). Default: ship with `unclaimed_only` messaging and the claim flow in A/E; announce in release notes.
4. **Skill version gate** for `personality_binding_required` (0.3.0). Default: warn-only before D lands; enforce with D.
5. **Standalone dev without the desktop layout** → `WORKSPACE_UNAVAILABLE`. Default: Settings shows the same message as brief-file failures; no fallback write path.
6. **Exemplar samples in `VOICE.md`** put self-authored text into the workspace directory. Default: acceptable (the user approved the samples and the proposal shows them); cap 5 × 600 chars.
7. **Snapshot growth**: ≤ 50 bindings per workspace retained with their snapshots; older pruned on commit. Default as stated.
8. **Org selection UX** when the self contact owns several orgs: single picker, default none. Multi-org representation is not supported in one workspace (D10).
