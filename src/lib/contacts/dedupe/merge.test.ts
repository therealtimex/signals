import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  createContact,
  getOwnerContactId,
  isContactArchived,
  listContacts,
  restoreContact,
} from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import {
  createContactEmployment,
  resolveCurrentEmployment,
} from "@/lib/db/queries/contact-employments";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrg } from "@/lib/db/queries/orgs";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contacts,
  contentItems,
  embeddings,
  graphEdges,
  interactions,
  tasks,
} from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";
import { MergeContactsError, mergeContacts, mergedIntoContactId } from "./merge";

function seedInteraction(contactId: string, occurredAt = 1_700_000_000): string {
  const id = nanoid();
  db.insert(interactions)
    .values({ id, contactId, interactionType: "reply", occurredAt, source: "test" })
    .run();
  return id;
}

function seedTask(contactId: string, title = "Follow up"): string {
  const id = nanoid();
  db.insert(tasks).values({ id, title, relatedContactId: contactId }).run();
  return id;
}

function seedContentItem(contactId: string): string {
  const id = nanoid();
  db.insert(contentItems).values({ id, contentType: "post", contactId }).run();
  return id;
}

function seedEmbedding(contactId: string, kind: string, model: string): string {
  const id = nanoid();
  db.insert(embeddings)
    .values({
      id,
      nodeType: "contact",
      nodeId: contactId,
      kind,
      model,
      dims: 3,
      vector: Buffer.from([1, 2, 3]),
      contentHash: `${contactId}:${kind}`,
    })
    .run();
  return id;
}

function seedEdge(edgeType: string, srcId: string, dstType: string, dstId: string): string {
  const id = nanoid();
  db.insert(graphEdges)
    .values({
      id,
      edgeType,
      srcType: "contact",
      srcId,
      dstType: dstType as "contact" | "org",
      dstId,
      source: "test",
    })
    .run();
  return id;
}

describe("mergeContacts", () => {
  beforeEach(() => {
    // resetCoreTables does not clear tasks, and tasks.related_contact_id is a FK
    // onto contacts — so it has to go first or the contacts delete fails.
    db.delete(tasks).run();
    resetCoreTables();
  });

  it("re-points every graph edge that hung off the secondary", () => {
    const primary = createContact({ name: "Jim Fan" });
    const secondary = createContact({ name: "Linxi Fan" });
    const org = createOrg({ name: "NVIDIA", source: "test" });

    createIdentity({
      contactId: secondary.id,
      platform: "x",
      platformUserId: "999",
      platformHandle: "drjimfan",
    });
    createContactChannel({
      contactId: secondary.id,
      channelType: "email",
      value: "jim@nvidia.com",
      source: "test",
    });
    createContactEmployment({
      contactId: secondary.id,
      orgId: org.id,
      title: "Senior Research Scientist",
      source: "test",
    });
    seedInteraction(secondary.id);
    seedTask(secondary.id);
    seedContentItem(secondary.id);

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.merged).toEqual([
      { contactId: secondary.id, name: "Linxi Fan", status: "merged" },
    ]);
    expect(result.moved).toMatchObject({
      contactIdentities: 1,
      contactChannels: 1,
      contactEmployments: 1,
      interactions: 1,
      tasks: 1,
      contentItems: 1,
    });

    // Lossless: nothing still points at the secondary.
    const orphans = {
      identities: db
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, secondary.id))
        .all().length,
      channels: db
        .select()
        .from(contactChannels)
        .where(eq(contactChannels.contactId, secondary.id))
        .all().length,
      employments: db
        .select()
        .from(contactEmployments)
        .where(eq(contactEmployments.contactId, secondary.id))
        .all().length,
      interactions: db
        .select()
        .from(interactions)
        .where(eq(interactions.contactId, secondary.id))
        .all().length,
      tasks: db.select().from(tasks).where(eq(tasks.relatedContactId, secondary.id)).all().length,
      contentItems: db
        .select()
        .from(contentItems)
        .where(eq(contentItems.contactId, secondary.id))
        .all().length,
    };
    expect(orphans).toEqual({
      identities: 0,
      channels: 0,
      employments: 0,
      interactions: 0,
      tasks: 0,
      contentItems: 0,
    });

    expect(
      db.select().from(contactIdentities).where(eq(contactIdentities.contactId, primary.id)).all(),
    ).toHaveLength(1);
  });

  it("tombstones the secondary with merged_into and archived status", () => {
    const primary = createContact({ name: "Sam Altman" });
    const secondary = createContact({ name: "Sam Altman" });

    mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
      options: { reason: "dedupe run 7", workflowRunId: "run_7" },
    });

    const row = db.select().from(contacts).where(eq(contacts.id, secondary.id)).get();
    const metadata = JSON.parse(row?.metadata ?? "{}");
    expect(metadata).toMatchObject({
      archived: 1,
      archiveReason: "dedupe run 7",
      mergedIntoContactId: primary.id,
      mergeWorkflowRunId: "run_7",
    });
    expect(mergedIntoContactId(row?.metadata)).toBe(primary.id);

    // The tombstone is hidden by the existing archived filter, not a new one.
    expect(isContactArchived(row?.metadata)).toBe(true);
    const listed = listContacts().data.map((contact) => contact.id);
    expect(listed).toContain(primary.id);
    expect(listed).not.toContain(secondary.id);
  });

  it("drops a channel the primary already holds instead of violating the unique index", () => {
    const primary = createContact({ name: "Demis Hassabis" });
    const secondary = createContact({ name: "Demis Hassabis" });

    createContactChannel({
      contactId: primary.id,
      channelType: "email",
      value: "demis@deepmind.com",
      source: "test",
    });
    createContactChannel({
      contactId: secondary.id,
      channelType: "email",
      value: "Demis@DeepMind.com",
      source: "test",
    });
    createContactChannel({
      contactId: secondary.id,
      channelType: "email",
      value: "demis@google.com",
      source: "test",
    });

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.dropped).toMatchObject({ contactChannels: 1 });
    expect(result.moved).toMatchObject({ contactChannels: 1 });

    const surviving = db
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, primary.id))
      .all()
      .map((row) => row.valueNormalized)
      .sort();
    expect(surviving).toEqual(["demis@deepmind.com", "demis@google.com"]);
  });

  it("hands the cross-claim identity to the record that had none", () => {
    // The #209 failure mode: the second import was refused the platform claim and
    // was left with zero identities, so it is the one that must not survive.
    const claimHolder = createContact({ name: "Sam Altman" });
    const stranded = createContact({ name: "Sam Altman" });
    createIdentity({
      contactId: claimHolder.id,
      platform: "x",
      platformUserId: "1605",
      platformHandle: "sama",
    });

    const result = mergeContacts({
      primaryContactId: stranded.id,
      secondaryContactIds: [claimHolder.id],
    });

    expect(result.moved).toMatchObject({ contactIdentities: 1 });
    const identities = db
      .select()
      .from(contactIdentities)
      .where(eq(contactIdentities.contactId, stranded.id))
      .all();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.platformUserId).toBe("1605");
  });

  it("keeps a single primary identity after the merge", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    createIdentity({
      contactId: primary.id,
      platform: "x",
      platformUserId: "1",
      isPrimary: 1,
    });
    createIdentity({
      contactId: secondary.id,
      platform: "linkedin",
      platformUserId: "2",
      isPrimary: 1,
    });

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    const primaries = db
      .select()
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, primary.id), eq(contactIdentities.isPrimary, 1)))
      .all();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.platform).toBe("x");
  });

  it("collapses duplicate graph edges and drops the edge between the duplicates", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada L" });

    // Deliberately not works_at: that edge type is rebuilt from employments by
    // projectWorksAtFromEmployments, so it would not survive any merge here.
    seedEdge("engaged_with", primary.id, "content", "item_1");
    seedEdge("engaged_with", secondary.id, "content", "item_1");
    seedEdge("knows", secondary.id, "contact", primary.id);

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.dropped).toMatchObject({ graphEdges: 2 });
    const edges = db.select().from(graphEdges).all();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ edgeType: "engaged_with", srcId: primary.id });
  });

  it("keeps the primary embedding when both sides embed the same kind and model", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    const kept = seedEmbedding(primary.id, "profile", "test-model");
    seedEmbedding(secondary.id, "profile", "test-model");
    seedEmbedding(secondary.id, "persona", "test-model");

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.dropped).toMatchObject({ embeddings: 1 });
    expect(result.moved).toMatchObject({ embeddings: 1 });
    const rows = db
      .select()
      .from(embeddings)
      .where(eq(embeddings.nodeId, primary.id))
      .all()
      .map((row) => row.kind)
      .sort();
    expect(rows).toEqual(["persona", "profile"]);
    expect(
      db.select().from(embeddings).where(eq(embeddings.id, kept)).get()?.nodeId,
    ).toBe(primary.id);
  });

  it("fills only the blanks on the primary and unions tags", () => {
    const primary = createContact({
      name: "Jim Fan",
      firstName: "Jim",
      tags: JSON.stringify(["ai"]),
    });
    const secondary = createContact({
      name: "Linxi Fan",
      firstName: "Linxi",
      lastName: "Fan",
      tags: JSON.stringify(["robotics", "ai"]),
    });

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    const row = db.select().from(contacts).where(eq(contacts.id, primary.id)).get();
    expect(row?.firstName).toBe("Jim");
    expect(row?.lastName).toBe("Fan");
    expect(JSON.parse(row?.tags ?? "[]").sort()).toEqual(["ai", "robotics"]);
  });

  it("folds a same-org stint into the primary instead of stacking a second one", () => {
    const primary = createContact({ name: "Sam Altman" });
    const secondary = createContact({ name: "Sam Altman" });
    const org = createOrg({ name: "OpenAI", source: "test" });
    createContactEmployment({ contactId: primary.id, orgId: org.id, title: "CEO", source: "test" });
    createContactEmployment({ contactId: secondary.id, orgId: org.id, source: "test" });

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.dropped).toMatchObject({ contactEmployments: 1 });
    expect(result.moved.contactEmployments).toBeUndefined();

    const stints = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, primary.id))
      .all();
    expect(stints).toHaveLength(1);
    expect(stints[0]?.title).toBe("CEO");
  });

  it("fills a blank title on the primary from the secondary's stint", () => {
    const primary = createContact({ name: "Sam Altman" });
    const secondary = createContact({ name: "Sam Altman" });
    const org = createOrg({ name: "OpenAI", source: "test" });
    createContactEmployment({ contactId: primary.id, orgId: org.id, source: "test" });
    createContactEmployment({
      contactId: secondary.id,
      orgId: org.id,
      title: "CEO",
      startedAt: 1_600_000_000,
      source: "test",
    });

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    const stints = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, primary.id))
      .all();
    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({ title: "CEO", startedAt: 1_600_000_000 });
  });

  it("keeps a genuinely different stint at the same org", () => {
    const primary = createContact({ name: "Sam Altman" });
    const secondary = createContact({ name: "Sam Altman" });
    const org = createOrg({ name: "OpenAI", source: "test" });
    createContactEmployment({ contactId: primary.id, orgId: org.id, title: "CTO", source: "test" });
    createContactEmployment({
      contactId: secondary.id,
      orgId: org.id,
      title: "VP Engineering",
      source: "test",
    });

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.moved).toMatchObject({ contactEmployments: 1 });
    expect(
      db
        .select()
        .from(contactEmployments)
        .where(eq(contactEmployments.contactId, primary.id))
        .all(),
    ).toHaveLength(2);
  });

  it("keeps the survivor's current employer when the incoming stint cannot prove it is newer", () => {
    // The same two employers, named differently by each source, so they are two org rows and
    // the fold above cannot catch them.
    const primary = createContact({ name: "Fei-Fei Li" });
    const secondary = createContact({ name: "Fei-Fei Li" });
    const richOrg = createOrg({ name: "World Labs / Stanford University", source: "test" });
    const thinOrg = createOrg({ name: "Stanford University / World Labs", source: "test" });
    createContactEmployment({
      contactId: primary.id,
      orgId: richOrg.id,
      title: "Co-Founder & CEO of World Labs, Professor at Stanford",
      source: "test",
    });
    createContactEmployment({
      contactId: secondary.id,
      orgId: thinOrg.id,
      title: "Co-founder & Professor",
      source: "test",
    });

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    expect(resolveCurrentEmployment(primary.id)?.title).toBe(
      "Co-Founder & CEO of World Labs, Professor at Stanford",
    );
    // The duplicate's stint is kept as history, not dropped.
    const stints = db
      .select()
      .from(contactEmployments)
      .where(eq(contactEmployments.contactId, primary.id))
      .all();
    expect(stints).toHaveLength(2);
    expect(stints.find((row) => row.orgId === thinOrg.id)?.isCurrent).toBe(false);
  });

  it("lets a dated stint take over as the current employer", () => {
    const primary = createContact({ name: "Sam Altman" });
    const secondary = createContact({ name: "Sam Altman" });
    const oldOrg = createOrg({ name: "Loopt", source: "test" });
    const newOrg = createOrg({ name: "OpenAI", source: "test" });
    createContactEmployment({
      contactId: primary.id,
      orgId: oldOrg.id,
      title: "Founder",
      source: "test",
    });
    createContactEmployment({
      contactId: secondary.id,
      orgId: newOrg.id,
      title: "CEO",
      startedAt: 1_700_000_000,
      source: "test",
    });

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    expect(resolveCurrentEmployment(primary.id)?.title).toBe("CEO");
  });

  it("never lowers the primary enrichment score", () => {
    // Regression: re-pointing the secondary's thinner same-org stint used to win
    // resolveCurrentEmployment's createdAt tiebreak and cost the survivor its title.
    const primary = createContact({ name: "Sam Altman", email: "sam@openai.com" });
    const org = createOrg({ name: "OpenAI", source: "test" });
    createContactEmployment({ contactId: primary.id, orgId: org.id, title: "CEO", source: "test" });
    createIdentity({
      contactId: primary.id,
      platform: "x",
      platformUserId: "1605",
      platformHandle: "sama",
    });

    const secondary = createContact({ name: "Samuel Altman", email: "sam@openai.com" });
    createContactEmployment({ contactId: secondary.id, orgId: org.id, source: "test" });

    const before =
      db
        .select({ score: contacts.enrichmentScore })
        .from(contacts)
        .where(eq(contacts.id, primary.id))
        .get()?.score ?? 0;

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    expect(result.enrichmentScore).toBeGreaterThanOrEqual(before);
    expect(resolveCurrentEmployment(primary.id)?.title).toBe("CEO");
  });

  it("survives a contact whose tags column is not JSON", () => {
    // contacts.tags is a free-form text column and the API writes it straight
    // through, so a non-JSON value must not abort the whole merge transaction.
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    db.update(contacts)
      .set({ tags: "vip,founder" })
      .where(eq(contacts.id, secondary.id))
      .run();
    seedInteraction(secondary.id);

    expect(() =>
      mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] }),
    ).not.toThrow();
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, primary.id)).all(),
    ).toHaveLength(1);
  });

  it("leaves a non-JSON tags column on the primary alone", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada", tags: JSON.stringify(["b"]) });
    db.update(contacts).set({ tags: "vip,founder" }).where(eq(contacts.id, primary.id)).run();

    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    // Rewriting it as ["b"] would silently discard whatever the column held.
    expect(db.select().from(contacts).where(eq(contacts.id, primary.id)).get()?.tags).toBe(
      "vip,founder",
    );
  });

  it("unions tags across every secondary in an N-way merge", () => {
    const primary = createContact({ name: "Ada", tags: JSON.stringify(["a"]) });
    const first = createContact({ name: "Ada", tags: JSON.stringify(["b"]) });
    const second = createContact({ name: "Ada", tags: JSON.stringify(["c"]) });

    mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [first.id, second.id],
    });

    const tags = JSON.parse(
      db.select().from(contacts).where(eq(contacts.id, primary.id)).get()?.tags ?? "[]",
    ) as string[];
    expect(tags.sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the newest lastInteractionAt across every secondary", () => {
    const primary = createContact({ name: "Ada" });
    const first = createContact({ name: "Ada" });
    const second = createContact({ name: "Ada" });
    const setLast = (id: string, at: number) =>
      db.update(contacts).set({ lastInteractionAt: at }).where(eq(contacts.id, id)).run();
    setLast(primary.id, 100);
    setLast(first.id, 500);
    setLast(second.id, 300);

    mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [first.id, second.id],
    });

    // 300 arriving after 500 must not walk recency backwards.
    expect(
      db.select().from(contacts).where(eq(contacts.id, primary.id)).get()?.lastInteractionAt,
    ).toBe(500);
  });

  it("takes the first non-blank name across an N-way merge", () => {
    const primary = createContact({ name: "Ada" });
    const first = createContact({ name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace" });
    const second = createContact({ name: "Ada Byron", firstName: "Ada", lastName: "Byron" });
    db.update(contacts)
      .set({ firstName: null, lastName: null })
      .where(eq(contacts.id, primary.id))
      .run();

    mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [first.id, second.id],
    });

    const row = db.select().from(contacts).where(eq(contacts.id, primary.id)).get();
    expect(row?.lastName).toBe("Lovelace");
  });

  it("merges all secondaries' graph rows onto the survivor in an N-way merge", () => {
    const primary = createContact({ name: "Ada" });
    const first = createContact({ name: "Ada" });
    const second = createContact({ name: "Ada" });
    seedInteraction(first.id);
    seedInteraction(second.id);
    seedTask(first.id);

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [first.id, second.id],
    });

    expect(result.merged.map((member) => member.status)).toEqual(["merged", "merged"]);
    expect(result.moved).toMatchObject({ interactions: 2, tasks: 1 });
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, primary.id)).all(),
    ).toHaveLength(2);
  });

  it("refuses to archive the workspace owner", () => {
    const owner = createContact({ name: "Me", isSelf: true });
    const other = createContact({ name: "Me" });
    seedInteraction(owner.id);

    const result = mergeContacts({
      primaryContactId: other.id,
      secondaryContactIds: [owner.id],
    });

    expect(result.merged[0]).toMatchObject({
      contactId: owner.id,
      status: "skipped",
      detail: "Contact is the workspace owner; merge the duplicate into it instead",
    });
    // Ownership must survive intact: getOwnerContactId still resolves to a live row.
    expect(getOwnerContactId()).toBe(owner.id);
    expect(mergedIntoContactId(db.select().from(contacts).where(eq(contacts.id, owner.id)).get()?.metadata)).toBeNull();
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, owner.id)).all(),
    ).toHaveLength(1);
  });

  it("merges a duplicate into the owner in the supported direction", () => {
    const owner = createContact({ name: "Me", isSelf: true });
    const duplicate = createContact({ name: "Me" });
    seedInteraction(duplicate.id);

    const result = mergeContacts({
      primaryContactId: owner.id,
      secondaryContactIds: [duplicate.id],
    });

    expect(result.merged[0]?.status).toBe("merged");
    expect(getOwnerContactId()).toBe(owner.id);
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, owner.id)).all(),
    ).toHaveLength(1);
  });

  it("a restored merge tombstone can be merged again", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    mergeContacts({ primaryContactId: primary.id, secondaryContactIds: [secondary.id] });

    restoreContact(secondary.id);
    seedInteraction(secondary.id);

    // Without stripping the merge keys this reports already_merged forever and
    // leaves a live duplicate that can never be consolidated.
    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });
    expect(result.merged[0]?.status).toBe("merged");
    expect(result.moved).toMatchObject({ interactions: 1 });
  });

  it("is idempotent — replaying the same merge changes nothing", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    seedInteraction(secondary.id);

    const first = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });
    expect(first.merged[0]?.status).toBe("merged");
    expect(first.moved.interactions).toBe(1);

    const second = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });
    expect(second.merged).toEqual([
      { contactId: secondary.id, name: "Ada", status: "already_merged", detail: undefined },
    ]);
    expect(second.moved).toEqual({});
    expect(second.dropped).toEqual({});

    expect(
      db.select().from(interactions).where(eq(interactions.contactId, primary.id)).all(),
    ).toHaveLength(1);
  });

  it("follows a tombstone chain so a stale primary still resolves to the survivor", () => {
    const survivor = createContact({ name: "Ada" });
    const middle = createContact({ name: "Ada" });
    const last = createContact({ name: "Ada" });

    mergeContacts({ primaryContactId: survivor.id, secondaryContactIds: [middle.id] });
    seedInteraction(last.id);

    // A staged file that still names `middle` as the primary must not resurrect it.
    const result = mergeContacts({
      primaryContactId: middle.id,
      secondaryContactIds: [last.id],
    });

    expect(result.primaryContactId).toBe(survivor.id);
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, survivor.id)).all(),
    ).toHaveLength(1);
  });

  it("skips a secondary already merged somewhere else", () => {
    const a = createContact({ name: "Ada" });
    const b = createContact({ name: "Ada" });
    const c = createContact({ name: "Grace" });

    mergeContacts({ primaryContactId: a.id, secondaryContactIds: [b.id] });
    const result = mergeContacts({ primaryContactId: c.id, secondaryContactIds: [b.id] });

    expect(result.merged[0]).toMatchObject({
      contactId: b.id,
      status: "skipped",
      detail: `Already merged into ${a.id}`,
    });
    expect(mergedIntoContactId(db.select().from(contacts).where(eq(contacts.id, b.id)).get()?.metadata)).toBe(a.id);
  });

  it("skips a self-merge and a missing contact without touching the graph", () => {
    const primary = createContact({ name: "Ada" });

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [primary.id, "does-not-exist"],
    });

    expect(result.merged).toEqual([
      {
        contactId: primary.id,
        name: "Ada",
        status: "skipped",
        detail: "Secondary is the primary contact",
      },
      { contactId: "does-not-exist", name: "Unknown", status: "skipped", detail: "Contact not found" },
    ]);
    expect(result.moved).toEqual({});
  });

  it("dryRun reports the plan without writing", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    seedInteraction(secondary.id);

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
      options: { dryRun: true },
    });

    expect(result.dryRun).toBe(true);
    expect(result.merged[0]?.status).toBe("merged");
    expect(result.moved).toEqual({});
    expect(mergedIntoContactId(db.select().from(contacts).where(eq(contacts.id, secondary.id)).get()?.metadata)).toBeNull();
    expect(
      db.select().from(interactions).where(eq(interactions.contactId, secondary.id)).all(),
    ).toHaveLength(1);
  });

  it("recalculates the primary enrichment score over the consolidated data", () => {
    const primary = createContact({ name: "Demis Hassabis" });
    const secondary = createContact({ name: "Demis Hassabis" });
    const org = createOrg({ name: "Google DeepMind", source: "test" });

    createIdentity({
      contactId: secondary.id,
      platform: "x",
      platformUserId: "77",
      platformHandle: "demishassabis",
      headline: "CEO, Google DeepMind",
      bio: "Building AGI",
      avatarUrl: "https://example.com/a.png",
      location: "London",
    });
    createContactChannel({
      contactId: secondary.id,
      channelType: "email",
      value: "demis@deepmind.com",
      source: "test",
    });
    createContactEmployment({
      contactId: secondary.id,
      orgId: org.id,
      title: "CEO",
      source: "test",
    });

    const before =
      db
        .select({ score: contacts.enrichmentScore })
        .from(contacts)
        .where(eq(contacts.id, primary.id))
        .get()?.score ?? 0;

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
    });

    // The consolidated identity, email, and employment all have to count.
    expect(result.enrichmentScore).toBeGreaterThan(before);
    expect(
      db.select({ score: contacts.enrichmentScore }).from(contacts).where(eq(contacts.id, primary.id)).get()
        ?.score,
    ).toBe(result.enrichmentScore);
  });

  it("leaves the score untouched when autoRecalculateScore is false", () => {
    const primary = createContact({ name: "Ada" });
    const secondary = createContact({ name: "Ada" });
    createContactChannel({
      contactId: secondary.id,
      channelType: "email",
      value: "ada@example.com",
      source: "test",
    });

    const before =
      db
        .select({ score: contacts.enrichmentScore })
        .from(contacts)
        .where(eq(contacts.id, primary.id))
        .get()?.score ?? 0;

    const result = mergeContacts({
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
      options: { autoRecalculateScore: false },
    });

    expect(result.enrichmentScore).toBe(before);
  });

  it("throws NOT_FOUND for a primary that does not exist", () => {
    expect(() =>
      mergeContacts({ primaryContactId: "nope", secondaryContactIds: ["also-nope"] }),
    ).toThrow(MergeContactsError);
  });
});
