import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent-tools/invoke/route";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities } from "@/lib/db/schema";
import { createIdentity, listIdentitiesByContact } from "@/lib/db/queries/identities";
import { resolveContactWebResearchPrimaryIdentity } from "@/lib/workflows/contact-web-research";
import { resetCoreTables } from "@/test/db";

// #569: remove_contact_identity releases a claim and drops the identity from every lookup, and
// identity writes reject junk handles with a VALIDATION_ERROR naming the platform, value and rule.

async function invoke(tool: string, input: object) {
  const response = await POST(
    new NextRequest("http://localhost/api/agent-tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ tool, input }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function ok(tool: string, input: object) {
  const { status, body } = await invoke(tool, input);
  expect(status, `${tool}: ${JSON.stringify(body)}`).toBe(200);
  return body.result;
}

async function contactCount() {
  return (await ok("query_contacts", { pageSize: 1 })).total as number;
}

/** A junk claim stored before #569, written past the agent-tools checks. */
function seedJunkIdentity(contactId: string, platformUserId = "in") {
  return createIdentity({ contactId, platform: "x", platformUserId, platformHandle: platformUserId });
}

describe("remove_contact_identity (#569)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("releases the claim, drops the identity from every lookup, and lets another contact take the handle", async () => {
    const guest = await ok("create_contact", { name: "First Guest", platform: "linkedin", platformUserId: "first-guest" });
    const junk = seedJunkIdentity(guest.id);

    // Before: the junk claim answers every lookup.
    expect((await ok("resolve_platform_claim", { platform: "x", platformUserId: "in" })).claimed).toBe(true);
    const before = await ok("query_contacts", { platform: "x", platformUserId: "in" });
    expect(before.contacts.map((c: { id: string }) => c.id)).toEqual([guest.id]);

    const removed = await ok("remove_contact_identity", { contactId: guest.id, identityId: junk.id });
    expect(removed).toMatchObject({
      contactId: guest.id,
      removed: { id: junk.id, platform: "x", platformUserId: "in" },
      releasedClaim: { platform: "x", platformUserId: "in" },
      promotedIdentityId: null,
    });

    // After: claims (what import dedupe asks), query_contacts and get_contact are clean.
    expect(await ok("resolve_platform_claim", { platform: "x", platformUserId: "in" })).toMatchObject({ claimed: false });
    expect((await ok("query_contacts", { platform: "x", platformUserId: "in" })).total).toBe(0);
    const contact = await ok("get_contact", { contactId: guest.id });
    expect(contact.identities.map((i: { platform: string; platformUserId: string }) => `${i.platform}/${i.platformUserId}`)).toEqual([
      "linkedin/first-guest",
    ]);
    expect(db.select().from(contactIdentities).where(eq(contactIdentities.id, junk.id)).get()).toBeUndefined();

    // Re-claiming: the right person takes a real handle, and another contact can take "in" itself
    // (it passes X syntax, so only the heuristic stands in the way, and the opt-out clears it).
    await ok("upsert_contact_identity", { contactId: guest.id, platform: "x", platformUserId: "first_guest" });
    const other = await ok("create_contact", { name: "Mr In" });
    const reclaimed = await ok("upsert_contact_identity", {
      contactId: other.id,
      platform: "x",
      platformUserId: "in",
      allowUnusualHandle: true,
    });
    expect(reclaimed.contactId).toBe(other.id);
    expect(await ok("resolve_platform_claim", { platform: "x", platformUserId: "in" })).toMatchObject({
      claimed: true,
      claimant: { kind: "contact", contactId: other.id },
    });
  });

  it("promotes the earliest remaining active identity when the primary is removed, and research follows it", async () => {
    const created = await ok("create_contact", { name: "Primary Person" });
    const primary = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "linkedin", platformUserId: "primary-person", isPrimary: true,
      provenance: { kind: "self_declared" },
    });
    const inactive = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "bluesky", platformUserId: "primary.bsky.social", isActive: false,
    });
    db.update(contactIdentities).set({ createdAt: 1 }).where(eq(contactIdentities.id, inactive.id)).run();
    const x = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "x", platformUserId: "primary_person", provenance: { kind: "inferred" },
    });
    db.update(contactIdentities).set({ createdAt: 2 }).where(eq(contactIdentities.id, x.id)).run();

    expect(resolveContactWebResearchPrimaryIdentity({ identities: listIdentitiesByContact(created.id) }).identity?.id).toBe(primary.id);

    const removed = await ok("remove_contact_identity", { contactId: created.id, identityId: primary.id });
    // The inactive identity is older but is never promoted.
    expect(removed.promotedIdentityId).toBe(x.id);
    const identities = listIdentitiesByContact(created.id);
    expect(identities.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([x.id]);
    expect(resolveContactWebResearchPrimaryIdentity({ identities })).toMatchObject({
      identity: { id: x.id },
      provenanceUsed: "inferred",
    });

    // Removing the last active identity leaves none primary.
    const last = await ok("remove_contact_identity", { contactId: created.id, identityId: x.id });
    expect(last.promotedIdentityId).toBeNull();
    expect(listIdentitiesByContact(created.id).map((i) => [i.id, i.isPrimary])).toEqual([[inactive.id, 0]]);
  });

  // Milestone-verify note (#569): upsert_contact_identity {isPrimary: true} never cleared the other
  // primaries, so legacy contacts can hold two. Removing one must not promote a third.
  it("does not promote when another active primary remains, and research follows that primary", async () => {
    const created = await ok("create_contact", { name: "Two Primaries" });
    const a = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "bluesky", platformUserId: "two.bsky.social",
    });
    db.update(contactIdentities).set({ createdAt: 1 }).where(eq(contactIdentities.id, a.id)).run();
    const b = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "linkedin", platformUserId: "two-primaries", isPrimary: true,
    });
    db.update(contactIdentities).set({ createdAt: 2 }).where(eq(contactIdentities.id, b.id)).run();
    const c = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "x", platformUserId: "two_primaries", isPrimary: true,
      provenance: { kind: "agent_verified" },
    });
    db.update(contactIdentities).set({ createdAt: 3 }).where(eq(contactIdentities.id, c.id)).run();
    expect(listIdentitiesByContact(created.id).filter((i) => i.isPrimary).map((i) => i.id).sort()).toEqual([b.id, c.id].sort());

    const removed = await ok("remove_contact_identity", { contactId: created.id, identityId: b.id });
    expect(removed.promotedIdentityId).toBeNull();
    expect(removed.message).toContain("x/two_primaries is still primary, so nothing was promoted.");
    const identities = listIdentitiesByContact(created.id);
    expect(identities.filter((i) => i.isPrimary).map((i) => i.id)).toEqual([c.id]);
    expect(identities.find((i) => i.id === a.id)?.isPrimary).toBe(0);
    expect(resolveContactWebResearchPrimaryIdentity({ identities })).toMatchObject({
      identity: { id: c.id },
      provenanceUsed: "agent_verified",
    });
  });

  it("still promotes when the only other primary is inactive", async () => {
    const created = await ok("create_contact", { name: "Inactive Primary" });
    const inactivePrimary = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "bluesky", platformUserId: "inactive.bsky.social", isPrimary: true, isActive: false,
    });
    db.update(contactIdentities).set({ createdAt: 1 }).where(eq(contactIdentities.id, inactivePrimary.id)).run();
    const primary = await ok("upsert_contact_identity", {
      contactId: created.id, platform: "linkedin", platformUserId: "inactive-primary", isPrimary: true,
    });
    db.update(contactIdentities).set({ createdAt: 2 }).where(eq(contactIdentities.id, primary.id)).run();
    const x = await ok("upsert_contact_identity", { contactId: created.id, platform: "x", platformUserId: "inactive_prim" });
    db.update(contactIdentities).set({ createdAt: 3 }).where(eq(contactIdentities.id, x.id)).run();

    const removed = await ok("remove_contact_identity", { contactId: created.id, identityId: primary.id });
    expect(removed.promotedIdentityId).toBe(x.id);
    expect(removed.message).not.toContain("still primary");
    expect(resolveContactWebResearchPrimaryIdentity({ identities: listIdentitiesByContact(created.id) }).identity?.id).toBe(x.id);
  });

  it("is scoped to the identity's contact, refuses the self contact, and 404s an unknown identity", async () => {
    const owner = await ok("create_contact", { name: "Owner", platform: "x", platformUserId: "owner_x" });
    const stranger = await ok("create_contact", { name: "Stranger" });
    const [identity] = listIdentitiesByContact(owner.id);

    const wrongContact = await invoke("remove_contact_identity", { contactId: stranger.id, identityId: identity.id });
    expect(wrongContact.status).toBe(404);
    expect(wrongContact.body.code).toBe("NOT_FOUND");
    expect(listIdentitiesByContact(owner.id)).toHaveLength(1);

    const unknownContact = await invoke("remove_contact_identity", { contactId: "no-such-contact", identityId: identity.id });
    expect(unknownContact.body.code).toBe("NOT_FOUND");

    db.update(contacts).set({ isSelf: true }).where(eq(contacts.id, owner.id)).run();
    const self = await invoke("remove_contact_identity", { contactId: owner.id, identityId: identity.id });
    expect(self.body.code).toBe("VALIDATION_ERROR");
    expect(self.body.error).toContain("self contact");
    expect(listIdentitiesByContact(owner.id)).toHaveLength(1);
  });
});

describe("identity value validation on agent-tools writes (#569)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  const junk: Array<[string, Record<string, string>, string]> = [
    ["in", { platformUserId: "in" }, "too_short"],
    ["x", { platformUserId: "x" }, "too_short"],
    ["i", { platformUserId: "i" }, "too_short"],
    ["hi", { platformUserId: "hi" }, "too_short"],
    ["v", { platformUserId: "v" }, "too_short"],
    ["notwitter", { platformUserId: "notwitter" }, "placeholder"],
    ["a LinkedIn URL in the X field", { platformUserId: "trung_rta", platformHandle: "linkedin.com/in/trung-le-rta" }, "foreign_url"],
    ["a LinkedIn URL as the X account", { platformUserId: "https://www.linkedin.com/in/trung-le-rta" }, "foreign_url"],
    ["a LinkedIn platformUrl on an X identity", { platformUserId: "trung_rta", platformUrl: "https://linkedin.com/in/trung-le-rta" }, "foreign_url"],
    ["an account that is only @", { platformUserId: "@" }, "syntax"],
    ["a handle that is only @@ and spaces", { platformUserId: "trung_rta", platformHandle: " @@ " }, "syntax"],
  ];

  it.each(junk)("upsert_contact_identity rejects %s", async (_label, values, rule) => {
    const created = await ok("create_contact", { name: "Guest" });
    const { status, body } = await invoke("upsert_contact_identity", { contactId: created.id, platform: "x", ...values });
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toMatchObject({ platform: "x", rule });
    expect(body.error).toContain(`(rule: ${rule})`);
    expect(listIdentitiesByContact(created.id)).toHaveLength(0);
  });

  it.each(junk)("create_contact rejects %s before writing anything", async (_label, values, rule) => {
    const { body } = await invoke("create_contact", { name: "Guest", platform: "x", ...values });
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toMatchObject({ rule });
    expect(await contactCount()).toBe(0);
  });

  it("create_contact with a junk handle another contact already holds is rejected, not routed to that contact", async () => {
    const first = await ok("create_contact", { name: "First Guest" });
    seedJunkIdentity(first.id);
    const { body } = await invoke("create_contact", { name: "Second Guest", email: "second@example.com", platform: "x", platformUserId: "in" });
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(await contactCount()).toBe(1);
    const firstNow = await ok("get_contact", { contactId: first.id });
    expect(firstNow.email ?? null).toBeNull();
  });

  it("accepts valid handles, numeric account IDs, and an unusual handle with the opt-out", async () => {
    const created = await ok("create_contact", { name: "Valid", platform: "x", platformHandle: "@trung_rta" });
    await ok("upsert_contact_identity", { contactId: created.id, platform: "linkedin", platformUserId: "trung-le-rta", platformUrl: "https://www.linkedin.com/in/trung-le-rta" });
    await ok("upsert_contact_identity", { contactId: created.id, platform: "bluesky", platformUserId: "trung.bsky.social" });
    const jack = await ok("create_contact", { name: "Jack", platform: "x", platformUserId: "12", platformHandle: "jack" });
    const short = await ok("create_contact", { name: "Short", platform: "x", platformUserId: "v", allowUnusualHandle: true });
    expect(jack.id).not.toBe(short.id);
    expect(await ok("resolve_platform_claim", { platform: "x", platformUserId: "v" })).toMatchObject({ claimed: true });
    // The opt-out never covers a hard rule.
    const { body } = await invoke("create_contact", { name: "Url", platform: "x", platformUserId: "linkedin.com/in/url", allowUnusualHandle: true });
    expect(body.details).toMatchObject({ rule: "foreign_url" });
  });

  it("an identity stored with junk before #569 stays readable, updatable in place and removable", async () => {
    const guest = await ok("create_contact", { name: "Legacy Guest" });
    const legacy = seedJunkIdentity(guest.id, "notwitter");

    const read = await ok("get_contact", { contactId: guest.id });
    expect(read.identities.map((i: { platformUserId: string }) => i.platformUserId)).toEqual(["notwitter"]);

    // Same account, same contact: an update in place, not a new claim.
    const updated = await ok("upsert_contact_identity", { contactId: guest.id, platform: "x", platformUserId: "notwitter", bio: "kept" });
    expect(updated).toMatchObject({ id: legacy.id, bio: "kept" });
    await ok("upsert_contact_identity", { contactId: guest.id, id: legacy.id, displayName: "Legacy" });
    // A new junk value on it is still rejected.
    const renamed = await invoke("upsert_contact_identity", { contactId: guest.id, id: legacy.id, platformHandle: "none" });
    expect(renamed.body.details).toMatchObject({ rule: "placeholder" });

    await ok("remove_contact_identity", { contactId: guest.id, identityId: legacy.id });
    expect(listIdentitiesByContact(guest.id)).toHaveLength(0);
  });
});
