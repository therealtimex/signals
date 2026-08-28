# Signals Writing System — specification and corpus curation

**Status:** Accepted (System Design, 2026-08-28, loop `loop-issue-347-8d4be348`) — foundation for epic #346; Dev implements downstream slices exactly against the contracts here.
**Issue:** [#347](https://github.com/therealtimex/signals/issues/347) · **Epic:** [#346](https://github.com/therealtimex/signals/issues/346)
**Base:** `main` @ `acd239f`
**Companion artifacts:** `docs-dev/refs/manifest.json` (corpus manifest), `docs-dev/refs/README.md`, `scripts/verify-writing-corpus-manifest.mjs`

This document is the durable contract for the writing system. It settles the architecture,
data contracts, rule classification, corpus adoption policy, and the dependency order for
#348–#354. Nothing here adds product code; the only executable added by #347 is the manifest
validator.

---

## 0. Decisions at a glance

| # | Decision | Why (one line) |
|---|---|---|
| D1 | One `signals-writing` workspace skill: a common core plus one versioned overlay per platform. The 63-skill corpus stays under `docs-dev/refs` as dev-only reference and is never packaged. | The corpus is 7 find-and-replace copies of one template; product value is in the shared contracts, not in 63 routers. |
| D2 | Creative orchestration runs in RealTimeX terminal agents dispatched from a Signals workflow template. Signals exposes data tools only; no `/api/content/ai-generate` and no in-app LLM loop. | Preserves `docs/rtx-agent-orchestration.md`; RTX offers no thread-history read, so results land through tools (ADR-314-1 pattern). |
| D3 | **Launch = writing run and brief container. Variant = one platform/surface-native draft. Content Item = one approved, single-platform publishable artifact. Publish job = the existing execution lane.** | Reuses every GTM primitive; the legacy one-body/many-platforms Compose path is untouched (#354 only fixes its validation). |
| D4 | Metadata-first persistence: contracts are versioned JSON in `launches.metadata.writing`, `variants.metadata.writing`, `variants.generationMetadata`, `content_items.platformData.writing`, plus typed `graph_edges` for lineage. No migration in the MVP. | `AGENTS.md` §8 gates migrations on owner sign-off; every MVP query is by id or 1-hop edge, which existing columns serve. |
| D5 | Voice profiles are Signals-owned JSON documents in a file store under `SIGNALS_DATA_DIR/writing/voice-profiles/`, versioned and approval-gated; a `voice_profiles` table is a named later step with stated triggers. | Signals must own the store (UI and `get_writing_context` read it) without a migration; the media-assets precedent already keeps files under the data dir. |
| D6 | Five rule classes with fixed precedence: `hard` > `claim` > `voice` > `heuristic` > `aesthetic`. Only `hard` and `claim` findings can block. Approved voice evidence beats heuristics and aesthetics unless the request sets `voicePrecedence: "rules_first"`. | The epic requires voice from real samples to win over generic style rules; platform limits and claim integrity are the only non-negotiables. |
| D7 | Every factual claim is a `PreservedClaim` with a source locator; drafts carry a claim map; the audit blocks on invented or altered claims. | "Never invent names, facts, numbers, dates, quotations, citations" must be testable, not aspirational. |
| D8 | Explicit approval is the default and is a user decision recorded on the variant; `writingApprovalPolicy` in `config.json` can relax to `auto_low_risk`, which still never publishes. | Risk relaxation is deliberate configuration (same mechanism as `personaGenerationMode`, ADR-314-2). |
| D9 | A static capability registry keyed by `platform/surface` gates draft, export, publish, metrics, engage. Publish is `direct` only for surfaces backed by `PUBLISH_PLATFORM_TARGETS` (`x`, `linkedin`, `facebook`); everything else is `draft_only`/`export_only`. | "Can draft" must never be confused with "can publish"; a static test pins the registry to the publish lane. |
| D10 | Identifiers are namespaced: surfaces `x/thread`, formulas `linkedin/post/anaphora@1`, rules `x/post/hard/char-limit`, overlays `overlay:x@1`. Heuristic rules carry source, observed date, confidence, and review date. | Cross-platform names in the corpus collide (five different "R1"s); provenance must travel with the rule. |
| D11 | Corpus adoption policy: nothing is vendored. 62 of 63 skills declare no license; `humanizer-skill` declares MIT over CC BY-SA-derived text with no copyright holder. Every adopted pattern is **re-authored** with the corpus path as provenance; license status is a validated manifest field, not a silent copy. | Signals ships proprietary; there is no grant anywhere in the corpus to rely on. |
| D12 | Outcome attribution is a deterministic key (`platform, surface, goal, formulaId, overlay version, voice profile version, audience cohort, launch, variant`) derived from persisted lineage; recommendations are correlational with sample size and window. | #352 must not invent causal folklore; the key exists from the first variant so no backfill is needed. |

---

## 1. Problem, doctrine, and non-negotiables

Signals already has the GTM primitives for a closed writing loop — Launches, Variants, Wind
Tunnel simulation and calibration, Content Items, publish jobs, content posts, engagement
metrics, niches, personas, and the graph — but nothing produces platform-native, voice-grounded,
claim-safe drafts into them. The only "writing" paths today are the Compose dialog (one body,
comma-joined `platformTarget`, hand-written) and a seeded "Thought Leadership Posts" template
whose prompt still references removed in-process tools (`save_draft`, `report_progress`,
`search_web`).

`docs-dev/refs` holds 63 reference skills (177 files) covering seven platforms. They contain
useful design patterns — hook formulas, humanizer rubrics, audit checklists, voice-profile
building — but also unsourced "2026 algorithm" claims, a Publora/Apify/Pixfaro tool stack,
`lib.*` wrappers that do not exist here, and a bundle-root `references/` directory that was never
copied (§9.3).

Doctrine (fixed inputs from #346, restated as requirements):

- **N1 — Orchestration boundary.** Creative orchestration belongs to RealTimeX terminal agents and Agent Flows. Signals exposes bounded data tools. No embedded conversational route returns.
- **N2 — One skill.** One Signals-native `signals-writing` workspace skill with common contracts and platform overlays. Not 63 production skills.
- **N3 — Voice from real samples.** A voice profile is built only from user-approved, self-authored samples and must be approved before it is active. Approved voice evidence overrides generic aesthetic rules.
- **N4 — Claims are traceable.** Every factual claim in output traces to source or user input. Invented names, numbers, dates, quotes, or citations are blockers.
- **N5 — One native variant per platform/surface.** A run produces distinct variants, never one body copied to several networks.
- **N6 — Hard vs heuristic.** Platform constraints are hard rules. Algorithm, timing, and style guidance are versioned, sourced heuristics with confidence.
- **N7 — Approval on by default.** Relaxation is explicit user configuration, never a default.
- **N8 — Publish boundary.** X, LinkedIn, and Facebook are the only initial publish-capable platforms. Other networks are draft/export-only until executable adapters exist.
- **N9 — Audience personas are not the author's voice.** `contact_personas` stay audience-side.

## 2. Scope

In scope for #347: this spec, the corpus manifest and validator, the ADRs in §10, and the
dependency-ordered plan in §11.

Out of scope for #347 (delivered by child issues): the skill (#348), agent tools (#349),
persistence and lineage code (#350), Creative Studio UI (#351), calibration (#352), additional
platforms (#353), and the Compose validation fix (#354). Any database migration is out of scope
for the whole MVP (§7.4 names the triggers that would justify one later).

---

## 3. Architecture overview

```
┌──────────────────────────── Signals (Local App, source of truth) ─────────────────────────────┐
│  Launch (brief, goal, audience, sources, voice ref)  ──►  workflow template "Platform-native   │
│        │                                                   writing" (config.signalsWriting)     │
│        │                                                        │ run-template-via-rtx          │
│  Variants (one per platform/surface; metadata.writing)          ▼ brief.md + routing message    │
│        │  ◄── upsert_variant / materialize_variant ──┐   RTX workspace thread                   │
│  Content Item (approved, single platform) ─► send-to-agent ─► publish_jobs ─► content_posts     │
│        │                                                                    └► engagement_metrics│
│  Wind Tunnel runs / calibrations  ◄── create_simulation_run … calibrate_simulation_run           │
│  Voice profiles (file store)      ◄── get/upsert/approve_voice_profile                           │
│  Capability registry (static)     ◄── get_writing_context                                        │
└───────────────────────────────┬──────────────────────────────────────────▲────────────────────┘
                                │ dispatch (x-app-id)                       │ agent-tools (localhost/bearer)
┌───────────────────────────────▼──────────────────────────────────────────┴────────────────────┐
│  RealTimeX terminal agent (creative orchestration)                                              │
│   loads `realtimex-signals` (tools) + `signals-writing` (contracts, core, overlay) skills       │
│   1. get_writing_context → sources, audience, acting target, voice profile, capabilities        │
│   2. build/confirm voice profile (approval gate) · 3. extract evidence spine + claims           │
│   4. draft one variant per platform/surface via overlay · 5. humanize without inventing         │
│   6. audit (claims, hard limits, voice drift, heuristics) · 7. approval card                    │
│   8. on approval: materialize_variant → approved content item → hand to `signals-publish`       │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Division of responsibility:

| Concern | Owner | Why |
|---|---|---|
| Brief, sources, audience spec, goal, approval policy | Signals (Launch + config) | Source of truth |
| Voice profile document, sample provenance, approval state | Signals file store via tools | UI and context reads need it; agent must not own durable state |
| Spine extraction, drafting, humanizing, auditing, approval card | Agent + `signals-writing` skill | LLM judgment; contracts fix the shapes, not the prose |
| Variant persistence, claim map, audit record, lineage edges | Signals via `upsert_variant` (validated) | Invariants enforced at the source of truth |
| Materialization to an approved content item | Signals `materialize_variant` | One platform per content item, idempotent, approval evidence recorded |
| Browser publishing | `signals-publish` + publish jobs | Unchanged lane (`specs/publish-via-terminal-agent.md`) |
| Outcomes, calibration, attribution | Signals queries + `calibrate_simulation_run` | Deterministic aggregation over persisted lineage |

The agent never writes `content_items` directly, never sets a variant to `published`, and never
creates a publish job for a surface whose capability is not `direct`/`beta` (§5.8).

---

## 4. Domain model

### 4.1 Bounded context and node roles

The writing context sits between Audience Intelligence (niches, personas, graph) upstream and
Launch & Deploy (publish lane, engagement) downstream. It owns three concepts and borrows the rest:

| Concept | Backed by | Role in writing | Never |
|---|---|---|---|
| **Writing run** | `launches` row (`metadata.writing`) + `workflow_runs` row | Brief, goal, audience spec, source refs, voice ref, spine, run history; status `draft → generating → ready → live → completed` | A per-platform body |
| **Platform-native variant** | `variants` row (`metadata.writing`, `generationMetadata`) | Exactly one `platform/surface` draft with claim map, audit, approval, lineage | A comma-joined multi-platform target |
| **Approved artifact** | `content_items` row, `status: approved`, single `platformTarget` | What the publish lane consumes; `platformData.writing` carries the back-reference | Created by the agent directly |
| **Voice profile** | JSON document in `SIGNALS_DATA_DIR/writing/voice-profiles/` | Approved author fingerprint + sample provenance, versioned | Stored on `contact_personas` |
| **Evidence spine** | `launches.metadata.writing.spine` (latest) and per-variant snapshot hash | Sources, preserved claims, core message | Re-derived silently after approval |
| Source material | `content_items` (imported/authored), URLs, files, notes as `SourceRef` | Provenance root of every claim | Fabricated |
| Audience | `launches.audienceSpec` (`nicheIds`, `sampleSize`), `niches`, `contact_personas` | Cohort context for drafting and Wind Tunnel | Author voice |
| Acting target | `platform_targets` | Whose feed the variant is for; kind (`account`/`profile`/`page`) | Assumed from a bare platform string |
| Publish job / content post / metrics | existing tables | Execution and outcome | Modified by this spec |

Status vocabularies are reused, not extended:

- Launch: `draft` (brief only) → `generating` (agent run active) → `ready` (variants audited, awaiting approval) → `live` (≥1 variant published) → `completed`/`archived`.
- Variant: `draft` (generated) → `simulated` (Wind Tunnel projection) → `selected` (**approved and materialized**) or `rejected` → `published` (set only by the publish lane through `publishVariantForContentItem`).
- Content item: `approved` on materialization → `queued → publishing → published | failed` by the publish lane.

### 4.2 Identifiers

| Kind | Pattern | Examples |
|---|---|---|
| Platform | value of `PLATFORMS` (`src/lib/db/platforms.ts`) | `x`, `linkedin`, `facebook`, `threads`, `instagram`, `tiktok`, `youtube` |
| Surface | `<platform>/<surface>` — lowercase, `_` inside a surface | `x/post`, `x/thread`, `x/reply`, `x/quote`, `linkedin/post`, `linkedin/comment`, `facebook/post`, `threads/post`, `threads/thread`, `instagram/caption`, `instagram/carousel`, `tiktok/caption`, `tiktok/script`, `youtube/title`, `youtube/description`, `youtube/community_post`, `youtube/hook_script`, `youtube/thumbnail_brief` |
| Formula | `<platform>/<surface>/<slug>@<overlayVersion>` or `core/<slug>@<coreVersion>` | `x/post/one-liner-contrarian@1`, `linkedin/post/anaphora@1`, `core/story-arc@1` |
| Rule | `<platform>/<surface>/<class>/<slug>` or `core/<class>/<slug>` | `x/post/hard/char-limit`, `linkedin/post/heuristic/hook-before-fold`, `core/claim/no-invented-numbers` |
| Overlay | `overlay:<platform>@<version>` | `overlay:x@1` |
| Core rule set | `core@<version>` | `core@1` |
| Voice profile | `vp_<nanoid>` + integer `version` | `vp_8f3…` v3 |
| Voice sample | `vs_<nanoid>` | |
| Spine / claim / source / audit | `spn_`, `clm_`, `src_`, `aud_` + nanoid | |

Surface vocabulary is closed per platform and lives in `src/lib/writing/surfaces.ts` (#350);
adding a surface is a registry change with a capability row (§5.8), never an ad-hoc string.
The corpus formula codes (`X1…X11`, `T1…T13`, `R1…R5`, LinkedIn `A1…`) are **not** identifiers in
Signals; the manifest maps them to namespaced slugs where adopted (§9.2).

### 4.3 Rule classes and precedence

| Class | Definition | Source of truth | Can block? | Examples |
|---|---|---|---|---|
| `hard` | Platform-enforced constraint: character/unit limits, media/attachment rules, hashtag caps the platform rejects, target-kind restrictions | Platform documentation; verified against the publish adapter | **Yes** | `x/post/hard/char-limit` (280; premium limits are target metadata, not a default), `threads/post/hard/one-hashtag`, `linkedin/post/hard/char-limit` (3,000) |
| `claim` | Claim/safety invariant: no invented facts, numbers, dates, names, quotes, citations; preserved claims stay verbatim where required; private/sensitive claims need explicit inclusion; no third-party dunking; no unverifiable promises | This spec (§5.2, §5.5) | **Yes** | `core/claim/no-invented-numbers`, `core/claim/verbatim-quote`, `core/claim/private-source-excluded` |
| `voice` | User voice preference from an **approved** profile: sentence habits, protected quirks, vocabulary keep/avoid, format habits, signature lines | Voice profile document | No (warning: `voice-drift`) | `voice/protected-quirk-kept`, `voice/avoid-list` |
| `heuristic` | Dated, sourced platform guidance: hook placement, structure, timing, engagement-signal weighting, "AI-tell" phrase lists | Overlay rule records with provenance (§5.10) | No (warning/info) | `linkedin/post/heuristic/hook-before-fold@1 (confidence: low)` |
| `aesthetic` | Optional taste: em-dash policy, emoji count preference, list vs prose, sign-off style | Overlay/core, marked optional | No (info) | `core/aesthetic/em-dash-sparingly` |

Precedence when rules conflict: `hard` > `claim` > `voice` > `heuristic` > `aesthetic`.
`voicePrecedence: "rules_first"` on a request swaps `voice` below `heuristic` for that request
only (used for deliberate "platform-first" rewrites) and is recorded on the variant; it never
lifts `voice` above `hard`/`claim`, and it never silently applies — the audit reports which rules
were applied under which precedence.

Corollary that makes N3 testable: an AI-tell scrub rule (heuristic) that would delete a
protected quirk (e.g. the author's habitual sentence fragments) must be skipped under
`voice_first`, and the audit must list it under `heuristics.skippedForVoice`.

---

## 5. Canonical contracts

All contracts are JSON, carry `schemaVersion`, and are validated by Zod schemas in
`src/lib/writing/contracts.ts` (#350) which the agent-tool schemas import. Timestamps are unix
seconds (repo convention). Field names are camelCase in JSON, snake_case only where an existing
column already dictates it. Unknown fields are preserved (forward-compatible) but never trusted.

### 5.1 Voice profile and sample provenance

```ts
type VoiceSampleSource =
  | { kind: "content_item"; contentItemId: string; platform: Platform; publishedAt: number | null;
      origin: "authored" | "imported"; contentPostId?: string }   // real, Signals-known writing
  | { kind: "pasted"; pastedAt: number; declaredPlatform?: Platform; sha256: string }
  | { kind: "file"; path: string; sha256: string; importedAt: number };

type VoiceSample = {
  id: `vs_${string}`;
  text: string;                                   // verbatim
  source: VoiceSampleSource;
  authorship: "self";                             // only self-authored samples are admissible
  approved: boolean;                              // user-approved for use
  engagement?: Record<string, number>;            // snapshot at capture, informational only
  excludedReason?: "ai_generated" | "not_self" | "duplicate" | "user_removed";
};

type VoiceProfile = {
  schemaVersion: 1;
  id: `vp_${string}`;
  version: number;                                // 1..n; a new approved revision increments
  status: "draft" | "approved" | "superseded" | "rejected";
  label: string;
  ownerContactId: string | null;                  // the `contacts.isSelf` row when present
  platforms: Platform[];                          // [] = all
  samples: VoiceSample[];                         // approval requires ≥3 approved samples
  fingerprint: {
    sentenceLength: { medianWords: number; range: [number, number] };
    openers: string[];  closers: string[];        // observed patterns, not templates
    punctuation: string[];                        // e.g. "uses ellipses", "no em dashes"
    vocabulary: { keep: string[]; avoid: string[] };
    formats: string[];                            // "one-line takes", "numbered lists"
    emoji: "none" | "rare" | "regular";  hashtags: "none" | "rare" | "regular";
    protectedQuirks: string[];                    // may never be scrubbed under voice_first
    taboo: string[];                              // never do
  };
  signatureLines: { text: string; sampleId: `vs_${string}` }[];   // verbatim from samples
  brand?: { handle?: string; link?: string; notes?: string };
  derivedBy: { method: "agent" | "manual"; model?: string; workflowRunId?: string;
               rtxThreadSlug?: string; at: number };
  approval?: { by: "user"; at: number; evidence: ApprovalEvidence };
  supersedesId?: `vp_${string}`;
  hash: string;                                   // sha256 of canonical JSON without approval/hash
};

type ApprovalEvidence =
  | { kind: "thread_message"; workspaceSlug: string; threadSlug: string; note?: string }
  | { kind: "ui"; route: string }
  | { kind: "api"; caller: string };
```

Invariants (tested in #350):

- V1 — A profile cannot reach `approved` with fewer than 3 samples whose `approved` is true and whose source is admissible: `content_item` sources must have `origin ∈ {authored, imported}`, `direction: outbound`, and `aiGenerated: false`; pasted/file sources need `authorship: "self"`.
- V2 — Only the approve tool (§7.2) sets `approved`; `upsert_voice_profile` can only write `draft` and always bumps `version` when the `hash` changes.
- V3 — At most one `approved` profile per `(ownerContactId, label)`; approving a new version marks the previous `superseded` with `supersedesId` set.
- V4 — `signatureLines[*].text` must be a substring of the referenced sample; anything else is rejected (no invented voice).
- V5 — Variants record `{ id, version, hash }` of the profile used; a superseded version stays readable forever (file store is append-only per version).

### 5.2 Evidence spine and preserved claims

```ts
type SourceRef =
  | { id: `src_${string}`; kind: "content_item"; contentItemId: string; title?: string; sha256: string }
  | { id: `src_${string}`; kind: "url"; url: string; title?: string; retrievedAt: number; sha256: string; excerpt?: string }
  | { id: `src_${string}`; kind: "file"; path: string; sha256: string }
  | { id: `src_${string}`; kind: "note"; text: string; enteredAt: number }        // user brief text
  | { id: `src_${string}`; kind: "brief"; launchId: string };                      // launches.brief

type PreservedClaim = {
  id: `clm_${string}`;
  kind: "fact" | "number" | "date" | "name" | "quote" | "citation" | "outcome";
  text: string;                       // verbatim from the source
  sourceId: `src_${string}`;
  locator?: string;                   // line/paragraph/quote anchor inside the source
  verbatimRequired: boolean;          // quotes, numbers, names, dates default true
  sensitivity: "public" | "private";  // private = local_only sources or user-marked
  includeInOutput: boolean;           // private claims require an explicit true
};

type WritingGoal = "replies" | "reposts" | "saves" | "likes" | "follows" | "clicks" | "leads" | "awareness";

type EvidenceSpine = {
  schemaVersion: 1;
  id: `spn_${string}`;
  launchId: string;
  goal: WritingGoal;
  audience: { nicheIds: string[]; cohortLabel?: string; personaHints?: string[] };
  sources: SourceRef[];
  claims: PreservedClaim[];
  message: {
    core: string;                     // one sentence, must be supported by ≥1 claim or be opinion-marked
    supporting: string[];
    proofClaimIds: `clm_${string}`[];
    opinion?: string[];               // explicitly the author's stance, not a claim
    cta?: { intent: "reply" | "bookmark" | "follow" | "click" | "share" | "none"; text?: string };
  };
  extractedBy: { model?: string; workflowRunId?: string; at: number };
  hash: string;                       // sha256 over sources+claims+message
};
```

Invariants:

- S1 — Every `claims[*].sourceId` resolves inside `sources`. Every `message.proofClaimIds` resolves inside `claims`.
- S2 — `sensitivity: "private"` is forced for `content_item` sources whose scope is `local_only` and for `note` sources the user marks private; such claims need `includeInOutput: true` to appear in any variant.
- S3 — The spine hash is snapshotted on every variant; a changed spine after approval invalidates the approval (§5.6).

### 5.3 Platform-native generation request

```ts
type GenerationMode = "draft" | "adapt" | "humanize" | "revise";

type GenerationRequest = {
  schemaVersion: 1;
  launchId: string;
  spineId: `spn_${string}`;  spineHash: string;
  platform: Platform;  surface: SurfaceId;            // exactly one
  targetId?: string;                                  // platform_targets.id; required for publish-capable surfaces at materialization
  mode: GenerationMode;
  sourceVariantId?: string;                           // adapt/revise/humanize input
  adaptedFromContentItemId?: string;                  // repurposing a published winner
  voiceProfile: { id: `vp_${string}`; version: number; hash: string } | null;
  voicePrecedence: "voice_first" | "rules_first";     // default voice_first
  overlay: { id: `overlay:${Platform}`; version: number };
  core: { version: number };
  formulaId: FormulaId | "auto";
  goal: WritingGoal;
  constraints?: { maxUnits?: number; maxChars?: number; hashtags?: number; links?: "none" | "last_unit" | "any";
                  media?: { plan: "none" | "user_supplied"; assetIds?: string[] } };
  instructions?: string;                              // operator guidance, ≤ 4,000 chars
  requestedBy: { workflowRunId: string; rtxThreadSlug?: string; rtxRuntimeSessionId?: string };
  requestHash: string;                                // sha256 of the request without requestedBy
};
```

Rules: `mode: "adapt"` requires `sourceVariantId` or `adaptedFromContentItemId`; `humanize`
and `revise` require `sourceVariantId`; `voiceProfile: null` is allowed only when the launch
records `voiceProfile: null` (explicitly voice-less run) and the audit then reports
`voice: { status: "none" }`. `media.plan: "user_supplied"` is the only media mode in the MVP —
image generation is not a Signals capability (Pixfaro replacement is deferred, §9.4).

### 5.4 Variant writing metadata (persisted)

Stored on the `variants` row. `variants.generationModel` mirrors `generation.model`;
`variants.label` is `<platform>/<surface>` plus an optional ` · <suffix>`; `variants.variantType`
is `thread` for multi-unit surfaces and `post` otherwise in the MVP (#353 extends
`VARIANT_TYPES` for captions/scripts/titles).

```ts
// variants.metadata.writing
type VariantWriting = {
  schemaVersion: 1;
  platform: Platform;  surface: SurfaceId;  targetId?: string;
  goal: WritingGoal;
  formulaId: FormulaId;
  overlay: { id: string; version: number };  core: { version: number };
  voiceProfile: { id: string; version: number; hash: string } | null;
  voicePrecedence: "voice_first" | "rules_first";
  spine: { id: `spn_${string}`; hash: string };
  units: { count: number; chars: number[] };           // per unit (tweet, post, slide)
  claimMap: { claimId: `clm_${string}`; present: boolean; unit?: number; verbatim?: boolean }[];
  audit: WritingAudit | null;                          // latest
  auditHistory?: Pick<WritingAudit, "id" | "auditedAt" | "verdict">[];   // ≤ 5, newest first
  approval: ApprovalState;
  lineage: { derivedFromVariantId?: string; adaptedFromContentItemId?: string;
             adaptedFromVariantId?: string; sourceIds: `src_${string}`[] };
  capability: { publish: PublishCapability };          // snapshot at generation
  materializedContentItemId?: string;
};

// variants.generationMetadata
type VariantGeneration = {
  schemaVersion: 1;
  kind: "signals-writing";
  mode: GenerationMode;
  model: string | null;
  skill: { name: "signals-writing"; version: string };
  agent: { workflowRunId: string; rtxThreadSlug?: string; rtxRuntimeSessionId?: string; briefPath?: string };
  requestHash: string;
  generatedAt: number;
};
```

`upsert_variant` (#350) validates `metadata.writing` and `generationMetadata` whenever
`generationMetadata.kind === "signals-writing"`; other producers (manual dialog, older agents)
are untouched. Validation failures return `VALIDATION_ERROR` with the Zod path.

### 5.5 Structured audit

```ts
type RuleClass = "hard" | "claim" | "voice" | "heuristic" | "aesthetic";
type Severity = "blocker" | "warning" | "info";

type AuditFinding = {
  code: RuleId;                                   // e.g. "x/post/hard/char-limit"
  class: RuleClass;
  severity: Severity;
  message: string;
  location?: { unit: number; start?: number; end?: number; excerpt?: string };
  evidence?: string;                              // what was measured / matched
  confidence?: "low" | "medium" | "high";         // heuristics only
  sourceRef?: string;                             // corpus path or platform doc URL
  skippedForVoice?: boolean;                      // rule not applied because voice_first protected a quirk
};

type WritingAudit = {
  schemaVersion: 1;
  id: `aud_${string}`;
  variantId: string;
  auditedAt: number;
  auditor: { kind: "agent"; model?: string; skillVersion: string; workflowRunId?: string };
  overlay: { id: string; version: number };  core: { version: number };
  verdict: "pass" | "warn" | "block";
  findings: AuditFinding[];
  claims: { total: number; preserved: number; altered: `clm_${string}`[]; missing: `clm_${string}`[];
            invented: { text: string; location: AuditFinding["location"] }[];
            privateIncluded: `clm_${string}`[] };
  hard: { units: number; chars: number[]; limit: number; hashtags: number; links: number; mediaCount: number };
  voice: { status: "applied" | "none" | "rules_first"; profileId?: string; version?: number;
           driftScore?: number; protectedQuirksKept?: boolean; skipped: RuleId[] };
  heuristics: { applied: RuleId[]; conflicts: RuleId[]; skippedForVoice: RuleId[] };
};
```

Verdict derivation (deterministic, tested):

- `block` if any finding has `severity: "blocker"`. Blockers are exactly: any `hard` violation; any `claims.invented`; any `claims.altered` whose claim is `verbatimRequired`; any `claims.privateIncluded` whose claim has `includeInOutput: false`; a publish-capable surface with no resolvable `targetId` at materialization time.
- `warn` if no blockers and any `warning` (missing non-verbatim claim, voice drift ≥ 0.4, heuristic conflict, `rules_first` used).
- `pass` otherwise. `info` findings never change the verdict.
- An audit older than the variant body (`auditedAt < variants.updatedAt` after a body change) is stale; materialization refuses stale audits (`AUDIT_STALE`).

### 5.6 Approval and risk state

```ts
type RiskTier = "low" | "medium" | "high";
type ApprovalPolicy = "explicit" | "auto_low_risk";

type ApprovalState = {
  schemaVersion: 1;
  state: "pending" | "approved" | "rejected" | "revoked";
  riskTier: RiskTier;
  policy: ApprovalPolicy;                 // policy in force when decided
  auditId?: `aud_${string}`;
  by?: "user" | "policy";
  at?: number;
  evidence?: ApprovalEvidence;
  note?: string;
  revokedReason?: "spine_changed" | "audit_stale" | "user" | "voice_superseded";
};
```

Risk tier is derived, never chosen: `high` when the audit verdict is `block`, or the variant
includes any `private` claim, or any claim of kind `quote`/`name` about a third party, or the
target kind is `page`/`organization`; `medium` when the verdict is `warn`; `low` otherwise.

Policy resolution (ADR-347-5): `SIGNALS_WRITING_APPROVAL_POLICY` env → `config.json`
`writingApprovalPolicy` → default `explicit`. Under `explicit`, only a user decision moves
`pending → approved`. Under `auto_low_risk`, `low` variants are approved `by: "policy"` at audit
time and materialized as `approved` content items — they are still never sent to the publish lane
automatically. `high` always requires the user regardless of policy. Approval is revoked (and the
content item, if still `approved`, is returned to `draft`) when the spine hash changes, the audit
becomes stale, or the voice profile version used is superseded and the user asked for
re-validation.

### 5.7 Generation and adaptation lineage

Edges are `graph_edges` rows (unique on `edgeType, src, dst`), created by Signals in the same
transaction as the write that justifies them:

| Edge | Direction | Created by | `properties` |
|---|---|---|---|
| `sourced_from` | variant → content (source content item) | `upsert_variant` when `lineage.sourceIds` include `content_item` sources | `{ sourceId, spineId }` |
| `derived_from` | variant → variant (sibling adaptation of the same spine, or revision) | `upsert_variant` when `lineage.derivedFromVariantId` set | `{ spineId, mode }` |
| `adapted_from` | variant → content (published winner) or variant → variant | `upsert_variant` when `lineage.adaptedFrom*` set | `{ mode: "adapt" }` |
| `materialized_as` | variant → content (approved artifact) | `materialize_variant` | `{ platform, targetId, approvalAt, by }` |
| `published_as` | variant → content | existing `publishVariantForContentItem` via `complete_publish` | `{ platform, published_at, targetId }` |
| `contributes_to` | launch → goal | existing agent-owned edge | unchanged |

Lineage that involves non-node sources (URLs, files, notes) lives only in `metadata.writing.lineage`
and the spine. The queryable path `source → variant → content → post → metrics` is:
`sourced_from` ⟶ `materialized_as`/`published_as` ⟶ `content_posts.contentItemId` ⟶
`engagement_metrics.contentPostId`, all existing indexes.

### 5.8 Capability registry and gates

```ts
type PublishCapability = "direct" | "beta" | "draft_only" | "export_only" | "unsupported";
type CapabilityState  = "supported" | "beta" | "unsupported";

type SurfaceCapabilities = {
  research: CapabilityState;   // audience/read-side context available in Signals
  draft: CapabilityState;      // overlay exists and variant persistence supports the surface
  audit: CapabilityState;
  export: CapabilityState;     // copy/markdown export of an approved variant
  target: CapabilityState;     // platform_targets can resolve an acting identity
  publish: PublishCapability;
  metrics: CapabilityState;    // engagement_metrics ingestion exists
  engage: CapabilityState;     // reply/comment execution exists
  notes?: string;
};
```

MVP registry (`src/lib/writing/capabilities.ts`, static):

| Surface | draft | target | publish | metrics | engage | notes |
|---|---|---|---|---|---|---|
| `x/post`, `x/thread` | supported | supported | **direct** | supported | unsupported | `x-publish.cjs` |
| `x/reply`, `x/quote` | #353 | supported | draft_only | — | unsupported | quote publish exists in the lane (`kind: quote`) but writing overlays for it land in #353 |
| `linkedin/post` | supported | supported | **beta** | supported | unsupported | shared connections verify-only (`signals-publish` §LinkedIn) |
| `linkedin/comment` | #353 | supported | draft_only | — | unsupported | |
| `facebook/post` | supported | supported | **direct** | beta | unsupported | target kind `profile` or `page`; `facebook-publish.cjs` |
| `threads/*`, `instagram/*`, `tiktok/*`, `youtube/*` | #353 | unsupported | draft_only / export_only | unsupported | unsupported | no target adapter, no publisher |

Gates (each has a required test):

- G1 — `send-to-agent` and `create publish job` accept a content item only if its single `platformTarget` maps to a surface with `publish ∈ {direct, beta}`. A static test asserts `{ p | publish(p/*) ∈ {direct, beta} } === PUBLISH_PLATFORM_TARGETS` so the registry cannot drift from the lane.
- G2 — `create_content_draft` accepts any registry platform (drafts are allowed everywhere) but stamps `platformData.writing.capability.publish` so UI and agents render the honest state.
- G3 — `materialize_variant` for a `draft_only`/`export_only` surface succeeds (content item `approved`) and returns `nextAction: "export"`; for `unsupported` it fails with `CAPABILITY_UNSUPPORTED`.
- G4 — `get_writing_context` returns the capability row for every requested surface; the skill must refuse to claim publishing for anything not `direct`/`beta`.

### 5.9 Outcome attribution and calibration linkage

```ts
type AttributionKey = {
  platform: Platform; surface: SurfaceId; goal: WritingGoal;
  formulaId: FormulaId; overlayVersion: number; coreVersion: number;
  voiceProfileId: string | null; voiceProfileVersion: number | null;
  audienceCohort: string;            // sorted nicheIds joined by "+", or "unspecified"
  launchId: string; variantId: string; contentItemId: string; contentPostId: string; targetId?: string;
};

type OutcomeRecord = {
  key: AttributionKey;
  publishedAt: number;
  windows: { horizon: "24h" | "72h" | "7d" | "30d"; metrics: EngagementMetricsRecord; score: number }[];
  prediction?: { simulationRunId: string; predictedScore: number; confidence: number };
  calibration?: { simulationCalibrationId: string; scoreError: number };
};
```

`AttributionKey` is derivable with no new columns: `content_posts` → `content_items` →
`materialized_as`/`published_as` edge → `variants.metadata.writing`. #352 materializes
`OutcomeRecord`s in a query module (not a table) and feeds `calibrate_simulation_run` unchanged.
Recommendation records must carry `sampleSize`, `window`, `confidence`, `evidence: contentPostIds[]`
and use correlational language; with `sampleSize < 5` per key the answer is
`"insufficient_evidence"`.

### 5.10 Heuristic provenance record (overlay rule format)

Every rule in an overlay or the core is a record, not prose:

```yaml
- id: linkedin/post/heuristic/hook-before-fold
  class: heuristic                      # hard | claim | voice | heuristic | aesthetic
  statement: "Put the payoff of the post in the first ~210 characters; the feed truncates there."
  applies: [linkedin/post]
  severity: warning                     # what an audit finding of this rule carries
  source:
    - path: docs-dev/refs/linkedin-skills/linkedin-post-writer/references/algorithm-heuristics.md
      kind: corpus                      # corpus | platform_doc | signals_outcome
      observedAt: "2026-07"             # when the source claims it was true
  confidence: low                       # low = unsourced corpus claim; medium = ≥1 external citation or Signals n≥30; high = reproducible Signals calibration evidence
  reviewBy: "2027-02-28"                # heuristic rules expire without review
  status: active                        # active | deprecated
```

`hard` rules cite `platform_doc` (or the publish adapter test that enforces them) and have no
`reviewBy`; `claim` rules cite this spec. The skill validates overlay files against this format at
package time (#348 test) and the audit copies `confidence`/`sourceRef` into findings.

### 5.11 Launch writing metadata

```ts
// launches.metadata.writing
type LaunchWriting = {
  schemaVersion: 1;
  goal: WritingGoal;
  surfaces: { platform: Platform; surface: SurfaceId; targetId?: string }[];   // one variant expected per entry
  sources: SourceRef[];
  spine?: EvidenceSpine;                                    // latest
  voiceProfile: { id: string; version: number; hash: string } | null;
  voicePrecedence: "voice_first" | "rules_first";
  approvalPolicy: ApprovalPolicy;                           // snapshot at run start
  runs: { workflowRunId: string; mode: GenerationMode; startedAt: number; rtxThreadSlug?: string }[];
};
```

`launches.audienceSpec` keeps `nicheIds`/`sampleSize` (Wind Tunnel contract, unchanged);
`launches.primaryPlatform` is the first surface's platform for dashboard badges.

---

## 6. `signals-writing` skill design (implemented by #348)

### 6.1 Layout

```
.claude/skills/signals-writing/
  SKILL.md                 # router: when to use, modes, contract summary, approval card, never-do list (≤ ~250 lines)
  reference.md             # JSON shapes from §5 as the agent sees them + tool call sequence per mode
  core/
    claims.md              # evidence spine extraction, PreservedClaim rules, claim map, private-source handling
    voice.md               # voice profile build/approve procedure, admissible samples, precedence (§4.3)
    audit.md               # audit rubric: claim checks, hard-limit checks, AI-tell heuristics (re-authored), verdict rules
    adapt.md               # repurposing spine: extract → choose container → re-hook → refit → strip artifacts → humanize → audit
    approval.md            # approval card, risk tiers, policy resolution, materialization + hand-off to signals-publish
    lineage.md             # exact tool sequence to persist spine, variants, audits, lineage; idempotency keys
  overlays/
    README.md              # overlay/rule record format (§5.10) and versioning rules
    x.md                   # overlay:x@1 — x/post, x/thread
    linkedin.md            # overlay:linkedin@1 — linkedin/post
    facebook.md            # overlay:facebook@1 — facebook/post (profile and page targets)
```

No `scripts/` in the MVP. `docs-dev/refs` is never copied into the skill or the plugin zip.

### 6.2 Router and progressive loading

`SKILL.md` loads only what a mode needs:

| Mode | Loads | Tools used |
|---|---|---|
| `voice build` / `voice approve` | `core/voice.md` | `get_writing_context`, `get_content`, `upsert_voice_profile`, `approve_voice_profile` |
| `spine` | `core/claims.md` | `get_writing_context`, `get_content`, `upsert_launch` (metadata.writing.spine) |
| `draft` / `adapt` / `revise` / `humanize` | `core/claims.md`, `core/voice.md`, `core/adapt.md` (adapt only), `overlays/<platform>.md` | `upsert_variant` |
| `audit` | `core/audit.md`, `overlays/<platform>.md` | `upsert_variant` (audit inside `metadata.writing`) |
| `approve` | `core/approval.md`, `core/lineage.md` | `materialize_variant`, then `signals-publish` via `send-to-agent`/publish job when the user asks to publish |

A run that produces N surfaces performs the draft → humanize → audit cycle once per surface with the
same spine; the agent must not derive surface B's draft from surface A's body (it derives from
the spine) unless the mode is `adapt` and lineage records `derivedFromVariantId`.

### 6.3 Overlay format

Each overlay file has frontmatter `{ overlayId: "overlay:x", version: 1, platform: "x",
surfaces: ["x/post", "x/thread"], reviewedAt, sources: [corpus paths] }` followed by three
sections: **Hard constraints** (rule records, class `hard`, with the adapter test that enforces
each), **Formulas** (records `{ id, goal, shape, slots, claimRules, sourceRef }`), and
**Heuristics & aesthetics** (records per §5.10). Bumping any record bumps `version`; variants pin
the version they were generated under. A packaging test (#348) parses every overlay and asserts:
frontmatter present, every rule id namespaced under the overlay's platform or `core`, every
`heuristic` record has `source`, `confidence`, and `reviewBy`, and every `hard` record cites a
platform doc or adapter test.

MVP formula catalog (namespaced from the corpus; see `docs-dev/refs/manifest.json` `formulaMap`):

- `x/post`: `one-liner-contrarian`, `data-point`, `build-in-public-confession`, `mini-list`, `relatable-cold-open`, `third-party-case-study` (requires consent/public-source claim for the named party).
- `x/thread`: `listicle-promise`, `story-arc`, `curiosity-gap-opener`, `how-i-teardown`.
- `linkedin/post`: `anaphora`, `rip-obituary`, `year-over-year-pivot`, `time-anchor-confession`, `self-proving-meta`, `precise-ledger`, `paid-vs-free-reversal`, `curiosity-gap`, `contrarian-with-receipts`, `emotional-cold-open`, `permission-slip`, `expectation-reversal`, `named-tribute` (consent rule), `explain-simply`, `status-strip`, `controlled-comparison`, `false-binary-dissolve`, `anecdote-evidence-bridge`, `diverging-curves-close`.
- `facebook/post`: `one-line-opinion`, `tiny-number`, `genuine-question`, `relatable-one-liner`, `behind-the-scenes`, `useful-tip`, `story-with-a-turn`, `announcement-with-stakes`, `community-spotlight` (consent rule).
- Not adopted: comment-gating and vote-bait shapes (`F6`, `FB4`), quote-dunk shapes (`X4`, `T4`).

### 6.4 Approval card contract

The agent renders one card per variant, in the thread, before asking for approval:

```
Variant  <label>  ·  <platform/surface>  ·  target @handle (kind)  ·  formula <formulaId>
Body     <full text, unit-numbered for threads>
Limits   <chars per unit> / <limit>  ·  hashtags n  ·  links n  ·  media n
Claims   <preserved>/<total> preserved  ·  altered: <ids or none>  ·  missing: <ids or none>  ·  invented: none
Voice    <profile label v<version>>  ·  precedence <voice_first|rules_first>  ·  drift <score>  ·  protected quirks kept: yes
Audit    <verdict>  ·  blockers <n>  ·  warnings <n>  (list each finding code + one line)
Risk     <tier>  ·  policy <explicit|auto_low_risk>
Publish  <direct|beta|draft_only|export_only>  — "draft_only: this platform has no publish adapter; export only"
Next     approve <variantId> | revise <instruction> | reject
```

The card is the human-readable projection of §5.4–§5.6; it never contains information that is not
also persisted. "approve" from the user is recorded as `ApprovalEvidence { kind: "thread_message" }`.

### 6.5 Never-do list (skill hard rules)

1. Never call a removed in-process tool (`save_draft`, `report_progress`, `search_web`) or any `lib.*` wrapper; the only write paths are the agent tools in §7.3.
2. Never write a content item directly for a variant; materialization goes through `materialize_variant`.
3. Never introduce a fact, number, date, name, quote, or citation absent from the spine; when a slot needs one, ask or drop the slot.
4. Never use a voice profile that is not `approved`; never build one from AI-generated or third-party text.
5. Never scrub a protected quirk under `voice_first`; record the skipped rule instead.
6. Never state or imply publish support for a surface whose capability is not `direct`/`beta`; say "draft/export only".
7. Never include platform-manipulation tactics: engagement-pod behaviour, timed "look human" delays, detector gaming, pre-publish "giants" commenting, engagement bait.
8. Never approve on the user's behalf under `explicit` policy; under `auto_low_risk`, never materialize a `medium`/`high` variant without the user.
9. Never publish: publishing is always a separate, explicit user instruction executed by `signals-publish`.

### 6.6 Packaging and documentation (part of #348)

- `realtimex-plugin/realtimex.plugin.json`: add `signals-writing` to `capabilities.workspace_skills` and to `provisions.workspaces[0].skills.workspace.include`.
- `scripts/package-realtimex-plugin.sh`: copy `.claude/skills/signals-writing/` and rewrite `.claude/skills/signals-writing` → `skills/signals-writing` in `SKILL.md` like the other two skills; `scripts/test-realtimex-plugin-package.mjs` asserts the directory, `SKILL.md`, `overlays/{x,linkedin,facebook}.md`, and that no `docs-dev` path is inside the zip.
- `realtimex-plugin/templates/signals/AGENTS.md` and `docs/realtimex-marketplace-plugin.md`: list the skill and its publish boundary (X, LinkedIn beta, Facebook; others draft/export-only).
- `src/lib/workflows/template-brief.ts`: "Workspace skills available" line adds `signals-writing`; `TOOLS_BY_TYPE.content` adds the §7.3 tools.
- `guide/03-content-and-publishing.md`: a short "Writing with your terminal agent" section.

---

## 7. Orchestration and integration contracts

### 7.1 End-to-end sequence

1. **Brief.** The user creates or opens a Launch (dashboard dialog or `upsert_launch`) with `brief`, `audienceSpec`, and `metadata.writing` (§5.11: goal, surfaces with targets, sources, voice ref, policy snapshot).
2. **Dispatch.** The user runs the seeded content template "Platform-native writing" (§7.2) with `signalsWriting.launchId`. `run-template-via-rtx` creates the `workflow_runs` row, writes `workflow-runs/<runId>/brief.md`, and dispatches the workspace default terminal agent. The Launch moves to `generating`; `metadata.writing.runs[]` records the run.
3. **Context.** The agent calls `get_writing_context` (sources with full bodies, niches, acting targets, active voice profile, capability rows per surface, existing variants).
4. **Voice.** If no approved profile exists (or the brief asks for a refresh), the agent runs `voice build` from admissible samples, presents the profile, and calls `approve_voice_profile` only on the user's explicit approval. A run may proceed voice-less only if the launch says so.
5. **Spine.** The agent extracts the `EvidenceSpine`, persists it on the launch (`upsert_launch` → `metadata.writing.spine`), and presents claims for confirmation when any claim is `private` or `sensitivity` is unclear.
6. **Draft.** For each surface: build the `GenerationRequest`, draft under the overlay, humanize, audit, and persist via `upsert_variant` with `metadata.writing` + `generationMetadata` in one call (audit included). Lineage edges are created by Signals from `lineage`.
7. **Simulate (optional).** The agent or user runs Wind Tunnel on variants (`create_simulation_run` …) — unchanged.
8. **Approve.** The agent renders approval cards. On approval, `materialize_variant` creates the approved content item, `materialized_as` edge, sets variant `selected`, and records `ApprovalState`. The Launch moves to `ready` when every requested surface has a variant with a non-stale audit; `live` when a variant is published.
9. **Publish (separate instruction).** The user asks to publish; the agent (or the Compose "Send to agent" button on the content item) calls `POST /api/content/send-to-agent` for that single content item; `signals-publish` executes; `complete_publish` links `published_as` and flips the variant to `published`.
10. **Outcomes.** `engagement_metrics` accrue on the post; `calibrate_simulation_run` and the #352 attribution queries read back through lineage.

### 7.2 Writing workflow template contract

Marker key in `workflow_templates.config` (same pattern as `profilePublish`):

```ts
export const WRITING_CONFIG_KEY = "signalsWriting";
export interface WritingTemplateConfig {
  version: 1;
  launchId?: string;                 // existing launch; when absent the agent creates one from the brief text
  goal: WritingGoal;
  surfaces: { platform: Platform; surface: SurfaceId; targetId?: string }[];   // ≤ 6 per run
  sourceContentItemIds: string[];    // ≤ 20
  sourceUrls: string[];              // ≤ 10; the agent fetches with RealTimeX Browser and records SourceRef.url with sha256
  instructions: string;              // ≤ 4,000 chars (operator brief text becomes a `note` SourceRef)
  voiceProfileId: string | "active" | null;
  voicePrecedence: "voice_first" | "rules_first";
  mode: "draft" | "adapt";
  adaptFromContentItemId?: string;
  requireApproval: true;             // literal; relaxation only via config policy (§5.6)
}
```

`buildWritingBriefSection` (in `src/lib/workflows/signals-writing.ts`, #349) renders the config,
the Signals base URL, the run id, the capability rows for every requested surface, the exact tool
sequence (§7.3), and the never-do list. The seeded template "Platform-native writing"
(`templateType: "content"`, `isSystem: 1`) replaces the stale "Thought Leadership Posts" prompt,
which references removed tools; that prompt is rewritten in the same seed migration step (a data
change in `seed-templates.ts`, not a schema migration).

### 7.3 Agent tools

All tools follow the existing 4-edit convention (schema → handler → registry → `docs/agent-tools.md`,
then `npm run generate:agent-tools-openapi`), the existing localhost/bearer auth, and the
`{ success, code, details }` error envelope. Scope rules: reads exclude `local_only` rows unless
`includeLocalOnly: true`; writes inherit the launch scope.

| Tool | Issue | Input (abridged) | Output | Idempotency / errors |
|---|---|---|---|---|
| `get_content` | #349 | `{ contentItemId, includeMetrics?: boolean }` | full item: untruncated `body`, `title`, `contentType`, `platformTarget`, `status`, `origin`, `direction`, `aiGenerated`, `threadId`, `parentItemId`, `platformAccountId`, `platformData`, `media[]`, `post` (`platformPostId`, `platformUrl`, `publishedAt`, `engagementSnapshot`), `latestMetrics`, `gtm` (`variantId`, `launchId`), `writing` (from `platformData.writing`) | read-only; `NOT_FOUND` |
| `create_content_draft` | #349 | `{ idempotencyKey, platform, contentType: "post" \| "thread", body, title?, threadTexts?, mediaAssetIds?, targetId?, origin: { launchId?, variantId? } }` | `{ contentItemId, created: boolean, capability: { publish } }` | same `idempotencyKey` (stored in `platformData.writing.idempotencyKey`) returns the existing item; `VALIDATION_ERROR` for unknown platform / surface; one platform per item (no comma lists) |
| `update_content_draft` | #349 | `{ contentItemId, body?, title?, threadTexts?, mediaAssetIds?, expectedUpdatedAt? }` | updated item summary | only `draft`/`failed` items (`EDITABLE_STATUSES`), otherwise `CONFLICT`; `expectedUpdatedAt` mismatch → `CONFLICT` |
| `get_writing_context` | #349 (voice fields land with #350) | `{ launchId, surfaces?: SurfaceId[], includeSources?: boolean }` | `{ launch (brief, audienceSpec, metadata.writing), niches[], sources[] (full bodies for content_item refs), targets[] (platform_targets for requested platforms), voiceProfile (active approved, full) \| null, capabilities: Record<SurfaceId, SurfaceCapabilities>, variants[] (summaries with `metadata.writing.audit.verdict`, `approval.state`), approvalPolicy }` | read-only; `NOT_FOUND`; `local_only` launch readable (detail-by-id rule, ui-4.1 §6) |
| `list_voice_profiles` / `get_voice_profile` | #350 | `{ status? }` / `{ id, version? }` | profiles (full document) | read-only |
| `upsert_voice_profile` | #350 | `VoiceProfile` minus `approval`/`hash`/`status` | stored draft with `version`, `hash` | V1–V5; cannot set `approved`; bumps `version` when hash changes |
| `approve_voice_profile` | #350 | `{ id, version, evidence: ApprovalEvidence }` | approved profile; previous approved → `superseded` | `CONFLICT` when `version` is not the latest draft; `VALIDATION_ERROR` when V1 fails |
| `upsert_variant` (extended) | #350 | existing input + validated `metadata.writing`, `generationMetadata` | existing output + `lineageEdges[]` | validation only when `generationMetadata.kind === "signals-writing"`; refuses `status: "published"` for writing variants (`use materialize_variant + publish lane`) |
| `materialize_variant` | #350 | `{ variantId, approval: { by: "user", evidence }, idempotencyKey? }` | `{ contentItemId, created, nextAction: "publish" \| "export", capability }` | idempotent via existing `materialized_as` edge; `AUDIT_STALE`, `AUDIT_BLOCKED`, `APPROVAL_REQUIRED`, `CAPABILITY_UNSUPPORTED`, `TARGET_REQUIRED` (publish-capable surface without a resolvable target) |
| `revoke_variant_approval` | #350 | `{ variantId, reason }` | approval state | returns `approved` content item to `draft` if not yet queued; `CONFLICT` if the item is `queued`/`publishing`/`published` |

`query_content` is unchanged (its 200-char body truncation is the reason `get_content` exists).
`send-to-agent` (REST) gains the G1 gate; no agent tool creates publish jobs directly.

### 7.4 Persistence mapping (implemented by #350)

| Contract | Location | Notes |
|---|---|---|
| `LaunchWriting` | `launches.metadata.writing` | validated on `upsert_launch` when present |
| `EvidenceSpine` | `launches.metadata.writing.spine` (latest); `variants.metadata.writing.spine.hash` (snapshot) | spine history is not kept in the MVP |
| `VariantWriting`, `WritingAudit`, `ApprovalState` | `variants.metadata.writing` | `auditHistory` capped at 5 |
| `VariantGeneration` | `variants.generationMetadata`; `variants.generationModel` mirrors `model` | |
| `VoiceProfile` | `SIGNALS_DATA_DIR/writing/voice-profiles/<id>/v<version>.json` + `<id>/current.json` pointer | append-only per version; `resetCoreTables()` gets a sibling `resetWritingStore()` for tests |
| Materialized artifact | `content_items` (`status: approved`, `platformTarget: <platform>`, `contentType`, `aiGenerated: true`, `generationPrompt: null`) + `platformData.writing = { variantId, launchId, surface, targetId, voiceProfile, formulaId, overlay, approval, capability }` | one row per variant per platform |
| Lineage | `graph_edges` per §5.7 | created in the same transaction as the triggering write |
| Capability registry | `src/lib/writing/capabilities.ts` (static) | G1 static test |
| Surfaces / rule id helpers | `src/lib/writing/surfaces.ts`, `src/lib/writing/ids.ts` | shared by tools, UI, and the overlay packaging test |
| Approval policy | `config.json` `writingApprovalPolicy` + env `SIGNALS_WRITING_APPROVAL_POLICY` | `src/lib/settings/writing-approval-policy.ts` |

**Materialization algorithm** (`materialize_variant`):

1. Load variant + launch; require `generationMetadata.kind === "signals-writing"`.
2. If a `materialized_as` edge exists → return its content item (`created: false`).
3. Require `metadata.writing.audit` present, `auditedAt ≥ variants.updatedAt` (else `AUDIT_STALE`) and `verdict !== "block"` (else `AUDIT_BLOCKED`).
4. Resolve policy; if `riskTier !== "low"` or policy is `explicit`, require `approval.by === "user"` with evidence (else `APPROVAL_REQUIRED`).
5. Resolve capability for `platform/surface`; `unsupported` → `CAPABILITY_UNSUPPORTED`; if `publish ∈ {direct, beta}` require `targetId` resolvable via `platform_targets` (else `TARGET_REQUIRED`).
6. In one transaction: create the content item (`approved`, single `platformTarget`, body from the variant, `contentType` from `variantType`), link media attachments referenced by the request, set `variants.contentItemId`, `variants.status = "selected"`, write `approval` + `materializedContentItemId` into `metadata.writing`, insert `materialized_as`.
7. Return `nextAction: "publish"` for `direct`/`beta`, `"export"` otherwise.

`publishVariantForContentItem` (called by `complete_publish`) already flips the variant to
`published` and adds `published_as`; #350 makes it tolerate the pre-existing `contentItemId`
(it does today) and copy `targetId` into the edge properties (it does today). The legacy
`upsert_variant status: "published"` path stays for non-writing variants only.

**Revocation:** spine hash change (`upsert_launch` with a new spine) → every variant of the launch
whose `spine.hash` differs gets `approval.state = "revoked", revokedReason: "spine_changed"`, and
its approved-but-unqueued content item returns to `draft`. Superseding a voice profile does not
auto-revoke; it flags `voice: { superseded: true }` in the context for the next audit.

**Migration-free boundary and later triggers (ADR-347-3/4).** Nothing above needs DDL. A migration
becomes justified — and gets its own ADR and owner sign-off — when one of these appears:
(a) a Creative Studio list needs to filter or sort variants by `verdict`/`approval.state` across
launches (→ generated columns or a `writing_audits` table); (b) #352 needs to join outcomes by
`voiceProfileId`/`formulaId` across thousands of posts (→ `voice_profiles` table + indexed
attribution columns); (c) voice profiles must be shared across machines/backups with the SQLite
file (→ `voice_profiles` table with the same JSON contract); (d) URL/file sources need dedup across
launches (→ `content_sources`). The JSON contracts are designed so that each table is a straight
projection of the existing document.

### 7.5 Creative Studio seams (implemented by #351)

The UI is a projection of the contracts above; it introduces no new writing state:

- **Brief panel** reads/writes `launches.brief`, `audienceSpec`, `metadata.writing` (goal, surfaces with targets, sources, voice ref) through the existing launch REST routes (`PUT /api/launches/[id]` gains `metadata.writing` validation).
- **Generate** starts the writing template run (`POST /api/workflows/templates/[id]/run` with `signalsWriting` config) and shows the thread link; it never calls an LLM.
- **Variant board** groups by `platform/surface`, shows `units.chars` vs limit, `audit.verdict` with expandable findings (blockers → warnings → info, each with `class`, `confidence`, `sourceRef`), claim coverage, voice line, provenance (`generation.model`, run link, overlay/core versions, formula), and lineage links.
- **Wind Tunnel** entry reuses ui-4.5 pages.
- **Approve** calls `materialize_variant` through a REST wrapper (`POST /api/variants/[id]/materialize`, evidence `{ kind: "ui", route }`), **Revoke** calls `revoke_variant_approval`; **Publish** is the existing Compose "Send to agent" for the materialized content item.
- **Capability honesty:** every surface header renders the registry state; `draft_only`/`export_only` surfaces show "Export" (copy markdown) and never a publish action.
- States: loading, empty (no variants → CTA to run the template), stale audit, revoked approval, partial run (some surfaces missing), error.

### 7.6 Calibration and repurposing (implemented by #352)

- `src/lib/writing/attribution.ts`: `buildAttributionKey(variant, contentItem, contentPost)` and `listOutcomeRecords({ launchId?, platform?, since })` over existing tables via lineage edges; horizons `24h/72h/7d/30d` computed from `engagement_metrics` snapshots exactly like `computeCalibrationActualsForRun`.
- Normalization: per `(platform, targetId)` baseline = median of the target's last N (default 20) posts' `score`; effect = ratio; cohorts (`audienceCohort`) are never pooled across platforms or goals; `sampleSize < 5` → `insufficient_evidence`.
- Recommendations: `{ key subset, metric, effect, sampleSize, window, confidence, evidence: contentPostIds[], statement }` with correlational language only; stored nowhere in the MVP (computed on read) and surfaced through `get_writing_context.recommendations[]` and the Studio.
- Repurposing a winner: `mode: "adapt"` with `adaptedFromContentItemId`; the spine is re-extracted from the published body and its original spine hash; claims carry over with their original `sourceId`s; `adapted_from` edge.
- Heuristic promotion: a rule's `confidence` may move `low → medium` only when a Signals outcome record set with `sampleSize ≥ 30` supports it; the overlay record gains a `signals_outcome` source entry with the query parameters.

### 7.7 Platform expansion (implemented by #353)

Each additional platform is its own follow-up issue and loop, gated by the capability registry:

| Platform | Draft/export surfaces (text artifacts) | Needs before `publish: direct` | Asset types to model |
|---|---|---|---|
| `threads` | `threads/post`, `threads/thread`, `threads/reply`, `threads/quote` | target adapter (`PLATFORM_TARGET_PLATFORMS`), `threads-publish.cjs`, verification invariants, metrics ingestion | none beyond text |
| `instagram` | `instagram/caption`, `instagram/carousel` (slide text) | media-required publisher, target adapter | carousel slides (2–10 images), reel cover |
| `tiktok` | `tiktok/caption`, `tiktok/script` | video upload path, publish settings model | spoken script, on-screen text, video |
| `youtube` | `youtube/title`, `youtube/description`, `youtube/community_post`, `youtube/hook_script`, `youtube/thumbnail_brief` | Data API/auth, upload path | title/description/chapters, thumbnail brief, community poll |

Engage surfaces for the MVP platforms (`x/reply`, `x/quote`, `linkedin/comment`, `facebook/comment`)
are also #353 scope: overlays exist in the corpus, but execution needs an engage adapter.
`VARIANT_TYPES` extends by registry (`caption`, `script`, `title`, `description`, `community_post`,
`thumbnail_brief`); `content_items.contentType` stays as is — non-post artifacts are exported,
not published, until an adapter exists.

### 7.8 #354 boundary

`POST /api/content/draft` validates `platforms` against `x | linkedin` while Compose and the
publish lane accept Facebook. #354 aligns the route with `PUBLISH_PLATFORM_TARGETS` and adds a
static type check. It touches the legacy one-body path only; the writing system never produces
comma-joined `platformTarget` values, and nothing in #347–#353 depends on #354.

---

## 8. Testable requirements

Each requirement names the issue that owns its test.

| ID | Requirement | Test shape | Owner |
|---|---|---|---|
| R1 | A variant persisted with `generationMetadata.kind = "signals-writing"` and any invented claim (`claims.invented.length > 0`) has `verdict: block` and cannot be materialized (`AUDIT_BLOCKED`). | unit + tool | #350 |
| R2 | Every `claimMap` entry with `present: true` references a claim whose `sourceId` exists in the spine snapshot; validation rejects orphans. | unit | #350 |
| R3 | A `private` claim with `includeInOutput: false` appearing in `claims.privateIncluded` is a blocker. | unit | #350 |
| R4 | `approve_voice_profile` rejects profiles with <3 admissible approved samples, with any `content_item` sample that is `aiGenerated`, inbound, or not self-authored, or with a signature line that is not a substring of its sample. | unit + tool | #350 |
| R5 | Only `approve_voice_profile` can set `approved`; approving supersedes the previous approved version; superseded versions remain readable. | unit | #350 |
| R6 | Variants record `voiceProfile { id, version, hash }`; `get_writing_context` returns the active approved profile only. | tool | #349/#350 |
| R7 | Under `voice_first`, an audit finding for a heuristic/aesthetic rule that targets a protected quirk is marked `skippedForVoice` and does not affect the verdict; under `rules_first` it applies and `voice.status = "rules_first"` is recorded. | skill packaging test with fixture drafts + unit for verdict derivation | #348/#350 |
| R8 | One template run with three surfaces yields three variants with distinct `platform/surface`, identical `spine.hash`, and bodies that differ (not prefix/suffix copies). | skill integration fixture | #348 |
| R9 | `create_content_draft` rejects comma-joined or unknown platforms; accepts any registry platform; stamps `capability.publish`. | route/tool | #349 |
| R10 | `send-to-agent` rejects a content item whose platform is not `direct`/`beta` (`CAPABILITY_UNSUPPORTED`), and the registry's publish-capable set equals `PUBLISH_PLATFORM_TARGETS` (static test). | unit | #349 |
| R11 | `materialize_variant` is idempotent (second call returns the same content item, `created: false`), refuses stale audits, and requires a resolvable target for publish-capable surfaces. | tool | #350 |
| R12 | Under `explicit` policy, `materialize_variant` without `approval.by = "user"` fails with `APPROVAL_REQUIRED`; under `auto_low_risk` it succeeds for `low` tier only and never enqueues a publish job. | tool | #350 |
| R13 | Materialization produces a content item with a single `platformTarget` and `status: approved`; publishing it through the existing lane flips the variant to `published` and adds `published_as` with `targetId`. | integration (publish handlers) | #350 |
| R14 | Lineage query: `content_post → content_item → variant → launch → sources` resolves for a published writing variant via edges only. | query test | #350 |
| R15 | Changing the spine hash revokes approvals and returns unqueued approved items to `draft`; queued/published items are untouched. | unit | #350 |
| R16 | `get_content` returns the untruncated body for a 10 kB item; `query_content` still truncates to 200 chars. | tool | #349 |
| R17 | The packaged plugin zip contains `skills/signals-writing/**` and no `docs-dev/**`; overlay files pass the record-format check. | package test | #348 |
| R18 | The brief section for a `signalsWriting` template lists capability rows and never lists a removed tool name. | unit | #349 |
| R19 | Attribution key derivation is deterministic and cohorts are not pooled across platform/goal; sparse keys yield `insufficient_evidence`. | unit | #352 |
| R20 | `docs-dev/refs/manifest.json` validates against the on-disk corpus (`npm run verify:writing-corpus`). | script (this PR) | #347 |

---

## 9. Corpus curation

The full inventory is `docs-dev/refs/manifest.json` (one entry per skill, validated by
`scripts/verify-writing-corpus-manifest.mjs`); `docs-dev/refs/README.md` states the handling rules.
This section records the decisions.

### 9.1 Inventory and adoption

63 skills, 177 files, 1.0 MB, eight families: `x-skills` (9), `threads-skills` (8),
`linkedin-skills` (11), `facebook-skills` (8), `instagram-skills` (9), `tiktok-skills` (8),
`youtube-skills` (9), `humanizer-skill` (1). Every family uses one skeleton (frontmatter →
when-to-use → input/output → steps → hard rules → anti-patterns → resources); the seven platform
families are find-and-replace ports of each other (e.g. `sub-skills/voice-profile.md` differs by
2–4 lines across families; reply templates are character-identical between X and Threads).

Dispositions: **adopt-core** 3 (`humanizer-skill`, `linkedin-humanizer`, `linkedin-employee-advocacy`),
**adopt-overlay** 9 (the X/LinkedIn/Facebook writers, thread builder, repurposers, and humanizers),
**defer-353** 24 (other platforms' writers/humanizers/repurposers and all engage surfaces),
**reference-only** 26 (audience-insights, content planners, profile optimizers, hook extractors,
engager analytics), **exclude** 1 (`linkedin-thread-monitor`). "Adopt" always means re-authored
in Signals' words with the corpus path recorded as `source` on each rule — never copied text.

### 9.2 What lands where

| Corpus pattern | Rule class | Destination |
|---|---|---|
| Character/unit limits, hashtag caps the platform rejects, media requirements, no-link-in-unit-1 | `hard` | overlay hard records (x, linkedin, facebook); #353 for others |
| "Never introduce facts not in the input", "delivery changes, never the meaning or the numbers", "true story only", "honor the click", reviewer risk-surface flags | `claim` | `core/claims.md`, `core/audit.md`, §5.6 risk tiers |
| Voice-profile-first preamble, fingerprint preserve-list, "sample takes priority over style rules", tier conflict table | `voice` | `core/voice.md`, §4.3 precedence |
| Hook formulas, fold/hook placement, structure guidance, AI-tell phrase lists, engagement-signal weightings | `heuristic` (confidence `low`) | overlay formula/heuristic records with provenance |
| Em-dash policy, emoji counts, rule-of-three, sign-off styles, "no ALL CAPS first line" | `aesthetic` | overlay/core aesthetic records (info severity) |
| Approval card, "on approval publish", image approval gate | contract | §6.4 + `materialize_variant`; images are user-supplied |
| Planning grids, pillar mixes, posting windows | not adopted | reference-only (planning is not an MVP mode; timing claims unsourced) |
| Audience/engager scraping (Apify), profile/bio rewriting, trend/sound mapping | not adopted | Signals audience intelligence; out of scope |

### 9.3 Broken references

167 reference edges point at 51 targets that do not exist anywhere in the corpus. They fall into
five groups, each with one disposition (recorded per reference in the manifest):

| Group | Targets | Referencing skills | Disposition |
|---|---|---|---|
| Bundle-root shared layer | `<family>/references/{hook-formulas, algorithm-heuristics, voice-profile, voice-rules}.md` | ~55 skills | **replace** — formulas/heuristics become namespaced overlay records (§5.10); voice profile becomes the Signals document (§5.1); voice rules become `core/voice.md` |
| Bundle-root `SKILL.md` "Global voice rules" | `<family>/SKILL.md` | 50 files | **replace** — `signals-writing/SKILL.md` + `core/` |
| Platform-specific shared files | `instagram-skills/references/{hashtag-strategy, media-workflow}.md`, `youtube-skills/references/thumbnail-principles.md` | ig/yt skills | **replace** — deferred overlays (#353); media workflow → Signals media assets |
| Angle library | `linkedin-skills/references/founder-topics.md` | post-writer, content-planner | **remove** — angles come from the spine, not a topic library |
| Python wrappers | `lib/publora_client.py`, `lib/url_parser.py` | tt/yt skills | **replace** — agent tools; no Python ships |

Three files that *do* exist are redirect tombstones ("This file moved to root-level
`references/…`"): `linkedin-post-writer/references/{algorithm-heuristics,hook-formulas}.md` and
`linkedin-comment-drafter/references/voice-rules.md`. Consequence: **no hook-formula skeleton
exists anywhere in the corpus**; the MVP catalog (§6.3) is re-authored from formula names and the
descriptions in the writer skills. Nothing is restored — the missing layer was never ours to copy.

### 9.4 Vendor assumptions and replacements

| Corpus assumption | Where | Signals/RealTimeX contract |
|---|---|---|
| **Publora** `lib.publish(kind, draft_text, target_url, platforms=[<PLATFORM_ID>], scheduled_time, media_urls, platform_settings)`; thread auto-split, `(1/N)` numbering, `postGroupId`, no reply/comment endpoints | 28 skills | Approved content item → `send-to-agent` → `publish_jobs` → `signals-publish` (X direct, Facebook direct, LinkedIn beta). Threads are explicit `threadTexts`; no scheduling; other networks export |
| **Apify** `APIFY_TOKEN`, `lib.ApifyClient().fetch_*` (audience, engagers, posts), voice read layer | 20 skills | Signals contacts/niches/personas/imports + RealTimeX Browser research written back via agent tools; voice samples come from Signals content items or user paste |
| **Pixfaro** `PIXFARO_TOKEN`, `lib.illustrate/refine/image_backend/available_models`, model names, cost guard | 13 skills | Not replaced: `media.plan: "user_supplied"` via `POST /api/media`; image generation is a later, separate decision |
| **`lib.*` wrappers** (`url_parser.parse_*`, `approval.render_approval_card`, `tiktok_settings`, `repost`, `fetch_post`, `sha`) | 47 skills | Agent tools + `signals-pp-cli`; URL parsing is `resolve_platform_claim`/target registry; the approval card is a skill contract (§6.4) |
| **AI-detector APIs** (GPTZero, Originality.ai, ZeroGPT, Sapling, Copyleaks) | linkedin-humanizer | Excluded; audits are rule-based |
| **YouTube Data API** | yt-audience-insights | Deferred with #353 |

### 9.5 Exclusions (never adopted)

- Platform-manipulation guidance: engagement-pod detection-evasion and "recovery protocol" (`linkedin-thread-monitor`, `linkedin-content-planner`), timed human-mimicry pauses before commenting (`linkedin-comment-drafter`, `linkedin-reply-handler`), pre-publish commenting on large accounts, AI-detector gaming (`linkedin-humanizer/sub-skills/detector-tester.md`, `scripts/`).
- Engagement bait shapes: comment-gating (`F6`), vote bait (`FB4`), quote-dunks (`X4`, `T4`, reply `R5` variants).
- Personal identifiers and non-public paths embedded in the LinkedIn bundle; a named third party's live post and derived template (`linkedin-hook-extractor/references/examples.md`).
- Unsourced multipliers presented as facts ("~66% lift", "8.5x", "6–8x reach", "360Brew", "~70% sound-on", tap-through percentages, posting windows). They may be cited as `heuristic` records at `confidence: low` with the corpus path, never as statements in the skill prose.
- Verbatim example pairs in `humanizer-skill` derived from the CC BY-SA Wikipedia article.

### 9.6 Heuristic confidence policy

Every performance claim in the corpus is unsourced (the only citations anywhere are for AI-detector
unreliability and a court case, plus vendor marketing pages). Adopted heuristics therefore start at
`confidence: low` with `source.kind: corpus`, `observedAt` = the month the source claims
(`2026-07` for the "corpus pulls"; `2026-04` for the LinkedIn maintainer date; otherwise the
manifest `updatedAt`), and `reviewBy` six months out. Promotion rules are in §5.10 and §7.6.
Platform limits stated by the corpus are verified against platform documentation or the publish
adapter before becoming `hard` records; where the corpus contradicts itself (LinkedIn fold 210 vs
265 chars; passive-voice ceiling 8% vs 10%; formula counts 16 vs 20, 10 vs 11, 10 vs 13) the
overlay picks one value, records both sources, and files the discrepancy in the record's `notes`.

### 9.7 Manifest format and maintenance

`docs-dev/refs/manifest.json` (`schemaVersion: 1`):

- `policy`, `dispositions` — the rules above, in the file so they travel with the corpus.
- `families[]` — `id`, `platform`, `provenance`, `license { declared, status: unknown | declared | conflict }`, `redistribution: "not-cleared"`, `adoptionPolicy: "re-author-only"`.
- `skills[]` — `id` (directory name), `family`, `path`, `platform`, `surfaces[]` (namespaced; `*/profile` and `*/weekly_plan` mark non-adopted surfaces), `capability`, `disposition`, `ruleClasses { hard, claim, voice, heuristic, aesthetic }`, `heuristicConfidence`, `datedClaims`, `files[]`, `missingReferences[] { ref, referencedFrom[], disposition: restore | replace | remove, replacement }`, `vendorAssumptions[] { vendor, symbols[], replacement }`, optional `formulaMap[] { corpus, adoptedAs }`, `exclusions[]`, `notes`.

`npm run verify:writing-corpus` recomputes `files`, `missingReferences.ref`, `vendorAssumptions.vendor`,
and `datedClaims` from disk and fails on drift or on any missing curated field; it also checks
that platforms come from `PLATFORMS`, surfaces and formula ids are namespaced, unknown/conflicting
licenses stay `not-cleared`, and every vendor/dangling reference has a replacement. Adding or
removing corpus files: run `node scripts/verify-writing-corpus-manifest.mjs --update`, fill the
`null` dispositions/replacements it leaves behind, and re-run the validator. The check is part of
`npm run check`.

---

## 10. Architecture decision records

### ADR-347-1: One `signals-writing` skill with core + overlays; corpus stays dev-only
**Status:** Accepted. **Context:** 63 reference skills, seven near-identical platform ports, no shared layer on disk, unknown licensing. **Options:** (a) vendor the bundles as workspace skills — rejected: license not cleared, vendor stack absent, 63 routers with conflicting rules; (b) one skill per platform — rejected: seven copies of the same core, precedence rules drift; (c) one skill, common core, one overlay per platform, corpus as reference — chosen. **Consequences:** every rule has one home and one provenance record; adding a platform is an overlay plus a capability row; the corpus must never be packaged (manifest `policy.packaging`, R17).

### ADR-347-2: Launch = run, Variant = platform-native draft, Content Item = approved single-platform artifact
**Status:** Accepted. **Context:** Compose stores one body with a comma-joined `platformTarget`; `publishVariant` materializes as `published` directly. **Options:** (a) reuse Compose's multi-platform item — rejected: violates N5 and makes per-platform audit/lineage impossible; (b) new `writing_runs`/`writing_drafts` tables — rejected: duplicates Launch/Variant and needs migrations; (c) map onto Launch/Variant/Content with a new `materialize_variant` seam and one item per platform — chosen. **Consequences:** Wind Tunnel, launch UI, calibration, and the publish lane work unchanged; `upsert_variant status: published` is refused for writing variants; the Compose path stays legacy (#354 fixes only its validation).

### ADR-347-3: Metadata-first persistence, migration-free MVP, named triggers for tables
**Status:** Accepted. **Context:** `AGENTS.md` gates migrations; every MVP access is by id or 1-hop edge. **Options:** (a) tables now — rejected: sign-off cost before the contracts have been exercised; (b) JSON contracts in existing columns + typed edges, validated by Zod — chosen. **Consequences:** contracts carry `schemaVersion`; `metadata.writing` validation only applies to `signals-writing` producers; §7.4 lists the concrete triggers that justify a later migration, and each JSON document is designed as a straight projection of that future row.

### ADR-347-4: Voice profiles live in a Signals-owned file store now; a `voice_profiles` table later
**Status:** Accepted. **Context:** The corpus keeps voice in a skill-local markdown file that is agent-owned and unreadable by the app; N9 forbids `contact_personas`; `config.json` is for scalars. **Options:** (a) agent workspace files — rejected: Signals cannot read them for context or UI, no versioning; (b) `config.json` — rejected: not versioned, wrong tool; (c) table now — rejected per ADR-347-3; (d) versioned JSON documents under `SIGNALS_DATA_DIR/writing/voice-profiles/` behind tools — chosen. **Consequences:** V1–V5 are enforced in one module; the row shape for the eventual table is fixed today; backups must include the directory (documented in `docs/local-app.md` by #350).

### ADR-347-5: Explicit approval by default; `auto_low_risk` is user configuration that never publishes
**Status:** Accepted. **Context:** N7. **Options:** (a) approval toggle per run — rejected: per-call flags let agents disagree with the user (same reasoning as ADR-314-2); (b) global policy resolved env → `config.json` → default, tiers derived from the audit — chosen. **Consequences:** `high` always needs the user; policy-approved variants still require a separate publish instruction; the approval record carries the policy in force.

### ADR-347-6: Static capability registry pinned to the publish lane
**Status:** Accepted. **Context:** "Can draft" must never read as "can publish"; adapters exist only for X, Facebook, and (beta) LinkedIn. **Options:** (a) infer from `platform_targets` at runtime — rejected: a target row is not an adapter; (b) static registry with a test asserting equality with `PUBLISH_PLATFORM_TARGETS` — chosen. **Consequences:** UI, tools, and the skill read one source; a new platform cannot claim `direct` without changing the registry and the lane together (G1).

### ADR-347-7: Writing runs are workflow-template runs; the Launch is the job record
**Status:** Accepted. **Context:** Persona generation needed a job table because it returns one validated JSON blob; writing persists incrementally through tools. **Options:** (a) `writing_jobs` table + callback — rejected: adds a table for state the Launch and `workflow_runs` already hold; (b) template run with a `signalsWriting` config marker and brief section, results via tools, Launch status as the observable — chosen. **Consequences:** reuses `run-template-via-rtx`, thread naming, and teardown; a partially completed run is visible as a `generating` launch with missing surfaces; no watchdog in v1 (same stance as ADR-118-4).

### ADR-347-8: Five rule classes with fixed precedence and provenance records
**Status:** Accepted. **Context:** The corpus mixes platform limits, unsourced "2026 algorithm" claims, taste, and safety in the same lists and contradicts itself across copies. **Options:** (a) keep tiers from `linkedin-humanizer` (forensic/strict/aesthetic) — rejected: tiers encode detection strength, not authority; (b) classes by *authority* (`hard` > `claim` > `voice` > `heuristic` > `aesthetic`) with only the first two able to block, every heuristic carrying source/confidence/review date — chosen. **Consequences:** voice from real samples wins over style rules by construction (N3); dated claims expire; audits expose which rules were applied or skipped and why.

### ADR-347-9: Re-author only; no verbatim vendoring; licensing is a visible manifest field
**Status:** Accepted. **Context:** 62/63 skills have no license; the one MIT declaration sits on CC BY-SA-derived text with no copyright holder; the LinkedIn bundle embeds personal identifiers and a named third party's post. **Options:** (a) vendor with attribution — rejected: no grant to rely on; (b) re-author every adopted pattern in Signals' words, cite the corpus path as provenance, exclude manipulation/identifier content — chosen. **Consequences:** the manifest's `license.status`, `redistribution`, and `adoptionPolicy` are validated; the validator runs in the gate so silently copied content cannot enter without a manifest change.

### ADR-347-10: Namespaced identifiers and closed surface vocabulary
**Status:** Accepted. **Context:** Five different "R1"s, "T1"s that mean Threads in one family and TikTok in another, counts that drift. **Options:** (a) keep corpus codes — rejected; (b) `platform/surface/slug@version` for formulas, `platform/surface/class/slug` for rules, closed per-platform surface registry — chosen. **Consequences:** attribution keys are stable across overlay versions; the manifest maps corpus codes to slugs so provenance is not lost.

---

## 11. Dependency-ordered implementation plan

```
#347 (this spec) ──► #349 tools ──┬──► #348 skill MVP ──► #351 Creative Studio ──► #352 calibration
                └──► #350 persistence ┘         └────────────────────────────────────► #353 platforms
#354 Compose validation fix — independent of all of the above
```

Recommended serial order and per-issue contract (each gets a fresh issue-scoped loop; none should
expand this PR):

| Order | Issue | Consumes from this spec | Delivers | Tests |
|---|---|---|---|---|
| 1 | **#349** agent tools | §7.2, §7.3 (`get_content`, `create_content_draft`, `update_content_draft`, `get_writing_context`), §5.8 G1/G2, §6.6 template-brief line | tools + `send-to-agent` gate + `signals-writing.ts` brief section + seeded template rewrite + `docs/agent-tools.md` + OpenAPI | R9, R10, R16, R18; auth/scope/idempotency per tool |
| 2 | **#350** persistence & lineage | §5.1–§5.7, §5.11, §7.4 | `src/lib/writing/{contracts,surfaces,ids,capabilities,voice-profile-store,attribution-key}.ts`, `upsert_variant` validation, voice tools, `materialize_variant`, `revoke_variant_approval`, edges, policy module | R1–R7 (verdict/validation), R11–R15 |
| 3 | **#348** skill MVP | §6 entirely, §4.3, §9.2–§9.6 (what to re-author) | `.claude/skills/signals-writing/**`, plugin packaging, docs | R7, R8, R17; overlay format test; packaged-zip test |
| — | **#354** Compose fix | §7.8 | draft-route validation from `PUBLISH_PLATFORM_TARGETS` | route regression |
| 4 | **#351** Creative Studio | §7.5, §5.4–§5.6 (what to render) | routes/components, REST wrappers for materialize/revoke | component/route/e2e per #351 |
| 5 | **#352** calibration | §5.9, §7.6 | attribution module, outcome records, recommendations, repurpose flow | R19 + sparse/cohort/privacy tests |
| 6 | **#353** platforms | §5.8, §7.7 | capability rows, per-platform child issues (overlay + adapter + publisher + tests each) | G1 per platform; export-only enforcement |

#349 and #350 can run in parallel worktrees if the `get_writing_context.voiceProfile` field is
left `null` until #350 lands (documented in §7.3). #348 must not start its packaging test before
#349's tool names are merged, because `SKILL.md` names them.

---

## 12. Risks and open questions (non-blocking; defaults stated)

1. **Approval evidence in the MVP is a thread message relayed by the agent** (`kind: "thread_message"`). The agent could misreport; the mitigation is that the approval card and the persisted state are identical, the thread is auditable, and #351 adds UI approval with `kind: "ui"`. Default: accept for MVP, document in `core/approval.md`.
2. **LinkedIn is `beta`** (shared-connection verify-only in `signals-publish`). Default: registry says `beta`; the approval card says so; #348 acceptance for LinkedIn is "materialized + handed off", not "published".
3. **Facebook target kind.** The corpus is Page-only; Signals targets are `profile` or `page`. Default: the overlay states rules per kind where they differ (Page CTA/links) and `riskTier` is `high` for `page`/`organization` targets.
4. **No formula skeletons exist in the corpus.** The MVP catalog is re-authored from names and descriptions; treat every formula as `heuristic` at `low` confidence until outcomes exist (§7.6).
5. **Voice-profile file store and backups.** Users who back up only `data.db` lose profiles. Default: #350 documents the directory; the table migration trigger (c) in §7.4 covers the durable fix.
6. **Media.** Instagram/TikTok/YouTube surfaces are text-only exports until an asset model exists; image generation (Pixfaro replacement) is explicitly not decided here.
7. **`npm run check` now includes the corpus validator.** It is sub-second and deterministic; if the owner prefers it outside the gate, remove it from `check` and keep the npm script.
