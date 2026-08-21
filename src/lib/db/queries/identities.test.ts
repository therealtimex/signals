import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity, updateIdentity } from "@/lib/db/queries/identities";
import { resetCoreTables } from "@/test/db";

/**
 * Migration 0029 normalized stored handles, but every write boundary — the identities API
 * route, both agent-tools upserts, the Go importer, and the two manual forms — routes through
 * create/update. Without normalization here the storage silently drifts back and the migration
 * undoes itself.
 */
describe("contact identity handle normalization on write", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("strips a sigil a caller typed or pasted into an X handle", () => {
    const contact = createContact({ name: "Manual Entry" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "1275678667",
      platformHandle: "@chickadeedee3",
      isActive: 1,
    });

    expect(identity.platformHandle).toBe("chickadeedee3");
  });

  it("strips a sigil an agent writes back after reading a formatted handle", () => {
    const contact = createContact({ name: "Agent Round Trip" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "1605",
      platformHandle: "sama",
      isActive: 1,
    });

    const updated = updateIdentity(identity.id, { platformHandle: "@sama" });

    expect(updated?.platformHandle).toBe("sama");
  });

  it("leaves a non-X handle exactly as given", () => {
    const contact = createContact({ name: "Gmail Contact" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "gmail",
      platformUserId: "someone@example.com",
      platformHandle: "someone@example.com",
      isActive: 1,
    });

    expect(identity.platformHandle).toBe("someone@example.com");
    expect(updateIdentity(identity.id, { platformHandle: "/in/name" })?.platformHandle)
      .toBe("/in/name");
  });

  it("nulls a handle that was nothing but a sigil, and leaves an untouched field alone", () => {
    const contact = createContact({ name: "Sigil Only" });
    const identity = createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "42",
      platformHandle: "@",
      isActive: 1,
    });
    expect(identity.platformHandle).toBeNull();

    const seeded = updateIdentity(identity.id, { platformHandle: "@person42" });
    expect(seeded?.platformHandle).toBe("person42");

    // An update that does not mention the handle must not disturb it.
    const untouched = updateIdentity(identity.id, { displayName: "Person 42" });
    expect(untouched?.platformHandle).toBe("person42");
  });
});
