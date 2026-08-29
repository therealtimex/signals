# Adapt, revise, and humanize

Adaptation changes the delivery container while preserving the evidence boundary. Revision normally
updates one live variant in place; derived alternatives exist only when the user wants both drafts
or the original is locked by the publish lane.

## Choose the operation

- **Revise in place:** same variant `id`, request hash, generation metadata, surface, and lineage.
  Rewrite units, remeasure, reaudit, and upsert. Signals revokes stale approval automatically.
- **Keep an alternative:** omit the top-level variant `id` so Signals allocates it, increment the
  deterministic request-hash counter, set mode `revise` or `humanize`, and record
  `lineage.derivedFromVariantId`.
- **Adapt a variant:** omit the top-level variant `id`; use mode `adapt`, the appropriate
  `derivedFromVariantId` or adaptation origin, and source IDs from the shared spine.
- **Adapt a published winner:** set `adaptedFromContentItemId` and, when known,
  `adaptedFromVariantId`. Read persisted metadata and real `query_graph` edges rather than
  inferring ancestry from body similarity.
- **Locked conflict:** when Signals returns `variant_locked`, preserve the linked variant and create
  a derived alternative without an `id`. Never edit the queued/publishing/published artifact.

## Adaptation sequence

1. Read the source variant/content and its persisted writing lineage.
2. Resolve the launch context, exact spine version, approved voice profile, target, and destination
   overlay. Stop if the source is outside the requested launch or the spine cannot resolve.
3. Extract the message role of each source unit: hook, setup, proof, interpretation, CTA.
4. Choose a destination formula whose required slots are available from claims, opinion, or CTA.
5. Re-hook from the spine for the destination surface. Do not crop the prior platform body into a
   new platform shape.
6. Refit ordered units to the destination container. Keep claim wording when verbatim is required.
7. Strip source-platform artifacts such as unit numbering, UI labels, or link-placement scaffolding.
8. Apply the approved voice under precedence, then run the complete measure/audit/precheck cycle.

## Revision invariants

- In-place revision keeps `generationMetadata.mode: "draft"` and resends the original generation
  metadata unchanged. `generationMetadata` describes creation provenance, not edit history.
- A derived variant uses mode `revise`, `humanize`, or `adapt` and a request hash of
  `wr1:<runId>:<surface>:<mode>:<n>` where `n` advances only for new alternatives.
- A derived create omits the top-level variant `id`; only in-place revision sends the stored ID.
- Revisions never reuse an old audit ID/input hash. Those fields remain server-owned.
- `body` stays equal to ordered unit 0; thread continuations remain explicit units.
- The claim map still covers every spine claim and `missing` still means absent proof claims.
- Formula and overlay versions remain aligned. Changing an overlay record requires a version bump,
  not an unrecorded reinterpretation.

## Humanize without flattening voice

Compare the draft against approved samples before applying any generic scrub. Remove redundant
transitions, repetitive cadence, uniform sentence lengths, unnecessary summaries, or formatting
habits only when the voice evidence does not protect them. Preserve fragments, punctuation, or
repetition that the profile marks as a quirk.

Every skipped heuristic appears both on its finding (`skippedForVoice: true`) and under
`audit.heuristics.skippedForVoice`. Under rules-first precedence, apply the heuristic and report
the resulting voice drift instead.

## Stop conditions

Ask the user rather than adapt when the destination formula needs an absent fact, the request
would disclose a private claim, the named-party formula lacks consent/public evidence, the target
kind changes risk materially, or the requested network has no supported writing overlay.

When the user rejects a variant, persist `status: "rejected"` or revoke approval as appropriate;
do not delete the evidence or lineage record.

## Adaptation review checklist

Before persistence, answer each item from the actual documents:

- Does the destination body start from the spine rather than copied surface ornament?
- Does every present claim map to the same source snapshot?
- Is `derivedFromVariantId` used for revise/humanize and an adaptation origin used for adapt?
- Does the destination formula fit the requested goal without forcing unsupported slots?
- Are ordered units complete, nonblank, and measured independently?
- Were source-only hashtags, mentions, labels, numbering, and sign-offs removed unless intentional?
- Was the approved voice reapplied after restructuring rather than imitated from the source body?
- Does the audit name the destination overlay and current core version?
- Does the deterministic request hash describe this surface, mode, and revision attempt?
- Does the approval card explain that earlier approval does not transfer?

For a same-surface revision, change only what the user requested plus corrections required by hard
or claim rules. For a cross-surface adaptation, allow structure to change substantially while the
spine, protected evidence, and approval boundary stay fixed.
