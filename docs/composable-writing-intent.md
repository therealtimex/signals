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

Every field an agent sends is caller-owned — the run pointer *and* the surface — so neither can be
the authority. The agent-tools route has no ambient run context (auth is localhost-or-shared-token),
so there is nothing in the request itself to trust.

The anchor is the **launch**, and the launch is bound to its dispatch by a **capability**, not by a
selector.

At dispatch, `run-template-via-rtx.ts` mints a writing scope token for a composed run
(`<workflowRunId>.<secret>`), persists only its SHA-256 under `_writingScopeTokenHash` on the
server-owned run row — a `_`-prefixed key, so `stripInternalConfigKeys` keeps it out of the brief —
and writes the plaintext into *that dispatch's brief*. `upsert_launch` accepts the token and
`mergeLaunchMetadata` stamps:

```
writing.composition = { schemaVersion, workflowRunId, templateId, consumer, mandate, surfaces, stampedAt }
```

Why a token rather than the run id: a run id is a **selector** the caller can enumerate through
agent-tools, so naming one proves nothing and would let any launch claim any composed dispatch.
Naming a composed run in caller-owned `writing.runs` therefore mints nothing. The token is evidence
of having been handed *this* dispatch.

The scope cannot be forged, widened, or dropped: a caller-supplied `composition` is stripped, a
malformed or non-verifying token is a hard `writing_scope_token_invalid` error that writes no launch
(presenting a capability is an explicit composed-lane attempt, so failing it must not silently
downgrade to ordinary writing), and a stamped scope is immutable across later `upsert_launch` calls.

The capability's lifecycle is bounded at both ends:

- The hash is persisted on the run row **before** the plaintext is written into the brief or
  terminal dispatch is accepted, so an accepted dispatch never holds a capability that verifies
  against nothing. `run-template-via-rtx.test.ts` pins the ordering by reading the run row from
  inside the mocked `/cli/send-message` handler.
- If dispatch is **rejected**, or an exception fires before acceptance, the hash is revoked. The
  brief is already on disk by then, so the plaintext token is recoverable — revocation is what stops
  it minting a scope for a dispatch that never happened. The guard is `!dispatchAccepted`, so an
  agent that really was handed the brief keeps its capability even if later bookkeeping throws.
  Both directions have regressions.

Possessing another dispatch's token authorises *that* dispatch, not this one: the scope it mints
names the other run, so a proposal claiming this run is rejected on lineage. An agent able to read
another run's brief file is the documented capability bound below, not a gap in the binding.

`assertWritingIntentAuthority` then validates the submission against that scope, so mandate,
consumer, allowed surfaces, and run/template lineage all come from server state:

| Situation | Result |
|---|---|
| scoped launch, no intent | `writing_intent_required` |
| scoped launch, surface outside the consumer's enabled set (e.g. `x/post`) | `writing_intent_surface_mismatch` |
| scoped launch, `generationMetadata.agent.workflowRunId` ≠ the scope's run | `writing_intent_lineage_mismatch` |
| scoped launch, intent lineage ≠ the scope's run/template | `writing_intent_lineage_mismatch` |
| scoped launch, `intent.target` ≠ the variant's acting target | `writing_intent_target_mismatch` |
| unscoped launch, intent present | `writing_intent_not_permitted` |
| unscoped launch, assist-only surface | `composed_scope_required` |

Moving both caller-owned fields at once — an ordinary run id *and* `x/post` — no longer helps: on a
scoped launch the surface is rejected and the pointer is checked against the scope; on an unscoped
launch a proposal surface is rejected outright.

`isAssistOnlySurface` remains as defence in depth, and a composed run still requires the active
Personality binding and a **compatible represented target**; `draft_only` does not relax the target
gate. One artifact carries one acting identity.

**What this does not claim — an explicit narrowing of #410's lineage guarantee.**

The complete-lineage guarantee applies to *composed proposals*: every artifact created under a
composed dispatch scope records run, template, consumer, recipient, goal, source, target, variant,
audit, approval, and materialization lineage, and that binding is unforgeable.

It does **not** guarantee that an agent holding the workspace's agent-tools credential performs only
composed work. The route authenticates by localhost or a shared token
(`authorizeAgentToolRequest`), with no per-invocation identity, so ordinary platform-native writing
by that credential is indistinguishable from any other writing workflow — the server has nothing to
attribute it to. Such an artifact carries no composition scope, no intent, and no nurture lineage,
so it can never be *counted* as a proposal of the active dispatch; but the server cannot stop it
being created.

Closing that requires scoped request authentication, which is an auth change outside this contract.
`writing-intent-pipeline.test.ts` pins the boundary in
`documents the boundary: ordinary writing beside an active dispatch is never a proposal`.

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

## The account objective and the ask (#549)

The mandate says what a proposal may *do*; the account objective says what the operator wants it
to *achieve*. Before #549 a nurture run carried only `goal: { id, writingGoal }`, so a run
dispatched to qualify an offering reached the agent as "warm conversation, optimise replies", and
an audited draft could pass while asking an unrelated question. The objective now travels the same
authority path as the mandate. Design record: `specs/account-objective-handoff.md`.

**Captured at dispatch, stamped by the server.** `POST /api/workflows/templates/[id]/run` accepts
`config.accountObjective`: `{ "kind": "relationship_only" }`, or
`{ "kind": "commercial", "brief": { "kind": "inline", "text": "…" } }` /
`{ "kind": "commercial", "brief": { "kind": "saved", "path": "objectives/<name>.md" } }`. The brief
is markdown with five optional headings (Outcome — required for `commercial` —, Fit, Unknowns, Next
step, Success) and `@` mentions of `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md`, `PRODUCTS.md`
or one `PRODUCTS.md#<slug>` entry. `normalizeAccountObjective` (`src/lib/writing/account-objective.ts`)
snapshots the brief and each mentioned excerpt from the Signals workspace, computes the limitations
(`offering_missing`, `offering_unresolved`, `offering_ambiguous`, `offering_proof_missing`,
`mention_unresolved`, `fit_missing`, `success_missing`), mints `objectiveId` and hashes the record.
An invalid objective refuses the dispatch with 422 `invalid_account_objective` and
`details.reason` (`too_large`, `outcome_missing`, `saved_brief_not_found`, `saved_brief_unsafe`,
`workspace_unavailable`, `invalid`). A composed run without one is stamped
`relationship_only` with `source: "default"` — never upgraded by inference.

**Referenced from every intent.** The normalized record is persisted on the run in the same write as
the scope-token hash, and `stampLaunchComposition` copies it onto `writing.composition.objective`.
On a launch with an objective every intent must carry `objective: { objectiveId, hash }` and an
`ask`; `assertWritingIntentAuthority` rejects a missing or changed reference
(`writing_intent_objective_required` / `_mismatch`), a reference on a pre-#549 launch
(`writing_intent_objective_not_permitted`), a missing ask (`writing_intent_ask_required`) and an
illegal relation (`writing_intent_ask_relation_invalid`). It runs for a new variant, an in-place
revision and a derived alternative alike, so a revision cannot silently shed the objective.

**The ask is the agent's one contribution.** `ask.relation` is `advances`, `tests` (with the 1-based
`testsUncertainty` of an Unknowns item), `defers` (with `deferReason`) or, only under a
relationship-only objective, `relationship_only`. `ask.customerPain` is `none_assumed`,
`evidenced` (spine `claimIds`, resolved in `validateCrossDocuments` as `ask_claim_unknown`) or
`asked` (a hypothesis). The claim rule `core/claim/no-assumed-customer-pain` blocks a draft that
asserts an unevidenced pain. The brief tells the agent to write and post the ask before drafting;
the intent is hashed into the audit input, so changing the ask stales the audit and revokes
approval.

**Outcome is not the metric.** `goal.writingGoal` (replies, follows, …) stays the platform signal the
spine is scored against; the business outcome lives only in the objective. Both cards show them
side by side.

**Sources that change after launch.** The snapshot stays the run's authority. On
`get_writing_context`, the run proposals projection and `materialize_variant`,
`observeObjectiveSources` (`src/lib/writing/objective-sources.ts`) re-reads the saved brief and
mentioned files; on a change it revokes every approved, unmaterialized proposal on the launch with
`objective_source_stale`, once per change, and projects `objectiveSource: { status, changedPaths,
observedAt }`.

**Review surfaces.** The thread card (`core/approval.md`) adds Objective, Fit, Ask, Next, Objective
limits and Sources lines mapped to `get_writing_context.launch.writing.composition.objective`,
`launch.writing.objectiveSource` and `variants[].intent`. The run page reads
`listWorkflowRunProposals().objective`, `.objectiveSource` and each proposal's `ask`.

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
| Launch scope stamping (server-owned, immutable) | `src/lib/writing/launch-writing.ts` |
| Scope validation | `src/lib/writing/writing-intent-authority.ts` |
| Shared brief text (both lanes) | `src/lib/workflows/writing-contract.ts` |
| Reusable opt-in + composed brief | `src/lib/workflows/writing-composition.ts` |
| Platform-native lane | `src/lib/workflows/signals-writing.ts` |
| First consumer | `src/lib/workflows/contact-relationship-nurture.ts` |
| Approval gate | `src/lib/writing/variant-writing.ts`, `src/lib/writing/materialize.ts` |
| Publish refusal | `src/lib/publish/send-to-agent.ts` |
| Account objective schema, normalization, preview | `src/lib/writing/account-objective.ts` |
| Objective brief parsing and mentions | `src/lib/writing/objective-brief.ts` |
| PRODUCTS.md entries, saved briefs (`objectives/`) | `src/lib/personality/workspace-resources.ts` |
| Changed objective sources → revocation | `src/lib/writing/objective-sources.ts` |
