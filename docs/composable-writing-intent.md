# Composable writing intent

How a Signals workflow gets Personality-bound, audited, explicitly approved writing without
becoming the Platform-native writing template and without forking the writing engine.

Introduced in #410. First consumer: **Contact Relationship Nurture**.

## The boundary

| Concern | Owner |
|---|---|
| Who is speaking (voice, identity, brand) | Workspace **Personality**, server-derived from the active `bindingId` |
| Who is receiving and what is relevant | The workflow's **recipient reference** (`contactId`, platform, handle) |
| What the workflow is trying to achieve | The workflow's **goal** (a relationship goal, a campaign, …) |
| What may become a fact | The intent's **`sourceRefs`** — allowlisted evidence only |
| Voice resolution, audit, approval, materialization, lineage | The **shared writing pipeline** |

A workflow supplies intent. It never supplies a Personality hash, workspace, identity, target
representation, or audit snapshot — `writingIntentSchema` is strict and rejects them
(`src/lib/writing/writing-intent.ts`). Recipient context selects relevance; it never becomes
authority, and it never enters `IDENTITY.md`, `SOUL.md`, `VOICE.md`, or `BRAND.md`.

## Two shapes

- **`WritingIntentDraft`** — what a template config or brief can express before a run starts.
- **`WritingIntent`** — the runtime request: the draft plus the active `bindingId` the agent read
  from `get_writing_context`.

## The server decides, not the payload

`metadata.writing.intent` is the agent's claim, and so is
`generationMetadata.agent.workflowRunId`. The agent-tools route has no ambient run context (auth is
localhost-or-shared-token), so **a run pointer can never be the anchor on its own** — a caller could
name an ordinary run, omit the intent, and slide a proposal into the platform-native lane.

Two independent anchors carry the mandate instead:

1. **The surface.** `WRITING_SURFACE_CAPABILITIES[...].mandate` marks the six proposal surfaces
   `assist_only`. A reply, comment, or direct message *is* a proposal, so the mandate holds even
   when every pointer in the payload is wrong. `persistWritingVariant` requires an intent on such a
   surface, `approvalFor` pins `explicit`, and `materializeVariantWithRunner` refuses a
   `by: "policy"` approval — all keyed on `writing.surface`.
2. **The workflow-run row** Signals wrote at dispatch (`buildStoredRunConfig`), falling back to the
   template config. It supplies the composition, consumer, and enabled surfaces.

The composition is resolved against the run the **intent** names, and the generation pointer must
equal it, so the two cannot be played against each other. Every direction fails closed:

| Situation | Result |
|---|---|
| assist-only surface, no intent | `writing_intent_required` — regardless of which run is named |
| intent naming an uncomposed run | `writing_intent_not_permitted` |
| composed run, no intent | `writing_intent_required` |
| consumer / surface / enabled-surface / lineage disagreement | rejected, not downgraded |
| `intent.target` ≠ the variant's acting target | `writing_intent_target_mismatch` |

A dishonest run pointer therefore cannot reach the platform-native lane. The most it buys is
attributing work to a *different composed run* — all of which pin explicit approval.

A composed run additionally requires the active Personality binding and a **compatible represented
target**; `draft_only` does not relax the target gate. One artifact carries one acting identity: the
Personality guard validates `writing.targetId` and the intent must name the same target, so a
materialized proposal cannot end up with contradictory lineage.

`resolveWritingRequest(intent, context)` turns an intent plus observed Personality/target state
into a `WritingRequest`. It fails closed:

| Observed state | Result |
|---|---|
| `personality.host.capability !== "available"` | refused `personality_host_unavailable` |
| status `unavailable` / `drifted` | refused `personality_workspace_unavailable` / `personality_drifted` |
| status `unbound` | refused `personality_unbound` — a proposal speaks as the workspace, so there is no legacy-unbound sketch lane |
| declared `targetId` does not represent the Personality | refused `target_identity_mismatch` |
| surface is not draft/audit-capable | refused `surface_draft_unsupported` |
| status `bound` / `source_stale` | `lane: "full"`, `deliverable: "draft_only"`, `approvalPolicy: "explicit"` |

## The `assist_only` mandate

`WRITING_INTENT_MANDATES` has exactly one value, pinned by a static test, mirroring
`PRESENCE_MANDATE_MODES` (#377, ADR D12). Under it:

- `WRITING_INTENT_ACTIONS` is `draft | audit | propose`. There is no publish or send action.
- The intent pins `approvalPolicy: "explicit"`. A workspace-wide `auto_low_risk` policy cannot
  approve a proposal — `approvalFor` in `variant-writing.ts` uses the stricter of the two, and
  `materializeVariantWithRunner` rejects a `by: "policy"` approval outright.
- `sendContentToAgent` refuses any content item whose writing metadata carries an assist-only
  intent, even on a publish-capable surface. Composition provenance outranks surface capability.
- An opted-in workflow's brief advertises the writing tool set (`get_writing_context`,
  `upsert_launch`, `upsert_variant`, `materialize_variant`, …) alongside its own category tools, so
  requirement 8 and the contract below it agree.
- The intent is part of `computeAuditInputHash`, so rebinding an approved proposal to a different
  recipient, relationship goal, or evidence set stales the audit and revokes the approval. Same
  body, different artifact.

Widening the mandate needs a new ADR, not an enum edit.

## Nurture surfaces

Six send-less surfaces carry draft/audit contracts and no publish adapter:

| Surface | Publish | Hard limit |
|---|---|---|
| `x/reply` | `draft_only` | 280 |
| `x/direct_message` | `draft_only` | 10 000 |
| `linkedin/comment` | `draft_only` | 1 250 |
| `linkedin/direct_message` | `draft_only` | 8 000 |
| `facebook/comment` | `draft_only` | 8 000 |
| `facebook/direct_message` | `draft_only` | 20 000 |

Each is listed in the `signals-writing` capability table and its platform overlay's operating
prose, with rules, formulas, and heuristics in `.claude/skills/signals-writing/overlays/`, mirrored
hard limits in `src/lib/writing/variant-writing.ts` and the skill's `writing-cli.cjs`, and
`contentTypeForSurface` materializes them as `reply` or `dm` — never `post`, which is what
`send-to-agent.ts` re-derives to prove an artifact is a publishable original.

A partnership proposal is a `direct_message` draft with `goal.id = "partnership"`. There is no
publish-capable spotlight-post surface for an assist-only consumer.

## Opting a workflow in

Four edits, no new engine:

1. **Register the consumer** in `WRITING_INTENT_CONSUMERS` and give it allowed surfaces in
   `WRITING_INTENT_CONSUMER_SURFACES` (`src/lib/writing/writing-intent.ts`). The registry is
   closed: an unknown consumer fails validation rather than inheriting the pipeline by accident.
2. **Carry the opt-in** in the template config:

   ```ts
   buildWritingIntentCompositionConfig({ consumer: "my_workflow" })
   ```

   `buildAgentWorkflowBrief` detects the `writingIntent` key and appends the shared contract. It
   does **not** make the workflow the Platform-native writing template — that lane still keys off
   `signalsWriting` and its brief is unchanged.
3. **Resolve the acting target before building the brief.** `buildAgentWorkflowBrief` takes the
   resolved `platformTarget` row; it never queries the database and never guesses a platform. A
   composed contract offers only the acting platform's surfaces, and its intent sample is always
   internally valid — an X sample handed to a LinkedIn run is both wrong advice and an intent the
   schema rejects. With no target resolved, the brief says so and defers surface choice per contact.
4. **Emit intents from the workflow's own brief section**, as
   `buildContactNurtureBriefSection` does: map the workflow's goal to a surface, name the
   recipient reference and evidence, and tell the agent to attach the intent as
   `metadata.writing.intent` on `upsert_variant`.

Existing installs need one more step: seed migration. Template config is preserved across seed
versions except where a branch merges structural keys, so `seedTemplates` merges the opt-in
explicitly (see the `CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME` branch). Without it the prompt
would reference a contract the brief never renders.

### Candidates

- **Profile Publish** — publish-capable surfaces, so it needs a mandate decision first: today
  every consumer is `assist_only`, which would remove its publish path. Opt it in only alongside
  an ADR that defines a publishing mandate.
- **Social Intent Patrol** — reply/comment proposals fit the existing nurture surfaces directly.
  It needs a consumer entry and the surfaces it may answer on.
- **Outreach sequences** — direct-message surfaces fit, but sequencing is scheduling; keep the
  scheduler outside the intent and let it consume approved proposals.

None of them are migrated here. The contract is the shared part; each workflow decides when its
own goals map onto it.

## Where things live

| Concern | File |
|---|---|
| Intent contract, composition config, lanes, refusals | `src/lib/writing/writing-intent.ts` |
| Surface mandate (`isAssistOnlySurface`) | `src/lib/writing/capabilities.ts` |
| Server-side composition authority | `src/lib/writing/writing-intent-authority.ts` |
| Shared brief text (both lanes) | `src/lib/workflows/writing-contract.ts` |
| Reusable opt-in + composed brief | `src/lib/workflows/writing-composition.ts` |
| Platform-native lane | `src/lib/workflows/signals-writing.ts` |
| First consumer | `src/lib/workflows/contact-relationship-nurture.ts` |
| Approval gate | `src/lib/writing/variant-writing.ts`, `src/lib/writing/materialize.ts` |
| Publish refusal | `src/lib/publish/send-to-agent.ts` |
