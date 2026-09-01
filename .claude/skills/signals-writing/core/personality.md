# Workspace Personality

Workspace Personality is the live identity, boundaries, voice, and brand that a writing run must
honor. It is projected into four files and bound to Signals by an approved server record.

## Read-first doctrine

Before evidence synthesis, drafting, adaptation, audit, or approval:

1. Read `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md` from the workspace root.
2. Read each whole file, including managed blocks and surrounding user-authored prose.
3. Call `get_writing_context` and inspect its persisted `personality` status.
4. Treat the files as canonical live identity and voice only when the persisted gate allows it.

Compose instructions in this order: Personality, writing mandate, platform overlay, conversation,
then ledger evidence. A lower layer may narrow style or format but cannot override identity,
boundaries, representation, or approval requirements from a higher layer.

Never repair Personality by editing files. Projection changes use the proposal lifecycle and user
approval. A successful file read does not override a drifted or unavailable server status.

## Authoritative reads

During a writing run, use `get_writing_context.personality`. For binding and proposal lifecycle
work, call `get_personality_binding`. Their binding and status fields must agree; re-read rather
than reconciling a mismatch yourself.

Report `host.capability` honestly. If capability is not available, stop Personality-required work.
Do not describe a proposal as applicable when the host cannot apply it.

All displayed state comes from persisted records:

- Binding status and identity: the current context or binding view.
- Target representation: `targets[].represents` and `targets[].compatible`.
- Proposal state, files, diffs, warnings, and blockers: `proposals[]`.
- Approval blockers: `proposals[].actions.approvalBlockers` exactly as returned.
- Audit state: the server-stamped `audit.personality` object.
- Drift and recovery detail: `PersonalityStatus.detail`.

Never reconstruct these fields from file prose or model memory.

## Binding selector discipline

For a bound or source-stale lane, copy `personality.binding.id` from the context just read and send
exactly:

```json
{"personality":{"bindingId":"pb_current"}}
```

The selector contains only `bindingId`. Signals derives every hash, workspace, identity, target,
and audit field. Never cache a binding ID across a rebind. On `personality_binding_stale`, re-read
context and resubmit with the current ID. Preserve variant IDs and request hashes during a retry;
do not rotate them merely to escape a contract error.

Audit input never contains a Personality selector or snapshot. Signals stamps audit Personality
from the persisted variant and current binding state.

## Lane selection

- `bound`: full draft, audit, approval, materialization, and publish-handoff lane.
- `source_stale`: full lane with a deterministic warning; tell the user that materialization needs
  fresh explicit approval of this warned audit.
- `unbound`: create only targetless, unaudited sketches labelled **legacy-unbound sketch**. Do not
  imply they used workspace Personality. Offer Settings → Personality or the projection flow.
- `drifted` or `unavailable`: refuse Personality-required writing and render the stale-state card.
- Host capability unavailable: refuse and report the capability record without guessing recovery.

A legacy-unbound sketch is not a publishable fallback. Never downgrade the declared skill version
or omit a target/audit to make full-lane work appear successful.

Its exact persistence sequence is: draft from the spine under the requested supported overlay; run
`writing-cli.cjs measure`; omit `metadata.writing.targetId` and `metadata.writing.personality`; set
`metadata.writing.audit` to `null`; set the top-level variant `label` suffix to
`legacy_unbound sketch`; call `upsert_variant`; re-read `get_writing_context` and verify
the selected `variants[].personalityState` is `legacy_unbound`. Stop there. Do not run audit
`verdict` or `precheck`, render an approval card, materialize, export, or publish the sketch.

## Binding and stale-state cards

Render from the latest persisted read:

```text
Personality  <status.binding.id|unbound>  ·  <status.status>  ·  host <status.host.capability>
Workspace    <status.workspace.slug>  ·  directory <status.workspace.dir|unavailable>
Identity     self <status.binding.identity.selfContactId|unbound>  ·  org <status.binding.identity.representedOrgId|none>
Sources      binding <status.binding.sourceHash|none>  ·  current <status.currentSourceHash|none>
Target       <targets[].id>  ·  represents <targets[].represents.kind>  ·  compatible <targets[].compatible>
Detail       <status.detail|none>
Doctrine     <required action from Lane selection or Error recovery below>
```

Here `status.*` is from `get_personality_binding.status` (or the identical
`get_writing_context.personality` fields). Render one Target row per relevant persisted
`get_writing_context.targets[]` entry, or omit that row when no target is relevant. `Doctrine` is
prescribed by this skill, not a persisted field. Do not invent a friendly status or suppress a
persisted warning. For legacy variants, report their persisted context state `legacy_unbound`
rather than `bound`.

## Projection lifecycle

1. Call `get_personality_binding` and render current state.
2. Call `propose_personality_projection` only when the user wants a projection change.
3. Render the returned proposal card and stop for a user decision.
4. After explicit approval, call `approve_personality_projection` with verbatim
   `thread_message` evidence. Use `reject_personality_projection` for rejection.
5. Use `retry_personality_projection` only for an interrupted persisted attempt.
6. Treat `rollback_personality_projection` and `unbind_personality_projection` as proposals; they
   also require the same explicit approval lifecycle.

Projection proposal card:

```text
Personality proposal  <proposals[].proposal.id>  ·  <proposals[].proposal.kind>  ·  <proposals[].record.state>
Workspace             <proposals[].proposal.workspace.slug>  ·  id <proposals[].proposal.workspace.id|none>  ·  directory <proposals[].proposal.workspace.dir>  ·  key <proposals[].proposal.workspace.key>
Binding               current <proposals[].proposal.basedOnBindingId|none>  →  proposed <proposals[].proposal.proposedBindingId>
Identity              self <proposals[].proposal.identity.selfContactId> (<proposals[].proposal.sourceSnapshot.self.input.name|snapshot absent>)  ·  org <proposals[].proposal.identity.representedOrgId|none> (<proposals[].proposal.sourceSnapshot.org.input.name|none>)
Sources               self rev <proposals[].proposal.sourceSnapshot.self.revision|none>  ·  org rev <proposals[].proposal.sourceSnapshot.org.revision|none>  ·  voice <proposals[].proposal.sourceSnapshot.voice.input.profile.label|none> (<proposals[].proposal.sourceSnapshot.voice.id|none>) v<proposals[].proposal.sourceSnapshot.voice.version|none> hash <proposals[].proposal.sourceSnapshot.voice.hash|none>  ·  statements <proposals[].proposal.sourceSnapshot.statements.hash|none>
Files                 repeat <proposals[].proposal.files[].path>: <proposals[].proposal.files[].diff>
Drift                 repeat non-null <proposals[].proposal.files[].path>: <proposals[].proposal.files[].driftDiff>; otherwise none
Preserves             repeat <proposals[].proposal.files[].path>: <proposals[].proposal.files[].unmanagedBytes> unmanaged bytes
Warnings              <proposals[].proposal.preflight.warnings|none>
Approval blockers     <proposals[].actions.approvalBlockers|none>
Actions               approve <proposals[].actions.canApprove>  ·  reject <proposals[].actions.canReject>  ·  retry <proposals[].actions.canRetry>
Doctrine next         expose only commands whose corresponding persisted action is true; otherwise stop
```

Render the full persisted `files[].diff` for each file; it is the per-file change summary the user
approves. Render every non-null `files[].driftDiff` separately and every file's `unmanagedBytes`,
without replacing them with a model-authored summary. The path prefix `proposals[]` always means the
single proposal entry selected by its persisted `proposal.id`.

Copy the approving message verbatim into evidence. Never infer approval from a request to inspect,
draft, preview, retry, roll back, or unbind.

## Target representation

Use only `targets[].represents` and `targets[].compatible`. On `target_identity_mismatch`, offer a
different compatible target or ask for explicit evidence to call `set_target_representation`.
Never assign a target to self or an organization from its handle, platform, or prose alone.
An unbound target representation is never compatible with a bound full-lane variant.

## Error recovery

| Persisted reason | Required action |
|---|---|
| `personality_binding_required` | Stop the full lane; bind Personality. Only a labelled targetless, unaudited legacy sketch remains available. |
| `personality_binding_stale` | Re-read context and resubmit the current `bindingId`; keep IDs and request hash. |
| `personality_drifted` | Stop; render drift detail and propose a newly approved projection. Never patch files. |
| `personality_identity_mismatch` | Stop; resolve the self/org identity in Signals, then create a new proposal. |
| `personality_source_stale` | Re-read, re-audit, show the server warning, and request fresh explicit approval. |
| `target_identity_mismatch` | Stop; choose a compatible target or collect evidence for target representation. |
| `workspace_mismatch` | Stop; restore the recorded workspace identity or intentionally rebind. |
| `personality_workspace_unavailable` | Stop; report the persisted workspace/host detail and retry only after availability returns. |

For `AUDIT_STALE`, assume the server has already revoked the approval in-transaction. Re-read,
re-audit, and present a fresh card. For `APPROVAL_REQUIRED` after source-stale audit, request a new
explicit approval of that exact warned audit. A personality-related `WRITING_ARTIFACT_STALE`
publish gate is terminal for the item until re-audit and re-approval complete.

Never author the `core/voice/personality-source-stale` finding. Signals removes any client copy and
inserts the deterministic persisted warning itself.
