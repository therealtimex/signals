# Signals Writing skill QA

Use this scenario after the automated skill, unit, plugin-package, and provision gates pass. It
verifies the human approval experience and capability language in an isolated workspace without
touching production data.

## Setup

1. Run `npm run qa:local-app:provision` with the repository-required Node runtime.
2. Build and install the packaged plugin in a scratch RealtimeX workspace, deploy its workspace
   provision, then run `node scripts/qa/verify-signals-plugin-provision.mjs`. Confirm the workspace
   lists `realtimex-signals`, `signals-writing`, and `signals-publish`.
3. In the isolated Signals app, create one authored outbound public content item, one public note,
   an active X profile target, a LinkedIn profile target, and a Facebook page target.
4. Create a Launch whose writing surfaces are `x/post`, `x/thread`, `linkedin/post`, and
   `facebook/post`, all pointing at the appropriate targets and sources.
5. In Settings → Personality, create and approve a projection for this workspace. Set each target
   to represent the projected self or organization as appropriate.

## Happy path

1. Run **Platform-native writing** with the Launch ID.
2. Verify the terminal agent loads Signals Writing. With no voice profile, it asks for at least
   three self-authored samples, presents the profile, and waits for an explicit `approve`.
3. Verify it reads `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md` before drafting and treats
   `get_writing_context.personality` as the binding gate.
4. Verify the agent lists spine claims with their source IDs, then presents four approval cards.
   Each card must show the persisted Personality binding, bound status, identity, and target
   representation; inspect the stored variant to confirm the server supplied all hashes.
5. Check card capability lines: X post `direct`, X thread `direct`, LinkedIn `beta`, Facebook
   `direct`. The Facebook page card must show high risk.
6. Send `approve <x-post-variant-id>`. Confirm `materialize_variant` returns an approved content
   item and `GET /api/content/<id>` exposes its current writing snapshot.
7. In a separate message, say `publish it`. Confirm the send-to-agent request returns 202 and a
   publish thread/job link. Do not complete a public post unless that is part of the QA scope.
8. Revise the LinkedIn variant. Confirm the variant ID stays fixed, the audit ID changes, and
   approval returns to pending. Reject the Facebook variant and confirm rejected state.

## Personality drift and migration

1. After approving but before materializing a fresh variant, hand-edit `VOICE.md` in the scratch
   workspace. The agent must refuse Personality-required writing, render the persisted stale-state
   card, and offer a new approved projection rather than editing the file. A materialization retry
   must revoke stale approval and return the Personality reason.
2. Redeploying plugin 0.2.4 replaces its managed `AGENTS.md`. A workspace bound before 0.2.4 may
   report `drifted` / `index_pointer_missing` because its older dynamic index span disappeared.
   Approve one new projection; the static pointer then prevents the dynamic block from returning.
3. In a separate unbound scratch workspace on plugin 0.2.4, request a writing run. The agent may
   offer only visibly labelled, targetless, unaudited **legacy-unbound sketches**. Binding
   Personality must unlock the normal draft → audit → approve → materialize lane.

## Evidence

Prefer API/SQLite evidence over dashboard rendering:

- `variants.metadata.writing.audit.verdict` and `approval.state`
- server-stamped `variants.metadata.writing.personality` and `audit.personality.statusAtAudit`
- `graph_edges` entries for `sourced_from` and `materialized_as`
- persisted ordered units on the X thread content item
- Launch status `ready` after all requested, current audits exist

## Negative checks

- Ask for `threads/post`: the agent must refuse a writing variant and may offer only an explicit
  export-only sketch.
- Ask to “just post it” before approval: the agent must refuse and cite the approval card.
- Add an unsupported number: audit must block materialization.
- Change a source/spine after approval: approval must become stale before any publish handoff.

Clean up through the isolated Local App QA cleanup command; do not delete or alter the user's
default Signals database.
