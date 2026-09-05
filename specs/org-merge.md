# Org merge

Status: **decided, not implemented**. §4 and §8 settle the two data-ownership questions that were
open in the first revision; no code exists yet.

Companion to `find_duplicate_orgs` (#444), which surfaces duplicate org records but deliberately
does not act on them. This specifies what acting on them would mean.

## 1. Why this needs a spec first

Merging contacts is well-trodden (`src/lib/contacts/dedupe/merge.ts`). Merging orgs is not the same
shape, for three reasons:

1. **An org is a join target, not a leaf.** Ten tables carry an `org_id`, and `graph_edges` points
   at orgs polymorphically from both directions. A contact merge mostly re-points rows that belong
   to the contact; an org merge re-points rows that belong to *other* entities and happen to
   reference the org.
2. **Unique keys get in the way** (§4). A contact merge collides on channels; an org merge has one
   exclusivity constraint (`orgs.domain`) and two keys that can genuinely collide
   (`org_email_patterns`, `graph_edges`). The other org-scoped unique keys are global and cannot be
   held by both sides at once, so they move without ceremony.
3. **Tier 2 detection is suggestive, not certain** — a venture arm can contain its parent's name.
   Merging a wrong pair moves employment edges belonging to real people, and the undo is manual.

## 2. Scope of a merge

Measured on a real install, merging `Andreessen Horowitz` into `Andreessen Horowitz (a16z)`:

| table | rows to move |
|---|---|
| `contact_employments` | 1 |
| `graph_edges` (dst) | 1 |

Small in that instance, but the tables that *can* hold rows are:

`contact_employments`, `org_identities`, `org_identity_metrics`, `org_domains`, `org_activities`,
`org_email_patterns`, `interactions`, `tasks`, `contact_email_candidates`, `simulation_agents`,
plus `graph_edges` as `src_type='org'` and `dst_type='org'`.

Across all nine candidate pairs on that install today: one cross-org employment collision (§4,
Safe Superintelligence), one domain in play (`a16z.com`, on the suggested survivor), zero
`org_email_patterns`, zero org-sourced edges, zero non-`works_at` org edges.

## 3. Contract

Mirrors `mergeContacts` so the two read alike, with two additions (§8, ADR-445-1 and ADR-445-4):

```ts
mergeOrgs({
  primaryOrgId: string;
  secondaryOrgIds: string[];
  options?: {
    dryRun?: boolean;        // same transaction, rolled back; reports exactly what a run would do
    domain?: string;         // which member domain becomes the survivor's primary (ADR-445-1)
    reason?: string;
    workflowRunId?: string;
  };
}): {
  primaryOrgId: string;
  primaryOrgName: string;
  merged: { orgId; name; status: "merged" | "already_merged" | "skipped"; detail? }[];
  moved: Record<string, number>;    // rows re-pointed, per table
  dropped: Record<string, number>;  // rows dropped to a unique-key collision or a fold
  plan: {
    domain: {
      primary: string | null;
      aliases: { domain: string; fromOrgId: string; source: string; mxStatus: string }[];
    };
    employments: {
      contactId: string;
      action: "fold" | "stint";
      keptId: string;            // the survivor-side row (fold) or the moved row (stint)
      foldedId?: string;         // the secondary-side row that was folded away
    }[];
  };
  dryRun: boolean;
}
```

`moved` and `dropped` stay count-shaped for parity with `mergeContacts`. `plan` is what the
reviewing surface actually needs to show before committing: which domain wins and which people's
employment rows fold.

**`dryRun` first is a surface rule, not a server rule.** The `merge_orgs` tool description and the
CLI must call `dryRun: true` and show `plan` before a committed call. The server does not enforce a
two-phase commit (ADR-445-4).

### Tombstones, not deletion

The secondary is **archived and stamped**, never deleted — matching `mergedIntoContactId`:

```
metadata.archived = 1
metadata.archivedAt, archiveReason
metadata.mergedIntoOrgId = <primaryOrgId>
metadata.mergedAt, mergeWorkflowRunId?
domain = NULL            // the unique index must be free before the survivor can adopt it
```

with `mergedIntoOrgId()` and `resolveSurvivingOrgId()` exported from the merge module and
following the chain. Deleting would orphan any foreign key we missed, and four of the ten
`org_id` columns are `ON DELETE SET NULL`, which is silent loss rather than an error. A tombstone is
recoverable by hand. It also doubles as the **name alias** for the secondary: see ADR-445-3 for the
reader changes that make that true.

## 4. Field and constraint resolution

**Decided** — see §8 for the reasoning behind each row.

| conflict | decision | rationale |
|---|---|---|
| `domain` (unique, exclusivity) | survivor keeps its own; if it has none, it adopts the first secondary's; every other member domain becomes an `org_domains` alias on the survivor; `options.domain` overrides the choice from the union | ADR-445-1 |
| `org_domains.domain` (global unique) | re-point to the survivor; **cannot collide** — the write path refuses a domain held by two orgs, so no pair can carry the same one | move, never drop |
| `org_identities` (global unique on platform+user) | re-point; **cannot collide** for the same reason; if the survivor already has an `isPrimary` identity, incoming ones arrive with `isPrimary = 0` | mirrors `mergeIdentities` |
| `org_identity_metrics` | re-point `org_id`; `org_identity_id` follows the identity | |
| `org_activities.dedupe_key` (global unique, keyed by workflow run) | re-point; **cannot collide** — the key names a run, not an org | move |
| `org_email_patterns` (unique on org+pattern) | re-point; on collision keep the survivor's row and drop the secondary's, count in `dropped`; if the survivor has any `isSelected` row, incoming rows arrive with `isSelected = false` | one selected pattern per org |
| `graph_edges` (unique on type+src+dst) | re-point both endpoints with collision drop and self-loop drop, mirroring `mergeGraphEdges`; then `works_at` is rebuilt by projection (ADR-445-2) | |
| `contact_employments` | fold or keep as a stint per ADR-445-2 | |
| `interactions.org_id`, `tasks.related_org_id`, `contact_email_candidates.org_id`, `simulation_agents.org_id` | plain re-point | no unique key includes the org |
| `name`, `orgType`, `scope` | survivor keeps its own; the secondary's name lives on in the tombstone | the caller chose the survivor |
| `website`, `industry`, `description`, `location`, `avatarUrl`, `company_size` | fill only where the survivor is empty | never overwrite a curated value |
| `enrichment_score` | recompute via `recalcOrgEnrichment` after the move | derived, not merged |
| `accountStage`, `ownerContactId`, `followedAt`, `feedSeenAt` | survivor wins; secondary's ignored | all null in practice today |
| `tags` | union | additive, no information lost |
| `createdAt` / provenance | survivor keeps its own | birth fields describe *that* record |

### Employment collisions

If both orgs hold an employment for the same contact, the merge must not leave that contact
employed twice by the survivor. **Decided (ADR-445-2):** reuse the fold rule `mergeContacts`
already applies to same-org stints, extracted into a shared helper, with one added guard for dated
stints. Neither "drop the thinner row" nor "always keep both".

## 5. Guards

1. Refuse if `primaryOrgId` is among `secondaryOrgIds`.
2. Refuse if either side is already a tombstone; resolve the chain first (`resolveSurvivingOrgId`
   on the primary, `already_merged` / `skipped` on secondaries, exactly as `mergeContacts`).
3. Refuse a secondary that is a *distinct-entity* name under the `find_duplicate_orgs` rules
   (`Lockheed Martin Ventures` into `Lockheed Martin`) unless an explicit `force` is passed. This
   only catches pairs a caller names by hand that the detector would have declined. It does **not**
   catch the detector's own false positives — `FPT Software Nordics` into `FPT Software` is a
   suggested candidate today and passes this guard (ADR-445-6).
4. Cap `secondaryOrgIds` per call so one bad invocation cannot cascade. The detector only ever
   proposes pairs, so anything above ten is a caller mistake.

## 6. Surface

- `merge_orgs` agent tool, mirroring `merge_contacts`, plus a CLI batch mode mirroring
  `run-merge.ts` if one is wanted.
- Not exposed in the Companies UI until the tool has been used enough to trust tier 2 precision.
  Current measurement: 9 candidates, 8 correct, on 1,028 orgs.

## 7. Verification

Because this is destructive:

- `dryRun` parity: with ADR-445-4 the dry run *is* the real transaction rolled back, so the test
  asserts the two result objects are deep-equal, not that two implementations agree.
- A test per key that can actually collide (`org_email_patterns`, `graph_edges`), one for the
  domain exclusivity dance (survivor has a domain / survivor has none / `options.domain` override),
  and one per employment outcome (fold on equal title, fold on blank title, stint on distinct
  titles, stint on distinct dates).
- A test that no row anywhere still references a tombstoned org id, iterating the ten tables and
  both `graph_edges` directions rather than asserting a hand-written list.
- A test that `ensureOrgByName(<secondary's name>)` returns the survivor after the merge, and that
  the Companies list no longer shows the tombstone (ADR-445-3).
- The shared fold helper keeps every existing `mergeContacts` employment test green, plus one new
  case for the dated-stint guard.
- Run against a **copy** of a real install before it is offered in the UI. Uniform fixtures did not
  predict real distribution anywhere else in this area, and will not here.

## 8. Decisions

Recorded by System Design (loop `loop-issue-signals-org-merge-design-603e69f2`, 2026-09-05) against
a read-only copy of the real install (1,028 orgs, 1,285 employments, 11 org domains).

### ADR-445-1 — Domain survivorship is a caller decision with a deterministic default

**Context.** `orgs.domain` is uniquely indexed, so one value survives. The suggested survivor is
picked by linked-people count, which says nothing about which domain is better. Two proposals were
on the table: the survivor keeps its own domain, or the "better-verified" domain wins.

What the data says: only 11 of 1,028 orgs carry a domain; all 11 `org_domains` rows are
`mx_status = unknown`; field provenance is uneven (`agent:enrich_org` with an evidence URL on eight,
`derived:create_org_fill_gaps` on two, nothing on one). Across the nine candidate pairs exactly one
domain is in play, and it sits on the suggested survivor. The "hard case" does not exist on the
install today, and there is no verification signal to score it with if it did.

What actually depends on which domain is primary: `getOrgByDomain` resolves through `org_domains`
regardless of `kind`, so lookups, `ensureOrgByDomain`, and the write-path conflict check all land
on the survivor whichever domain is primary. The primary matters for email-candidate rendering
(`intelligence.ts` renders `<pattern>@<org.domain>`), for the ARPP/personality projections, and for
display. All of that is reversible through `updateOrg`, whose existing `syncPrimaryDomain` already
swaps primary and alias.

**Decision.**

- The survivor keeps its own `domain` when it has one.
- When it has none, it adopts the first secondary's domain (in call order) as primary.
- Every other member domain — the secondaries' primaries and all their aliases — is re-pointed to
  the survivor as an `org_domains` alias. Nothing is discarded.
- `options.domain` names which member of that union becomes the primary. It must be one of the
  union; a new domain is `updateOrg`'s job, not the merge's. The swap goes through the same
  primary/alias sync that `updateOrg` uses, so `orgs.domain` and `org_domains.kind = 'primary'`
  cannot disagree.
- `plan.domain` reports the primary and every alias with its source org, provenance source, and
  `mxStatus`, so the reviewer sees the evidence and can override on the next call.
- No quality inference. The merge does not rank domains by provenance or MX status.

**Ordering constraint** (a real trap): re-point the secondary's `org_domains` rows → set the
secondary's `orgs.domain` to `NULL` → set the survivor's `orgs.domain`. Any other order trips the
unique index or lets the `orgs.domain` fallback in `getOrgByDomain` land on the tombstone.

**Consequences.** The default is the same posture as every other field in §4: the survivor's
curated value is never silently replaced. The hard case becomes a visible reviewer choice instead of
a heuristic the reviewer cannot see. When MX verification starts populating `mx_status`, the
evidence appears in `plan.domain` for free; promoting it to an automatic preference is a separate,
small decision.

**Rejected.** *Better-verified wins*: untestable on real data today, and a silent primary swap
changes email-candidate generation for every contact at that org — that is a reviewer-visible
change, not a tie-break. *Choose the survivor by domain quality instead of people count*: the
survivor's name is what people see; coupling it to the domain trades one arbitrary rule for another.

### ADR-445-2 — Employment collisions fold by the contact-merge rule, shared, with a date guard

**Context.** Two rows for one contact, one at each org, must not become two employments at the
survivor. The spec proposed "keep the row with a title, else the older; drop the other". The
alternative was "keep both as stints", which is right for a genuine re-hire.

What the data says: one collision exists across the nine pairs. The contact holds
`Co-Founder & Chief Scientist` (current) at `Safe Superintelligence Inc. (SSI)` and
`Co-founder & Chief Scientist` (not current) at `Safe Superintelligence (SSI)`, both from
`agent:create_contact`, no dates. That is "same job, less detail", not a re-hire. Date evidence
that could prove a re-hire is nearly absent: 0 of 729 `import:linkedin_csv` rows and 0 of 514
`agent:create_contact` rows carry `started_at`; only `agent:contact_web_research` does (17 of 34).

`mergeContacts` already solved this shape for same-org stints on one contact (`mergeEmployments`):
fold when normalized titles are equal or one side is blank, filling blanks on the kept row; keep
both when the titles are two distinct non-blank strings. Its comment records why: the
`resolveCurrentEmployment` tie-break on `createdAt` lets the thinner row win and the survivor loses
its title.

**Decision.**

- Extract that rule into a shared helper (for example `src/lib/db/employment-fold.ts`) and use it
  from both `mergeContacts` and `mergeOrgs`, so the two merges cannot drift.
- For each contact with rows at both orgs, treat the secondary-org rows as incoming against the
  survivor-org rows for that contact:
  - **fold** when normalized titles are equal, or either title is blank — fill `title`,
    `startedAt`, `endedAt` where the kept row is null, set `isCurrent` if either side is current,
    delete the incoming row, count it in `dropped.contactEmployments`, list it in
    `plan.employments` as `fold`;
  - **stint** otherwise — re-point the incoming row to the survivor and list it as `stint`.
- One added guard, applied in the shared helper and therefore to contact merge too: two rows whose
  `startedAt` are both non-null and differ are distinct stints and are never folded. That is the
  only evidence of a re-hire or promotion the data can carry, and the guard is strictly more
  conservative (fewer deletes), so it is safe to apply to the existing contact merge.
- `works_at` edges are derived from employments (ADR-092-2). After the transaction, call
  `afterEmploymentMutation(contactId)` for every contact whose rows moved or folded, exactly as
  `mergeContacts` runs its projection and recalc outside the transaction. Do not hand-maintain
  `works_at` properties on the re-pointed edges; the projection rewrites them.

**Consequences.** The one real collision folds correctly. A wrong fold loses nothing that was on
the dropped row (blanks are filled), only the fact that there were two rows; a wrong keep would
show two current stints and could demote the titled one. Where the rows carry evidence of being
different jobs (titles or dates), that evidence wins. Where they carry none, one row is the
reading that is consistent with both and recoverable by re-adding a stint.

**Rejected.** *Title-non-null else older, drop the other*: discards `startedAt`/`endedAt` on the
dropped row when the kept row lacks them, and keeps the thinner row when both have titles that
differ only by case. *Always keep both*: wrong for the only real case, and visible on every
affected profile immediately.

### ADR-445-3 — Tombstones stay, and the merge PR must teach org readers to see them

**Context.** The tombstone convention works for contacts because `archiveContact` and the
archived-aware readers pre-existed the merge. Orgs have neither: `queries/orgs.ts` has no notion
of `archived` at all. Only `findDuplicateOrgs` filters it.

Concretely, after merging `Andreessen Horowitz` into `Andreessen Horowitz (a16z)`:

- `ensureOrgByName("Andreessen Horowitz")` scans **every** org by name key and returns the
  tombstone, so the next LinkedIn import re-attaches an employment to it and the merge quietly
  un-happens over time. Five call sites go through `ensureOrgByName`.
- `listOrgs` (the Companies list) still shows both records.

**Decision.**

- Keep tombstones over deletion (§3). The tombstone is also the secondary's **name alias**: because
  it keeps its name, `ensureOrgByName` can find it and follow the chain.
- In the same PR as `mergeOrgs`:
  - `ensureOrgByName` resolves through `resolveSurvivingOrgId` when the name-key match is a
    tombstone (resolve, do not skip — skipping would create a third record);
  - `listOrgs` excludes `metadata.archived = 1` (the Companies list and everything built on it);
  - the tombstone's `orgs.domain` is `NULL` (§3), so `getOrgByDomain`'s fallback cannot reach it.
- Follow-up, not this PR: the other org readers (`contact-explore`, embeddings, ARPP/personality
  projections, simulations) should hide tombstones too. `getOrgById` stays as is — history rows
  still need the name.

**Consequences.** The merge is durable across the next import. Undo remains manual: the tombstone
guarantees the record survives, not that an un-merge exists.

### ADR-445-4 — `dryRun` is the real transaction, rolled back; dry-run-first is a surface rule

**Context.** `mergeContacts`' `dryRun` validates membership and returns empty counters; it does not
predict `moved`/`dropped`. The spec's §7 parity test would have to compare two implementations.

**Decision.**

- One code path. `dryRun: true` runs the same `db.transaction`, captures the result, and throws a
  sentinel that rolls it back. Post-transaction side effects (`afterEmploymentMutation`,
  `recalcOrgEnrichment`) are skipped. The parity test asserts deep equality of the dry and real
  results.
- Dry-run-first is enforced by the callers — the `merge_orgs` tool description, the CLI, any
  future UI — not by the server. A server-enforced two-phase commit needs a plan token and a store
  for it, and the only caller today is the agent tool.

**Consequences.** `plan` is exact by construction. The known gap in `mergeContacts`' dry run is
recorded here and left alone; closing it is a separate change.

### ADR-445-5 — The collision matrix is two keys and one exclusivity, not five

**Context.** The first revision counted five unique indexes that could collide. Checked against
the schema: `org_domains.domain`, `org_identities (platform, platform_user_id)`, and
`org_activities.dedupe_key` are global keys. The write path refuses a domain or platform identity
already held by another org (the same reasoning `findDuplicateOrgs` uses to skip a "shared
identity" tier), and the activity key names a workflow run, not an org. None of the three can be
held by both sides of a merge, so re-pointing cannot violate them.

**Decision.** The §4 table is corrected. Only `org_email_patterns (org_id, pattern)` and the
`graph_edges` identity can collide, and `orgs.domain` is handled as exclusivity (ADR-445-1). Tests
cover those; the global keys get a re-point and a count.

### ADR-445-6 — Guard 3 is belt-and-braces; the real protection is review plus tombstone

**Context.** The one wrong candidate in nine is a country unit whose marker (`nordics`) is not a
distinct-entity token, so both the detector and guard 3 accept it. That is a detector-vocabulary
question for #444's follow-up, not a merge-guard question.

**Decision.** Keep guard 3 for hand-named pairs. Do not promise it prevents wrong merges. The
protection against a wrong merge is `dryRun` + `plan` in front of a reviewer, and a tombstone that
keeps the record. State that in the tool description.

### ADR-445-7 — Scope

- `mergeOrgs` module (mirroring `merge.ts`), the shared employment-fold helper, `merge_orgs`
  tool + schema, `ensureOrgByName` chain resolution, `listOrgs` archived filter, tests per §7.
- Out of scope: Companies UI, un-merge, hiding tombstones from readers beyond `listOrgs`, MX-based
  domain preference, detector vocabulary.
