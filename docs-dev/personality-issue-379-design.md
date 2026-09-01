# Signals #379 — Personality-bound writing and publish-gate design

**Status:** Accepted for implementation, subject to the repository migration guard below
**Loop:** `loop-issue-379-54749fa4` · **Role:** System Design → Dev
**Date:** 2026-08-31
**Signals base:** `main@e49dd91b2b888a3ec6bbf8dd93938d5036b8ab92` (includes #378 / PR #393)
**Authority:** #373 / PR #374, `specs/personality-projection.md`,
`specs/signals-writing-system.md`, and issue #379

This document narrows the accepted Personality architecture to issue #379 and reconciles it with
the merged writing, target, publish, and #378 projection code. It is an implementation contract,
not a new autonomous-action design.

---

## 0. Verdict and approval gate

#379 should add one server-owned lineage snapshot and one reusable gate to the existing modular
monolith. The gate must be invoked at every writing mutation or queue boundary; UI state and
caller-supplied hashes are never authority.

The implementation should:

1. stamp the active workspace, binding, whole-file revision, binding source revision,
   represented identity, and target representation onto a writing variant;
2. derive the corresponding audit snapshot and deterministic `source_stale` warning on the
   server;
3. validate before every approval, materialization lookup/idempotent return, and G5 queue
   transition;
4. serialize Personality apply/unbind and writing gates with the existing Personality store
   lock, serialize voice-source reads with the voice store lock, and use SQLite
   `BEGIN IMMEDIATE` for DB source/target/queue races;
5. update variant approval plus its unqueued materialized item in one SQLite transaction when a
   stale condition is detected;
6. keep a queued publish job immutable after the queue transaction wins; and
7. preserve legacy-unbound variants and their pre-Personality hashes without rewriting them.

### Repository approval gate

The accepted architecture and the current schema already provide JSON extension points:

- `variants.metadata.writing`;
- `content_items.platformData.writing`;
- `platform_targets.metadata.personality`.

Therefore **no Drizzle schema change and no migration are required or approved by this design**.
Dev must not edit `src/lib/db/schema.ts`, `src/lib/db/migrations/`, or generate a migration for
#379. If implementation discovers a real need for DDL, stop and obtain explicit user approval
under `AGENTS.md` before proceeding. Additive Zod/JSON/API contracts described below are intended;
they do not alter SQLite structure.

### Baseline correction: rollout version

The accepted spec says Personality binding becomes mandatory at `signals-writing >= 0.3.0`.
The merged baseline already packages `signals-writing` **1.0.0**, but that version does not read or
submit Personality. A literal `>= 0.3.0` check would break the current client as soon as #379
lands.

Use:

```ts
export const PERSONALITY_AWARE_WRITING_SKILL_MIN_VERSION = "1.1.0";
```

and correct the normative `0.3.0` references in both accepted specs when the Personality-aware
skill work lands. Until 1.1.0 is packaged, 1.0.x remains the explicit legacy-unbound compatibility
cohort. Version parsing must be semantic, not string comparison.

---

## 1. Scope and boundaries

### 1.1 In #379

- additive stored and input contracts for variant/audit Personality lineage;
- server-side binding, workspace, whole-file, source, identity, and target resolution;
- deterministic `source_stale` audit behavior;
- effective approval staleness and durable unqueued revocation;
- materialization and idempotent-return gating;
- `send-to-agent` / G5 and queue-transaction gating;
- explicit target representation with user evidence;
- `get_writing_context.personality`, target representation, and effective stale projections;
- eager post-apply/unbind reconciliation and lazy drift/source reconciliation;
- `AttributionKey.personalityBindingId` and binding-aware grouping; and
- C1–C7/S1 unit, integration, concurrency, and fault evidence.

### 1.2 Explicitly outside #379

| Work | Owner / reason |
|---|---|
| Personality-first skill instructions and package version 1.1.0 | #380; #379 only establishes the compatible server contract |
| Settings Personality and target-representation UI | #381; #379 adds the REST/use-case seam |
| Presence mandate persistence or non-`assist_only` actions | #377 / later ADR |
| New publish, reply, comment, reaction, schedule, or browser paths | Forbidden by S1 |
| Cancellation or mutation of already queued/publishing/published artifacts after later drift | Existing queue is the execution boundary; changing this needs a separate product decision |
| Target-bound per-account Personality files | Later ADR; one workspace binding still represents one self and at most one owned org |
| Database columns, generated columns, indexes, or migrations | Not needed; user approval required if this changes |

### 1.3 Current seams to extend, not replace

The baseline already has the right aggregate boundaries:

- `src/lib/personality/status.ts` computes binding/source/file status, but currently returns
  `compatibleTargets: []`;
- `src/lib/personality/apply.ts` commits a binding but does not reconcile writing artifacts;
- `src/lib/writing/variant-writing.ts` owns audit IDs, verdicts, risk, approval, and revision;
- `src/lib/writing/materialize.ts` validates before most mutations, but not Personality and not
  under a cross-boundary guard;
- `src/lib/writing/publish-gate.ts` is the pure G5 item/variant snapshot check;
- `src/lib/publish/send-to-agent.ts` already repeats G5 inside the queue transaction;
- `src/lib/db/queries/platform-targets.ts` preserves target JSON metadata; and
- `src/lib/writing/attribution-key.ts` already centralizes attribution-key derivation.

Do not create a second writing state machine or a second Personality status model.

---

## 2. Architecture and dependency direction

```text
Agent tool / REST route
          │
          ▼
writing mutation use case ───────────────► personality-writing-guard.ts
          │                                      │
          │                                      ├──► Personality store session
          │                                      ├──► status.ts pure status core
          │                                      ├──► voice-profile store lock
          │                                      └──► target-representation.ts
          │
          ├──► variant-writing.ts   (audit + approval policy)
          ├──► materialize.ts       (variant → approved item)
          └──► send-to-agent.ts     (approved item → queued immutable job)

personality/apply.ts ──► injected PersonalityBindingCommitted port
          │                              ▲
          └─ commit binding              │ wired by outer application facade
                                         │
                              writing/personality-revocation.ts
```

Inner writing contracts and pure gate comparisons must not import Next.js, RealTimeX transport,
or filesystem mechanics. The integration service may coordinate Personality, voice, target, and
SQLite adapters, but controllers must call that use case rather than query repositories directly.

### 2.1 Proposed modules

| Module | Responsibility | Must not do |
|---|---|---|
| `src/lib/writing/personality-lineage.ts` | Stored/input schemas, semantic skill-version check, snapshot comparison, deterministic warning. | Read DB/files or mutate rows. |
| `src/lib/writing/personality-guard.ts` | Resolve workspace once, acquire locks in fixed order, build an authoritative guard snapshot, and run an immediate SQLite transaction. | Render Personality or call publish dispatch. |
| `src/lib/writing/personality-revocation.ts` | Runner-aware revocation/draft transitions and implementation of the post-binding effect port. | Resolve current Personality on its own. |
| `src/lib/personality/target-representation.ts` | Parse default-unbound metadata, validate decisions against an active binding, list compatible target IDs, and set representation with evidence. | Infer ownership from target kind, handle, connection, or platform account. |
| `src/lib/personality/status.ts` | Expose one reusable pure status computation plus async host-decorated public view. | Duplicate writing approval rules. |
| `src/lib/personality/use-cases.ts` | Outer application facade that wires approve/retry to the writing-effect implementation. | Reimplement apply or revocation policy. |
| Existing writing/publish modules | Call the shared guard and keep their current aggregate responsibilities. | Trust caller lineage or bypass the guard on replay. |

`apply.ts` declares and invokes an injected `onBindingCommitted` application port while it still
owns the Personality lock; it must not import `src/lib/writing/**`. Production routes/tools call
the outer facade, which supplies the writing implementation. This keeps #378's projection module
independent of downstream writing policy and makes fault injection straightforward.

### 2.2 Options considered

| Option | Benefit | Cost / failure mode | Decision |
|---|---|---|---|
| Repeat status checks independently in audit, materialize, and publish modules | Small local diffs | Error semantics drift; one boundary will eventually omit source, identity, or target; hard to race-test | Rejected |
| One shared immutable guard snapshot and comparison policy | One contract and one C1–C7 test seam | Makes writing mutations async and adds lock coordination | Chosen |
| Rely only on eager revocation when a new binding applies | Cheap reads | Manual file edits and source changes have no event and stale idempotent returns remain possible | Rejected |
| Combine eager cleanup with mandatory lazy gates | Cleanup improves UX; safety does not depend on cleanup timing | Every critical boundary must pay a local hash/source read | Chosen |
| Store represented identity on `platform_accounts` | Looks like one account-level setting | One login can control a self profile and owned page; account/credential is not the acting identity | Rejected |
| Store representation per `platform_target`; account/connection remains auth only | Exact acting identity and current publish seam already uses target IDs | Each target needs an explicit decision | Chosen |
| Cancel a job whenever Personality changes after queue | Strongest freshness | Races a browser action already in flight and contradicts the accepted “queued untouched” contract | Rejected |
| Treat queue commit as the last Personality gate and execute its immutable snapshot | Clear linearization point and compatible with existing publish lane | Later drift does not cancel an already authorized action | Chosen |

---

## 3. Exact persisted contracts

### 3.1 Variant Personality lineage

The caller-facing and stored shapes must be different. A client may select only a binding ID;
the server replaces that selector with the full stored snapshot.

```ts
type VariantPersonalityInput =
  | { bindingId: `pb_${string}` }
  | null; // accepted only for the legacy-unbound cohort

type VariantPersonalitySnapshot = {
  schemaVersion: 1;
  bindingId: `pb_${string}`;
  personalityHash: string;                 // exact four whole-file bytes
  bindingSourceHash: string;               // sourceHash used to create the binding
  workspaceSlug: string;                   // retained accepted public field
  workspaceId: string | null;
  workspaceKey: string;
  identity: {
    selfContactId: string;
    representedOrgId: string | null;
  };
  target: {
    targetId: string;
    represents: TargetRepresentation;      // exact decision at variant write time
  } | null;
};
```

`VariantWriting.personality?: VariantPersonalitySnapshot | null` remains additive. For a targetless
export/draft-only variant, `target` is null. For a named target, the snapshot records even
`{ kind: "unbound" }`; that draft cannot gain an audit/approval for a publish-capable surface
until the target is explicitly compatible.

Implementation rules:

- `variantWritingSchema` accepts the complete stored shape.
- `variantWritingInputSchema` replaces that field with the strict selector shape. It must reject
  `personalityHash`, workspace, source, identity, or target fields from a caller rather than
  silently strip them.
- Skill 1.1.0+ must provide a selector whenever an active binding exists.
- Skill 1.0.x may omit the field during the migration window. Preserve omission as omission; do
  not inject null into existing metadata.
- Once a variant has a non-null binding, a caller cannot remove or change it except by submitting
  a fresh valid active binding selector through the normal revision/audit path.
- The server derives the snapshot inside the guard; it never merges caller Personality fields.

The extra source, workspace, identity, and target fields intentionally duplicate current read
models. They make the historical artifact self-describing and let every later gate compare the
exact decision without reconstructing what the target meant at generation time.

### 3.2 Audit Personality snapshot

```ts
type WritingAuditPersonality = VariantPersonalitySnapshot & {
  currentSourceHash: string;
  statusAtAudit: "bound" | "source_stale";
};
```

`WritingAudit.personality?: WritingAuditPersonality | null` is stored, but
`writingAuditInputSchema` must **omit** it. The server stamps it after it has stamped the variant
snapshot. This closes the current input-schema pattern where an additive stored field would
otherwise become caller-writable automatically.

An audit is acceptable only when:

- active binding ID, workspace identity, and whole-file hash equal the variant snapshot;
- status is `bound`, or is the narrow allowed `source_stale` case in §5;
- current represented identity IDs equal the binding snapshot;
- for a publish-capable surface, the exact target is active, platform-matched, and compatible;
  and
- the audit has no caller-supplied Personality snapshot.

### 3.3 Content-item snapshot

`content_items.platformData.writing` copies the complete `VariantPersonalitySnapshot` at
materialization:

```ts
type ContentWritingMetadata = {
  // existing fields
  personality?: VariantPersonalitySnapshot | null;
  materialization?: {
    auditId: string;
    inputHash: string;
    approvalAt: number;
    approvalBy: string;
  };
};
```

The materialized snapshot must equal the variant snapshot exactly. `snapshotMatches()` includes
it before returning an existing item, and G5 compares content, variant, audit, current binding,
current source, and current target.

### 3.4 Target representation

The only stored decision is:

```ts
type TargetRepresentation =
  | { kind: "unbound" }
  | { kind: "self"; contactId: string }
  | { kind: "org"; orgId: string };

type TargetPersonalityDecision = {
  schemaVersion: 1;
  represents: TargetRepresentation;
  setAt: number;
  by: "user";
  evidence: ApprovalEvidence;
  bindingIdAtDecision: `pb_${string}`;
};

// platform_targets.metadata.personality
```

Read semantics are deliberately conservative:

- missing/invalid metadata, legacy target kinds, and the old string `"self"` all project as
  `{ kind: "unbound" }`;
- all newly registered/discovered targets omit `metadata.personality`, so they also start
  unbound;
- `platform_accounts` and browser connections remain credential/session records. They never
  imply represented identity;
- an active target is compatible only when its concrete contact/org ID equals the active
  binding identity; and
- `bindingIdAtDecision` is provenance, not a same-self rebind invalidator. A new binding for the
  same concrete self/org may keep the target compatible; a rebind to another identity cannot.

When target deduplication merges two records, preserve an existing concrete decision and its
evidence. If both aliases carry different concrete representations, fail the merge with a
conflict and require an explicit user resolution. Never choose one silently.

### 3.5 Hash compatibility

Add `personality` to `computeAuditInputHash()`'s field list. The canonicalizer already removes
`undefined`, so a pre-#379 variant that lacks the key produces the exact old hash. Explicit null
or a bound snapshot intentionally participates in new hashes.

`approvalStateSchema.revokedReason` widens additively with:

```ts
"personality_stale" | "personality_source_stale"
```

No persisted `schemaVersion` bump is required: these are optional fields and enum widening in a
JSON document that has not changed its structural meaning.

---

## 4. Guard, locks, and transaction protocol

### 4.1 One guard snapshot

Use one internal result at every mutation boundary:

```ts
type PersonalityWritingGuard = {
  workspace: { slug: string; id: string | null; key: string; dir: string };
  binding: PersonalityBinding | null;
  status: "bound" | "source_stale" | "drifted" | "unbound" | "unavailable";
  currentPersonalityHash: string | null;
  currentSourceHash: string | null;
  currentIdentity: {
    selfContactId: string;
    representedOrgId: string | null;
  } | null;
  compatibleTargets: Set<string>;
  targetDecisions: Map<string, TargetPersonalityDecision | null>;
  detail: PersonalityStatus["detail"];
};
```

Refactor `status.ts` so both `getPersonalityBindingView()` and this guard call the same pure status
core. `get_writing_context.personality` must return the exact public status object from
`getPersonalityBindingView`, not a separately reconstructed approximation. This is C4.

The current effective whole-file hash is recomputed from exact bytes. Do not trust the hash stored
on the variant, binding, content item, target, request, or UI.

### 4.2 Lock order

Every Personality-sensitive writing mutation uses this order:

```text
1. Resolve exact RealTimeX workspace identity (read-only host lookup).
2. Acquire SIGNALS_DATA_DIR/personality/.store.lock.
3. Acquire SIGNALS_DATA_DIR/writing/voice-profiles/.store.lock.
4. Start SQLite transaction with { behavior: "immediate" }.
5. Rebuild binding/file/source/identity/target status inside that transaction.
6. Validate and perform the complete writing/target/queue mutation.
7. Commit SQLite; release voice lock; release Personality lock.
```

Reasons:

- Personality apply/unbind already holds the Personality lock through binding commit.
- statements use that same lock; represented-org writes must be moved under it.
- voice approval/supersession uses the voice lock.
- contact/org source writes and target/queue writes use SQLite. `BEGIN IMMEDIATE` gives a clear
  writer order instead of deferred read-then-write `SQLITE_BUSY` races.
- fixed global ordering prevents a target setter, writing gate, and apply hook from deadlocking.

Do not hold the SQLite transaction across a host/network call. Workspace resolution happens
first. The local files/store/source/target recheck is authoritative after locks are held.

### 4.3 Supported and external file edits

The guard cannot lock an arbitrary OS editor. It performs its final whole-file read before the
DB mutation. Concurrent operations are linearized at that read:

- an edit visible before the read makes the gate fail `personality_drifted`;
- a queue transaction whose final read wins first may commit, after which a later edit does not
  cancel its already queued job; and
- a direct uncoordinated edit is still outside the host's serializable writer guarantee, exactly
  as documented by #378.

This is not a claim that POSIX reads and SQLite commits are one physical transaction. Safety comes
from validating at every pre-queue boundary and treating a completed queue as the last approval
boundary.

### 4.4 Async application facade

The existing low-level `upsertVariant()` is synchronous and used broadly by legacy code. Do not
make every legacy caller async merely to support #379.

Add an async application facade for external variant mutations:

- agent `handleUpsertVariant`;
- `POST /api/launches/[id]/variants`; and
- `PUT /api/variants/[id]`.

The facade detects `signals-writing` creation or an existing writing variant and calls the guarded
writing path; otherwise it delegates to the existing legacy query. The low-level synchronous
query must refuse a writing mutation that did not come through the facade, so a controller cannot
bypass the use case accidentally.

`materializeVariant()` becomes async; its agent handler is already async. `sendContentToAgent()`
is already async.

---

## 5. `source_stale` and represented-identity semantics

### 5.1 Narrow safe `source_stale`

`source_stale` means:

- active binding and exact whole-file bytes are unchanged;
- the current concrete self/org identity IDs still equal the binding identity; and
- one or more allowlisted source contents now hash differently.

Only that case may accept a new audit while retaining unchanged canonical Personality bytes.
Changing the self contact ID, selecting another represented org, losing ownership of the selected
org, or making the bound voice ineligible is an **identity mismatch**, not a retainable source
warning. It fails closed until unbind/reprojection restores a compatible binding.

This distinction prevents the warning path from becoming a way to keep writing as a previously
represented person or brand.

### 5.2 Deterministic warning

For the safe source-stale case, the server removes any caller finding with this code and appends
exactly one server record:

```ts
const PERSONALITY_SOURCE_STALE_FINDING = {
  code: "core/voice/personality-source-stale",
  class: "voice",
  severity: "warning",
  message:
    "Personality sources changed after the active workspace Personality was applied; " +
    "this audit retains unchanged Personality bytes and requires fresh explicit approval.",
  evidence: `bindingSourceHash=<full hash>;currentSourceHash=<full hash>`,
  sourceRef: "specs/personality-projection.md#63-stale-sources",
};
```

No timestamps, caller prose, short-hash ambiguity, or target display names enter the finding.
The server then derives verdict and risk. The warning guarantees `verdict: "warn"` and at least
`riskTier: "medium"`, so `auto_low_risk` cannot approve it.

### 5.3 New audit and fresh explicit approval

The audit snapshot's changed `currentSourceHash` makes it semantically different even though
`inputHash` may remain the same. `persistWritingVariant` therefore allocates a new audit ID,
revokes the older approval as `personality_source_stale`, and requires a user decision tied to
the new audit ID. A second source change repeats the process.

Materialization and G5 accept `status: "source_stale"` only when all are true:

- audit binding/workspace/personality hash equal the variant and active binding;
- audit `currentSourceHash` equals the current guard hash;
- `statusAtAudit === "source_stale"`;
- the deterministic warning is present exactly once; and
- approval is `by: "user"`, contains evidence, and names that audit ID.

---

## 6. Boundary-by-boundary contract

| Boundary | Resolve/stamp | Fail closed when | Mutation behavior |
|---|---|---|---|
| `upsert_variant` draft without audit | Active binding, workspace, files, source, identity, target decision | Caller supplies forged snapshot; selected binding is not active; workspace unavailable/drifted for a bound write; 1.1+ omits required binding | Server replaces `{bindingId}` with full snapshot. Legacy omission stays absent. |
| Audit acceptance inside `upsert_variant` | Full audit snapshot and optional server warning | Binding/workspace/file/identity mismatch; source hash unavailable; publish-capable target missing/unbound/incompatible; submitted audit Personality data | New audit ID when source snapshot changes; derive verdict/risk; old approval becomes stale. |
| Effective approval | Current audit plus current guard | Audit no longer matches binding/files/source/identity/target; policy tries to approve medium/high | Read-only views project revoked; mutation boundary persists revocation. Source-stale always needs user evidence. |
| `materialize_variant` | Reload variant, launch, item, target, guard inside immediate transaction | Any stale proof, blocked audit, missing approval, target mismatch, unsupported capability | Persist revoke/draft and return tagged failure after commit. Validate **before** edge/item idempotency lookup. |
| Materialize idempotent return | Compare body, units, media, target, capability, audit, approval, and complete Personality snapshot | Existing snapshot differs, even when idempotency key/edge matches | Return unchanged only after every current gate passes. Refresh only an unqueued item. |
| `send-to-agent` preflight | Optional UX check | Same conditions as G5 | No mutation; never treated as authority. |
| G5 / queue transaction | Reload everything and current guard under locks + immediate transaction | Approval/audit/materialization/Personality/source/identity/target mismatch | On stale, commit revoke/draft and create no job. On success, create job and set item `queued` in one transaction. |
| Terminal dispatch failure restore | Current guard after marking launch failed | The artifact became stale after queue but before restore | Restore to `approved` only if still current; otherwise restore to `draft` and persist revocation. |
| `get_publish_job`, `update_publish_job`, `complete_publish` | Immutable job payload, target ID, expected handle, lease | Existing job/lease/account verification rules | No new Personality re-gate after queue. Later drift does not rewrite an in-flight/terminal job. |
| Personality apply/rollback | New active binding ID | N/A after host commit | Reconcile every unqueued variant bound to another ID in one DB transaction. Legacy-unbound untouched. |
| Personality unbind | No active binding | N/A after host commit | Reconcile every unqueued bound variant as `personality_stale`. Concrete target decisions remain historical but none are compatible while unbound. |
| Target representation setter | Active binding + concrete identity + evidence | Binding stale/drifted/unavailable; contact/org does not equal binding; conflicting alias merge | Update target metadata and revoke affected unqueued variants/items in one immediate DB transaction. |
| Read context | Same public Personality status; target decisions; effective approval | Never mutates | Report effective stale/revoked state even when cleanup has not yet run. |

### 6.1 Error contract

Reuse existing top-level tool codes; add structured reasons rather than widening
`AgentToolErrorCode`:

| Condition | Tool/materialize code | `details.reason` |
|---|---|---|
| Missing required selector for aware skill | `VALIDATION_ERROR` | `personality_binding_required` |
| Selected/non-null binding is not active | `CONFLICT` | `personality_binding_stale` |
| Workspace unavailable or changed | `WORKSPACE_UNAVAILABLE` | `personality_workspace_unavailable` / `workspace_mismatch` |
| Managed or unmanaged file drift | `AUDIT_STALE` (audit/materialize) or `CONFLICT` (draft selector) | `personality_drifted` |
| Concrete represented identity changed | `CONFLICT` | `personality_identity_mismatch` |
| Audit source snapshot is old | `AUDIT_STALE` | `personality_source_stale` |
| Target missing/unbound/incompatible | `CONFLICT` | `target_identity_mismatch` |

The HTTP G5 surface continues to return `WRITING_APPROVAL_REQUIRED` for missing/revoked approval
and `WRITING_ARTIFACT_STALE` for audit, units, target, Personality, source, identity, or snapshot
mismatch. Do not expose different safety semantics between tool and REST paths.

### 6.2 Revocation must commit before throwing

Throwing inside a SQLite transaction rolls it back. Stale gates that need durable cleanup must
return a tagged result from the transaction:

```ts
type GateTransactionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AgentToolError };
```

The transaction updates variant approval, variant status, content-item status, and edge audit
properties, commits, and only then does the outer use case throw/translate `error`. This applies
to materialization and G5.

### 6.3 Publish is a snapshot after queue

The queue transaction is the last Personality authorization point. Once it commits:

- `publish_jobs.payload`, target snapshots, materialized writing snapshot, and audit/approval
  evidence are immutable execution inputs;
- `get_publish_job` does not re-read a mutable variant to replace its text or target;
- target preparation still verifies the live account/handle and lease;
- later apply/unbind/source/target drift does not mutate queued/publishing/published rows; and
- no retry may create a second job without passing G5 again after the item becomes unqueued.

This avoids a mid-browser race while preserving the requirement that stale content cannot cross
the queue boundary.

---

## 7. Revocation and race behavior

### 7.1 One runner-aware transition

Refactor `revokeOne()` into a runner-aware operation used by explicit revoke, spine change,
Personality cleanup, materialization, and G5:

```ts
revokeWritingVariantWithRunner(tx, {
  variant,
  reason: "personality_stale" | "personality_source_stale" | ...,
  allowQueuedNoop: true,
});
```

For an unqueued artifact it atomically:

- sets `approval.state = "revoked"`, reason, time, and the current audit ID;
- changes a selected variant back to `draft`;
- changes an `approved` materialized content item back to `draft`; and
- records `revokedAt`/reason on the materialization edge.

For `queued`, `scheduled`, `publishing`, or `published`, it performs no row mutation. The caller
reports that the queued snapshot won.

### 7.2 Binding commit and cleanup crash gap

The Personality index and SQLite cannot form one physical transaction. Preserve this ordering:

1. host verifies exact proposed files;
2. #378 commits the new active binding under the Personality lock;
3. while still holding that lock, `apply.ts` invokes the injected post-binding effect and #379
   runs one immediate SQLite reconciliation transaction;
4. release the lock and return.

If the process crashes after step 2, every lazy gate already sees the new binding and fails closed.
Repeated approve/retry of an already applied proposal must run the idempotent reconciliation
before returning the existing binding, repairing the UX state. If reconciliation itself fails,
return an error that states `bindingCommitted: true` and `cleanupRequired: true`; never claim the
binding failed or re-run the host transaction.

This trades cross-store atomicity (not available) for a durable authority-first commit plus
idempotent projection cleanup. Safety depends on the authority check, not on eager cleanup.

### 7.3 Race outcomes

| Race | Winner and required result |
|---|---|
| Apply/unbind vs audit/materialize/G5 | Personality lock serializes. Apply first → stale/revoked. Gate first → it may complete against the old binding; apply then revokes only if still unqueued. |
| Contact/org source update vs queue | SQLite immediate writer order. Source first → old audit stale. Queue first → immutable queued snapshot wins. |
| Voice approval/supersession vs queue | Voice lock serializes. Voice change first → source hash mismatch. Queue first → queued snapshot wins. |
| Statements or represented-org change vs queue | Personality lock serializes after represented-org setter moves under it. Identity-ID change is hard stale, not warning-only. |
| Target representation change vs queue | Both hold Personality lock and use immediate SQLite transactions. Target change first → G5 fails. Queue first → setter leaves queued rows untouched. |
| Managed/unmanaged edit vs materialize/G5 | Final whole-file read defines ordering. Visible edit → fail; completed queue first → later edit cannot cancel it. |
| Stale materialize idempotency key vs drift | Gate runs before lookup; stale item is revoked/drafted, never returned. |
| Dispatch failure vs later drift | Restore path re-gates: current → approved; stale → draft + revoked. |

### 7.4 Source/identity change hooks

Do not add hooks to every contact/org field mutation. Those facts are already in SQLite and the
guard recomputes them transactionally. The required proactive paths are only stores outside the
DB transaction:

- Personality statements already use the Personality store lock;
- change `setRepresentedOrgId` to an async, locked use case and update its route to await it; and
- writing gates acquire the voice-profile store lock while resolving the active profile.

This is narrower and safer than coupling every CRM repository to writing revocation.

---

## 8. Target and account representation use case

### 8.1 Agent tool

Add:

```ts
set_target_representation {
  targetId: string;
  bindingId: `pb_${string}`;
  represents: TargetRepresentation;
  evidence: {
    kind: "thread_message";
    workspaceSlug: string;
    threadSlug: string;
    note?: string;
  };
}
```

The handler requires the evidence workspace to equal the active binding workspace. Assigning
`self` requires the exact `selfContactId`; assigning `org` requires the exact non-null
`representedOrgId`. `unbound` is an explicit removal decision. There is no bulk endpoint and no
policy approval.

### 8.2 REST

Add `PUT /api/platform-targets/[id]/representation` with:

```ts
{ bindingId: `pb_${string}`, represents: TargetRepresentation }
```

The route stamps `{ kind: "ui", route: "/settings/personality" }` evidence server-side. It calls
the same use case as the tool and returns the normalized target view plus `compatible`.

### 8.3 Read models

- `toPlatformTargetView()` may keep raw metadata for compatibility, but adds normalized
  `represents` and `personalityDecision` fields.
- `list_platform_targets` and `get_platform_target` return those normalized fields.
- `get_writing_context.targets[]` adds `represents`, `compatible`, and
  `bindingIdAtDecision` (when a valid decision exists).
- `PersonalityStatus.compatibleTargets` is populated from the same parser and exact active
  identity.

No target is auto-bound from `kind`, `platformAccountId`, `externalId`, browser connection,
handle, canonical URL, or live login. `prepare_platform_target` continues to verify the account
actually opened, but that verification is not represented-identity evidence.

---

## 9. Public API and documentation changes

### 9.1 Existing outputs

`get_personality_binding` and `GET /api/personality/binding`:

- populate `compatibleTargets`;
- keep status enum and existing binding fields stable.

`get_writing_context`:

- add `personality: PersonalityStatus` using the exact shared view;
- add normalized target representation/compatibility;
- add per-variant Personality snapshot and effective stale/revoked state;
- keep legacy variants explicit as `personalityState: "legacy_unbound"`; and
- never mutate stale rows on this read.

`upsert_variant` output:

- returns the server-stamped complete Personality snapshot and server-derived audit snapshot;
- rejects forged fields with a Zod path.

`materialize_variant` output remains shape-compatible; its content item stores the snapshot.

### 9.2 New surface

- agent tool `set_target_representation`;
- `PUT /api/platform-targets/[id]/representation`.

Follow the repository's schema → handler → registry → docs convention and regenerate
`openapi/agent-tools.json`.

### 9.3 Documentation

Update:

- `docs/agent-tools.md` for selector-only input, server-owned output, new target tool, errors, and
  source-stale flow;
- `.claude/skills/realtimex-signals/reference.md` for current tool payloads;
- `specs/personality-projection.md` for the 1.1.0 rollout correction;
- `specs/signals-writing-system.md` only if its example/version prose still says 0.3.0; and
- a migration/rollback note in `docs/local-app.md` or the existing Personality section.

Do **not** edit `signals-writing` instructions or plugin version/package contents in #379; #380
owns the 1.1.0 client and package bump.

---

## 10. Attribution

Extend the existing key:

```ts
type AttributionKey = {
  // existing fields
  personalityBindingId?: string | null;
};
```

Derivation is server-side:

```ts
personalityBindingId: writing.personality?.bindingId ?? null
```

Every cohort/group serializer must include the normalized value. Two non-null, different binding
IDs are always different cohorts even when platform, target, formula, voice profile, and audience
match. Legacy absent and explicit null normalize to the single legacy-null cohort; they never
join a non-null binding cohort.

The current baseline has key derivation but no outcome aggregation query. #379 should add/pin one
`attributionGroupKey()` helper that includes `personalityBindingId`, and the future #352 query must
use that helper rather than hand-pick fields. A regression test with records differing only by
binding ID proves they cannot pool.

---

## 11. Compatibility, rollout, and rollback

### 11.1 Legacy variants

- `personality === undefined` from skill 1.0.x is legacy-unbound.
- Preserve its stored JSON and pre-#379 `inputHash` byte-for-byte.
- First Personality binding does not revoke it.
- Existing materialization/G5 behavior remains until the user intentionally revises it through a
  Personality-aware client.
- Never silently backfill a binding, target representation, hash, or approval.

The compatibility window remains open until 1.1.0 has been packaged into every supported
workspace and a separate owner-approved cleanup issue closes it. Do not encode a calendar date or
silently end the window in #379.

### 11.2 Bound variants

Skill 1.1.0+ cannot create an unbound artifact when the workspace has an active binding. If the
workspace is unbound, it may create a targetless legacy-style draft, but it cannot claim a bound
lineage or reach a Personality-gated publish path.

### 11.3 Target rollout

- Existing and new targets project as unbound with no row rewrite.
- Users bind targets one at a time with evidence.
- Removing #379 code leaves original metadata intact and ignored by older readers.
- Re-enabling #379 restores the decisions; there is no irreversible backfill.

### 11.4 Binary rollback

Because there is no DDL, the prior binary can read the same DB. It will preserve unknown JSON due
to existing passthrough behavior. Bound #379 audits may fail the older audit-hash check because
the older code omits Personality from its hash; that is a safe fail-closed rollback, not data
loss. Legacy-unbound artifacts continue unchanged. Restore the #379 binary to resume bound
materialization; do not down-convert bound approvals automatically.

---

## 12. Exact file map

### 12.1 New files

- `src/lib/writing/personality-lineage.ts`
- `src/lib/writing/personality-lineage.test.ts`
- `src/lib/writing/personality-guard.ts`
- `src/lib/writing/personality-guard.test.ts`
- `src/lib/writing/personality-revocation.ts`
- `src/lib/personality/target-representation.ts`
- `src/lib/personality/target-representation.test.ts`
- `src/lib/personality/use-cases.ts` (outer wiring; name may follow local convention)
- `src/app/api/platform-targets/[id]/representation/route.ts`

Names may be combined if the resulting module remains cohesive; do not bury target decisions in
`materialize.ts` or copy guard logic into routes.

### 12.2 Existing files likely changed

Core contracts and status:

- `src/lib/writing/contracts.ts`
- `src/lib/writing/hash.ts`
- `src/lib/writing/content-writing.ts`
- `src/lib/writing/variant-writing-projection.ts`
- `src/lib/personality/status.ts`
- `src/lib/personality/apply.ts` (port declaration/call only; no Writing import)
- `src/lib/settings/signals-config.ts`

Writing mutations and publish:

- `src/lib/writing/variant-writing.ts`
- `src/lib/writing/materialize.ts`
- `src/lib/writing/publish-gate.ts`
- `src/lib/publish/send-to-agent.ts`
- `src/lib/db/queries/variants.ts`
- `src/lib/db/queries/platform-targets.ts`
- `src/lib/agent-tools/graph-handlers.ts`
- `src/lib/agent-tools/writing-handlers.ts`
- `src/lib/agent-tools/platform-target-handlers.ts`
- `src/lib/agent-tools/registry.ts`
- external variant REST routes named in §4.4

Context, attribution, and generated contract:

- `src/lib/agent-tools/content-item-handlers.ts`
- `src/lib/writing/attribution-key.ts`
- `docs/agent-tools.md`
- `.claude/skills/realtimex-signals/reference.md`
- `openapi/agent-tools.json` (generated)
- the two accepted specs for the rollout-version correction only

Tests should extend existing suites where the seam already exists:

- `src/lib/agent-tools/writing-handlers.test.ts`
- `src/lib/publish/send-to-agent.test.ts`
- `src/lib/writing/publish-gate.test.ts`
- `src/lib/writing/attribution-key.test.ts`
- `src/lib/agent-tools/platform-target-handlers.test.ts`
- `src/lib/personality/proposal-apply.test.ts`

### 12.3 Files explicitly unchanged

- `src/lib/db/schema.ts`
- `src/lib/db/migrations/**`
- browser publisher scripts and selectors
- plugin packaging and `signals-writing` skill content/version (owned by #380)
- CI workflows and dependencies

---

## 13. Proof plan: C1–C7 and S1

| ID | Required evidence |
|---|---|
| C1 | Input schema accepts only `{bindingId}`; forged hash/workspace/source/identity/target/audit snapshot is rejected. Active selector stamps the exact server snapshot. `computeAuditInputHash` golden fixture proves an absent field preserves the old hash and a bound field changes it. |
| C2 | Apply, rollback, and unbind integration fixtures revoke old-binding unqueued approval + item in one transaction; queued/published and absent/null legacy stay byte-identical. Inject failure after binding commit and prove applied-proposal replay reconciles without another host PUT. |
| C3 | Managed edit, unmanaged edit, marker mismatch, missing file, binding change, workspace mismatch, identity change, and target change each fail audit/materialize/G5 with the documented code/reason. A stale materialization edge/idempotency key is not returned. |
| C4 | For bound, source-stale, drifted, unbound, and unavailable fixtures, `get_writing_context.personality` deep-equals `get_personality_binding.status`; compatible target IDs and target projections agree. |
| C5 | Existing `PRESENCE_MANDATE_MODES === ["assist_only"]` and S1 static tests remain green. #379 adds no mandate write or publish-job producer. |
| C6 | Two legacy targets read unbound. Evidence-bound self and org targets are compatible only with the exact binding identity. Other contact/org is rejected. Unbind/rebind to another self does not reinterpret the old decision. Conflicting target aliases fail merge. |
| C7 | Any allowlisted source content change makes old audit/effective approval stale and drafts the unqueued item. Same identity + unchanged bytes accepts one deterministic warned audit and only explicit reapproval. Second source change stales it again. Self/org identity-ID change refuses the warning path. |
| S1 | Static import/call scan proves new #379 modules do not call `createPublishJob`, browser publishers, terminal dispatch, reply/comment/reaction code, or any mandate execution. Only existing `send-to-agent` creates a job after G5. |

### 13.1 Focused unit and integration suites

Add these named scenarios, not only broad happy paths:

1. **Legacy golden hash:** fixture from current main, before and after #379 parser, exact hash equal.
2. **Forged lineage table:** mutate each server-owned field independently and expect input-schema
   rejection or server replacement.
3. **Whole-file drift table:** managed/unmanaged/four social files/marker provenance.
4. **Target table:** absent, invalid JSON, old `"self"`, explicit unbound, exact self, exact org,
   other contact, other org, forgotten/merged target.
5. **Source-stale sequence:** audit A → approve/materialize → source B → lazy revoke → audit B +
   warning → explicit approve → source C → stale again.
6. **Idempotency sequence:** valid materialize twice; drift; third call with same key/edge fails and
   drafts the item.
7. **Dispatch restore:** queue; drift; dispatch failure; item returns draft/revoked, not approved.
8. **Attribution split:** keys differing only in binding ID create two groups; absent and null make
   one legacy group.

### 13.2 Concurrency and fault injection

Use process/barrier tests where two SQLite connections or store locks matter:

- apply binding commit paused before DB reconciliation vs materialize and G5;
- target setter vs G5, in both winner orders;
- source-row write vs G5, in both winner orders;
- voice-store supersession vs audit/G5, in both winner orders;
- crash after binding index commit and before/during revocation transaction;
- stale materialize edge plus concurrent apply;
- queue commit followed by apply/unbind proves queued rows and job payload unchanged; and
- DB failure during dispatch restore returns a failure without falsely reporting the item
  approved.

Assertions must inspect authoritative DB rows, Personality index, and job payload—not only handler
responses.

### 13.3 Commands

At minimum during implementation:

```bash
nvm use
npx vitest run src/lib/writing/personality-lineage.test.ts
npx vitest run src/lib/writing/personality-guard.test.ts
npx vitest run src/lib/personality/target-representation.test.ts
npx vitest run src/lib/agent-tools/writing-handlers.test.ts
npx vitest run src/lib/publish/send-to-agent.test.ts
npx vitest run src/lib/personality/proposal-apply.test.ts
npx vitest run src/lib/writing/attribution-key.test.ts
npm run generate:agent-tools-openapi
SIGNALS_DATA_DIR=/private/tmp/signals-issue-379-check npm run check
SIGNALS_DATA_DIR=/private/tmp/signals-issue-379-integration npm run test:integration
```

If test filenames are consolidated, run the equivalent focused suites and list them explicitly in
the PR.

---

## 14. Ordered Dev implementation

### C1 — Pure contracts and compatibility

- add selector/stored/audit/target schemas;
- add 1.1.0 semantic-version constant;
- add `personality` to hash inputs with golden legacy tests;
- widen revocation reasons and content/variant projections; and
- implement deterministic warning and comparison helpers.

Gate: C1 contract tests and legacy hash fixture.

### C2 — Target representation and shared status core

- implement metadata parser/setter/compatibility;
- refactor status core and populate compatible targets;
- add agent tool + REST route + read projections; and
- move represented-org selection under the Personality lock.

Gate: C4/C6 plus route/tool/OpenAPI tests.

### C3 — Guard and audit/upsert boundary

- implement lock ordering and immediate transaction helper;
- add async writing mutation facade and prevent low-level bypass;
- stamp variant/audit snapshots;
- implement source-stale/identity distinction and fresh audit behavior; and
- project effective read-only staleness in context.

Gate: C1/C4/C7 and forged-input tests.

### C4 — Revocation, materialization, and apply/unbind

- refactor runner-aware revocation;
- gate materialization before lookup and commit stale cleanup before throwing;
- copy/compare complete snapshot on content items; and
- add binding-commit reconciliation plus applied-replay repair.

Gate: C2/C3/C7 and crash gap tests.

### C5 — G5 queue and publish snapshot

- extend pure publish gate;
- use authoritative guard in the immediate queue transaction;
- re-gate dispatch-failure restoration; and
- prove queued jobs remain unchanged after later drift.

Gate: C3, R10/R11/R15 regressions, and S1.

### C6 — Attribution, docs, and repository gates

- add binding-aware attribution grouping;
- update docs/reference/spec rollout number;
- regenerate OpenAPI;
- run focused, integration, and full repository gates.

Only after C1–C6 pass should Dev open/refresh the implementation draft PR and route Review.

---

## 15. Architecture decision records

### ADR-379-1: Server-owned full lineage snapshot, selector-only client input

**Status:** Accepted.
**Context:** A binding ID alone is sufficient for selection but insufficient for durable workspace,
source, identity, and target auditability; accepting the stored shape as input lets clients forge
lineage.
**Decision:** clients select only `{bindingId}`; the server stamps the full additive snapshot and
audit extension.
**Consequences:** more JSON duplication, but every boundary can compare exact historical intent;
legacy omission keeps its hash.

### ADR-379-2: Mandatory lazy gate plus eager projection cleanup

**Status:** Accepted.
**Context:** binding apply can emit an event-like hook, but manual file and source edits cannot.
Eager cleanup alone cannot guarantee safety.
**Decision:** validate current authority at audit, materialize, idempotent return, and G5; use
eager cleanup only for prompt UX consistency.
**Consequences:** local hashing/source reads occur at each boundary; a cleanup crash is safe and
repairable.

### ADR-379-3: Personality lock → voice lock → SQLite immediate

**Status:** Accepted.
**Context:** relevant state spans two file stores, SQLite, and workspace files. Deferred SQLite
transactions permit read/write races and arbitrary lock order risks deadlock.
**Decision:** one fixed lock order and an immediate DB transaction for every sensitive mutation.

**Consequences:** human-scale writes may wait briefly; correctness and deterministic race tests
outweigh throughput.

### ADR-379-4: Target owns representation; account owns credentials

**Status:** Accepted.
**Context:** one login/account may control a personal profile and an owned page; target kind and
login are not evidence of represented identity.
**Decision:** explicit evidence lives on `platform_targets.metadata.personality`; account and
connection records never imply it.
**Consequences:** every target starts unbound and needs a decision; multi-target accounts remain
possible without voice leakage.

### ADR-379-5: Queue commit is the terminal Personality gate

**Status:** Accepted.
**Context:** revalidating/cancelling after a browser action begins creates irreconcilable partial
external effects; the accepted spec leaves queued/published artifacts untouched.
**Decision:** G5 validates and queues atomically; the publish worker executes the immutable job
snapshot without a later Personality re-gate.
**Consequences:** later drift does not cancel an already authorized job; every requeue must pass
the current gate.

### ADR-379-6: No database migration

**Status:** Accepted.
**Context:** all queries are by existing IDs/edges and all needed aggregates have JSON extension
points.
**Decision:** use versioned JSON contracts and existing rows.
**Consequences:** no owner migration approval is needed for the designed path; cross-launch
indexed Personality queries remain a future migration trigger with separate approval.

---

## 16. Risks and explicit assumptions

1. **Accepted spec version is stale.** Default: 1.1.0 is the first aware client; update the
   normative text rather than breaking current 1.0.0.
2. **Cross-store commit is not physically atomic.** Default: binding authority commits first,
   gates fail closed immediately, and replay repairs DB projections.
3. **External OS edits cannot join the lock protocol.** Default: final read defines operation
   order; completed queue is immutable.
4. **Legacy-unbound is an intentional compatibility exception.** It can be selected only by the
   old-client cohort during the documented window and cannot forge a bound lineage.
5. **No current outcome aggregation query exists.** Default: pin the binding-aware group-key seam
   now so #352 cannot omit it later.
6. **Target representation is not account ownership proof.** It is an explicit user decision
   about who the target represents, while the existing live-handle check separately proves which
   account is open.
7. **A source change for the same identity may retain old canonical bytes only through the warned
   audit path.** A concrete identity-ID change never may.
8. **Any proposed DDL, autonomous action, queue cancellation, or target-bound Personality file
   model is a scope change.** Stop and route it for user/product approval instead of embedding it
   in #379.
