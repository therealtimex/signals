---
name: signals-writing
description: >-
  Turn Signals launch evidence, audience context, and an approved writer voice into
  independently persisted, audited X, LinkedIn, and Facebook variants; present approval
  cards; materialize approved variants; hand approved content to signals-publish. Use when
  a Signals writing template run, a launch brief, or the user asks to draft, adapt,
  humanize, audit, or approve platform-native posts.
author: RealtimeX
license: Apache-2.0
version: "1.0.0"
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
4. Use files plus `run-signals-pp-cli.sh agent-tools invoke --agent --stdin < file` for payloads.

## Modes, progressive loads, and tools

| Mode | Load | Tools |
|---|---|---|
| `voice build` / `voice approve` | `core/voice.md` | `get_writing_context`, `query_content`, `get_content`, `list_voice_profiles`, `get_voice_profile`, `upsert_voice_profile`, `approve_voice_profile` |
| `spine` | `core/claims.md`, `core/lineage.md` | `get_writing_context`, `get_content`, `upsert_launch` |
| `draft` | `core/claims.md`, `core/voice.md`, `core/audit.md`, one platform overlay | `upsert_variant` |
| `adapt` / `revise` / `humanize` | draft loads plus `core/adapt.md` | `get_content`, `query_graph`, `upsert_variant` |
| `audit` | `core/audit.md`, one platform overlay | `upsert_variant` |
| `approve` / `export` / `publish` | `core/approval.md`, `core/lineage.md` | `get_content`, `query_graph`, `materialize_variant`, `revoke_variant_approval`, REST `send-to-agent` |

Load only `.claude/skills/signals-writing/overlays/x.md`, `linkedin.md`, or `facebook.md` for the
requested supported surface. Use `.claude/skills/signals-writing/reference.md` for exact payloads.

## Run contract

1. **Bootstrap** — read `launchId`, goal, surfaces, sources, instructions, voice selection,
   precedence, mode, and adaptation source from the brief.
2. **Context** — call `get_writing_context` with sources included. Treat redactions and
   capabilities as final; create a launch first only when the brief has none.
3. **Voice** — use an approved pinned/active profile. Resolve ambiguity with the user; build from
   at least three admissible self-authored samples when none exists; stop on a missing pin.
4. **Spine** — extract verbatim claims only from public or durably approved source views. Persist a
   complete launch-writing document and read the server-derived spine hash back.
5. **Draft per surface** — start each surface from the same spine, not another surface's body.
   Select a versioned formula and preserve approved voice evidence under the chosen precedence.
6. **Measure and audit** — run `writing-cli.cjs measure`, create the structured audit, run
   `verdict`, then `precheck`. Fix every problem before `upsert_variant`; retry validation errors
   with the same request hash.
7. **Optional Wind Tunnel** — use the `realtimex-signals` simulation playbook. Simulation never
   changes the approval gate.
8. **Approval cards** — render from the persisted `upsert_variant` response, then wait for an
   explicit `approve <variantId>`, `revise <instruction>`, or `reject`.
9. **Close** — call `complete_workflow_run` with variant IDs, content item IDs, blockers, and
   missing surfaces. Publishing remains a separate explicit instruction.

## Contract ownership

| Agent supplies | Signals derives or owns |
|---|---|
| Spine/source/claim IDs | Source hashes and forced sensitivity |
| Verbatim source text and claims | Spine hash |
| Distinct units, formula, overlay/core versions | Audit ID and input hash |
| Findings and claim observations | Hard-count and verdict validation |
| Voice content and real sample provenance | Voice version/hash/lifecycle |
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
Audit    <verdict>  ·  blockers <n>  ·  warnings <n>  (list each finding code + one line)
Risk     <tier>  ·  policy <explicit|auto_low_risk>
Publish  <direct|beta|draft_only|export_only>  — draft_only: this platform has no publish adapter; export only
Next     approve <variantId> | revise <instruction> | reject
```

Only approval messages that name the profile/variant and say approve become thread-message
evidence. Copy the user's approval message verbatim into the evidence note.

## Capability honesty

| Surface | Draft/audit | Publish |
|---|---|---|
| `x/post`, `x/thread` | supported | direct |
| `linkedin/post` | supported | beta |
| `facebook/post` | supported | direct |
| all other surfaces | no writing overlay | draft/export boundary from context |

Unsupported surfaces get no writing variant. On an explicit export-only request, use a standalone
content draft with the same claim rules, no writing audit, no approval card, and no publish.

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

## Related

- `.claude/skills/realtimex-signals/SKILL.md` — tool and simulation operations
- `.claude/skills/signals-publish/SKILL.md` — deterministic execution after handoff
- `docs/agent-tools.md` — server-owned field contract
- `specs/signals-writing-system.md` — normative architecture
