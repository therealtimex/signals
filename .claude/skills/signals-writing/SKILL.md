---
name: signals-writing
description: >-
  Turn Signals launch evidence, audience context, approved workspace Personality, and writer voice into
  independently persisted, audited X, LinkedIn, and Facebook variants; present approval
  cards; materialize approved variants; hand approved content to signals-publish. Use when
  a Signals writing template run, a launch brief, or the user asks to draft, adapt,
  humanize, audit, or approve platform-native posts.
author: RealtimeX
license: Apache-2.0
version: "1.1.0"
coreVersion: 1
allowed-tools: Read Bash
---

# Signals Writing

Turn one evidence spine into distinct, voice-grounded platform variants while keeping claims,
approval, and the publish boundary inspectable in the thread.

## When to use / when not

Use this skill for Signals writing templates and requests to build a writer voice, extract a
message spine, draft or adapt platform-native posts, humanize, audit, approve, materialize, or
hand approved content to publishing.

Do not use it for Compose's one-body drafts, direct publishing work, audience-persona synthesis,
or unsupported-platform variants. Use `signals-publish` only after this skill has materialized an
approved content item and the user separately asks to publish.

## Start here

1. Run `.claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh health`.
2. Export the brief's `SIGNALS_BASE_URL` and create `workflow-runs/<runId>/writing/`.
3. Read the brief's **Signals Writing execution contract**. Its config, redactions, targets, and
   capability rows are authoritative.
4. Read `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md` from the workspace root as whole
   files, including managed and unmanaged prose. They are the canonical live identity and voice.
5. Use files plus `run-signals-pp-cli.sh agent-tools invoke --agent --stdin < file` for payloads.

## Personality gate

Read `get_writing_context.personality` immediately before writing and select exactly one lane:

| Status | Lane |
|---|---|
| `bound` | Full lane. Copy the current `personality.binding.id` as `{ bindingId }` into every `upsert_variant`. |
| `source_stale` | Full lane with the persisted warning. Tell the user materialization requires fresh explicit approval of the warned audit. |
| `unbound` | Legacy-unbound sketches only: targetless and unaudited, visibly labelled `legacy_unbound`. Offer Settings → Personality or the projection flow to unlock the full lane. |
| `drifted` / `unavailable` / host capability not `available` | Refuse Personality-required writing, render the persisted stale-state card, and never edit files to repair drift. |

The binding status, proposal status, audit snapshot, target compatibility, and approval blockers
come only from persisted server records. Load `core/personality.md` for the card and recovery rules.

## Modes, progressive loads, and tools

| Mode | Load | Tools |
|---|---|---|
| `voice build` / `voice approve` | `core/voice.md` | `get_writing_context`, `query_content`, `get_content`, `list_voice_profiles`, `get_voice_profile`, `upsert_voice_profile`, `approve_voice_profile` |
| `spine` | `core/claims.md`, `core/lineage.md` | `get_writing_context`, `get_content`, `upsert_launch` |
| `draft` | `core/personality.md`, `core/claims.md`, `core/voice.md`, one platform overlay; `core/audit.md` only in a full lane | `upsert_variant` |
| `adapt` / `revise` / `humanize` | draft loads plus `core/adapt.md`; audit only in a full lane | `get_content`, `query_graph`, `upsert_variant` |
| `audit` | `core/personality.md`, `core/audit.md`, one platform overlay; `bound`/`source_stale` only | `upsert_variant` |
| `approve` / `export` / `publish` | `core/personality.md`, `core/approval.md`, `core/lineage.md`; full lane only | `get_content`, `query_graph`, `materialize_variant`, `revoke_variant_approval`, REST `send-to-agent` |
| `personality` | `core/personality.md` | `get_personality_binding`, `propose_personality_projection`, `approve_personality_projection`, `reject_personality_projection`, `retry_personality_projection`, `rollback_personality_projection`, `unbind_personality_projection`, `set_target_representation` |

Load only `.claude/skills/signals-writing/overlays/x.md`, `linkedin.md`, or `facebook.md` for the
requested supported surface. Use `.claude/skills/signals-writing/reference.md` for exact payloads.

## Run contract

1. **Bootstrap** — read `launchId`, goal, surfaces, sources, instructions, voice selection,
   precedence, mode, and adaptation source from the brief.
2. **Context** — call `get_writing_context` with sources included. Treat redactions and
   capabilities as final; create a launch first only when the brief has none.
3. **Personality** — read the four workspace files, apply the gate above, and record only the
   current `bindingId` for bound-lane submissions.
4. **Voice** — with an active binding, `VOICE.md` is live voice and the approved profile is
   evidence/attribution. Resolve ambiguity with the user; build from three admissible self-authored
   samples when none exists; stop on a missing pin.
5. **Spine** — extract verbatim claims only from public or durably approved source views. Persist a
   complete launch-writing document and read the server-derived spine hash back.
6. **Draft per surface** — start each surface from the same spine, not another surface's body.
   Select a versioned formula and preserve approved voice evidence under the chosen precedence.
7. **Persist by lane** — for `bound`/`source_stale`, run `measure`, create the structured audit,
   run `verdict` then `precheck`, fix every problem, and call `upsert_variant` with the current
   `bindingId`. For `unbound`, run `measure`, omit `targetId` and `personality`, send `audit: null`,
   set the persisted variant `label` suffix to `legacy_unbound sketch`, call `upsert_variant`,
   then confirm its context `personalityState` is `legacy_unbound`. Do not audit or precheck that
   sketch, and do not continue it to approval, materialization, export, or publish.
8. **Optional Wind Tunnel** — use the `realtimex-signals` simulation playbook. Simulation never
   changes the approval gate.
9. **Approval cards (full lane only)** — after persistence, re-read `get_writing_context`, select
   the returned variant by ID, render the persisted card, then wait for an explicit
   `approve <variantId>`, `revise <instruction>`, or `reject`.
10. **Close** — call `complete_workflow_run` with variant IDs, content item IDs, blockers, and
   missing surfaces. Publishing remains a separate explicit instruction.

## Contract ownership

| Agent supplies | Signals derives or owns |
|---|---|
| Spine/source/claim IDs | Source hashes and forced sensitivity |
| Verbatim source text and claims | Spine hash |
| Distinct units, formula, overlay/core versions | Audit ID and input hash |
| Findings and claim observations | Hard-count and verdict validation |
| Voice content and real sample provenance | Voice version/hash/lifecycle |
| `personality.bindingId` only | Personality hashes, workspace, identity, target snapshot, audit Personality, and source-stale warning |
| Deterministic request hash and generation context | Variant lifecycle and capability snapshot |
| User evidence copied from the thread | Approval state, risk, materialization, lineage edges |

Never set `sha256`, `hash`, `inputHash`, `audit.id`, or `audit.variantId`. Generate only
`spn_`, `clm_`, `src_`, `vs_`, and `vp_` IDs with `scripts/writing-cli.cjs id`; the server allocates
`aud_` IDs.

## Approval card

Render every value from the persisted response and context:

```text
Variant  <label>  ·  <platform/surface>  ·  target @handle (kind)  ·  formula <formulaId>
Body     <full text, unit-numbered for threads>
Limits   <chars per unit> / <limit>  ·  hashtags n  ·  links n  ·  media n
Claims   <preserved>/<total> preserved  ·  altered: <ids or none>  ·  missing: <ids or none>  ·  invented: none
Voice    <profile label v<version>>  ·  precedence <voice_first|rules_first>  ·  drift <score>  ·  protected quirks kept: yes
Personality  <variants[].personality.bindingId>  ·  <variants[].personalityState>  ·  self <variants[].personality.identity.selfContactId> (org <variants[].personality.identity.representedOrgId|none>)  ·  target represents <variants[].personality.target.represents.kind|none>
Audit    <verdict>  ·  blockers <n>  ·  warnings <n>  (list each finding code + one line)
Risk     <tier>  ·  policy <explicit|auto_low_risk>
Publish  <direct|beta|draft_only|export_only>  — draft_only: this platform has no publish adapter; export only
Next     approve <variantId> | revise <instruction> | reject
```

The Personality placeholders above are exact paths on the selected persisted
`get_writing_context.variants[]` entry; do not substitute names inferred from workspace files.

Only approval messages that name the profile/variant and say approve become thread-message
evidence. Copy the user's approval message verbatim into the evidence note.

## Capability honesty

| Surface | Draft/audit | Publish |
|---|---|---|
| `x/post`, `x/thread` | supported | direct |
| `linkedin/post` | supported | beta |
| `facebook/post` | supported | direct |
| `x/reply`, `x/direct_message` | supported | draft_only |
| `linkedin/comment`, `linkedin/direct_message` | supported | draft_only |
| `facebook/comment`, `facebook/direct_message` | supported | draft_only |
| all other surfaces | no writing overlay | draft/export boundary from context |

The `draft_only` rows are assist-only surfaces: full spine, voice, audit, approval card, and
materialization, but no publish adapter and no send. Never submit one to a publish job, and never
describe it as publishable. A composed workflow reaches them through the writing-intent contract
(`docs/composable-writing-intent.md`), which pins explicit approval — `auto_low_risk` does not
apply to a proposal.

Surfaces outside the table get no writing variant. On an explicit export-only request, use a
standalone content draft with the same claim rules, no writing audit, no approval card, and no
publish.

## Never do

1. Never call a removed in-process tool (`save_draft`, `report_progress`, `search_web`) or a
   `lib.*` wrapper; agent tools are the only write path.
2. Never write a content item directly for a variant; use `materialize_variant`.
3. Never introduce a fact, number, date, name, quote, or citation absent from the spine.
4. Never use an unapproved voice profile or build one from generated or third-party writing.
5. Never scrub a protected quirk under `voice_first`; record the skipped rule.
6. Never imply publish support when capability is not `direct` or `beta`.
7. Never use manipulation, engagement bait, artificial delays, or detector gaming.
8. Never approve for the user under `explicit`; `auto_low_risk` never covers medium/high risk.
9. Never publish without a separate explicit instruction; hand off through `send-to-agent`.
10. Never compute hashes or counts by hand; use `scripts/writing-cli.cjs` and server responses.
11. Never send partial `metadata.writing` arrays to `upsert_launch`; arrays replace on merge.
12. Never create, edit, patch, or delete `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md`, or
    `AGENTS.md`; use `propose_personality_projection` and user approval for Personality changes.
13. Never manufacture Personality snapshots, hashes, workspace, identity, or target fields;
    submit only the active `bindingId`.
14. Never author or copy `core/voice/personality-source-stale`; the server inserts it.
15. Never declare another skill version to bypass the Personality gate or present a
    legacy-unbound sketch as Personality-bound.

## Related

- `.claude/skills/realtimex-signals/SKILL.md` — tool and simulation operations
- `.claude/skills/signals-publish/SKILL.md` — deterministic execution after handoff
- `docs/agent-tools.md` — server-owned field contract
- `specs/signals-writing-system.md` — normative architecture
