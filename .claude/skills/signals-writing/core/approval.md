# Approval, materialization, export, and publish handoff

Approval is a durable user decision tied to the current audit. Materialization copies exactly one
approved platform variant into one content item; publishing is a later explicit instruction.

## Render the persisted card

Use the `upsert_variant` response plus context, never a model-side risk estimate:

```text
Variant  <label>  ·  <platform/surface>  ·  target @handle (kind)  ·  formula <formulaId>
Body     <full text, unit-numbered for threads>
Limits   <chars per unit> / <limit>  ·  hashtags n  ·  links n  ·  media n
Claims   <preserved>/<total> preserved  ·  altered: <ids or none>  ·  missing: <ids or none>  ·  invented: none
Voice    <profile label v<version>>  ·  precedence <voice_first|rules_first>  ·  drift <score>  ·  protected quirks kept: yes
Personality  <pb_id>  ·  <bound|source_stale|legacy-unbound>  ·  self <name> (org <name|none>)  ·  target represents <self|org|unbound>
Audit    <verdict>  ·  blockers <n>  ·  warnings <n>  (list each finding code + one line)
Risk     <tier>  ·  policy <explicit|auto_low_risk>
Publish  <direct|beta|draft_only|export_only>  — draft_only: this platform has no publish adapter; export only
Next     approve <variantId> | revise <instruction> | reject
```

Map target handle/kind and Personality from context and persisted snapshots, hard and claims from
audit, voice label/version from the resolved profile, risk/policy from `approval`, and publish text
from `capability.publish`.

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
