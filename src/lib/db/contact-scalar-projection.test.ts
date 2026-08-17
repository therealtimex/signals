import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { getContactById } from "@/lib/db/queries/contacts";
import { resetCoreTables } from "@/test/db";

describe("contact DTO channel shim", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("exposes email and phone from channel rows on the read model", () => {
    const contact = createContact({
      name: "Ada",
      email: "ada@example.com",
      phone: "+1 555 123 4567",
      verifiedEmail: 1,
    });

    const dto = getContactById(contact.id);
    expect(dto?.email).toBe("ada@example.com");
    expect(dto?.phone).toBe("+1 555 123 4567");
    expect(dto?.primaryEmail).toBe("ada@example.com");
    expect(dto?.channels).toHaveLength(2);
  });
});
