# Persistence and lineage

Working files make the agent's large payloads durable and keep measurements tied to the exact text
Signals receives.

## Working directory

Create `workflow-runs/<runId>/writing/` and keep:

```text
spine.json
launch-writing.json
voice-profile.json
x-post.variant.json
x-post.audit.json
x-thread.variant.json
linkedin-post.variant.json
facebook-post.variant.json
```

Files used with `--stdin` contain `{ "tool": "...", "input": { ... } }`. Helper inputs may be
the inner spine/audit/units object. The helper reads only files named on its command line.

## Exact persistence order

1. Resolve/create the launch and call `get_writing_context`.
2. Resolve or build/approve the voice profile. Keep the returned `{id, version, hash}`.
3. Generate source/claim/spine IDs with `writing-cli.cjs id`.
4. Write `spine.json`, then send one complete `upsert_launch` writing document containing the full
   existing+new `surfaces`, `sources`, and `runs` arrays. Arrays replace during deep merge.
5. Read the server-derived source hashes and spine hash from the response/context; update working
   files without inventing hashes.
6. For each supported surface, produce distinct units from the spine, measure, audit, precheck, and
   call `upsert_variant` with the same launch/spine pin.
7. Read the persisted variant, audit, approval, capability, and lineage edges; render its card.
8. Materialize only the selected approved variant. Query lineage to verify the content/variant link.
9. On explicit publish instruction, hand the content item to the REST route; completion is owned by
   the publish job and `signals-publish` callback.
10. Complete the workflow run with every created ID and any blocker/missing surface.

## Idempotency

Use `requestHash = wr1:<workflowRunId>:<surface>:<mode>:<n>`. Keep `n = 1` for the first variant of
a run/surface/mode and reuse it on retries and in-place revisions. Increment only when creating a
new derived alternative.

When revising in place, send the stored variant ID and original generation metadata. When creating
an alternative, generate a new variant ID and record `derivedFromVariantId` or adaptation lineage.
Materialization itself is idempotent: unchanged calls return the same content item; an approved
unqueued revision refreshes it in place.

## Complete launch writing shape

The `spine` mode sends all of these together:

```json
{
  "schemaVersion": 1,
  "goal": "awareness",
  "surfaces": [{"platform":"x","surface":"x/post","targetId":"<target>"}],
  "sources": [],
  "spine": {},
  "voiceProfile": null,
  "voicePrecedence": "voice_first",
  "approvalPolicy": "explicit",
  "runs": [{"workflowRunId":"<run>","mode":"draft","startedAt":0,"rtxThreadSlug":"<thread>"}]
}
```

Read existing arrays from context before appending the current run. Never send a partial array and
never assume another workflow component recorded run start.

## Lineage meanings

- `sourceIds`: source snapshots actually used by this variant.
- `derivedFromVariantId`: prior variant retained as an ancestor for alternative/revision lineage.
- `adaptedFromVariantId`: a variant whose message was intentionally repurposed.
- `adaptedFromContentItemId`: a published/materialized content item used as adaptation evidence.
- Server edges connect launch → variant, variant → source, variant → materialized content, and
  published content outcomes. Do not manufacture owned graph edges through generic edge tools.

For verification, prefer `query_lineage`/content APIs and persisted IDs over body similarity or UI
labels. A body match is not lineage.

## Retry discipline

On a validation failure, inspect `details.reason` and `details.path`, fix the working file, rerun
precheck, and resend with the same idempotency key. Do not change IDs or request hashes merely to
escape a contract error. On store busy/conflict, retry the unchanged voice operation after the
server-provided delay or a bounded pause.
