import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactIdentities } from "@/lib/contact-identities-api";
import { listIdentitiesByContact } from "@/lib/db/queries/identities";
import { resetCoreTables } from "@/test/db";

describe("createContactIdentities", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("skips empty platformUserId rows and assigns one primary", () => {
    const contact = createContact({ name: "Batch" });

    createContactIdentities(contact.id, [
      { platform: "x", platformUserId: "  " },
      { platform: "linkedin", platformUserId: "li-1", isPrimary: true },
      { platform: "gmail", platformUserId: "gm-1" },
    ]);

    const identities = listIdentitiesByContact(contact.id);
    expect(identities).toHaveLength(2);
    expect(identities.find((identity) => identity.platform === "linkedin")?.isPrimary).toBe(1);
    expect(identities.find((identity) => identity.platform === "gmail")?.isPrimary).toBe(0);
  });
});
