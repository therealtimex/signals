# Signals #378 — Personality projection lifecycle design

**Status:** Accepted for implementation\
**Loop:** `loop-issue-378-bc79c912` · **Role:** System Design → Dev\
**Date:** 2026-08-30\
**Signals base:** `main@baae875` (includes #376 at `41a457c`)\
**Host prerequisite:** RealTimeX #1729 / MR !1782, merged as `6dbf8b5a23e790fc2d272fd49f229989a29de996`

Authority remains #373 / PR #374, `specs/personality-projection.md`,
`specs/signals-writing-system.md`, and the #375 epic plan. This document narrows that authority to
#378, reconciles it with the post-#376 Signals tree and the **landed** host API, and records the
implementation order and proof gates.

---

## 0. Verdict

#378 should be one bounded Personality Projection module inside the existing modular monolith. It
owns immutable proposals, explicit decisions, application attempts, bindings, drift, and recovery.
It does not own source facts, workspace files, writing-artifact gates, UI state, or social actions.

The implementation should use:

1. the landed #376 source adapters, snapshots, renderer, IDs, contracts, and locked-store
   primitives;
2. read-only local workspace access for status and proposal construction;
3. the authenticated RealTimeX SDK Personality transaction as the **only** mutation port;
4. one Signals store lock held across each apply/recovery transition; and
5. exact raw-byte hashes for every social Personality file, including unchanged files.

No database migration, dependency, scheduler, browser path, terminal-agent write path, or direct
workspace filesystem fallback belongs in #378.

### Post-#376 contract deltas that #378 must make

`src/lib/personality/contracts.ts` intentionally landed the epic's initial types in #376. Four
additive corrections are required now to satisfy #378 and the exact host behavior:

- proposal records need explicit `rejection` evidence;
- terminal attempts need retained `attemptHistory`, so attempt N is not erased when N+1 starts;
- successful bindings need `attemptNo` and the applied host capability version/schema in addition
  to `hostTransactionId`; and
- host transaction status must accept `resolved_discarded`, which the landed host returns after a
  desktop operator keeps current third-party bytes.

These are file-schema changes only. No persisted proposal/index exists on `main`, so schema version
1 can be extended before its first production write without a data migration.

---

## 1. Scope and boundaries

### 1.1 In #378

- immutable projection, rollback, unbind, and noop proposals;
- exact whole-file merge products and persisted unified diffs;
- explicit approval and rejection evidence;
- generation-checked proposal/index persistence under one file lock;
- capability probing and permission declaration;
- exact workspace, represented-identity, source, binding, and file-revision guards;
- host transaction submit, replay, restore recovery, terminal retry, and operator-visible failure;
- active/history bindings and whole-file/source/marker drift status;
- agent tools, REST routes, OpenAPI/docs, backup/recovery guidance; and
- W1–W10 plus focused, concurrency, fault-injection, and host-contract coverage.

### 1.2 Explicitly outside #378

| Work | Owner | Boundary in #378 |
|---|---|---|
| Writing variant/audit binding, stale approval revocation, target representation, materialize/G5/publish gates, attribution | #379 | Expose stable `PersonalityStatus` and binding records only; do not import `src/lib/writing/materialize.ts`, `publish-gate.ts`, or publish modules. |
| `signals-writing` Personality-first instructions and static plugin `AGENTS.md` pointer | #380 | Dynamic managed pointer only. Do not edit the skill or plugin template. |
| Settings workspace/proposal/diff/recovery UI | #381 | Add server routes with authoritative persisted responses; no React work. |
| Dormant `assist_only` mandate operations | #377 | Keep `mandates.json` and contracts reserved; #378 must not add mandate tools or scheduling/action code. |

Statements and represented-org selection already landed in #376. #378 reads them through
`loadPersonalitySources()`; it does not create a second source model.

---

## 2. Component architecture and dependency direction

```text
Agent tool / REST route
        │
        ▼
 proposal.ts ───────────────► status.ts
        │                         │
        ├──► sources.ts/render.ts │        (#376 domain policy)
        ├──► managed-files.ts ◄───┘        (pure byte/marker/diff policy)
        ├──► workspace.ts                  (read-only local + CLI identity)
        └──► store.ts                      (SIGNALS_DATA_DIR only)
                 ▲
                 │
              apply.ts ───────► host-client.ts ─────► RealTimeX SDK writer
                 │                    │
                 └────────────► capabilities.ts
```

Inner Personality policy must not depend on Next.js routes, the RealTimeX transport, or filesystem
write APIs. `apply.ts` is the application service: it coordinates the store and the host port but
does not implement host mechanics or edit workspace files.

### 2.1 Module ownership

| Module | Responsibility | Must not do |
|---|---|---|
| `src/lib/personality/store.ts` | Read/validate index and immutable documents; lock; generation CAS; install proposal; transition record; prune binding history. | Read a workspace, call the host, render blocks. |
| `src/lib/personality/workspace.ts` | Resolve configured slug/id/realpath; enforce containment; read exact regular-file bytes; reject aliases/symlinks/non-UTF-8. | Write any workspace path. |
| `src/lib/personality/managed-files.ts` | Parse markers, wrap blocks, merge/remove/repair complete blocks, preserve unmanaged bytes, hash, generate deterministic diffs. Pure functions over bytes/strings. | Import DB, host, Next.js, or filesystem APIs. |
| `src/lib/personality/proposal.ts` | Orchestrate projection/rollback/unbind proposal construction and rejection. | Submit a mutation. |
| `src/lib/personality/host-client.ts` | Typed `x-app-id` client for the four landed SDK routes; normalize response/error envelopes. | Decide proposal state. |
| `src/lib/rtx/capabilities.ts` | Probe and short-cache host capability state by `(apiBase, appId)`. | Infer support from app version strings. |
| `src/lib/personality/apply.ts` | Approve, preflight, create/resume attempts, map host outcomes, commit bindings. | Write workspace files or repair host journals locally. |
| `src/lib/personality/status.ts` | Resolve local binding/source/file/marker status; async wrapper decorates it with cached host capability. | Mutate the store or workspace. |

Tools and routes call the same use-case functions. They may translate errors and approval evidence,
but must not reproduce lifecycle rules.

### 2.2 Options considered

| Option | Benefit | Cost / failure mode | Decision |
|---|---|---|---|
| Signals writes files directly after re-reading | Fewer host calls | Cannot close the stale-editor race; bypasses permission, coordinator, journal, and recovery | Rejected |
| Require the SDK read endpoint even to propose | One consistent multi-file snapshot | Proposal becomes unavailable when permission/capability is missing, contrary to #378 | Rejected |
| Read locally for proposals, then revalidate through the SDK listing and transaction CAS | Read-only proposal remains usable; exact mutation guard | Proposal reads are not a cross-file atomic snapshot; stale sets are rejected later | Chosen |
| Release the Signals store lock during the host transaction | Better concurrent status/propose latency | Allows competing apply attempts and makes crash reconciliation depend on a second lease protocol | Rejected for v1 |
| Hold the store lock through host inspect/submit/result commit | One local owner and simple durable transitions | Other writers receive `STORE_BUSY` during a slow host call | Chosen; correctness over rare apply throughput |

The expected apply frequency is human-scale. A second local orchestration/lease system would add
failure modes without meaningful product value.

---

## 3. Persistence model and invariants

```text
SIGNALS_DATA_DIR/personality/
  .store.lock
  index.json
  proposals/<prp_id>.json
  statements.json                 # already shipped by #376
  mandates.json                   # reserved for #377, not created by #378
```

`withStoreLock(personalityStoreDir(), personalityStoreDir(), ...)` is the only mutation boundary.
Every index replace increments `generation` exactly once and uses `commitIndex` against the exact
base generation and canonical hash. Immutable documents are installed before their index record;
an interruption can leave an unreferenced file, never an index reference to a missing file.
Unreferenced files are ignored and reported by store diagnostics, not adopted by filename alone.

### 3.1 Proposal document

The landed `PersonalityProposal` shape remains authoritative with these invariants:

- `id` and non-noop `proposedBindingId` are allocated **before** any marker is rendered;
- every `proposedBlock` start marker names that exact binding ID;
- `files[]` always contains `IDENTITY.md`, `SOUL.md`, `VOICE.md`, and `BRAND.md`, even when a
  file is unchanged or absent;
- `AGENTS.md` is a fifth entry only when a dynamic managed pointer exists or must be added/removed;
- `proposedFile` is the exact UTF-8 string sent to the host; `proposedFileHash` is SHA-256 over
  `Buffer.from(proposedFile, "utf8")`; null/null means deletion;
- `proposalHash` covers every apply-relevant field and excludes only `proposalHash` and
  `proposedBy`;
- `intentHash` excludes allocated IDs, timestamps, and marker provenance, and includes kind,
  workspace, identity, base binding, source/target binding, current whole-file hashes, and desired
  block-body hashes; and
- an identical live intent returns the existing immutable proposal and IDs.

A noop proposal is persisted for visibility, uses the active binding ID, and is never approvable.
Any older record still in `proposed` for the workspace becomes `superseded` in the same index
commit. An `applying` or retryable failed proposal is never silently superseded.

### 3.2 Mutable proposal record

Extend the landed record additively:

```ts
type HostCapabilityRef = {
  key: "workspace.personality.transactions";
  version: number;                 // >= 1
  schemaVersion: 1;
  fileHash: "sha256-hex";
};

type PersonalityAttemptHistoryEntry = {
  bindingId: `pb_${string}`;
  attemptNo: number;
  hostTransactionId: string;
  startedAt: number;
  finishedAt: number;
  terminalStatus:
    | "restored_failure"
    | "recovery_required"
    | "resolved_discarded";
  hostCapability: HostCapabilityRef;
  failure: PersonalityProposalRecord["failure"];
  hostResult: PersonalityProposalRecord["hostResult"];
};

type PersonalityProposalRecord = {
  // existing fields remain
  rejection: {
    by: "user";
    at: number;
    evidence: ApprovalEvidence;
    note?: string;
  } | null;
  attemptHistory: PersonalityAttemptHistoryEntry[]; // append before allocating N+1
};
```

The current/latest `attempt` also stores `hostCapability` and may reach phase `terminal`. Before
allocating N+1, N must be terminal, copied into `attemptHistory`, and still derivable by its stable
transaction ID. There is no implicit retry and no reuse of an old ID as a fresh mutation.

### 3.3 Binding

The landed binding gains:

```ts
attemptNo: number;
hostCapability: HostCapabilityRef;
```

Together with `proposalId`, `previousBindingId`, `hostTransactionId`, exact workspace/identity,
source snapshot references, and exact file hashes, these fields satisfy attempt and host-contract
lineage without copying the entire attempt journal into each binding.

`personalityHash` is always:

```ts
sha256Canonical(
  SOCIAL_PERSONALITY_FILES.map((path) => [path, finalWholeFileHashOrNull])
)
```

in fixed order `IDENTITY`, `SOUL`, `VOICE`, `BRAND`. `AGENTS.md` and `CLAUDE.md` do not participate
in the live social-voice hash.

History is newest-first and capped at 50 bindings. A proposal document remains while referenced by
the active binding, retained history, or a nonterminal/retryable proposal record. History pruning
removes an immutable document only after the index no longer references it. Index commit precedes
best-effort orphan cleanup, so interruption cannot create a dangling reference.

### 3.4 Corruption behavior

Every store read parses `index.json`, referenced proposal documents, and recomputed proposal hashes
through the Zod contracts. Missing, malformed, hash-mismatched, or cross-workspace references fail
closed as `STORE_CONFLICT` with `reason: "store_corrupt"`. No operation reconstructs an immutable
proposal from current workspace bytes. Operator recovery is restore of the whole `personality/`
directory from backup or creation of a fresh data directory after preserving the corrupt one.

---

## 4. Exact RealTimeX host contract

The landed API, not the pre-implementation sketch in the accepted spec, is normative:

| Purpose | Route |
|---|---|
| Probe | `GET /sdk/capabilities` |
| Consistent hash/content listing | `GET /sdk/workspaces/:slug/personality-files?include=content` |
| Commit/replay | `PUT /sdk/workspaces/:slug/personality-files/transactions/:transactionId` |
| Inspect | `GET /sdk/workspaces/:slug/personality-files/transactions/:transactionId` |
| Restore recovery | `POST /sdk/workspaces/:slug/personality-files/transactions/:transactionId/recover` with `{ "mode": "restore" }` |

All carry `x-app-id`; workspace routes additionally require `workspace.personality.write`.
Transaction IDs match `^[A-Za-z0-9:_.-]{8,200}$` and are:

```text
personality:<workspaceKey>:<proposalId>:attempt:<attemptNo>
```

The request contains 4 or 5 unique root markdown paths, never `CLAUDE.md`. Limits for host schema
v1 are 16 files, 1 MiB per file, and 4 MiB total proposed bytes. #378 validates those limits before
approval and again before submit.

### 4.1 Capability state

`probeHostCapabilities` validates the key, `version >= 1`, schema version 1, permission name,
`sha256-hex`, limits, and an allowlist that accepts all five possible paths. It returns:

- `available`: compatible and granted;
- `not_granted`: compatible but `granted === false`;
- `unsupported`: missing/incompatible key or contract;
- `unreachable`: no embedded app ID/base URL, network failure, or invalid response.

Status may cache this for at most 30 seconds. Every actual submit uses an uncached probe. Proposal,
diff, history, and local drift remain available when the writer is unsupported or not granted;
Apply remains in `approved` with `attempt: null` and fails `CAPABILITY_UNSUPPORTED`. There is no
filesystem fallback.

### 4.2 Landed-host details that change the older plan

1. **The transaction ID is in the URL**, not the body.
2. **`resolved_discarded` is a real terminal status.** The SDK transaction schema must accept it.
   It means a desktop operator kept current bytes after a third-hash conflict. Signals records the
   attempt failed and stale; it must create a new proposal from those current bytes. It never
   allocates N+1 from the discarded proposal.
3. **A committed journal cannot be compensated through `/recover`.** The host's recover function
   returns an already committed transaction unchanged. If a `committed` response has a path/hash
   set that violates the SDK contract, Signals re-reads the listing. Exact proposal hashes may be
   accepted; any persistent mismatch becomes `apply_failed / host_contract_mismatch`, with no
   binding and an operator-required message. Signals must not claim that `/recover` restored it.
   The ordinary host verify mismatch is different: the host compensates internally and returns
   `restored_failure` (W3).
4. **The `CLAUDE.md` shim is advisory after file commit.** `symlink` and `copy` satisfy the request;
   `regular_file` is preserved with the proposal warning. A rare `missing`/error result is recorded
   on the terminal proposal record and surfaced beside the binding as a warning, but does not deny
   an already verified file commit. W9 still proves the ordinary missing-file path creates the shim.
5. **Path checks are case-insensitive and regular-file-only.** A case-fold alias (`identity.md`),
   target symlink, directory, socket, or unsafe ancestor is rejected locally before proposal and
   again by the host.

### 4.3 Host outcome mapping

| Host outcome | Proposal transition | Retry rule |
|---|---|---|
| `FILE_CHANGED` | `stale`, clear attempt; no host mutation | New reviewed proposal only |
| exact `committed` | phase `committing` → binding + `applied` in one index commit | Repeated approve/retry returns binding |
| `restored_failure` | `apply_failed`, terminal attempt, approval retained | Next explicit retry revalidates original tokens and allocates N+1 |
| `recovery_required` / `WORKSPACE_RECOVERY_REQUIRED` | `apply_failed`, same attempt blocked | Retry inspects then calls `recover(restore)`; only a later user retry may allocate N+1 after `restored_failure` |
| `resolved_discarded` | `stale` + terminal history | New proposal only |
| `WRITER_BUSY` | keep phase `submitted`; honor `Retry-After` once with same ID | Later retry first inspects same ID |
| network/5xx after submit | keep nonterminal attempt | Inspect same ID before any resubmit |
| network/unavailable before submit | `approved` or phase `prepared`, depending on durable boundary | Inspect/resume same ID |
| capability/permission refusal | `approved`, `attempt: null` | Grant/upgrade, then explicit approve/retry |
| workspace mismatch/ineligible | `stale` | Resolve/rebind and create a new proposal |
| validation/path/owner/request mismatch | `apply_failed / proposal_corrupt` | No automatic retry; repair code/store contract |

---

## 5. Workspace and represented-identity guards

No public tool or route accepts an arbitrary workspace slug. Every operation starts from
`getSignalsRtxWorkspaceSlug(env)`, the same resolver used by dispatch.

### 5.1 Proposal-time resolution

1. Require embedded RealTimeX identity (`RTX_APP_ID` and API base) and resolve
   `GET /cli/get-workspace/:slug` to exact `{ id, slug }`. Writer capability/permission is not
   required.
2. Resolve `resolveRtxStorageDir()/working-data/<slug>` and its realpath.
3. Walk every ancestor from the real working-data root to the workspace: no symlink and no escape.
4. Require each existing managed target to be a regular file, with no case-fold alias.
5. Persist stringified workspace ID, exact slug, exact realpath, and
   `workspaceKey = sha256Canonical([slug, realpath]).slice(0, 32)`.
6. Load sources and persist exact self and represented-org IDs.

If the CLI identity or local directory cannot be resolved, proposal fails `WORKSPACE_UNAVAILABLE`.
The promise that proposals survive an **absent writer capability** does not mean proposals can be
approved against an unidentified workspace.

### 5.2 Apply-time guard, immediately before attempt allocation

While holding the store lock:

1. the active binding still equals `basedOnBindingId` (including null);
2. proposal/index hashes and every marker provenance recompute exactly;
3. projection: current self ID, represented org ID, and `sourceHash` equal the proposal;
4. rollback: current self/selected-org IDs equal the target binding identity; historical source
   bytes may be stale by design and status can become `source_stale` after rollback;
5. unbind: the active binding and its identity equal the unbind proposal; current Signals self may
   be missing/different because unbind is the recovery path for an identity change;
6. uncached capability is `available`;
7. SDK listing returns the proposal's exact slug and ID;
8. host listing dir realpath = local realpath = proposal dir, with containment still valid; and
9. listing hashes for every proposal file equal all immutable `currentFileHash` tokens.

Any source, identity, binding, workspace, or file mismatch occurs before the PUT. File/binding/source
changes make the proposal `stale`; corrupt proposal provenance fails `STORE_CONFLICT` without
changing state to imply an external edit.

---

## 6. Managed blocks, byte preservation, and diffs

### 6.1 Read and decode

- Hash the raw `Buffer` first.
- Decode as UTF-8 and require `Buffer.from(decoded, "utf8").equals(raw)`; otherwise refuse with
  `VALIDATION_ERROR / file_not_utf8`.
- Preserve BOM and every unmanaged byte/code point. Do not normalize Unicode.
- Detect per-file EOL as CRLF when any CRLF exists, otherwise LF, matching the landed heartbeat
  precedent. Only newly rendered managed lines use that EOL.
- Bound files to the host v1 limits before proposal persistence.

### 6.2 Marker parser

The parser recognizes only the mapped section in its mapped file. Complete duplicate blocks are
safe to identify: replace the first in place and remove later complete blocks, recording
`repair: "duplicate_block"`.

Fail proposal with `marker_ambiguous` for:

- a start without an end, or an orphan end;
- nested/overlapping blocks;
- malformed `signals:personality` marker syntax/version;
- a marker for the wrong section in a managed file; or
- a managed marker inside a non-regular/case-aliased path.

The existing `missing_end_marker` schema value remains reserved but is not emitted. Guessing where
an unterminated managed region ends would violate byte preservation. This is the deliberate
resolution of the spec's repair hint versus #378's “marker ambiguity fails before mutation”
acceptance criterion.

### 6.3 Merge rules

- Wrapped block = start marker + detected EOL + LF renderer body converted to detected EOL + EOL
  + end marker; no final newline is invented inside the wrapper.
- Existing complete block: replace exactly from start-marker text through end-marker text; the
  surrounding unmanaged bytes, including line endings, remain identical.
- Missing block in nonempty file: append the minimum EOL bytes needed for one blank line, then the
  wrapper. All prior bytes remain a prefix unchanged.
- New/empty file: wrapper only.
- Removed source: remove only complete marker spans. If the remaining bytes are whitespace/BOM only,
  propose file deletion; otherwise retain them exactly.
- Unbind removes all four managed blocks and the dynamic managed `AGENTS.md` index block. It never
  removes a static/unmanaged pointer or `CLAUDE.md`.
- Block hash is SHA-256 of the renderer's LF body only; marker attributes and file EOL are excluded.
- Current file hash and proposed file hash cover exact whole bytes.

All four social files are included in every host transaction, even unchanged/absent ones. The host
accepts a no-op file but still checks and verifies its hash. This closes the race where unmanaged
`VOICE.md` changes after listing while the transaction writes only `IDENTITY.md`; without all-four
CAS, Signals could commit a `personalityHash` that never existed.

### 6.4 Diff contract

`diff` is a deterministic unified line diff from current to proposed bytes after validated UTF-8
decode. It includes filenames and the no-final-newline marker. `driftDiff` compares the active
binding proposal's exact final file with current bytes. The immutable `proposedFile` and hash—not
the diff renderer—are the write authority.

Implement a small repository-local Myers line diff in `managed-files.ts` (or a sibling pure
`diff.ts`) rather than adding a dependency. Tests must prove that applying its hunks reconstructs
the exact proposed UTF-8 string. Diff display may normalize line separators for readability; raw
current/proposed strings and their hashes preserve the exact EOL/BOM contract.

---

## 7. Use cases and state machines

### 7.1 Propose projection

1. Resolve workspace and sources outside the store lock for early errors.
2. Enter the store lock; re-read index, sources, workspace identity, and exact file bytes.
3. Determine active binding and drift; refuse identity replacement while active (unbind first).
4. Render desired #376 bodies and determine whether a dynamic `AGENTS.md` pointer is needed.
5. Compute intent hash. Return existing live intent if present.
6. For a true noop, persist a non-approvable proposal using active binding ID.
7. Otherwise allocate proposal and binding IDs, wrap markers, merge exact files, compute diffs and
   proposal hash, install immutable JSON, and commit its `proposed` record while superseding older
   `proposed` records.

### 7.2 Approve and apply

Approval always records `by: "user"` plus valid evidence before any attempt. Agent-tool approval
accepts only `thread_message` evidence whose workspace slug equals the proposal workspace. REST UI
approval creates `ui` evidence. Personality never uses `writingApprovalPolicy`.

```text
proposed
   │ persist approval
   ▼
approved ── capability/workspace/source/hash preflight ──► applying(prepared)
   │                                                        │
   │ no capability                                          ├─ PUT / same tx id
   └─ remains approved                                      ▼
                                  stale | apply_failed | applying(committing)
                                                               │
                                                               ▼
                                                            applied
```

On exact committed result, create the binding and mark the proposal applied in one generation
replace. If the process dies after the host commit but before this replace, retry inspects the same
transaction, verifies exact hashes, and completes the binding without another mutation.

### 7.3 Rejection

`proposed`, `approved` with no active attempt, or terminal `apply_failed` may be explicitly rejected.
Rejection persists evidence/note and clears no forensic attempt history. `applying`, `applied`,
`stale`, and `superseded` cannot be rejected. Reject never calls the host.

### 7.4 Retry and recovery

- `approved` + no attempt: run preflight and allocate attempt 1.
- `applying` in `prepared|submitted|committing`: inspect the same ID first; resubmit only when host
  returns `not_started`.
- `apply_failed` + `recovery_required`: inspect, call SDK restore once, persist the outcome, and
  return. Do not allocate another attempt in the same user action.
- `apply_failed` + terminal `restored_failure`: on the **next** explicit retry, revalidate the
  immutable original CAS tokens, append N to history, and allocate N+1.
- `resolved_discarded`, `FILE_CHANGED`, or any original token mismatch: mark stale; create and
  approve a new proposal.
- startup/status reads never recover or mutate a workspace. Only repeated approve/retry does.

### 7.5 Rollback proposal

Rollback requires a retained target binding in the same exact workspace and compatible represented
identity. Desired block **bodies** come from the target binding's immutable proposal, never the host
journal. Allocate a new proposal/binding ID, wrap historical bodies in new markers, and merge them
into **current** unmanaged bytes. The result follows ordinary approval/apply/retry.

Rollback can legitimately become `source_stale` immediately because it restores historical
managed content. That is visible and later enforced by #379; it is not a reason to rewrite history.

### 7.6 Unbind proposal

Unbind uses the active binding identity, removes complete managed blocks, preserves current
unmanaged bytes, and goes through explicit approval and the same all-file transaction. After
commit, the removed active binding and the unbind audit binding are history entries and `active` is
null. The audit binding records its final whole-file hash, attempt, capability, and approval.

### 7.7 Proposal transitions

| Current | Event | Next |
|---|---|---|
| none | propose | `proposed` |
| `proposed` | newer distinct intent | `superseded` |
| `proposed` | reject | `rejected` |
| `proposed` | approve evidence persisted | `approved` |
| `approved` | preflight passes / attempt persisted | `applying` |
| `approved` | capability unavailable | `approved` |
| `applying` | exact host commit + binding commit | `applied` |
| `applying` | host pre-mutation conflict | `stale` |
| `applying` | terminal restored/recovery/protocol failure | `apply_failed` |
| `apply_failed` | restore resolves | `apply_failed` terminal |
| `apply_failed` | later retry + original tokens valid | `applying` attempt N+1 |
| `apply_failed` | tokens differ/operator discard | `stale` |

Terminal workflow states are `applied`, `rejected`, `superseded`, and `stale`; `apply_failed` is
retryable only under the rules above.

---

## 8. Status and drift

`resolveLocalPersonalityStatus()` is synchronous and host-free so #379 can later use it inside
server-side writing gates. `getPersonalityStatus()` decorates the local result with the cached host
capability for tools/REST.

Precedence is:

```text
unavailable > drifted > source_stale > bound
```

with `unbound` when no active projection exists.

For the four social files, compare exact whole hash, parsed block hash, marker binding, duplicates,
and existence against the active binding and retained proposal. Reasons are evaluated per file:

1. `file_missing`;
2. `duplicate_block`;
3. `block_missing`;
4. `marker_binding_mismatch`;
5. `block_edited`;
6. `unmanaged_edited` when block/provenance match but whole hash differs.

A file newly created where the binding recorded null is `unmanaged_edited`. For `AGENTS.md`,
unmanaged edits do not affect `personalityHash`; status is drifted only when a required pointer or
managed index block is missing/invalid (`index_pointer_missing`).

Source status recomputes the #376 content hash. Timestamp-only touches remain bound. Missing/different
self or invalid represented org sets the corresponding source-stale detail and prevents apply.
When a binding with the configured slug exists under another realpath/ID, report unavailable
`workspace_mismatch`, not a misleading unbound state.

The host capability changes whether Apply is enabled; it does not overwrite a valid local status.

---

## 9. Public application surface

All commands target the configured Signals workspace; none accepts a workspace chooser.

### 9.1 Agent tools

| Tool | Input | Result |
|---|---|---|
| `get_personality_binding` | `{}` | Authoritative status, active/history summaries, latest actionable proposal, host capability |
| `propose_personality_projection` | optional same-owner `voiceProfileId` only | Persisted immutable proposal/diff |
| `approve_personality_projection` | `proposalId`, `thread_message` evidence | Binding or authoritative proposal/attempt state |
| `reject_personality_projection` | `proposalId`, `thread_message` evidence, optional note | Rejected record |
| `retry_personality_projection` | `proposalId` | Resumed/retried authoritative state |
| `rollback_personality_projection` | `bindingId` | New rollback proposal; does not approve |
| `unbind_personality_projection` | `{}` | New unbind/noop proposal; does not approve |

The agent path may pin a same-owner approved voice version but may not select a represented org;
the represented-org scalar remains user-surface-owned from #376.

### 9.2 REST routes

```text
GET  /api/personality/binding
GET  /api/personality/host
POST /api/personality/proposals
GET  /api/personality/proposals/:id
POST /api/personality/proposals/:id/approve
POST /api/personality/proposals/:id/reject
POST /api/personality/proposals/:id/retry
POST /api/personality/rollback
POST /api/personality/unbind
```

Routes return persisted proposal fields; #381 must not recompute diff, status, approval, or recovery
truth in the browser.

### 9.3 Error mapping

- Add `WORKSPACE_UNAVAILABLE` to `AgentToolErrorCode` and map it to 503.
- `STORE_BUSY` → 503; `STORE_CONFLICT`, lifecycle/source/file conflicts → 409.
- `CAPABILITY_UNSUPPORTED` → 400 with `reason: host_capability_unavailable`.
- malformed marker/file encoding/path → 400 `VALIDATION_ERROR`.
- host/network details are sanitized; never include file contents or before-images in logs.

---

## 10. Implementation milestones and proof gates

### B1 — Contracts, store, workspace, capability

Files: contract deltas, `store.ts`, `workspace.ts`, `capabilities.ts`, `host-client.ts`, error code,
permission manifests. Prove strict schema, generation CAS, immutable/orphan behavior, exact
slug/id/realpath containment, alias/symlink refusal, capability states, v1 limits, and no writes.

### B2 — Pure managed-file engine and immutable proposals

Files: `managed-files.ts`, `proposal.ts`. Implement projection/noop/dedupe/supersede, exact
all-four files, dynamic index, rejection, rollback, and unbind construction. Prove W1, W7, W9,
W10 plus malformed-marker and file-size cases.

### B3 — Apply, attempts, retry, and recovery

File: `apply.ts`. Implement approval, preflight, transaction ID, host outcome table, attempt
history, binding commit, crash resume, operator discard, and committed-contract mismatch. Prove W2,
W3, W4, W5, W6 with the in-process host contract fake and process-level store contention.

### B4 — Status and public surfaces

File: `status.ts`, handlers, registry, routes, OpenAPI, docs. Prove W8 and route/tool parity; add
backup, permission, capability, retry/recovery, slug-binding, and operator instructions.

### B5 — Contract and rollout evidence

Run the focused suite, full Signals gate, and the opt-in host contract against a disposable
workspace on RealTimeX `realtimex-dev >= 6dbf8b5`. Do not point at the canonical Signals Local App
or user data.

### 10.1 W1–W10 mapping

| ID | Milestone | Required observable |
|---|---|---|
| W1 | B2 | CRLF/BOM fixture retains every unmanaged byte; reconstructed proposed file equals stored string/hash; diff changes only managed span/separator addition. |
| W2 | B3 | Any stale host hash returns `FILE_CHANGED`, no mutation/binding, proposal stale. |
| W3 | B3 | Injected host verify mismatch returns compensated `restored_failure`; replay is terminal; later N+1 can commit unchanged reviewed bytes. |
| W4 | B1/B3 | Two processes serialize through `.store.lock`; one generation/binding commit; loser is busy/conflict, never mixed. |
| W5 | B1/B3 | Slug, ID, realpath, symlink ancestor, case alias, and unavailable directory failures occur before PUT. |
| W6 | B3 | Crash after approval, attempt persistence, submit, host commit, and before binding commit converges through same transaction ID; only terminal restored failure permits N+1. |
| W7 | B2/B3 | Rollback uses historical block bodies + current unmanaged bytes/new marker; unbind removes managed regions, preserves prose, audits, and leaves active null. |
| W8 | B4 | Every managed/unmanaged/marker/delete/duplicate/source mutation produces the exact status reason; reprojection adopts/corrects it. |
| W9 | B2/B3 | Pointer only when required; host creates missing shim; regular `CLAUDE.md` untouched/warned; shim error recorded. |
| W10 | B2/B3 | Only durable user evidence approves; noop/superseded/stale refuse; reject is explicit and durable. |

### 10.2 Additional focused/fault tests

| ID | Test |
|---|---|
| H1 | Static import scan: no `node:fs` write API in Personality modules except the existing locked store implementation operating under `SIGNALS_DATA_DIR`; no publish/runtime-session/browser/scheduler imports. |
| H2 | Apply listing mismatch matrix: slug, ID, dir, one of five hashes, active binding, self, org, source. Assert no PUT. |
| H3 | Host fake implements every exact response/error, replay header, `Retry-After`, `resolved_discarded`, shim states, and committed-response mismatch. |
| H4 | Capability missing, incompatible, not granted, unreachable, stale cache, and permission revoked between probe and submit all fail closed. |
| H5 | UTF-8 round-trip refusal, BOM, LF/CRLF/mixed EOL, no-final-newline, empty/absent file, alias and symlink fixtures. |
| H6 | Opt-in dev-host contract: projection → apply → manual drift conflict → retry → rollback → unbind in a receipt-backed disposable QA Local App/workspace. |
| H7 | Store crash hooks before/after immutable install and before index replace; no dangling index reference, corrupt reference fails closed. |
| H8 | Host committed before Signals index commit; retry GET commits exactly one binding without a second PUT. |
| H9 | Operator discard response makes old proposal stale and cannot allocate N+1. |
| H10 | Static frozen set proves #378 adds no `createPublishJob`, `send-to-agent`, browser session, scheduler, reply, comment, reaction, or follow caller. |

Suggested focused files:

```text
src/lib/personality/store.test.ts
src/lib/personality/workspace.test.ts
src/lib/personality/managed-files.test.ts
src/lib/personality/proposal.test.ts
src/lib/personality/apply.test.ts
src/lib/personality/apply.fault.test.ts
src/lib/personality/status.test.ts
src/lib/personality/host-client.test.ts
src/app/api/personality/personality-projection-routes.test.ts
src/test/personality-projection-child.ts
```

Full proof gate:

```bash
export SIGNALS_DATA_DIR=/private/tmp/signals-378-<unique>
nvm use
npx vitest run src/lib/personality
npm run check
SIGNALS_CONTRACT_PROBES=1 npx vitest run --project contract
```

H6 is a rollout gate. If the dev host cannot run, the PR may be reviewed with H1–H5/H7–H10 but
must remain capability-disabled for dogfood until H6 is recorded.

---

## 11. Rollout, backup, and operator recovery

1. Add `workspace.personality.write` to `rtx-manifest.json`, the marketplace Local App manifest,
   canonical recovery permission list, and any permission-parity fixture. Existing installs will
   prompt again; until granted, proposal/status work and Apply stays disabled.
2. Back up the whole `SIGNALS_DATA_DIR/personality/`, not just SQLite. Proposal files contain
   unmanaged workspace prose and should be treated as equally sensitive.
3. The host must back up `private-working-data/personality-writer` with `working-data`; Signals
   never reads its before-images.
4. No startup path applies or recovers a proposal. An interrupted attempt is visible until the user
   invokes approve/retry.
5. SDK callers can only request restore. If third bytes must win, the desktop operator uses the
   host Personality writer recovery surface; Signals then observes `resolved_discarded` and
   requires a new proposal.
6. Dogfood on one disposable workspace before enabling user-facing #381 controls. The capability
   probe—not a desktop version string—is the release switch.

---

## 12. Architecture decision records

### ADR-378-1: Local read-only proposal, host-locked mutation

**Status:** Accepted.\
**Context:** Proposals must remain available without the writer permission, but mutations require a
consistent host snapshot.\
**Decision:** Build proposals from byte-stable local reads; revalidate workspace identity and every
CAS token using the host listing and transaction immediately before mutation.\
**Consequences:** A proposal can capture a cross-file set that later proves stale, but cannot mutate
that set. Apply has two defenses: explicit listing guard and host in-lock CAS.

### ADR-378-2: All social files participate in every transaction

**Status:** Accepted.\
**Context:** `personalityHash` covers managed and unmanaged bytes across four files. Sending only
changed files leaves a race on the omitted files.\
**Decision:** Include all four social files as exact no-op/create/update/delete operations; include
`AGENTS.md` only when dynamically managed.\
**Consequences:** Larger payload (bounded below host limits), but a committed binding names an exact
whole Personality revision that the host verified together.

### ADR-378-3: Ambiguous markers fail closed

**Status:** Accepted.\
**Context:** An unmatched/nested marker has no provable managed/unmanaged boundary.\
**Decision:** Repair only complete duplicates; reject every ambiguous shape before proposal.\
**Consequences:** Some manual corruption needs user repair, but Signals never deletes guessed prose.

### ADR-378-4: One local lock spans each host attempt transition

**Status:** Accepted.\
**Context:** Releasing the lock needs a lease/ownership protocol to prevent competing attempts.\
**Decision:** Hold the existing cross-process store lock through preflight, inspect/submit, and
result commit.\
**Consequences:** Concurrent status/store mutations may receive `STORE_BUSY`; apply remains a simple,
auditable single-owner state machine.

### ADR-378-5: Host terminal outcomes are facts, not inferred retries

**Status:** Accepted.\
**Context:** The host owns before-images and may return committed, restored, recovery-required, or
operator-discarded outcomes.\
**Decision:** Persist each outcome and its stable transaction ID; resume nonterminal attempts;
allocate N+1 only after a distinct explicit retry following proven restoration.\
**Consequences:** Recovery can require two user actions, but a retry can never repeat or relabel a
completed mutation.

---

## 13. Ordered Dev handoff

1. Land B1 contract/store/workspace/host-client foundations and focused tests.
2. Land B2 pure merge/proposal/rollback/unbind engine; inspect CRLF/BOM and marker fixtures before
   touching transport code.
3. Land B3 apply/recovery state machine against the exact host fake; do not start with the live
   desktop.
4. Land B4 status, tools, routes, OpenAPI, permission parity, and operator docs.
5. Run H1–H5/H7–H10 and `npm run check` with an isolated data dir.
6. Exercise H6 against a receipt-backed disposable RealTimeX dev Local App/workspace, capture the
   host build/capability, transaction IDs, binding/proposal IDs, and final hygiene result.
7. Route to Review only with the exact test commands/results and any unresolved rollout blocker.

The implementation is acceptable only when no mutation path exists outside `host-client.ts`'s
authenticated transaction PUT and every reviewed byte is the same byte later hashed, submitted,
verified, and bound.
