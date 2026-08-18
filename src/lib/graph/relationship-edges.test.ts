import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { graphEdges } from "@/lib/db/schema";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { getExploreMap } from "@/lib/db/queries/explore-map";
import {
  projectContactFollowsOwner,
  projectOwnerConnectedTo,
  projectOwnerFollowsContact,
  projectXArchiveRelationships,
} from "@/lib/graph/relationship-edges";
import { resetCoreTables } from "@/test/db";

function seedOwner(name = "Owner") {
  const owner = createContact({ name, platform: "x", platformUserId: "owner-x" });
  updateContact(owner.id, { isSelf: true });
  return owner;
}

beforeEach(() => {
  resetCoreTables();
});

describe("relationship-edges", () => {
  it("skips edge writes when no owner is configured", () => {
    const contact = createContact({ name: "Peer" });
    projectOwnerFollowsContact(contact.id, "sync:x");
    projectContactFollowsOwner(contact.id, "import:x_archive");
    projectOwnerConnectedTo(contact.id, "sync:linkedin");

    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("writes owner → contact follows for X sync", () => {
    const owner = seedOwner();
    const contact = createContact({ name: "Following" });

    projectOwnerFollowsContact(contact.id, "sync:x");

    const edge = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.edgeType, "follows"))
      .get();
    expect(edge).toMatchObject({
      srcId: owner.id,
      dstId: contact.id,
      scope: "shared",
      source: "sync:x",
    });
  });

  it("writes contact → owner follows for archive followers", () => {
    const owner = seedOwner();
    const contact = createContact({ name: "Follower" });

    projectContactFollowsOwner(contact.id, "import:x_archive");

    const edge = db.select().from(graphEdges).get();
    expect(edge).toMatchObject({
      srcId: contact.id,
      dstId: owner.id,
      edgeType: "follows",
      source: "import:x_archive",
    });
  });

  it("collapses mutual follows in explore read model", () => {
    const owner = seedOwner();
    const contact = createContact({ name: "Mutual" });

    projectOwnerFollowsContact(contact.id, "import:x_archive");
    projectContactFollowsOwner(contact.id, "import:x_archive");

    const map = getExploreMap();
    expect(map.meta.totalContacts).toBe(1);
    const followEdge = map.edges.find((edge) => edge.kind === "follows");
    expect(followEdge?.mutual).toBe(true);
  });

  it("writes connected_to with canonical min-id ordering", () => {
    const owner = seedOwner();
    const contact = createContact({ name: "LinkedIn peer" });

    projectOwnerConnectedTo(contact.id, "sync:linkedin");

    const edge = db.select().from(graphEdges).get();
    const [minId, maxId] =
      owner.id < contact.id ? [owner.id, contact.id] : [contact.id, owner.id];
    expect(edge).toMatchObject({
      srcId: minId,
      dstId: maxId,
      edgeType: "connected_to",
      source: "sync:linkedin",
      scope: "shared",
    });
  });

  it("does not create self-edges on the owner's contact", () => {
    const owner = seedOwner();
    projectOwnerFollowsContact(owner.id, "sync:x");
    projectContactFollowsOwner(owner.id, "import:x_archive");
    projectOwnerConnectedTo(owner.id, "sync:linkedin");

    expect(db.select().from(graphEdges).all()).toHaveLength(0);
  });

  it("projectXArchiveRelationships maps follower and following flags", () => {
    const owner = seedOwner();
    const followerOnly = createContact({ name: "Follower only" });
    const followingOnly = createContact({ name: "Following only" });

    projectXArchiveRelationships(followerOnly.id, { follower: true, following: false });
    projectXArchiveRelationships(followingOnly.id, { follower: false, following: true });

    const edges = db.select().from(graphEdges).all();
    expect(edges).toHaveLength(2);
    expect(
      edges.some(
        (edge) =>
          edge.edgeType === "follows" &&
          edge.srcId === followerOnly.id &&
          edge.dstId === owner.id,
      ),
    ).toBe(true);
    expect(
      edges.some(
        (edge) =>
          edge.edgeType === "follows" &&
          edge.srcId === owner.id &&
          edge.dstId === followingOnly.id,
      ),
    ).toBe(true);
  });
});
