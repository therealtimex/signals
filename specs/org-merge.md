# Org merge

Status: **proposed**. No implementation.

Companion to `find_duplicate_orgs` (#444), which surfaces duplicate org records but deliberately
does not act on them. This specifies what acting on them would mean.

## 1. Why this needs a spec first

Merging contacts is well-trodden (`src/lib/contacts/dedupe/merge.ts`). Merging orgs is not the same
shape, for three reasons:

1. **An org is a join target, not a leaf.** Ten tables carry an `org_id`, and `graph_edges` points
   at orgs polymorphically from both directions. A contact merge mostly re-points rows that belong
   to the contact; an org merge re-points rows that belong to *other* entities and happen to
   reference the org.
2. **Five unique indexes can collide** (§4). A contact merge collides on channels; an org merge can
   collide on domain, platform identity, activity dedupe key, domain alias, and email pattern.
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

## 3. Contract

Mirrors `mergeContacts` so the two read alike:

```ts
mergeOrgs({
  primaryOrgId: string;
  secondaryOrgIds: string[];
  options?: {
    dryRun?: boolean;        // validate and report, write nothing
    reason?: string;
    workflowRunId?: string;
  };
}): {
  primaryOrgId: string;
  primaryOrgName: string;
  merged: { orgId; name; status: "merged" | "already_merged" | "skipped"; detail? }[];
  moved: Record<string, number>;    // rows re-pointed, per table
  dropped: Record<string, number>;  // rows dropped to a unique-key collision
  dryRun: boolean;
}
```

**`dryRun` is not optional in practice.** Given tier 2's confidence, the reviewing surface should
call `dryRun: true` first and show `moved`/`dropped` before committing.

### Tombstones, not deletion

The secondary is **archived and stamped**, never deleted — matching `mergedIntoContactId`:

```
metadata.mergedIntoOrgId = <primaryOrgId>
metadata.archived = 1
```

with a `resolveSurvivingOrgId()` that follows the chain. Deleting would orphan any foreign key we
missed, and there is no undo. A tombstone is recoverable.

## 4. Field and constraint resolution

These are the decisions this spec exists to settle. **Open — needs a call before implementation.**

| conflict | proposal | rationale |
|---|---|---|
| `domain` (unique) | primary keeps its own; secondary's becomes an `org_domains` alias | never silently discard a real domain |
| `org_domains.domain` (unique) | on collision, drop the secondary row, count in `dropped` | the alias already points at the survivor |
| `org_identities` (unique on platform+user) | move; on collision drop the secondary's | identity already claimed by the primary |
| `org_activities.dedupe_key` (unique) | move; on collision drop | same activity observed twice |
| `org_email_patterns` (unique on org+pattern) | move; on collision drop | |
| `industry`, `description`, `location`, `company_size` | fill only where the primary is empty | never overwrite a curated value |
| `enrichment_score` | recompute via `recalcOrgEnrichment` after the move | derived, not merged |
| `accountStage`, `ownerContactId`, `followedAt` | primary wins; secondary's ignored | all null in practice today |
| `tags` | union | additive, no information lost |
| `createdAt` / provenance | primary keeps its own | birth fields describe *that* record |

### Employment collisions

If both orgs hold an employment for the same contact, the merge must not leave that contact
employed twice by the survivor. Proposal: keep the row with a non-null `title`, else the older;
drop the other and count it. **Needs confirmation** — the alternative is keeping both as separate
stints, which is right for a real re-hire and wrong here.

## 5. Guards

1. Refuse if `primaryOrgId` is among `secondaryOrgIds`.
2. Refuse if either side is already a tombstone; resolve the chain first.
3. Refuse a secondary that is a *distinct-entity* name under the `find_duplicate_orgs` rules
   (`Lockheed Martin Ventures` into `Lockheed Martin`) unless an explicit `force` is passed. The
   detector already declines to suggest these; the merge should decline to perform them by accident.
4. Cap `secondaryOrgIds` per call so one bad invocation cannot cascade.

## 6. Surface

- `merge_orgs` agent tool, mirroring `merge_contacts`.
- Not exposed in the Companies UI until the tool has been used enough to trust tier 2 precision.
  Current measurement: 9 candidates, 8 correct, on 1,028 orgs.

## 7. Verification

Because this is destructive:

- `dryRun` parity test: the reported `moved`/`dropped` must equal what a real run then performs.
- A test per unique index in §4, each constructing the collision.
- A test that no row anywhere still references a tombstoned org id, iterating the ten tables and
  both `graph_edges` directions rather than asserting a hand-written list.
- Run against a **copy** of a real install before it is offered in the UI. Uniform fixtures did not
  predict real distribution anywhere else in this area, and will not here.
