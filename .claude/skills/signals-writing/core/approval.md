# Approval, materialization, export, and publish handoff

Approval is a durable user decision tied to the current audit. Materialization copies exactly one
approved platform variant into one content item; publishing is a later explicit instruction.
This module applies only to the `bound` and `source_stale` full lanes. A `legacy_unbound` sketch
has no approval card, materialization, export, or publish path.

## Render the persisted card

Use the `upsert_variant` response plus context, never a model-side risk estimate:

```text
Variant  <label>  ·  <platform/surface>  ·  target @handle (kind)  ·  formula <formulaId>
Body     <full text, unit-numbered for threads>
Limits   <chars per unit> / <limit>  ·  hashtags n  ·  links n  ·  media n
Claims   <preserved>/<total> preserved  ·  altered: <ids or none>  ·  missing: <ids or none>  ·  invented: none
Voice    <profile label v<version>>  ·  precedence <voice_first|rules_first>  ·  drift <score>  ·  protected quirks kept: yes
Personality  <variants[].personality.bindingId>  ·  <variants[].personalityState>  ·  self <variants[].personality.identity.selfContactId> (org <variants[].personality.identity.representedOrgId|none>)  ·  target represents <variants[].personality.target.represents.kind|none>
Objective  <kind>  ·  <source>  ·  <saved brief <path>|brief written for this run>  ·  offering <name> (@PRODUCTS.md#<slug>)|none  ·  outcome: <outcome>  ·  platform metric: <writingGoal>
Fit      <fit|not stated>  ·  unknowns: <1. … 2. …|none listed>
Ask      <relation badge> — <statement>  ·  customer pain: <none assumed|asked, not assumed — "<text>"|from a source (<claim ids>)>
Next     <next step|not stated>  ·  success: <success|not defined>
Objective limits  <short limitation labels|none>
Sources  changed since this run started: <changed paths> — drafts still use the snapshot[ · <n> approval(s) revoked] | couldn't be checked
Audit    <verdict>  ·  blockers <n>  ·  warnings <n>  (list each finding code + one line)
Risk     <tier>  ·  policy <explicit|auto_low_risk>
Publish  <direct|beta|draft_only|export_only>  — draft_only: this platform has no publish adapter; export only
Next     approve <variantId> | revise <instruction> | reject
```

After `upsert_variant`, re-read `get_writing_context` and select `variants[]` by the returned ID.
Map the Personality line exactly from that entry's `personality.bindingId`, `personalityState`,
`personality.identity.selfContactId`, `personality.identity.representedOrgId`, and nullable
`personality.target.represents.kind`; do not substitute names inferred from workspace files. Map
target handle/kind from the context `targets[]` entry, hard and claims from persisted `audit`, voice
label/version from the resolved profile, risk/policy from `approval`, and publish text from
`capability.publish`.

### Objective lines (composed runs)

`O` is `launch.writing.composition.objective`; the ask is the selected variant's
`variants[].intent.ask`. Use the run page's words, never your own summary:

| Card value | Persisted field | Rendering |
|---|---|---|
| kind | `O.kind` | `commercial` → Business outcome; `relationship_only` → Relationship only |
| source | `O.source` | `run_config` → set when the run started; `template_config` → from the template's default; `default` → no objective was given |
| brief | `O.brief.source.kind`, `O.brief.source.path` | saved brief `<path>`, or brief written for this run |
| offering | `O.offering.name`, `O.offering.slug` | `<name> (@PRODUCTS.md#<slug>)`, or none |
| outcome / fit / unknowns | `O.parsed.outcome`, `O.parsed.fit`, `O.parsed.unknowns` | unknowns numbered from 1 |
| next / success | `O.parsed.nextStep`, `O.parsed.success` | not stated / not defined when null |
| platform metric | `variants[].intent.goal.writingGoal` | never merged with the outcome |
| relation badge | `variants[].intent.ask.relation`, `variants[].intent.ask.testsUncertainty` | Advances outcome · Tests unknown n · Defers outcome (add "why: `variants[].intent.ask.deferReason`") · Relationship only |
| statement | `variants[].intent.ask.statement` | verbatim |
| customer pain | `variants[].intent.ask.customerPain.status`, `variants[].intent.ask.customerPain.text`, `variants[].intent.ask.customerPain.claimIds` | none assumed · asked, not assumed — "text" · from a source (claim ids) |
| objective limits | `O.limitations` | no offering · offering not found · more than one offering · no proof points · file not found · fit not stated · success not defined |
| sources | `launch.writing.objectiveSource.status`, `launch.writing.objectiveSource.changedPaths`, `variants[].revokedReason` | only when stale or unavailable; add "· n approval(s) revoked" only when n ≥ 1 variants on the launch have `variants[].revokedReason` `objective_source_stale` |

A `revoked` approval with reason `objective_source_stale` means a saved brief or mentioned file
changed after the run started. The snapshot is still the run's objective; render a fresh card and
ask for a fresh approval.

## Approval policy

- `explicit`: call `materialize_variant` only after a user message names or unambiguously selects
  the variant and says approve. Send `approval.by: "user"` and thread-message evidence.
- `auto_low_risk`: Signals may mark a low-risk passing/warning variant approved by policy. Omit a
  user approval payload when materializing that persisted policy approval.
- Always require the user for high risk: blocked audit, private inclusion, named-party quote/name,
  or page/organization target. Medium/high never inherit low-risk policy.
- Approval of a voice profile does not approve a variant. Approval of one surface does not approve
  another. Simulation scores never approve anything.

Thread evidence is:

```json
{"kind":"thread_message","workspaceSlug":"<RTX workspace>","threadSlug":"<RTX thread>","note":"<user approval message verbatim>"}
```

## Materialize and revise

Call `materialize_variant` with the approved variant ID. Report `contentItemId`, whether it was
created/updated/adopted, the persisted capability, and `nextAction`.

Handle errors by contract:

- `AUDIT_STALE`: rerun audit after reading current spine/units, present a new card, and reapprove.
  For a `personality_*` or `target_identity_mismatch` reason, re-read context, render the persisted
  stale-state card, and follow `core/personality.md`; the server already revoked approval.
- `AUDIT_BLOCKED`: fix claim/hard blockers; do not ask for approval yet.
- `APPROVAL_REQUIRED`: wait for real evidence. After a `source_stale` audit, explain that the exact
  warned audit needs fresh explicit approval.
- `TARGET_REQUIRED`: select an active matching target from writing context.
- `CAPABILITY_UNSUPPORTED`: state export-only/draft-only honestly.
- `CONFLICT`: preserve the publish-lane item and create a derived alternative if revision is wanted.
- `WRITING_ARTIFACT_STALE`: a Personality reason is terminal for the item until re-audit and fresh
  approval complete.

On `reject` or `withdraw`, call `revoke_variant_approval` with reason `user` and the user's note.
If Signals reports a publish-lane conflict, explain that the immutable queued/published artifact
cannot be revoked by editing its source variant.

## Publish handoff

Only after a separate explicit publish instruction, POST the materialized item and target to
`$SIGNALS_BASE_URL/api/content/send-to-agent`. Do not run browser publisher scripts here and do not
send `text` or `threadTexts`; Signals derives ordered units from the persisted item.

```json
{"contentItemId":"<content item>","targets":[{"targetId":"<target>"}]}
```

Report the 202 response's job ID and RealTimeX publish workspace/thread. LinkedIn beta means
materialized plus handed off; the publish thread owns verify-only/dedicated-session behavior.

## Export boundary

For a materialized item whose next action is export, print ordered units in a fenced markdown block
labeled with platform/surface and content item ID. For an unsupported surface requested explicitly
as a sketch, create a standalone draft under the capability row, apply the same claim rules, and
state that it has no writing audit, approval card, or publish path.

After any correction or revocation, render a fresh persisted card. Require a fresh approval
message when policy is explicit or the server reports medium/high risk; old evidence never
transfers to changed units, targets, voice, spine, or audit.
