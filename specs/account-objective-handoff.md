# Account objective through the writing handoff (#549)

Status: Proposed, **revision 2** (System Design, 2026-10-17, loop `loop-issue-549-2ea030a4`). Part of epic #548.
**Revision 2 (§18) supersedes the form-based objective input of §4.3–4.5, §4.7, §5, §10, §12, §13 slice D and §17; read §18 first.** The lineage, authority, ask, outcome-versus-metric and read-model decisions (ADR-549-1, -5, -7..-13, -17) are unchanged.
Routed `needs_ux` for the two Signals UI surfaces (activation dialog authoring, run-page review
card); the data contract and every non-UI slice below are fixed and may start on `contract_agreed`.

Base: `main` @ `fc53d96` (v0.2.23), branch `issue-549`.

## 1. Problem

The dogfood run that motivated #548 was dispatched to qualify an engineering-workflow offering.
What reached the writing pipeline was `goal: { id: "warm_conversation", writingGoal: "replies" }`.
The offering, the desired business outcome, the buyer-fit hypothesis and the operator's proposed
next step lived in the operator's head and in thread prose. Nothing typed carried them, so the
agent did what the typed contract asked for: a grounded, audited DM that advanced "replies" and
asked an unrelated customer-product question. Audit passed because nothing in the audit knows what
the operator wanted.

The failure is a **missing authority**, not a missing prompt. Every other operator intent on this
path (mandate, consumer, surfaces, acting target, approval policy) is server-stamped onto the
launch composition scope and validated on every variant write (#410). The commercial intent is the
one input that is not.

## 2. Outcomes and acceptance

The six checkboxes on #549, restated as testable outcomes:

| AC | Outcome | Mechanism (section) |
|---|---|---|
| 1 | Dispatch → run → launch → variant lineage carries objective + offering references; updates and revisions cannot silently drop them | objective stamped on the composition scope; every `upsert_variant` (create, revise, derive) validates the intent's objective ref against it (§5, §6) |
| 2 | Before drafting, the agent states how the ask advances or tests the objective, without assuming unverified customer pain | persisted `intent.ask` with a typed relation and a typed customer-pain status; blocker claim rule (§7) |
| 3 | Business outcome is separate from the `writingGoal` platform metric | `writingGoal` untouched; outcome lives only in the objective; both projected side by side (§8) |
| 4 | Review card exposes objective, fit hypothesis, uncertainties, next step | thread card from persisted read models; run-page card from the proposals projection (§9) |
| 5 | Synthetic regression: existing founder connection + recent touch + engineering-workflow objective does not silently become an unrelated question | a proposal without a declared ask relation cannot be persisted; fixture in §11 |
| 6 | Relationship-only and missing-product-context cases stay supported with truthful limitations | `kind: "relationship_only"` objective; server-computed limitations rendered on both cards (§4.3, §4.4) |

Unchanged on purpose: Personality gate and snapshot, source privacy and redaction, the
`assist_only` mandate, explicit approval, `auto_low_risk` exclusion, publish refusal.

## 3. Current system (facts)

- `WritingIntent` (`src/lib/writing/writing-intent.ts`) carries `goal: { kind: "relationship_goal", id, writingGoal }`. `writingGoal` is the platform metric the spine is scored against (`replies | reposts | … | leads | awareness`). There is no field for an offering or a business outcome.
- `launch.metadata.writing.composition` (`launchCompositionSchema`, strict) is stamped by `mergeLaunchMetadata` only from a dispatch-issued scope token, is immutable once present, and is the authority `assertWritingIntentAuthority` validates every variant against. Caller-supplied compositions are stripped.
- `persistWritingVariant` runs the authority check and `validateCrossDocuments` for **every** write: new variant, in-place revision (`mode: revise`, same id), derived alternative (`derivedFromVariantId`). `intent` is part of `computeAuditInputHash`, so changing it stales the audit and revokes approval.
- `materializeVariantWithRunner` snapshots `intent` into the content item and `snapshotMatches` compares it.
- The nurture run config is built in `runTemplateViaRtx` from template config plus the activation dialog's run config; structural keys (`contactNurture`, `writingIntent`) are restored from the stored template, the approval gate is server-derived, and the scope token hash is persisted before the brief is written.
- The review surface is two-sided: the agent renders the thread card (`core/approval.md`, spec §6.4) and the Signals run page renders `ProposalCard` from `listWorkflowRunProposals`, with Approve & materialize / Reject / Request revision posting `kind: "ui"` evidence. An operator approving from the run page today sees recipient, relationship goal, surface, body, audit, revision note. No objective.
- `get_writing_context` does not expose the launch composition; the agent learns the scope only from the brief.
- No product or offering model exists in `src`. `PRODUCTS.md` (#530) is a prototype in one RTX workspace root, not readable by Signals.
- Seed fixture `seedNurtureProposalFixture` builds composed proposals for the run page; `writing-intent-pipeline.test.ts` runs the real tables end to end.

## 4. Decision summary

> Revision 2 note: the *record shape* in 4.3–4.5 and the authoring paths in 4.7 are superseded by §18. The decision in 4.1/4.2 (server-stamped on the composition scope, hash-referenced from every intent) stands.

Carry the objective the same way the mandate is carried: **captured at dispatch, normalized and
stamped by the server onto the launch composition, referenced by hash from every intent, validated
on every variant write, projected to both review surfaces.** The agent never authors the objective.
The agent authors one thing on top of it, the **ask statement**, and that is persisted next to the
objective reference so the operator sees how the draft relates to what they asked for.

### 4.1 Options considered

| Option | Verdict |
|---|---|
| A. Objective only in the brief prose | Rejected. That is the current state; nothing typed survives to the variant. |
| B. Objective authored by the agent into the intent | Rejected. Reintroduces "the agent decides"; an objective the agent can rewrite is not an operator authority. |
| C. Separate `account_objectives` table referenced by id | Deferred. Correct long-term home once objectives are reused across runs and per contact, but it needs DDL, a contact-page UI and a lifecycle, none of which #549 needs. The record shape below is designed so a table can adopt it later without changing the intent reference (`objectiveId` + `hash`). |
| **D. Typed run-config record, server-normalized, stamped on the composition scope, hash-referenced from the intent** | **Chosen.** No DDL, no migration, reuses the one authority mechanism the pipeline already trusts, and every acceptance item follows from existing enforcement points. |

### 4.2 ADR-549-1 — the objective is part of the composition scope

`launchCompositionSchema` gains an optional `objective: AccountObjective`. It is written by
`stampLaunchComposition` from the run's normalized config at the moment the scope token mints the
scope, is deleted from any caller patch exactly like the rest of `composition`, and is immutable
with it. A launch created before this change has no `objective`, and that is a visible state, not
an error.

### 4.3 ADR-549-2 — `AccountObjective` v1

```ts
export const ACCOUNT_OBJECTIVE_KINDS = ["commercial", "relationship_only"] as const; // pinned by test; adding a kind needs an ADR

AccountObjective (strict) {
  schemaVersion: 1,
  objectiveId: "aobj_<id>",                       // server-minted; add "aobj" to WRITING_ID_PREFIXES
  kind: "commercial" | "relationship_only",
  offeringRef: OfferingRef | null,                // what the operator pointed at
  offering: OfferingSnapshot | null,              // what the server resolved at dispatch
  businessOutcome: string | null,                 // ≤ 300 chars; required when commercial
  fitHypothesis: string | null,                   // ≤ 500
  knownEvidence: Array<{ text: string ≤ 300; ref?: { kind: "url", url } | { kind: "content_item", contentItemId } }>,  // ≤ 8
  uncertainties: string[],                        // ≤ 8 × 300
  proposedNextStep: string | null,                // ≤ 300
  successEvidence: string | null,                 // ≤ 300
  limitations: AccountObjectiveLimitation[],      // server-computed, see 4.4
  source: "run_config" | "template_config" | "default",
  authoredAt: unixSeconds,
  hash: string,                                   // sha256Canonical of the record minus `hash`
}
```

Whole-record bound: ≤ 8 KiB serialized (refine). Text fields are trimmed; empty strings become
null. `relationship_only` requires `offeringRef`, `offering` and `businessOutcome` to be null (the
normalizer rejects a relationship-only objective that smuggles an offering).

Input shape (`accountObjectiveInputSchema`) is the same minus `objectiveId`, `offering`,
`limitations`, `source`, `authoredAt`, `hash`. Any of those present on input are stripped and
recomputed by the server; a caller cannot pre-mint an id, a hash or a limitation list.

### 4.4 ADR-549-3 — `OfferingRef` v1 and the #530 seam

```ts
OfferingRef =
  | { kind: "snapshot", slug: /^[a-z0-9][a-z0-9-]{1,62}$/ }
  | { kind: "catalog",  slug, catalogVersion?: string }      // reserved for #530

OfferingSnapshot (strict) {
  slug, name ≤ 120, oneLiner ≤ 300, category?: ≤ 120,
  valueProps: string[] ≤ 5 × 300,
  proofPoints: Array<{ text ≤ 300; url?: string }> ≤ 5,
  icp?: ≤ 300, cta?: { text ≤ 120; url?: string },
  capturedAt: unixSeconds,
}
```

- A `snapshot` ref is supplied together with its `OfferingSnapshot` body in the input
  (`offering: { ... }`); the server keeps the body verbatim (after bounds) and sets `offeringRef =
  { kind: "snapshot", slug }`.
- A `catalog` ref goes through `resolveOfferingSnapshot(ref)` in `account-objective.ts`. In v1 the
  resolver has no catalog and returns `null`; the objective is stamped with `offering: null` and the
  limitation `offering_unresolved`. Dispatch proceeds. When #530 lands, the resolver reads the
  catalog, fills `offering` and `offeringRef.catalogVersion`, and nothing downstream changes: the
  snapshot carried in lineage is still what the operator's run saw.
- The offering snapshot is **context, not evidence**. Nothing in it may become a fact in the
  artifact unless it is also in the spine (existing hard rule). In v1 a proof point enters the spine
  as a `note` source whose text is copied verbatim from `offering.proofPoints[i].text` and whose
  claim `locator` is `offering:<slug>#proof[<i>]`. #551 owns whether that becomes a first-class
  `offering` source kind; this convention is the seam it can formalize.

### 4.5 ADR-549-4 — server-computed limitations

Computed once at normalization, stamped into `objective.limitations`, rendered on both cards.
They never change approval policy, risk tier or audit verdict; their job is to make the gap
visible and to bind the brief's instructions.

| Code | When | Brief consequence |
|---|---|---|
| `offering_missing` | commercial, `offeringRef` null | no offering may be named or pitched; asks are discovery only |
| `offering_unresolved` | catalog ref, resolver returned null | same as above, plus the card says the catalog was unavailable |
| `offering_proof_missing` | snapshot with zero `proofPoints` | no seller capability or outcome claim may appear in the draft |
| `fit_hypothesis_missing` | commercial, `fitHypothesis` null | the ask may not presume fit; it may test it |
| `success_evidence_missing` | commercial, `successEvidence` null | the card says success is undefined; `proposedNextStep` still renders |

`relationship_only` objectives carry no limitations.

### 4.6 ADR-549-5 — default objective

A composed dispatch (`readWritingIntentComposition(mergedConfig)` non-null) that carries no
`accountObjective` in run or template config is stamped with
`{ kind: "relationship_only", source: "default" }`. This is the honest statement that no commercial
objective was given. It is never upgraded by inference: `goal.id = "partnership"` does not make an
objective commercial, and neither does anything in contact data. The `source: "default"` provenance
is rendered so an operator who forgot to set one can see that they did.

### 4.7 ADR-549-6 — where the objective is authored

| Path | Status in #549 |
|---|---|
| `POST /api/workflows/templates/[id]/run` body `config.accountObjective` (input shape) | **In scope, non-UI.** This is what the activation dialog and any agent-tools or skill dispatcher send. |
| Activation dialog section for Contact Relationship Nurture | **In scope, UI → Product/UX contract** (§12). |
| Template config `accountObjective` as a standing default (template builder) | Accepted by the normalizer (`source: "template_config"`); no builder UI in #549. |
| Per-contact persisted objective (contact page) | **Out of scope**; noted as the natural follow-up with option C in 4.1. |

The run-level objective applies to every contact the run touches. For a batch run the operator
writes a segment-level hypothesis; per-account adaptation is the agent's ask statement plus its
evidence references, not an edit of the objective.

## 5. Normalization at dispatch (`run-template-via-rtx.ts`)

Immediately before the scope token is minted (the point where the server still owns the whole
context), for every composed run:

1. Read `accountObjective` from `mergedConfig` (run override wins over template default; record
   `source` accordingly; absent → default per 4.6).
2. Parse with `accountObjectiveInputSchema`; a parse failure is a `422 invalid_account_objective`
   dispatch refusal with the zod issues in `details`, before any run row is mutated past `pending`
   (same shape as the `approval_gate_locked` refusal).
3. Resolve the offering (4.4), compute limitations (4.5), mint `objectiveId`, stamp `authoredAt`,
   compute `hash`.
4. Write the normalized record back into `runtimeConfig.accountObjective` and persist it on the
   run row **in the same `updateWorkflowRun` call that persists the scope token hash**, so a run
   can never hold a token whose scope would stamp an objective the row does not have.
5. Hand the normalized record to the brief builder.

`existingRunId` re-dispatch normalizes again from the merged config; an already-normalized record
present in the stored run config is treated as input (its server fields are stripped and
recomputed), so re-running keeps the same text but never trusts a stored id or hash blindly.

## 6. Authority on every variant write

### 6.1 ADR-549-7 — intent reference and schema version

`writingIntentShape` gains two optional keys. `WRITING_INTENT_SCHEMA_VERSION` stays `1`: the record
stays backward-readable (`readWritingIntentRecord` must still parse every existing variant), the
schema stays `.strict()`, and the authority check, not the schema, decides when the keys are
required.

```ts
objective?: { objectiveId: "aobj_…", hash: string } | null
ask?: WritingIntentAsk | null
```

### 6.2 ADR-549-8 — `assertWritingIntentAuthority` rules (added to the existing table)

| Situation | Result |
|---|---|
| scoped launch whose composition has `objective`, intent `objective` absent/null | `writing_intent_objective_required` |
| `intent.objective.objectiveId` or `hash` ≠ composition's | `writing_intent_objective_mismatch` |
| composition has no `objective` (pre-#549 launch), intent carries one | `writing_intent_objective_not_permitted` |
| composition has `objective`, intent `ask` absent/null | `writing_intent_ask_required` |
| `ask.relation` ∈ {advances, tests, defers} on a `relationship_only` objective, or `relationship_only` on a commercial one | `writing_intent_ask_relation_invalid` |
| `ask.relation = "tests"` without `testsUncertainty`, or index outside `objective.uncertainties` | `writing_intent_ask_relation_invalid` |
| `ask.relation = "defers"` without `deferReason` | `writing_intent_ask_relation_invalid` |

The check runs inside `persistWritingVariant` for create, in-place revise and derived alternatives
alike, which is what makes AC1 structural rather than procedural. A revision that drops or edits
the objective reference is rejected with the reason above; a revision that edits the ask is
accepted, stales the audit (intent is hashed) and revokes any approval, so the operator re-approves
with the new ask on the card.

### 6.3 Cross-document checks (`validateCrossDocuments`)

Added next to the existing claim/source resolution, because they need the spine:

| Check | Reason |
|---|---|
| `ask.customerPain.status = "evidenced"` → every `claimIds[i]` resolves in `spine.claims` | `ask_claim_unknown` |
| `ask.evidenceSourceIds[i]` resolves in `spine.sources` | `ask_source_unknown` |

## 7. The ask statement (AC2)

### 7.1 ADR-549-9 — `WritingIntentAsk`

```ts
WritingIntentAsk (strict) {
  statement: string (1..500),                                  // what this touch asks for, in one or two sentences
  relation: "advances" | "tests" | "defers" | "relationship_only",
  testsUncertainty?: number,                                   // index into objective.uncertainties; required for "tests"
  deferReason?: string ≤ 300,                                  // required for "defers"
  customerPain:
    | { status: "none_assumed" }
    | { status: "evidenced", claimIds: ["clm_…", …] (≥ 1) }     // the pain is a spine claim
    | { status: "asked", text: string ≤ 300 },                  // a hypothesis the draft asks about, never asserts
  evidenceSourceIds?: ["src_…", …] ≤ 10,                        // spine sources this ask leans on
}
```

Relation semantics:

- `advances`: the ask moves the account toward `businessOutcome` (for example proposes the
  `proposedNextStep`).
- `tests`: the ask is designed to resolve one named uncertainty.
- `defers`: this touch deliberately does not advance or test the objective (relationship nudge,
  thank-you, congratulation); `deferReason` says why. Allowed, and visible. The dogfood DM would
  have had to be persisted as `defers` with a reason, which is the "not silently" in AC5.
- `relationship_only`: the only legal value under a relationship-only objective.

`#550` will add a first-class action decision (wait, continue thread, comment, DM). That record
references `objectiveId` and may precede the ask; the ask stays the per-artifact statement.

### 7.2 Process rule (brief + skill)

The composed brief instructs: write the ask to the working file and post it in the thread
**before** drafting units; persist it as `metadata.writing.intent.ask` on the first `upsert_variant`.
The persisted record proves the ask existed at first persist; the thread proves the order.

### 7.3 ADR-549-10 — claim rule `core/claim/no-assumed-customer-pain`

Added to `core/claims.md` (class `claim`, severity `blocker`, applies `core`): "The draft does not
assert that the recipient has a problem, pain, or need unless a spine claim evidences it; a
hypothesis may be asked, never asserted." The structural `customerPain.status` keeps the ask
honest; the rule keeps the body honest. Verdict derivation is unchanged (a blocker blocks).

## 8. Outcome versus metric (AC3)

ADR-549-11: `writingGoalSchema` and `goal.writingGoal` are untouched; they remain the platform
signal the spine's CTA and formulas are chosen for. The business outcome exists only in
`objective.businessOutcome`. Every projection shows them as two fields, never merges them, and the
brief says in one sentence which is which. No enum change means no persisted-record migration.

## 9. Review surfaces (AC4)

### 9.1 ADR-549-12 — read models expose the stamped objective

- `get_writing_context.launch.writing.composition` is projected (new): `{ consumer, mandate,
  workflowRunId, surfaces, objective | null }`. Secrets are not involved (the token is never stored
  in plaintext), so this is a straight projection of the stamped scope.
- `listWorkflowRunProposals` returns a run-level `objective: AccountObjective | null` (read from the
  first launch's composition; every launch of a run carries the same stamped record, and a test
  pins that) and, per valid proposal, `ask: WritingIntentAsk | null`.
- `WorkflowRunProposal.goal` keeps `{ relationshipGoal, writingGoal }`; the outcome is on the
  run-level objective.

### 9.2 Thread card (skill contract)

`SKILL.md`, `core/approval.md` and spec §6.4 gain, between `Personality` and `Audit`:

```text
Objective  <kind> · source <run_config|template_config|default> · offering <slug|none> · outcome <businessOutcome|none> · metric <writingGoal>
Fit        <fitHypothesis|none> · evidence <n known> · uncertainties: <numbered list or none>
Ask        <relation[ #n]> — <statement> · pain: <none assumed|evidenced clm_…|asked: "<text>">
Next       <proposedNextStep|none> · success: <successEvidence|none>
Limits     <limitations joined|none>
```

Every value maps to `get_writing_context.launch.writing.composition.objective` or to the selected
`variants[].intent.ask`; the parity test that pins Personality card fields to read-model paths is
extended to these lines. A pre-#549 launch renders `Objective  none (launch predates account
objectives)` and no Ask line.

### 9.3 Run page (Signals UI, Product/UX contract)

The objective is per run, so the recommended shape is one objective block at the top of the
proposals section and, per proposal card, the ask line, relation badge, pain status and
limitation badges. States the contract must cover: commercial, relationship-only (operator),
relationship-only (default), each limitation, and a pre-#549 run (no objective). The approval
actions do not change. Dev treats the agreed contract as the spec for this slice.

## 10. Brief changes

`buildComposedWritingBriefSection` takes `objective: AccountObjective` and renders an
"Account objective" block after the consumer line:

- the record, verbatim, labelled "operator intent, server-stamped, never edit";
- the two reference lines the intent must carry (`objective: { objectiveId, hash }`) and the ask
  template, both added to the intent JSON sample;
- the pre-draft rule (§7.2) and the relation table (§7.1);
- the outcome-versus-metric sentence (§8);
- the limitation consequences that apply (§4.5), or for `relationship_only`: "Do not introduce an
  offering, pricing, a product or a pitch; the ask relation is `relationship_only`";
- the seller-context rule: "Offering text is context. A proof point becomes a fact only through a
  spine `note` source copied verbatim with locator `offering:<slug>#proof[i]`."

`buildContactNurtureBriefSection` adds one line to N4 pointing at that block and stating that the
touchpoint deliverable is chosen to serve the ask, not the reverse. `NURTURE_TOUCHPOINT_PLAN` is
unchanged.

## 11. Synthetic regression (AC5) and fixtures

ADR-549-13: one end-to-end test in `writing-intent-pipeline.test.ts` against real tables, plus an
option on `seedNurtureProposalFixture` so QA can see the card.

Synthetic case (no real names, handles, ids or message bodies):

- objective: commercial; offering snapshot `slug: "engineering-workflow"`, two proof points;
  `businessOutcome: "agree to a 20-minute evaluation of the engineering workflow"`;
  `fitHypothesis: "technical founder hiring engineers"`; `uncertainties: ["whether they use a
  coding agent today"]`; `proposedNextStep: "ask which workflow they use for new hires"`;
  `successEvidence: "a reply naming their current workflow"`.
- contact: synthetic founder already connected to the acting profile, one recent approved outbound
  touch logged.
- assertions:
  1. `upsert_variant` with an intent lacking `objective` → `writing_intent_objective_required`;
     with a wrong hash → `writing_intent_objective_mismatch`; lacking `ask` →
     `writing_intent_ask_required`.
  2. an intent whose ask is `relationship_only` on this commercial objective →
     `writing_intent_ask_relation_invalid` (the dogfood shape must declare `defers` + reason).
  3. a persisted proposal with `ask.relation: "tests", testsUncertainty: 0` appears in
     `listWorkflowRunProposals` with `objective.offeringRef.slug`, `fitHypothesis`, `uncertainties`
     and `proposedNextStep`, and `goal.writingGoal` still `replies`.
  4. in-place revision (`mode: revise`, same id) that omits `objective` →
     `writing_intent_objective_required`; a derived alternative that omits it → same.
  5. materializing the approved proposal writes the intent (objective ref + ask) into the content
     writing snapshot; a later revision with a changed ask revokes approval (`audit_stale`).
  6. a run dispatched without an objective stamps `relationship_only` / `source: "default"`, and an
     intent with `relation: "advances"` is rejected.
  7. a commercial objective without an offering stamps `offering_missing`; the brief contains the
     discovery-only instruction; the projection exposes the limitation.
  8. a `catalog` ref stamps `offering_unresolved` and the dispatch still succeeds.

## 12. Product/UX contract (why `needs_ux`)

Two Signals surfaces change and both are multi-state user surfaces under the Dev workspace rule:

1. **Activation dialog, Contact Relationship Nurture**: an objective section. Minimum contract:
   kind toggle (commercial / relationship only); for commercial: offering (snapshot entry with
   slug, name, one-liner, up to five value props and five proof points, or "none"), business outcome
   (required), fit hypothesis, known evidence, uncertainties, proposed next step, success evidence
   (each optional, each with the limitation it leaves when empty). Template-level default is out
   of scope for the UI.
2. **Run page proposals**: run-level objective block and per-card ask/relation/pain/limitations
   (§9.3), with the five states listed there.

Questions for Product/UX: compact versus expanded authoring layout; whether the run page shows the
objective even when every proposal is materialized; whether the variant detail page should mirror
the ask line (recommended read-only, can follow). Human acknowledgment on Origin is required before
the first UI patch; slices A–C below do not wait for it.

## 13. Implementation slices (for Dev)

| Slice | Files | Gate |
|---|---|---|
| A. Contract + server | new `src/lib/writing/account-objective.ts` (schemas, `normalizeAccountObjective`, `resolveOfferingSnapshot` seam, limitations, hash, pinned kinds); `writing-intent.ts` (+`objective`, +`ask`); `contracts.ts` (`launchCompositionSchema.objective`); `ids.ts` (`aobj`); `launch-writing.ts` (stamp from authority); `writing-intent-authority.ts` (6.2; `ComposedRunAuthority.objective`); `variant-writing.ts` (6.3); `run-template-via-rtx.ts` (§5); `run/route.ts` (accept `accountObjective`, 422 mapping) | contract_agreed |
| B. Brief + skill | `writing-composition.ts`, `contact-relationship-nurture.ts` (§10); `.claude/skills/signals-writing/{SKILL.md, core/approval.md, core/claims.md, reference.md}`; `scripts/writing-cli.cjs` precheck parity (`objective_ref_missing`, `ask_missing`, `ask_relation_invalid`, `ask_claim_unknown`, `ask_source_unknown`); skill version 1.1.0 → 1.2.0 and fixture versions; `specs/signals-writing-system.md` §6.4; `docs/composable-writing-intent.md` new section; `docs/agent-tools.md` | contract_agreed |
| C. Read models | `content-item-handlers.ts` (composition projection), `workflow-run-proposals.ts`, `seed-fixtures/nurture-proposals.ts` (objective option), proposals route test | contract_agreed |
| D. UI | `activate-dialog.tsx` + `contact-nurture-fields.tsx` (or a sibling `account-objective-fields.tsx`), `workflow-run-proposals.tsx` | agreed UX contract + Human ack |

Tests (minimum): `account-objective.test.ts` (bounds, normalization, stripping, limitations,
hash stability, pinned kinds), `writing-intent.test.ts` (old records still parse),
`writing-intent-authority.test.ts` (6.2 table), `launch-writing.test.ts` (stamped from run config,
caller `objective` stripped, immutable), `run-template-via-rtx.test.ts` (normalized record persisted
in the same write as the token hash; 422 on invalid input; default provenance; catalog unresolved),
`contact-relationship-nurture.test.ts` and the composed-brief test (block rendered, relationship-only
forbids pitch, limitations rendered), `workflow-run-proposals.test.ts` (projection, null for
pre-#549 runs), `signals-writing-skill.test.ts` (card fields pinned, precheck parity),
`writing-intent-pipeline.test.ts` (§11).

## 14. Boundaries with sibling issues

| Issue | Boundary |
|---|---|
| #550 action choice | `proposedNextStep` is operator input. The action decision record #550 adds references `objectiveId` and may conclude `wait`; it does not edit the objective. `ask.relation = "defers"` is the per-artifact statement; #550 owns the per-account decision. |
| #551 selective spines / seller proof | Offering proof enters the spine through the `note` convention in 4.4; #551 may promote it to an `offering` source kind and define minimal-proof selection. Nothing here changes claim accounting. |
| #552 editorial assessment | None of the new fields affect verdict or risk; the only new audit rule is a claim blocker (7.3). |
| #553 deferred review + completion cards | The completion card may reuse the Objective/Ask lines verbatim from the read models. |
| #554 visibility widening | The objective lives in launch metadata and in the run config; it inherits launch `scope` and is never copied into a content body. The ask statement is in the intent and therefore in the content writing snapshot; it is operator and agent reasoning, not contact private data. |
| #516 brief drift | Unchanged; the new block is appended to the composed contract, not to the legacy preamble. |

## 15. Risks, migration, rollback

- **No DDL, no migration.** Every change is additive and optional on persisted records. Old
  launches have no `objective`; old variants have no `objective`/`ask`; both parse and project as
  "none". New composed dispatches always stamp an objective (default relationship-only), so the
  brief grows by one block for every nurture run from the first upgraded dispatch on.
- **Rollback** is a code revert. Variants written with the new keys stay readable by the old schema
  only if the old `.strict()` intent schema is not reinstated verbatim; a revert must keep the two
  optional keys in the record schema (or accept that those proposals project as invalid).
- **Agent honesty of `relation` is self-reported.** The server enforces presence, legality and
  evidence resolution, not truth. Mitigation: the relation and statement are on the card the
  operator approves. This is the same trust model as thread-message approval evidence (spec §9.1).
- **Objective text on disk.** The normalized record is in the run config and therefore in the
  brief file like every other config key. No new exposure class; the scope token remains the only
  secret and is unchanged.
- **Catalog seam.** `resolveOfferingSnapshot` is the one function #530 replaces. Until then every
  `catalog` ref is a visible limitation, never a dispatch failure.
- **Precheck parity drift.** The skill's `writing-cli.cjs` must mirror the two cross-document checks
  and the relation rules; the existing parity test is the guard.
- **Run-page objective when launches disagree.** Every launch of a run stamps the same record (same
  run config); the projection reads the first and a test pins equality, so a future per-launch
  objective would have to change the projection deliberately.

## 16. Open questions

1. Product/UX: §12.
2. Owner (post-#530): should a `catalog` ref re-resolve on `existingRunId` re-dispatch, or keep the
   original snapshot? Recommendation: re-resolve and record `catalogVersion`, since the operator is
   re-dispatching on purpose.
3. Owner: per-contact persisted objectives (option C) as a follow-up issue once #530 Phase 3 lands.

## 17. UX contract v1 reconciliation (2026-10-17)

Product/UX contract v1 (`realtimex-product-ux/work/issue-549/contract-v1.md`, prototype
`…/b368e5dadfc4f3c9/index.html`) keeps the data contract. Decisions 1–6 there are accepted. The
following clarifications answer its §6 and requests R1/R2; none changes a persisted shape.

### ADR-549-14 — offering input shape

`accountObjectiveInputSchema` accepts **either** `offering: OfferingSnapshotInput` (a snapshot body)
**or** `offeringRef: { kind: "catalog", slug, catalogVersion? }`, never both. Sending `offering`
implies `offeringRef = { kind: "snapshot", slug }`; the dialog sends only `offering`. Sending
neither on a commercial objective stamps `offering_missing`.

### ADR-549-15 — the server derives the slug

`offering.slug` is optional on input. When absent the server derives it from `name` with the
algorithm in contract §6 (NFKD, strip diacritics, lowercase, runs of non `[a-z0-9]` → `-`, trim
`-`, cut to 63, `offering` when shorter than 2). A provided slug must still match
`/^[a-z0-9][a-z0-9-]{1,62}$/`. One implementation, in `account-objective.ts`, so the dialog does
not carry a copy; the dialog may omit it.

### ADR-549-16 — `capturedAt` (R2)

`offering.capturedAt` is optional on input. When absent the server stamps it with the objective's
`authoredAt`. When present it is kept (a snapshot pasted from an older source may legitimately
predate the run). A `catalog` resolution (post-#530) always stamps resolution time.

### ADR-549-17 — evidenced-pain claim text on the run page (R1)

Accepted. `listWorkflowRunProposals` already reads each launch's metadata, where the spine lives,
so per proposal `ask.customerPain` with `status: "evidenced"` is projected as
`{ status: "evidenced", claims: [{ claimId, text: string | null, sensitivity: "public" | "private" }] }`.
`text` is the spine claim's `text` cut to 300 characters (with `…`); `null` when the id no longer
resolves (a spine change after the write; approval is revoked in that case anyway), and the UI
falls back to "from N cited source(s)". `claimIds` stays on the persisted intent; the projection
only adds the resolved view. The thread card renders claim *text* the same way (first resolvable claim quoted, "from a private source" for a private claim, "and N more"), from the spine the agent already reads; claim ids are never shown on either card (amended 2026-10-18 after Product/UX experience review r1; contract v2 §4.2).
Private claims are shown with their sensitivity; the run page is the operator's own launch view,
which already shows the full spine, so this adds no new exposure.

### ADR-549-18 — typed 422 on dispatch

`POST /api/workflows/templates/[id]/run` refuses an invalid objective with status 422 and body
`{ error, errorCode: "invalid_account_objective", details: { reason: "too_large" | "invalid", issues } }`.
`too_large` is the whole-record 8 KiB refine; everything else is `invalid` with the zod issues, so
the dialog's two copy variants key off `details.reason`, not off issue text.

### Accepted UX decisions with contract consequences

- Decision 4 (kind never preselected): `source: "default"` therefore only ever comes from API,
  skill or older-client dispatches; §4.6 stands as the server rule for those.
- Decision 5 (pre-#549 run renders nothing): the projection still returns `objective: null`;
  tests pin that.
- §1 template default: an untouched default is omitted from the run body; the server reads it from
  template config and records `template_config` (§5 step 1).
- §5 thread card: labels follow the run-page vocabulary; the parity test pins field paths, not
  label strings.

## 18. Revision 2 — the objective is a markdown brief with workspace mentions (2026-10-17)

### 18.1 Why

The Human reviewed UX contract v1 and redirected the input model (Product/UX thread, verbatim):
"i think it's wrong direction to make workflow configuration via too detailed form. agents can
read markdown files and Signals has reusable resources in workspace's personality. I think we can
define contract in a markdown file and ability to mention personality's files: BRAND.md, SOUL.md,
PRODUCTS.md, etc". Product/UX proposed, and the Human accepted, that a Business outcome run takes
one **Objective brief** in markdown (inline or saved and reusable), with `@` mentions of workspace
resources, and that the offering is a mention of a PRODUCTS.md entry rather than text copied into
the run config.

What this changes is *where the operator's intent is written and how seller context is referenced*.
What it does not change is the authority model: the server still snapshots at dispatch, stamps the
snapshot on the composition scope, and validates every variant against it. The Personality pattern
is the precedent, and it already gives Signals a safe reader for the workspace directory
(`src/lib/personality/workspace.ts`: resolved under RealTimeX working-data, symlink and case-alias
refusal, UTF-8 check, whole-file hash) and a writer for files inside it
(`src/lib/rtx/workspace-brief-files.ts`).

### 18.2 ADR table for revision 2

| ADR | Status | Note |
|---|---|---|
| 549-1 stamped on composition | kept | the stamped value is now the brief snapshot (18.4) |
| 549-2 record v1 (form fields) | **superseded** by 549-19 | |
| 549-3 OfferingRef snapshot/catalog | **superseded** by 549-21 | the "#530 seam" is now the PRODUCTS.md reader |
| 549-4 limitations | revised, 549-23 | codes recomputed from facts the server checks |
| 549-5 default relationship-only | kept | |
| 549-6 authoring paths | **superseded** by 549-25 | |
| 549-7..-13 intent ref, authority, cross-document checks, ask, claim rule, outcome vs metric, read models, fixtures | kept | `testsUncertainty` becomes a 1-based ordinal (18.6) |
| 549-14 offering input shape, 549-15 server slug, 549-16 capturedAt | **superseded** | no offering sub-form; the slug comes from PRODUCTS.md |
| 549-17 evidenced-pain claim text | kept | |
| 549-18 typed 422 | revised, 549-26 | new reasons |

### 18.3 ADR-549-19 — the Objective brief

A brief is markdown text with a small headings convention. Headings are matched
case-insensitively at any level (`#`, `##`, `###`), in any order; text outside the five headings is
kept verbatim and not parsed.

| Heading | Parsed into | Required |
|---|---|---|
| `Outcome` | `parsed.outcome` (first non-empty paragraph, ≤ 500 chars) | **yes** for `commercial` |
| `Fit` | `parsed.fit` | no |
| `Unknowns` | `parsed.unknowns[]`: the list items under it (ordered or bulleted, ≤ 12); prose with no list becomes one item | no |
| `Next step` | `parsed.nextStep` | no |
| `Success` | `parsed.success` | no |

Bounds: brief text ≤ 16 KiB. The dialog prefills the five headings; API callers may send any
markdown that satisfies the convention.

Mentions are tokens of the form `@<FILE>.md` or `@PRODUCTS.md#<slug>` anywhere in the brief:

```
@(IDENTITY|SOUL|VOICE|BRAND|PRODUCTS)\.md(#[a-z0-9][a-z0-9-]{1,62})?
```

File names are case-sensitive (the reader already refuses case-fold aliases). `#<slug>` is legal
only on `PRODUCTS.md`. Saved briefs cannot be mentioned from a brief (no recursion).

### 18.4 ADR-549-20 — the snapshot record (what is stamped on the composition)

```ts
AccountObjective (strict) {
  schemaVersion: 2,
  objectiveId: "aobj_…",
  kind: "commercial" | "relationship_only",
  brief: {                                       // null for relationship_only
    source: { kind: "inline" } | { kind: "saved", path: "objectives/<name>.md", fileHash },
    text: string,                                // verbatim, ≤ 16 KiB
    hash: string,                                // sha256 of text
  } | null,
  parsed: { outcome, fit, unknowns: string[], nextStep, success } | null,
  mentions: Array<{                              // in order of first appearance, deduplicated
    raw: "@PRODUCTS.md#realtimex-desktop",
    path: "PRODUCTS.md", anchor: "realtimex-desktop" | null,
    resolved: { fileHash, excerpt: string ≤ 8 KiB, excerptHash } | null,   // null = unresolved
  }>,
  offering: {                                    // the one PRODUCTS.md entry mention, or null
    slug, name, oneLiner: string | null, proofPointCount: number,
    mentionIndex: number,
  } | null,
  limitations: AccountObjectiveLimitation[],
  sourceHash: string,                            // sha256Canonical of [[path, fileHash]…] for the saved brief + every resolved mention, sorted by path/anchor
  source: "run_config" | "template_config" | "default",
  authoredAt: unixSeconds,
  hash: string,                                  // sha256Canonical of the record minus `hash`
}
```

Whole-record bound: ≤ 64 KiB (brief 16 KiB + up to six mentions at 8 KiB). The intent reference
`objective: { objectiveId, hash }` (ADR-549-7) is unchanged. `relationship_only` requires `brief`,
`parsed`, `offering` null and `mentions` empty.

### 18.5 ADR-549-21 — PRODUCTS.md reader (answers Q1)

#549 adds a **read-only** `readWorkspaceResource(workspace, "PRODUCTS.md")` next to
`readPersonalityWorkspaceFiles`, with the same safety rules (inside the resolved Signals workspace
dir, regular file, no symlink, UTF-8, ≤ 256 KiB). It does not wait for #530 Phase 2: that phase
owns Settings and projection; this reader becomes its consumer and is replaced only if #530 moves
the catalog out of the file.

Entry grammar (matches the prototype file and is the convention #530 Phase 1 declared): an entry is
a `## ` section that contains a line `- **Slug:** \`<slug>\``. The **entry reference is the slug**,
not the heading text, because headings carry numbering and can be reworded. From the section the
server extracts `name` (heading text with a leading `N. ` stripped), `oneLiner` (the
`- **One-Liner:**` line, else null), and `proofPointCount` (bullet items under any heading in the
section whose text matches `/proof/i`). The section markdown is the mention excerpt. `@PRODUCTS.md`
without an anchor resolves to the whole file, bounded to 8 KiB, with `offering` null and the
limitation `offering_missing` (an offering must be a specific entry).

Exactly one entry mention makes the run's `offering`. Two or more different entry mentions stamp
`offering_ambiguous` with `offering` null; the brief keeps all excerpts.

### 18.6 ADR-549-22 — saved briefs (answers Q2) and the mention allowlist (answers Q3)

Saved briefs live as files in the Signals RealTimeX workspace, `objectives/<name>.md`, the same
directory the Personality reader resolves. Reasons: the Human's stated premise is that agents read
markdown files from the workspace; a file there is readable by the operator in the RealTimeX
editor, by agents from `cwd`, and by Signals through the existing safe reader; and it needs no
table.

- **Not projected like Personality.** A brief is operator input, not a Signals rendering of CRM
  facts, so it has no managed blocks, binding, proposal or approval lifecycle. Operators and agents
  may edit the files freely; dispatch snapshots them.
- **Name grammar** `^[a-z0-9][a-z0-9-]{1,62}$` → `objectives/<name>.md`; the reader applies the
  same path safety as Personality (no symlink, regular file, inside the workspace dir) and refuses
  any path outside `objectives/`.
- **Routes** (Signals API, non-UI): `GET /api/objectives` lists `{ name, path, outcome (parsed first
  line), fileHash, updatedAt }`; `GET /api/objectives/[name]` returns text; `PUT /api/objectives/[name]`
  with `{ text, overwrite?: boolean }` writes through the workspace writer (`409 objective_exists`
  without `overwrite`); `POST /api/objectives/preview` with `{ text }` returns `{ parsed, mentions,
  offering, limitations }` without dispatching (the dialog's live preview);
  `GET /api/objectives/mentions` lists resolvable targets (Personality files present, PRODUCTS.md
  entries) for the `@` picker.
- **Dialog → saved:** an inline brief with "Save as reusable brief" is written first, then the run
  is dispatched with `brief: { kind: "saved", path }`; the snapshot records the file hash.
- **Allowlist for `@` mentions:** `IDENTITY.md`, `SOUL.md`, `VOICE.md`, `BRAND.md`, `PRODUCTS.md`
  (whole or `#slug`). Nothing else; no arbitrary paths; no mention of other briefs. Contact data
  stays out of these files, as for Personality today (recipient boundary unchanged); the brief
  help text says so, and the server never injects contact data into a brief.

`testsUncertainty` (ADR-549-9) becomes the **1-based ordinal** of the item under `Unknowns`, so the
card reads "Tests unknown 2" against the numbered list the block renders. The server validates
`1 ≤ n ≤ parsed.unknowns.length`.

### 18.7 ADR-549-23 — limitations, revised (answers AC6 under rev 2)

Computed at normalization from facts the server can check:

| Code | When |
|---|---|
| `offering_missing` | commercial and no `PRODUCTS.md#slug` mention |
| `offering_unresolved` | a `PRODUCTS.md#slug` mention whose file or slug does not resolve |
| `offering_ambiguous` | more than one distinct entry mention |
| `offering_proof_missing` | the resolved entry has `proofPointCount = 0` |
| `mention_unresolved` | any other mention that does not resolve (file absent) |
| `fit_missing` | commercial, `Fit` heading absent or empty |
| `success_missing` | commercial, `Success` heading absent or empty |

A missing `Outcome` on a commercial brief is a dispatch refusal, not a limitation (18.10). The
brief consequences in §4.5 apply unchanged by code: no offering may be named or pitched under
`offering_missing | offering_unresolved | offering_ambiguous`; no seller capability or outcome
claim under `offering_proof_missing`; the ask may test fit but not presume it under `fit_missing`.
Resolution is also previewed to the operator before dispatch (`/api/objectives/preview`), so an
unresolved mention is visible before Run, not only on the card.

### 18.8 ADR-549-24 — objective sources that change after launch

Product/UX recorded, and the Human accepted, that a mentioned file or saved brief that changes after
launch should revoke approval "the same way" Personality does. The mechanism chosen is the one the
pipeline already uses for a changed evidence set, `revokeVariantsForSpineChange`, not the
Personality audit guard, because the draft text and its audit are unaffected; only the operator's
context moved.

- `objective.sourceHash` is the identity of the sources at dispatch (18.4).
- `observeObjectiveSources(launchId)` re-reads the saved brief and every mentioned file from the
  workspace, recomputes the hash, and compares it with the launch's server-owned
  `writing.objectiveState.observedSourceHash` (initialized to `sourceHash` at stamp time; stripped
  from caller patches like `composition`). On a change it revokes every approved, unmaterialized
  variant on the launch with `revokedReason: "objective_source_stale"` (added to the enum) and
  stores the new observed hash, so revocation fires **once per change**.
- It runs on the three read paths that already touch the launch: `get_writing_context`, the run
  proposals projection, and `materialize_variant` (before `effectiveApproval`). A fresh explicit
  approval granted after the observation stands.
- Status `objectiveSource: "current" | "stale" | "unavailable"` is projected; `stale` renders on
  both cards as "Objective sources changed since this run started: <paths>" and lists which
  mention or brief changed. The snapshot remains the run's authority; re-dispatch is how an
  operator adopts the new text.
- If the workspace cannot be resolved on read, status is `unavailable` and nothing is revoked (no
  evidence of change).

### 18.9 ADR-549-25 — authoring paths (replaces 549-6)

| Path | Status |
|---|---|
| `POST /api/workflows/templates/[id]/run` body `config.accountObjective` (18.10 input shape) | in scope, non-UI |
| Activation dialog: kind radio; for Business outcome a saved-brief picker or a markdown box with prefilled headings, `@` picker, live preview of parse/mentions/limitations, "Save as reusable brief" | in scope, UI → Product/UX contract v2 |
| Template config `accountObjective` default | accepted by the normalizer (`source: "template_config"`); no builder UI |
| Agent-authored saved briefs (an agent writes `objectives/<name>.md` in the workspace) | works by construction; the server snapshots at dispatch and the agent never edits a running objective (the stamped snapshot is the authority) |

### 18.10 ADR-549-26 — input shape and dispatch refusal (answers Q5)

```ts
accountObjective (input) =
  | { kind: "relationship_only" }
  | { kind: "commercial", brief: { kind: "inline", text: string } | { kind: "saved", path: "objectives/<name>.md" } }
```

`POST …/run` refuses with 422 `invalid_account_objective` and `details.reason` ∈
`too_large | outcome_missing | saved_brief_not_found | saved_brief_unsafe | invalid` (plus zod
`issues` for `invalid`). Unresolved mentions are limitations, never refusals.

Normalization (§5) is otherwise unchanged: resolve the workspace (`resolvePersonalityWorkspace`),
read the saved brief if any, parse, resolve mentions, compute limitations, `sourceHash`,
`objectiveId`, `hash`, and persist the record in the same write as the scope-token hash. If the
workspace is unavailable at dispatch, a commercial objective with a `saved` brief or any mention
is refused (`422`, reason `workspace_unavailable`); an inline brief with no mentions still
dispatches, with `mention_unresolved` impossible and `offering_missing` stamped.

### 18.11 Brief, cards, read models under rev 2

- The composed brief block (§10) renders the brief text verbatim, then each mention's snapshot
  excerpt under its `raw` token, then limitations, with the sentence: "This snapshot is the
  objective for this run. The same files in your working directory may have changed since; if
  they differ, say so in the thread and keep drafting against the snapshot."
- Thread card (§9.2 / contract v1 §5 vocabulary): `Objective` line uses `parsed.outcome` and
  `offering.name (@PRODUCTS.md#slug)`; `Fit` uses `parsed.fit` and the numbered `unknowns`;
  `Next` uses `parsed.nextStep` / `parsed.success`; `Limits` as before; a new `Sources` line
  renders `objectiveSource` when `stale` or `unavailable`.
- `get_writing_context.launch.writing.composition.objective` is the full record;
  `listWorkflowRunProposals.objective` is the full record plus `objectiveSource`. Per-proposal
  `ask` and ADR-549-17 claim text unchanged. v1 run-page decisions 2, 5 and 6 stand.

### 18.12 Tests added or changed by rev 2

`objective-brief.test.ts` (headings, lists, prose-as-one-unknown, mention grammar, bounds),
`workspace-resources.test.ts` (PRODUCTS.md entry extraction, slug reference, proof count, case
alias and symlink refusal, 256 KiB cap), `account-objective.test.ts` (normalize: default,
template provenance, limitations table, `offering_ambiguous`, `sourceHash` stability),
`objective-sources.test.ts` (revoke once per change, no revoke on `unavailable`, fresh approval
stands), saved-brief routes (name grammar, `objectives/` confinement, 409 without overwrite),
dispatch refusals (18.10), and the §11 regression rewritten so the objective is an inline brief
that mentions `@PRODUCTS.md#engineering-workflow` in a fixture workspace dir (reuse
`createPersonalityWritingFixture`, which already provisions one).

### 18.13 Slices under rev 2

| Slice | Files | Gate |
|---|---|---|
| A. Contract + server | `account-objective.ts` (rev 2 schemas, normalize), new `objective-brief.ts` (parse + mentions), `personality/workspace.ts` (+`readWorkspaceResource`, +`objectives/` reader/writer), `writing-intent.ts`, `contracts.ts` (+`objective_source_stale`), `launch-writing.ts`, `writing-intent-authority.ts`, `variant-writing.ts`, new `objective-sources.ts`, `materialize.ts` (observe step), `run-template-via-rtx.ts`, `run/route.ts`, new `api/objectives/*` routes | contract_agreed |
| B. Brief + skill | as §13 B, with 18.11 | contract_agreed |
| C. Read models | as §13 C, plus `objectiveSource` | contract_agreed |
| D. UI | activation dialog (brief picker, markdown box, `@` picker, preview, save), run page block + `Sources` state | agreed UX contract v2 + Human ack |

### 18.14 Open questions for Product/UX (contract v2)

1. Markdown box: plain textarea with a prefilled skeleton and an `@` picker, or a lightweight
   editor; the data contract only needs the resulting text.
2. Preview placement: inline under the box (parsed headings, resolved mentions with name, offering,
   limitations), updated on blur or debounce; the server route is `POST /api/objectives/preview`.
3. Saved-brief picker: list with outcome line and updated time; "Edit a copy" opens the text inline
   as a new inline brief; whether the run page links the saved brief file.
4. The `Sources` stale state on the run page: banner on the objective block plus the revoked
   proposals' existing "Approval revoked" state; copy for "re-dispatch to adopt the new text".

### 18.15 ADR-549-27 — `objectiveSource` projection shape (contract v2 reconciliation, 2026-10-17)

Contract v2 (`realtimex-product-ux/work/issue-549/contract-v2.md`, prototype
`…/a64adf4954cd87ed/index.html`) maps to §18 as written; its answers to 18.14 are accepted,
including "never sends `overwrite`" (a 409 is a field error) and "saved path shown as text, no
link". The one read-model point is confirmed:

```ts
objectiveSource: {
  status: "current" | "stale" | "unavailable",
  changedPaths: string[],      // e.g. ["objectives/eng-workflow.md", "PRODUCTS.md#realtimex-desktop", "BRAND.md"]
  observedAt: unixSeconds | null,
}
```

`observeObjectiveSources` already compares per-source hashes (the saved brief by path, each mention
by `path` or `path#anchor`), so `changedPaths` is the list of sources whose current hash differs
from the snapshot's, in snapshot order; a source that can no longer be read is listed too. Empty
when `current`; empty with `status: "unavailable"` when the workspace cannot be resolved. The same
object is returned by `get_writing_context` (for the thread card's `Sources` line) and by
`listWorkflowRunProposals`.

### 18.16 ADR-549-28 — the revocation set under the atomic approval model (2026-10-18)

Dev observed (correctly) that a composed proposal is approved only inside `materialize_variant`
(`effectiveApproval`; `auto_low_risk` is excluded for assist-only), so approval and
materialization are atomic and the set "approved, unmaterialized" in ADR-549-24 is empty today.
§18.8 also pointed at `revokeVariantsForSpineChange` as the pattern, and that function does pull
back materialized content whose item is not in the publish lane. The two sentences disagreed.

Decision: **keep the literal rule, not the spine-change semantics.** Assist-only surfaces have no
publish lane; a materialized reply or DM is what the operator copies and may already have sent by
hand, and pulling it back to `draft` would misreport a sent touch as unapproved (the same concern
#548 raises about counting drafts as touches, in reverse). A changed objective source after
materialization is information for the operator, not a reversal of their decision.

Consequences, stated plainly:

- Today the visible effect of a source change is the stale alert with `changedPaths`, the
  `Sources` line on the thread card, and the `objectiveSource` projection. No "Revoked · objective
  changed" card can appear.
- `observeObjectiveSources` keeps the revoke step as implemented (approved and not materialized,
  once per change, nothing on `unavailable`, fresh approval stands) so that a future
  approval-without-materialization path (#553 deferred decisions is the likely one) inherits the
  rule instead of silently escaping it. Tests pin both the empty-set behaviour under the current
  model and the revocation when such a variant exists.
- `revokeVariantsForSpineChange` remains the precedent only for the once-per-change bookkeeping,
  not for its treatment of materialized items. §18.8's "mirrors" wording is narrowed to that.
- Contract v2's copy "Approvals that weren't materialized yet were revoked" stays true; the
  revoked-card scenario in prototype v2 is unreachable under the current approval model and is not
  a post-dev experience-review failure.
