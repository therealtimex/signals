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
| D3 | Only four represented-identity sources may project into Personality: the `contacts.isSelf` ARPP → `IDENTITY.md`; an explicitly selected org whose `ownerContactId` is that self contact (AROO) → `BRAND.md`; the approved voice profile owned by that self contact → `VOICE.md`; user-authored statements plus fixed representation boundaries → `SOUL.md`. Rich DB rows stop at the loader: the renderer accepts only narrow, allowlisted `Rendered*Input` values that cannot carry persona, relationship, audience, contact-detail, provenance, or third-party fields. | Exclusion must be structural at the renderer boundary, not a filter that a later DB field can bypass. |
| D4 | Projection = deterministic **managed blocks** inside Personality files, delimited by `<!-- signals:personality:<section>:start/end -->` markers. Everything outside a block is preserved byte-for-byte. Signals never writes `USER.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`, or `memory/`. | RealTimeX already uses this marker pattern (`realtimex:companion-identity`) and the plugin `managedPaths` model; users keep authoring their own Personality around the managed parts. |
| D5 | Proposal-based lifecycle: `sources → source snapshot + hash → rendered blocks + exact final files → per-file diff → explicit user approval → host-coordinated compare-and-swap apply → binding record`. A proposal allocates its binding id before rendering, so every reviewed marker and hash is final. Rollback is a proposal whose block bodies come from the previous binding's proposal. | Every write is reviewable, hash-bound, and reversible through one code path. |
| D6 | **Signals never writes Personality files directly.** Apply uses a prerequisite RealTimeX SDK batch endpoint whose per-workspace writer coordinator is shared by the Personality UI and Local Apps. The UI PUT is upgraded to require the hash/etag returned when its editor loaded; the host revalidates every writer's expected whole-file hashes while holding the coordinator, writes/compensates as one durable transaction, and returns committed hashes. No terminal agent or LLM is in the write path. | A shared lock around a still-blind UI is insufficient: a stale UI save could wait and then overwrite the transaction. Every supported writer must coordinate **and** compare its read revision before Signals can ship apply. |
| D7 | A binding is exact: `{ workspaceSlug, workspaceId?, workspaceDir (realpath), selfContactId, representedOrgId, sourceHash, sourceRevisions, files[{path, fileHash, blockHash}], personalityHash, approval, appliedAt }`. `personalityHash` covers the exact whole bytes (managed + unmanaged) of the four social Personality files. Proposal and apply refuse a workspace whose slug, directory realpath, self contact, or expected file revision differs. | "Exact workspace + exact effective Personality revision" keeps voices from crossing workspaces and makes user prose part of the artifact boundary. |
| D8 | After application the whole social Personality is authoritative. Any manual change to managed **or unmanaged** bytes is `drifted`; bound artifacts fail lazy stale checks until the user approves a new projection that preserves/adopts unmanaged prose, corrects managed blocks from sources, and creates a new binding revision. Personality edits are never reverse-written into contacts, orgs, or voice profiles. | Facts flow one way, while user-authored workspace prose still changes the voice agents actually read and therefore must change the revision. |
| D9 | Writing variants record the Personality binding they were produced under (`metadata.writing.personality`). A new binding revokes pending approvals of variants bound to an older binding (`revokedReason: "personality_stale"`); `materialize_variant` and the G5 publish gate reject stale bindings. Queued/published artifacts are untouched. | Same mechanism as spine changes (§5.6 of the writing spec); no new state machine. |
| D10 | One workspace represents exactly one self contact and at most one org. The cross-owner fallback in voice-profile resolution is removed; profiles owned by another contact or by nobody are never eligible. Every legacy or new platform target defaults to `unbound` unless ownership is verifiably derived; assigning a concrete `{ kind: "self", contactId }` or `{ kind: "org", orgId }` requires explicit user evidence. Different people or incompatible brands use different workspaces (and, today, different `SIGNALS_DATA_DIR`s). | "Incompatible voices cannot silently share a Personality" is enforced at the binding, the voice resolver, and an explicit target decision. |
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
- **P3** Projection is exact-workspace-bound, diffable, explicit-approval-gated, applied through a host coordinator shared by every supported writer with whole-file compare-and-swap and verification, provenance/hash-backed, rollback-capable, and preserves unmanaged content.
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
│  personality/ store: proposals/<prp>.json (immutable exact files) · index.json (bindings)     │
│        propose ──► diff vs workspace files ──► approve(user evidence) ──► host CAS tx ──► bind │
│  variants.metadata.writing.personality { bindingId, personalityHash }  ◄── upsert_variant     │
│  mandates (assist_only, dormant) · platform_targets.metadata.personality.represents           │
└───────────────┬────────────────────────────────────────────────────────────────▲──────────────┘
                │ RTX SDK batch write (shared writer lock)      agent-tools (localhost/bearer) │
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
| Projection lineage (proposals, bindings, whole-file revisions) | Signals | `SIGNALS_DATA_DIR/personality/` | §5; RealTimeX owns transient transaction before-images |
| Presence mandate | Signals | `SIGNALS_DATA_DIR/personality/mandates.json` | dormant, `assist_only` only (§7.2) |
| Platform overlay | `signals-writing` skill | overlays | unchanged |
| Opportunities, execution/session state, leases, targets | Signals | existing tables | unchanged |
| Action/conversation ledger, outcomes | Signals | `workflow_runs`, `publish_jobs`, `content_posts`, `engagement_metrics`, variants | unchanged |
| Operational doctrine, tools, memory, heartbeat | Workspace | `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md` | Signals writes only the `AGENTS.md` pointer block when missing (§4.4) and the existing `HEARTBEAT.md` task block |

---

## 3. Represented-identity sources and exclusions

### 3.1 Allowlist (the only inputs to the projection)

```ts
// src/lib/personality/sources.ts — rich DB records never cross this module boundary.
declare const rendererInput: unique symbol; // not exported; only strict adapters may brand values

type PublicProfileInput = { network: string; url: string; displayName: string | null };
type RenderedIdentityInput = {
  contactId: string;
  name: string;
  preferredName: string | null;
  headline: string | null;
  bio: string | null;
  currentRole: { title: string; orgName: string } | null;
  website: string | null;
  profiles: PublicProfileInput[];
  representedOrgName: string | null;
  readonly [rendererInput]: "identity";
};
type RenderedBrandInput = {
  orgId: string;
  name: string;
  description: string | null;
  website: string | null;
  industry: string | null;
  companySize: string | null;
  primaryDomain: { domain: string; verified: boolean } | null;
  profiles: PublicProfileInput[];
  selfRelationshipTitle: string | null;
  readonly [rendererInput]: "brand";
};
type RenderedVoiceInput = {
  profile: { id: string; label: string; version: number; hash: string };
  platforms: string[];
  sentenceLength: { median: number; range: [number, number] } | null;
  openers: string[]; closers: string[]; punctuation: string[]; formats: string[];
  emoji: string[]; hashtags: string[];
  vocabulary: { keep: string[]; avoid: string[] };
  protectedQuirks: string[]; taboo: string[];
  signatureLines: { id: `vs_${string}`; text: string }[];
  exemplars: { id: `vs_${string}`; text: string }[];
  readonly [rendererInput]: "voice";
};

// The projection input. render.ts accepts this opaque output and no DB/entity type.
type PersonalitySources = {
  identity: RenderedIdentityInput;
  brand: RenderedBrandInput | null;
  voice: RenderedVoiceInput | null;
  statements: PersonalityStatements | null;  // user-authored (§3.3)
};
```

`loadPersonalitySources()` may read `ContactDTO`, `Org`, `OrgDomain`, `OrgIdentity`, and
`VoiceProfile` only long enough to validate ownership/public scope and construct explicit object
literals for `toRenderedIdentityInput`, `toRenderedBrandInput`, and `toRenderedVoiceInput`. Each
adapter parses a `.strict()` Zod schema, sorts/bounds arrays, and adds the unexported brand. Unknown
keys are rejected rather than stripped silently. Neither `render.ts` nor the persisted source
snapshot imports a DB row/entity type. This double boundary matters because TypeScript's ordinary
structural assignability alone would allow a rich object with extra private fields.

Selection rules (`loadPersonalitySources()`; each is a tested refusal):

| Rule | Refusal | Code / reason |
|---|---|---|
| A1 | No `isSelf` contact | `NOT_FOUND` / `self_contact_missing` |
| A2 | `representedOrgId` names an org whose `ownerContactId !== self.id` (or a missing org) | `VALIDATION_ERROR` / `org_not_represented` before `RenderedBrandInput` construction |
| A3 | Voice profile candidates are only `listVoiceProfiles("approved")` filtered by `ownerContactId === self.id`; `ownerContactId: null` is **not** self | none eligible → `voice: null` and IDENTITY/BRAND/SOUL still project; `VOICE.md` block is removed if previously managed |
| A4 | A caller-supplied `voiceProfileId` that resolves to another owner, a draft, or a rejected version | `VALIDATION_ERROR` / `voice_not_self_owned` |
| A5 | Any unknown key at any `Rendered*Input` depth, or an attempt to call the renderer with an unbranded/rich entity | strict-schema refusal; type test rejects the call |

### 3.2 Exclusions (structural + tested)

The following never reach the renderer because the loader's strict adapter output cannot carry
them. Sentinel tests (§10, X1–X7) assert both the serialized adapter output and rendered files do
not contain them:

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
| `identity` | `IDENTITY.md` | `## Identity (managed by Signals)`; Name; Preferred name (when distinct); Headline; Bio; Current role → "`<title>` at `<org.name>`" (highest-priority *shared* current employment, same selection rule as ARPP public mode); Website; Profiles list "`<network>` — `<url>`" for active, shared-scope identities; "Represents: self" and, when an org is selected, "Also represents: `<org.name>` (see BRAND.md)" | `RenderedIdentityInput` only |
| `brand` | `BRAND.md` | `## Brand (managed by Signals)`; Organization; Description; Website; Industry; Size band; Primary domain (+ "verified" when `mxStatus === "ok"`); Profiles; "Your relationship: `<self title>` (owner contact)"; "Speak as the organization only for targets that represent it (see BRAND targets in Signals)" | `RenderedBrandInput` only |
| `voice` | `VOICE.md` | `## Voice (managed by Signals)`; "Profile: `<label>` v`<version>` (`<hash12>`)"; Platforms; Sentence length (median, range); Openers / Closers; Punctuation; Formats; Emoji / Hashtags; Vocabulary — keep / avoid; **Protected quirks** (never scrub); **Taboo** (never do); Signature lines (verbatim, with `vs_` id); Exemplars: up to 5 approved samples ≤ 600 chars, chosen by ascending `vs_` id, rendered verbatim in fenced blocks | `RenderedVoiceInput` only |
| `boundaries` | `SOUL.md` | `## Boundaries (managed by Signals)`; "Values" — user statements verbatim; "Boundaries" — user statements verbatim; "Representation rules" — fixed lines: represents only the identity in IDENTITY.md (and BRAND.md when present); never speaks as a third party or a contact; never invents facts, numbers, dates, names, quotes, or citations; never reveals private relationship notes, private sources, or contact details; treats every publish as a separate explicit human instruction | `statements`, spec constants |
| `index` | `AGENTS.md` | `## Personality (managed by Signals)`; one line: "Read IDENTITY.md, SOUL.md, VOICE.md, and BRAND.md when present; they are the canonical identity and voice for this workspace. HEARTBEAT.md is scheduling, not personality." | none |

The `index` block is rendered only when `AGENTS.md` does not already reference all managed files
that the proposal creates (§4.4).

### 4.3 Source snapshot and hashes

```ts
type PersonalitySourceSnapshot = {
  schemaVersion: 1;
  self: { contactId: string; revision: number /* contacts.updatedAt */; input: RenderedIdentityInput };
  org: { orgId: string; revision: number /* orgs.updatedAt */; input: RenderedBrandInput } | null;
  voice: { id: string; version: number; hash: string; input: RenderedVoiceInput } | null;
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
    history: PersonalityBinding[];          // newest first, ≤ 50; older entries pruned with unreferenced proposals
  }>;
  proposals: Record<`prp_${string}`, PersonalityProposalRecord>;
  updatedAt: number;
};

type ProposalState = "proposed" | "approved" | "applying" | "applied" | "apply_failed" | "rejected" | "superseded" | "stale";
type PersonalityProposalRecord = {
  state: ProposalState;
  workspaceKey: WorkspaceKey;
  updatedAt: number;
  approval: { by: "user"; at: number; evidence: ApprovalEvidence } | null;
  attempt: {
    bindingId: `pb_${string}`;      // always equals immutable proposal.proposedBindingId
    hostTransactionId: string;
    phase: "prepared" | "submitted" | "committing";
    startedAt: number;
  } | null;
  failure: { step: string; reason: string; hostRecovery?: { transactionId: string; status: string } } | null;
};
```

Proposal documents remain immutable; this index record is the mutable state machine and durable
apply journal. Approval evidence and failure/retry state live here until a successful binding
copies the approval into `PersonalityBinding`. An immutable proposal referenced by any retained
binding/history entry is retained with that entry; pruning a history entry prunes its proposal
only when no other retained binding references it.

### 5.2 Proposal document (immutable)

```ts
type PersonalityProposal = {
  schemaVersion: 1;
  id: `prp_${string}`;
  kind: "projection" | "rollback" | "unbind";
  proposedBindingId: `pb_${string}`;             // allocated before any marker/file is rendered
  workspace: { slug: string; id: string | null; dir: string /* realpath */; key: WorkspaceKey };
  identity: { selfContactId: string; representedOrgId: string | null };
  basedOnBindingId: `pb_${string}` | null;       // active binding when proposed
  sourceSnapshot: PersonalitySourceSnapshot | null; // rollback: target binding's source snapshot; unbind: null
  sourceHash: string;
  files: {
    path: "IDENTITY.md" | "SOUL.md" | "VOICE.md" | "BRAND.md" | "AGENTS.md";
    section: "identity" | "boundaries" | "voice" | "brand" | "index";
    exists: boolean;
    bindingFileHash: string | null;               // exact whole-file baseline of basedOnBindingId
    currentFileHash: string | null;               // sha256 of the whole current file (CAS token)
    currentBlockHash: string | null;
    proposedBlock: string | null;                 // final marker uses proposedBindingId; null = remove block
    proposedBlockHash: string | null;
    proposedFile: string | null;                  // exact reviewed final bytes; null = delete file
    proposedFileHash: string | null;              // sha256 of the whole file after apply; null = delete file
    unmanagedBytes: number;                       // size of preserved content, for the UI
    driftDiff: string | null;                     // prior binding proposedFile → current file, when drifted
    diff: string;                                 // current file → proposedFile, whole file, for review
    repair?: "duplicate_block" | "missing_end_marker";
  }[];
  shim: { createClaudeSymlink: boolean };
  preflight: { warnings: string[] };              // e.g. claude_md_not_symlink, agents_md_plugin_managed
  intentHash: string;                             // semantic intent before allocating ids/rewriting marker provenance
  proposalHash: string;                           // hash of all apply-relevant fields (excludes proposedBy/proposalHash)
  noop: boolean;                                  // source + exact whole-file revision already equal active binding
  proposedBy: { kind: "ui" | "tool"; workflowRunId?: string; rtxThreadSlug?: string; at: number };
};
```

Under the store lock, `propose` first computes `intentHash` from kind, workspace, identity,
`basedOnBindingId`, source hash, current whole-file hashes, and desired block **body** hashes (the
future binding marker is excluded). If an existing `proposed` record has that intent it is returned
with its already allocated ids and byte-identical final files. Otherwise the store allocates
`prp_id` and `proposedBindingId`, renders every start marker with that binding id, builds the exact
`proposedFile`, then persists the immutable document. Thus an approvable proposal never contains a
placeholder and apply never changes reviewed bytes. A semantically unchanged, non-drifted active
binding returns a `noop` document whose `proposedBindingId` is the active id and whose files are
unchanged; it cannot be approved (`CONFLICT` / `proposal_noop`). Any other `proposed` proposal for
the workspace becomes `superseded`.

### 5.3 Approval

Approval is a user decision recorded on the proposal, never inferred:

```ts
approval: { by: "user"; at: number; evidence: ApprovalEvidence }   // same schema as the writing system
```

- UI: `POST /api/personality/proposals/:id/approve` with `{ kind: "ui", route }`.
- Agent: `approve_personality_projection` with `{ kind: "thread_message", workspaceSlug, threadSlug, note }` — the agent must render the diff card (§5.6) first, and the same MVP caveat as the writing spec §12.1 applies (the thread is auditable; the UI path is preferred).
- There is **no** policy-based approval for Personality; `writingApprovalPolicy` does not apply.
- The immutable proposal document is never rewritten. Approval evidence, the active apply attempt,
  and failure details are generation-checked fields in its `PersonalityProposalRecord` (§5.1).
- Approval and apply happen in one call (like `materialize_variant`): approve validates, persists
  the user evidence, then applies (§5.4). A pre-mutation host CAS conflict makes the proposal
  `stale`; a host write/verification/recovery failure makes it `apply_failed` and retains approval
  for explicit retry. `retry_personality_projection` reuses the immutable exact file request and
  its idempotent host transaction id; it never refreshes CAS tokens or rewrites proposal bytes.

### 5.4 Apply algorithm (host-coordinated compare-and-swap, verify, compensate)

Child B's apply path is blocked on child G (§12): RealTimeX must first expose an authenticated SDK
batch endpoint, return whole-file hash/etag values from UI reads, require that expected value on UI
writes, and move both paths onto the same per-workspace writer coordinator. The minimum SDK host
contract is:

```ts
PUT /sdk/workspaces/:slug/personality-files/transactions
// authenticated by x-app-id + workspace.personality.write permission
{
  schemaVersion: 1; transactionId: string; workspaceId: string | null;
  files: { path: string; expectedFileHash: string | null; proposedFile: string | null;
           proposedFileHash: string | null }[];
  claudeShim: { createIfAbsent: boolean };
}
// success: { transactionId, status: "committed", files: { path, fileHash }[], shimCreated }
```

The host acquires the same coordinator for SDK transactions and UI/other supported Personality
writes. Every supported writer carries the hash it read; while holding the coordinator, the host
revalidates that hash (all hashes together for the SDK batch) before its first mutation,
persists a durable before-image journal, writes fixed-order sibling temps + renames, verifies every
final hash, and either commits or compensates/verify-restores every touched path. `transactionId`
is idempotent; a retry reads or completes the durable host journal. Therefore an editor save that
wins the coordinator first changes the hash and makes the SDK fail pre-mutation with
`409 file_changed`; one based on old bytes that arrives second waits, revalidates, and itself gets
`409 file_changed` rather than overwriting the transaction. Neither update can be silently lost.

Under the Signals personality store lock (`STORE_BUSY` after the bounded wait):

1. Resolve the workspace: `getSignalsRtxWorkspaceSlug(env)` → `GET /cli/get-workspace/:slug` (id, slug) → `resolveRtxWorkspaceWorkingDir` → `realpath`. Require slug, id (when previously recorded), and realpath to equal the proposal's `workspace`; require the realpath to be inside `resolveRtxStorageDir()/working-data/` with no symlink ancestor (mirror RealTimeX's containment rule). Else `CONFLICT` / `workspace_mismatch`; unresolvable directory → `WORKSPACE_UNAVAILABLE` (503).
2. Identity guard: if an active binding exists and its `selfContactId` differs from the proposal's → `CONFLICT` / `identity_mismatch` (the user must `unbind` first, §5.5).
3. Provenance guard: require every non-null `proposedBlock` start marker to name exactly
   `proposal.proposedBindingId`; recompute every proposed block/file hash and `proposalHash`. A
   mismatch is `STORE_CORRUPT` before any host call.
4. Journal: generation-check and commit the proposal record as `applying`, with
   `bindingId = proposedBindingId`, deterministic
   `hostTransactionId = personality:<workspaceKey>:<proposalId>`, and phase `prepared`. This is
   durable before the host request.
5. Set phase `submitted` and call the host transaction with every touched file's exact immutable
   `currentFileHash`, `proposedFile`, and `proposedFileHash`. A host `409 file_changed` is known to
   occur before mutation: mark the proposal `stale`, clear the attempt, return `STORE_CONFLICT` /
   `file_changed`, and require a new reviewed proposal. A host `restored_failure` becomes
   `apply_failed`; `recovery_required` records the transaction id and blocks new applies until
   explicit retry resolves the host journal. No binding commits for either failure.
6. On host `committed`, require the returned path set and hashes to equal the immutable proposal.
   Any impossible response mismatch is `apply_failed / host_verification_mismatch` and invokes
   the host transaction's compensation/recovery operation; Signals never repairs files itself.
7. Set phase `committing` and commit the binding and terminal proposal state in one
   generation-checked index replace:

```ts
type PersonalityBinding = {
  schemaVersion: 1;
  id: `pb_${string}`;
  proposalId: `prp_${string}`;
  kind: "projection" | "rollback" | "unbind";
  workspace: { slug: string; id: string | null; dir: string; key: WorkspaceKey };
  identity: { selfContactId: string; representedOrgId: string | null };
  sourceHash: string;                      // null-equivalent "" for unbind
  sourceRevisions: { self: number; org?: number; voice?: { id: string; version: number; hash: string }; statements?: string } | null; // null for unbind
  files: { path: string; section: string; fileHash: string | null; blockHash: string | null }[];
  personalityHash: string;                 // §6.1 exact whole-file social Personality revision
  approval: { by: "user"; at: number; evidence: ApprovalEvidence };
  appliedAt: number;
  previousBindingId: `pb_${string}` | null;
  hostTransactionId: string;
};
```

   For a projection or rollback, the previous active binding moves to `history[0]`, the new
   binding becomes `active`, and the proposal becomes `applied`. For an unbind, both the previous
   binding and the new unbind audit binding move to history, `active` becomes `null`, and the
   proposal becomes `applied`; this is what permits a later proposal for a different self contact.
8. After commit (outside the lock, in the DB): revoke pending writing approvals bound to any older
   binding of this workspace (§6.2). An unbind also revokes artifacts bound to the removed active
   binding; there is deliberately no new active binding for them to match.

Crash recovery: under the store lock, `retry_personality_projection` inspects the durable Signals
attempt and queries its exact host transaction id. `committed` finishes the generation-checked
binding commit after rechecking returned hashes; `not_started` resubmits the immutable request;
`restored` becomes `apply_failed`; `recovery_required` asks the host to compensate/complete its
own journal and keeps the workspace blocked until a terminal status is proven. Startup does not
mutate a workspace automatically; recovery runs only from the explicit retry path.

Atomicity statement: a multi-file POSIX write is not physically atomic. For all supported
RealTimeX Personality writers, the shared host coordinator makes expected-hash validation and the
write/compensation transaction serializable: either every proposed hash verifies and the binding
commits, or the host proves every before-image restored and no binding commits. Direct edits by an
uncoordinated external OS process are outside that guarantee; the host journal must surface an
unexpected third hash as `recovery_required`, never claim it was preserved. Tests inject failures
and the exact UI-save interleaving (§10, G1/W6).

### 5.5 Rollback and unbind

- `rollback_personality_projection { bindingId }` creates a `kind: "rollback"` proposal whose
  block **body** per file is read from the target binding's immutable proposal
  (`proposals/<binding.proposalId>.json`), then wrapped in a new marker naming the rollback
  proposal's preallocated `proposedBindingId`. Host before-images do **not** contain the target
  binding's applied blocks and are never used as their source. The rollback proposal's
  `currentFileHash` is the *current* file and its exact `proposedFile` preserves unmanaged content
  edited after the target binding, so it goes through the same approve/apply path without stale
  marker provenance. Rolling back to "no binding" is
  `kind: "unbind"`: every managed block is removed, `AGENTS.md`'s `index` block is removed, files
  that become empty are deleted, the previous binding plus the unbind audit binding stay in
  history, and `active` becomes `null`.
- Rollback never restores unmanaged bytes from a host before-image (that would overwrite the
  user's later prose); host transaction snapshots exist only for apply-failure compensation.
  Retained immutable proposals are the source of historical managed block bodies and exact bound
  whole-file baselines.

### 5.6 Review surfaces

- **Settings → Personality** (child issue E): workspace card (slug, directory, status, active binding, history), per-file unified diff with managed/unmanaged shading, Approve / Reject / Rollback, statements editor, represented-org picker, target representation table.
- **Thread card** (skill, child issue D): one card per proposal —

```
Personality proposal <prp_id>  ·  workspace <slug>  ·  self <name>  ·  org <name|none>
Sources   self rev <n> · org rev <n> · voice <label> v<version> (<hash12>) · statements <hash12>
Files     IDENTITY.md +12/-3 · VOICE.md new · BRAND.md removed · SOUL.md +4/-0 · AGENTS.md pointer added
Drift     unmanaged VOICE.md +2/-0 since binding <pb_id> · managed edits will be corrected (or none)
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
    drifted?: { path: string; reason: "block_edited" | "block_missing" | "file_missing" |
      "duplicate_block" | "unmanaged_edited" | "marker_binding_mismatch" | "index_pointer_missing" }[];
    unavailable?: string;   // workspace dir unresolvable
  };
  compatibleTargets: string[];   // platform_targets ids whose `represents` matches the binding (§8.3)
};
```

The effective social Personality revision is the exact whole-file state agents read, not only the
Signals-managed block bodies:

```ts
const SOCIAL_PERSONALITY_FILES = ["IDENTITY.md", "SOUL.md", "VOICE.md", "BRAND.md"] as const;
// each entry is present even when absent (`fileHash: null`), in the fixed order above
personalityHash = sha256Canonical(
  SOCIAL_PERSONALITY_FILES.map(path => [path, sha256(exactFileBytes) /* or null */]),
);
```

Every successful binding stores those four whole-file hashes (managed + unmanaged) and the exact
`personalityHash`; `AGENTS.md` pointer state is tracked as a readability invariant but is not voice
content and does not enter this hash. Every status, audit, materialization, and G5 read recomputes
the current four-file hash. A whole-file mismatch with an unchanged managed `blockHash` is
`unmanaged_edited`, not `bound`.

`status` precedence: `unavailable` > `drifted` > `source_stale` > `bound`; `unbound` when no active
projection binding. `drifted` means the workspace files no longer match the binding (the user
edited managed or unmanaged bytes, changed marker provenance, removed a block/file, or broke the
index pointer); `source_stale` means Signals facts changed since the binding while exact workspace
bytes still match (a new proposal would not be `noop`).

The adoption path is an ordinary, explicit new `projection` proposal. It records `driftDiff` from
the active binding proposal's immutable `proposedFile` to the current whole file, preserves the
current unmanaged bytes in its new exact `proposedFile`, re-renders managed bodies from allowlisted
Signals sources, and rewrites markers with its new `proposedBindingId`. Approval therefore adopts
the user's unmanaged prose into a new whole-Personality revision while correcting any direct
managed-block edit rather than reverse-writing it into Signals. Until that new binding commits,
the old binding is `drifted` and no bound pending artifact may be approved, materialized, or pass
G5.

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
- Lazy checks: audit/approval, `materialize_variant`, and G5 each recompute current
  `PersonalityStatus`; `materialize_variant` requires `personality.bindingId === active binding id`,
  `personality.personalityHash === active binding.personalityHash`, and
  `status ∈ {bound, source_stale}` (a `drifted` workspace blocks materialization with
  `AUDIT_STALE` / `personality_drifted` until re-applied or rolled back; `source_stale` only warns —
  facts changed, the exact voice bytes the agent used are still what the workspace says). A
  pending audit/approval under `drifted` is stale and must be re-run after the new binding. G5
  rejects a writing item whose materialization snapshot's binding/hash is no longer active **or**
  whose current effective Personality is drifted with `WRITING_ARTIFACT_STALE`.
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

```ts
type TargetRepresentation =
  | { kind: "unbound" }
  | { kind: "self"; contactId: string }
  | { kind: "org"; orgId: string };

platform_targets.metadata.personality = {
  represents: TargetRepresentation;
  setAt: number;
  by: "user";
  evidence: ApprovalEvidence;
  bindingIdAtDecision: `pb_${string}`;
};
```

This is JSON metadata (no DDL), set only by `set_target_representation` or the Settings table.

- Missing metadata, every legacy target kind (`account`, `profile`, `page`, `organization`), and
  the old relative string `"self"` all read as `{ kind: "unbound" }`. Ownership may be auto-derived
  only when a platform adapter supplies an authoritative external-owner id that maps to the exact
  bound contact/org and persists that derivation evidence; no current adapter meets that contract,
  so the MVP silently derives **none**.
- Assigning `self` requires the active binding's exact `selfContactId`; assigning `org` requires its
  exact `representedOrgId`. The UI is a direct user decision. The agent tool requires persisted
  `thread_message` evidence after showing target identity + active binding; there is no policy,
  migration, or agent-only bulk assignment. A stale `bindingIdAtDecision` is rejected at write
  time, while the concrete contact/org id prevents an old decision from becoming compatible after
  unbind/rebind to another self.
- `PersonalityStatus.compatibleTargets` lists targets whose concrete contact/org id equals the
  active binding identity. `unbound` is never compatible.
- `materialize_variant` refuses a target outside `compatibleTargets` with `CONFLICT` /
  `target_identity_mismatch`; the skill's approval card shows the target's representation.
- Targets representing a different contact or org than the bound identity are the "incompatible
  voice" case: they are visible, clearly labelled, and unusable from this workspace until an
  explicit user re-assignment or a move to a workspace bound to that identity.

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
- Platform adapters (#353): unaffected; all new targets default to `unbound` unless a future
  adapter implements the authoritative owner-derivation contract above.
- Plugin: template `AGENTS.md` static Personality section; `realtimex.plugin.json`/`package.json`/
  `rtx-manifest.json` bump `0.2.3 → 0.2.4` with child D.

### 9.5 Concurrency with RealTimeX editors

RealTimeX's current Personality UI PUT is a blind whole-file replace, so Signals apply must not
ship against it. Child G is a prerequisite to B and gives UI reads a whole-file hash/etag, requires
that expected hash on UI save, and puts both that path and the new `x-app-id` SDK batch path behind
one per-workspace writer coordinator (§5.4). The exact read → UI save → Signals commit interleaving
is then serializable: whichever writer commits first changes the revision; the second revalidates
under the coordinator and receives `file_changed` instead of overwriting it. Settings still warns
against editing during approval because it predictably stales one proposal/editor, not because a
supported save can be silently lost. Uncoordinated OS-level editors remain explicitly outside the
guarantee and surface as host `recovery_required` if they produce an unexpected third hash.

---

## 10. Testable requirements

| ID | Requirement | Test shape | Owner |
|---|---|---|---|
| X1 | Rich DB entities cannot be passed to `render.ts`; only opaque values returned by the strict allowlist adapters type-check. Unknown keys at every adapter depth are rejected, and serialized adapter output contains only the named DTO fields. | type + schema test | A |
| X2 | A self contact/org fixture with sentinels in every persona, relationship, tags/stage, raw metadata, channel/contact detail, provenance, mail-pattern, domain/identity evidence field is loaded through the real adapter; neither its serialized `PersonalitySources` nor four rendered files contain a sentinel. | unit | A |
| X3 | `representedOrgId` naming an org with `ownerContactId ≠ self` → `VALIDATION_ERROR` / `org_not_represented`; a non-self contact can never be the identity source. | unit | A |
| X4 | Voice candidates exclude other owners and `null` owners; `getActiveVoiceProfileFor` no longer falls back across owners (regression test for the removed branch). | unit | A |
| X5 | `local_only` identities/employments, email, phone, timezone never appear in `IDENTITY.md`; `org_email_patterns`, `accountStage`, `ownerContactId` never appear in `BRAND.md`. | unit | A |
| X6 | Rendering is deterministic: same sources → byte-identical blocks and hashes across two processes; no timestamp/run id inside a block. | unit | A |
| X7 | Statements are rendered verbatim and only from `statements.json`; a statement > 280 chars or > 12 items is rejected. | unit | A |
| W1 | Proposal against a file with unmanaged prose before and after the block preserves that prose byte-for-byte (CRLF fixture included) and the diff touches only the block. | unit | B |
| W2 | Host batch CAS with any changed `currentFileHash` → `STORE_CONFLICT` / `file_changed`, no host mutation, proposal `stale` (not `apply_failed`). | integration | B/G |
| W3 | Apply verifies the host's committed path/hash set against every immutable `proposedFileHash`; an injected write mismatch is host-compensated and leaves the proposal `apply_failed` with no binding. | fault injection | B/G |
| W4 | Two concurrent applies for one workspace serialize; the second sees `STORE_CONFLICT` or `STORE_BUSY`, never a mixed state; index generation increments once. | multi-process | B |
| W5 | Workspace mismatch (slug ok, realpath differs; or symlink ancestor) → `CONFLICT` / `workspace_mismatch`; unresolvable storage dir → `WORKSPACE_UNAVAILABLE`. | unit | B |
| W6 | Crash injection after every host rename and before each Signals/host journal commit leaves either host-verified before-images with no new binding or exact proposal files committed on retry. Every applied file marker names `proposedBindingId`; retry never rewrites reviewed bytes or allocates another id. | fault injection | B/G |
| W7 | Rollback preserves unmanaged prose edited after the target binding, restores historical block bodies under the rollback proposal's new binding marker, and records matching marker provenance after retry. Unbind removes all blocks, deletes fully-managed files, keeps unmanaged content, records its audit binding, and leaves `active: null`. | unit | B |
| W8 | Editing managed bytes, unmanaged `VOICE.md`/`SOUL.md` prose, a marker binding id, deleting/duplicating a block, or deleting a file each yields `drifted` with the right reason and changes the effective whole-file hash. A new approved projection shows `driftDiff`, preserves/adopts unmanaged prose, corrects managed bytes, and commits a new binding/hash. `source_stale` reflects source content changes and ignores a bare `updatedAt` touch. | unit | B |
| W9 | `AGENTS.md` pointer block is proposed only when the file lacks references; a missing `CLAUDE.md` becomes a symlink; an existing regular `CLAUDE.md` is untouched with a warning. | unit | B |
| W10 | Approval requires `by: "user"` with evidence; `noop` proposals cannot be approved; approving a `superseded` proposal → `CONFLICT`. | tool | B |
| C1 | `upsert_variant` with a stale `bindingId` → `CONFLICT` / `personality_binding_stale`; with the active one stamps the server-derived whole-file `personalityHash`. The field participates in new audit hashes; canonicalization drops absent/`undefined`, so a legacy variant's `inputHash` is byte-identical. | tool | C |
| C2 | A new binding revokes pending approvals of variants bound to the old binding and returns their unqueued `approved` items to `draft`; queued/published untouched; `personality: null` variants untouched. | unit | C |
| C3 | After an unmanaged Personality edit, audit/approval and `materialize_variant` refuse the old whole-file revision (`AUDIT_STALE` / `personality_drifted`); after rebind the old binding is revoked. Target mismatch is `CONFLICT` / `target_identity_mismatch`; G5 refuses stale binding/hash or current drift with `WRITING_ARTIFACT_STALE`. | tool + route | C |
| C4 | `get_writing_context.personality` and `get_personality_binding` agree byte-for-byte on status for the same workspace state. | tool | C |
| C5 | `PRESENCE_MANDATE_MODES` equals `["assist_only"]`; a mandate with `cadence !== null`, `approvalPolicy !== "explicit"`, or an action outside `draft|audit|propose_reply` fails validation; no code path creates publish jobs from a mandate. | static + unit | C/F |
| C6 | Two legacy `account`/`profile` targets default to `unbound`. Assigning one to the exact self and one to another contact/org requires distinct user evidence; only the exact bound identity is compatible, and unbind/rebind to a different self never reinterprets the old decision. | tool + unit | C |
| G1 | UI reads return an etag/hash and UI saves require it. With UI and SDK paths on the same host coordinator, the exact `read expected hashes → external UI save → SDK commit` fault interleaving lets exactly one stale-revision writer commit; the second revalidates to pre-mutation `file_changed`. Neither writer's bytes are silently lost. | RealTimeX integration | G |
| D1 | The skill's proposal and approval cards contain only persisted fields; the packaged plugin zip contains the template `AGENTS.md` Personality section; `signals-writing` 0.3.0 passes `bindingId` and never writes `*.md` in the workspace root. | package + fixture | D |
| E1 | Settings diff view renders managed vs unmanaged regions from the proposal's `files[]` only; Approve is disabled for `noop`/`superseded`/`stale`. | component | E |
| S1 | Nothing in this epic creates a publish job, reply, comment, or reaction without the existing `send-to-agent` user path (static grep test over the new modules for `createPublishJob`/`send-to-agent` callers). | static | C |

---

## 11. Architecture decision records

### ADR-373-1: Workspace Personality is the canonical live social identity and voice; the voice store is an evidence source
**Status:** Accepted. Amends ADR-347-4 (its storage decision stands; its "canonical" clause is superseded). **Context:** Agents run with the workspace directory as `cwd` and read Personality natively; the writing system made a Signals file store canonical because RealTimeX could not read it. Two authorities would diverge the moment a user edits `SOUL.md`. **Options:** (a) keep the Signals store canonical and have the skill ignore Personality — rejected: the agent reads Personality anyway, so drift is guaranteed; (b) move voice evidence into RealTimeX files — rejected: samples, approvals, and versions need a structured, lockable store and Signals UI reads them; (c) Personality canonical for the live voice, Signals store as the approved evidence that *proposes* Personality content — chosen. **Consequences:** Signals never reverse-writes; variants bind to a Personality revision; the voice profile ref stays for attribution; `core/voice.md` and docs are reworded.

### ADR-373-2: Structural allowlist of represented-identity sources
**Status:** Accepted. **Context:** The DB-facing `ContactDTO`, org/domain/identity rows, and `VoiceProfile` are rich and include private or operational fields; using them directly would make the claimed exclusion false. **Options:** (a) filter inside each renderer — rejected: a new field later becomes a leak; (b) loader-only rich reads followed by strict, opaque, allowlisted `Rendered*Input` adapters, with type/schema/sentinel tests at the adapter output and renderer — chosen. **Consequences:** `render.ts` imports no DB entity; representing an org still requires ownership plus explicit selection; other/null-owner voice profiles are ineligible; statements remain the only user free text projected into managed blocks.

### ADR-373-3: Managed blocks with HTML-comment markers; unmanaged content preserved
**Status:** Accepted. **Context:** Personality files are user-authored prose; RealTimeX already uses marker blocks and plugin `managedPaths`. **Options:** (a) whole-file ownership of the four files — rejected: users lose their own prose and the plugin's `managedPaths` would fight it; (b) separate Signals-only files (`SIGNALS_IDENTITY.md`) — rejected: agents would not read them and #373 names the target files; (c) one marker-delimited block per file, hash over the block body, everything else preserved — chosen. **Consequences:** deterministic renderers, per-file diffs, block-level drift detection, `AGENTS.md` gets only a pointer (static in the plugin template, dynamic only when missing).

### ADR-373-4: RealTimeX owns the shared-writer CAS transaction; Signals never writes Personality directly
**Status:** Accepted. **Context:** No Local-App-authenticated Personality write API exists; the current UI PUT is blind; POSIX provides no compare-and-swap from a Signals re-read to a later rename, so a UI save in that window can be silently lost. A shared lock alone also leaves a stale blind UI save free to overwrite after waiting. A terminal agent in the write path is non-deterministic. **Options:** (a) terminal-agent-mediated apply — rejected; (b) direct fs with re-read/rename/verify — rejected because verify cannot reveal a UI save overwritten immediately before rename; (c) new `x-app-id` SDK batch endpoint, required UI expected-hash saves, and one RealTimeX per-workspace coordinator honored by both paths — chosen and made prerequisite G. **Consequences:** child B cannot ship apply before G; every supported writer revalidates its read revision under the host coordinator, the host owns durable before-images/recovery, and Signals commits only a host-verified exact result. Uncoordinated OS editors remain an explicit `recovery_required` limitation, not a preservation claim.

### ADR-373-5: Exact binding = slug + workspace id + directory realpath + self contact
**Status:** Accepted. **Context:** Slugs are stable but the runtime default and the plugin slug can name different workspaces; Local Apps get no host binding. **Options:** (a) bind by slug only — rejected: a re-pointed `STORAGE_DIR` or a different desktop user would apply to the wrong directory; (b) bind by slug, id (when RealTimeX returns it), realpath, and identity, refusing any mismatch — chosen. **Consequences:** moving Signals to another machine/user requires an explicit re-bind (unbind + propose); the same resolver as dispatch is an invariant.

### ADR-373-6: Rollback is a proposal
**Status:** Accepted. **Context:** Restoring whole files from a before-image would overwrite unmanaged prose written after the binding. **Options:** (a) snapshot restore — rejected; (b) a `rollback`/`unbind` proposal carrying historical block bodies from the target binding's retained immutable proposal, wrapping them in the new proposal-time binding marker, and preserving current unmanaged bytes — chosen. **Consequences:** one write path to test; retained proposals contain exact bound file baselines; history is bounded to 50; host before-images serve failure compensation only.

### ADR-373-7: Artifact binding, eager revocation on rebinding, lazy gates
**Status:** Accepted. **Context:** The writing system already revokes on spine change and gates at audit/materialization/G5, while agents consume managed and unmanaged Personality prose. **Options:** (a) hash managed blocks only — rejected because a manual `VOICE.md`/`SOUL.md` prose edit changes the live voice invisibly; (b) additive `metadata.writing.personality` carrying a fixed-order whole-file hash, eager revoke at rebind, and lazy current-file checks at audit/materialization/G5 — chosen. **Consequences:** `revokedReason: personality_stale`; any whole social-Personality edit is `drifted` until explicitly reprojected into a new binding; `source_stale` warns; legacy unbound variants are grandfathered.

### ADR-373-8: One self and at most one org per workspace; no cross-owner voice fallback; target representation in metadata
**Status:** Accepted. **Context:** `getActiveVoiceProfileFor` falls back to another owner's profile; targets carry no authoritative identity link; even `account`/`profile` can belong to another person, and a relative `"self"` decision could silently change meaning after rebinding. **Options:** (a) infer by target kind — rejected; (b) concrete `{contactId|orgId}` representation metadata, default all unknown/legacy targets to `unbound`, require explicit user evidence, remove voice fallback, and gate materialization — chosen. **Consequences:** two people = two workspaces (and two data dirs today); no target becomes compatible by migration or rebinding accident; target-bound Personality remains a later option.

### ADR-373-9: File store under `SIGNALS_DATA_DIR/personality/`, no DDL, new tools only
**Status:** Accepted. **Context:** ADR-347-3/-4, ADR-350-1, `AGENTS.md` migration gate, frozen agent-tool input schemas. **Options:** (a) tables now — rejected; (b) reuse the voice store's lock/immutable/CAS protocol in a sibling store, scalars in `config.json`, output-only extensions to `get_writing_context`, new tools/routes for everything else — chosen. **Consequences:** `AgentToolErrorCode` gains `WORKSPACE_UNAVAILABLE` (503); backups must include `personality/` (docs); a `personality_bindings` table is a later straight projection if cross-machine sync is needed.

### ADR-373-10: Presence mandate exists as a contract with a single legal mode
**Status:** Accepted. **Context:** #373 forbids autonomous external action while pointing at agentic presence. **Options:** (a) omit the mandate until needed — rejected: Studio, skill, and context would each invent one; (b) define the type now, pin `assist_only` with a static test, forbid `cadence`/policy values, and require a new ADR for any other mode — chosen. **Consequences:** future issues extend an existing contract; nothing in this epic can schedule or execute an external action.

---

## 12. Dependency-ordered implementation plan

```
#373 (this spec + writing-spec amendment; Dev lands as spec-only PR)
  ├─► A sources+render ───────────────────────────────┐
  └─► G RTX shared-writer SDK + UI coordination ─────┴─► B projection store/apply/rollback/tools/REST ─► C writing binding + gates ─► D skill 0.3 + plugin template
                                                                                                                   └─► F mandate contract (dormant)      └─► E Settings → Personality UI
#351 Creative Studio rebases on C · #352 reads the optional attribution field · #353 unaffected
Later (own ADRs): H target-bound Personality · I any non-assist mandate mode
```

Child issues (file from these bodies; each gets its own loop; none expands the #373 PR):

| Order | Issue | Title | Delivers | Tests |
|---|---|---|---|---|
| 1 | **A** | Personality sources, exclusions, and deterministic renderers | `src/lib/personality/{sources,render,snapshot,statements}.ts`, `contracts.ts` (Zod: statements, snapshot, proposal, binding, status, mandate), config key `personalityProjection { representedOrgId }`, voice-resolver fallback removal + `unclaimed_only`, `upsert_personality_statements` + `GET/PUT /api/personality/statements`, docs | X1–X7, voice regression |
| 1 | **G** | RealTimeX Personality shared-writer transaction API | In `realtimex-ai-app`: UI read etag/hash + required expected hash on save; one per-workspace coordinator used by UI PUT and new `x-app-id` SDK batch endpoint; all-file expected-hash validation; durable before-image journal; fixed-order write/verify/compensate; idempotent transaction status/recovery; Local App permission | G1 + host crash/authorization tests |
| 2 | **B** | Personality projection store: propose, approve/apply, rollback, drift | `src/lib/personality/{store,workspace,diff,apply}.ts`, exact immutable `proposedFile` + proposal-time binding ids, RealTimeX G client (no direct writes), `AGENTS.md` pointer + `CLAUDE.md` shim request, tools `get_personality_binding`, `propose_personality_projection`, `approve_personality_projection`, `retry_personality_projection`, `rollback_personality_projection`, `unbind_personality_projection`, REST `/api/personality/{binding,proposals,proposals/:id/approve|reject,rollback,unbind}`, `WORKSPACE_UNAVAILABLE`, docs/OpenAPI/backup note | W1–W10 |
| 3 | **C** | Bind writing artifacts to Personality; stale re-audit; target representation | `metadata.writing.personality` (contracts + canonical `inputHash` field list), whole-file drift gates at audit/materialize/G5, eager revoke on rebinding, `get_writing_context.personality` + `voice.status` values + concrete `targets[].represents`, explicitly user-evidenced `set_target_representation` + REST, `AttributionKey.personalityBindingId`, `revokedReason: personality_stale` | C1–C6, S1 |
| 3′ | **F** | Presence mandate contract (dormant) | `mandates.json` store, `PRESENCE_MANDATE_MODES`, `get_presence_mandate`/`upsert_presence_mandate` (assist_only only), `get_writing_context.mandate`, ledger read-model type only | C5 |
| 4 | **D** | `signals-writing` 0.3.0: Personality-first drafting, proposal/approval cards; plugin template | `SKILL.md`/`core/voice.md`/`core/approval.md` updates, `personality` in `reference.md`, cards, `templates/signals/AGENTS.md` Personality section, package test, version `0.2.4` | D1, R7/R8 still green |
| 5 | **E** | Settings → Personality: workspace status, diff review, approve/rollback, statements, org picker, target table | routes/components over B/C REST; no new writing state | E1 |

Acceptance for #373's own PR: this file, the writing-spec amendment, and no product code.
Acceptance for the epic (after E): #373's checklist items all satisfied by A–G's tests; no autonomous
posting path exists (S1 + C5).

---

## 13. Risks and open questions (non-blocking; defaults stated)

1. **Slug mismatch** (§9.1). Default: bind to the dispatch slug; document `SIGNALS_RTX_WORKSPACE_SLUG`; plugin passes it later.
2. **Host dependency** (§9.5). Default: B apply stays disabled until G's shared coordinator, SDK
   transaction, UI migration, and G1 interleaving test are released in the minimum compatible
   RealTimeX version.
3. **Removed voice fallback** (§9.2). Default: ship with `unclaimed_only` messaging and the claim flow in A/E; announce in release notes.
4. **Skill version gate** for `personality_binding_required` (0.3.0). Default: warn-only before D lands; enforce with D.
5. **Standalone dev without the desktop layout** → `WORKSPACE_UNAVAILABLE`. Default: Settings shows the same message as brief-file failures; no fallback write path.
6. **Exemplar samples in `VOICE.md`** put self-authored text into the workspace directory. Default: acceptable (the user approved the samples and the proposal shows them); cap 5 × 600 chars.
7. **Proposal baseline growth**: immutable proposals retain exact whole Personality files for every
   referenced binding; ≤ 50 bindings per workspace are retained and unreferenced proposals are
   pruned on commit. Backups and Settings must treat that local prose as sensitive workspace data.
8. **Org selection UX** when the self contact owns several orgs: single picker, default none. Multi-org representation is not supported in one workspace (D10).
