import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listContacts } from "@/lib/db/queries/contacts";
import { resetCoreTables } from "@/test/db";

// recalcEnrichment is the last write create_contact makes, after the contact insert, the
// identity upsert and the field merges. Failing its final call simulates any post-insert failure.
// `skip` lets earlier calls (e.g. the identity upsert's own recalculation) through first.
const failRecalc = vi.hoisted(() => ({ next: false, skip: 0, calls: 0 }));

vi.mock("@/lib/db/queries/contacts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/queries/contacts")>();
  return {
    ...original,
    recalcEnrichment: (...args: Parameters<typeof original.recalcEnrichment>) => {
      failRecalc.calls += 1;
      if (failRecalc.next && failRecalc.skip > 0) {
        failRecalc.skip -= 1;
      } else if (failRecalc.next) {
        failRecalc.next = false;
        throw new Error("simulated post-insert failure");
      }
      return original.recalcEnrichment(...args);
    },
  };
});

function contactsNamed(name: string) {
  return listContacts({ search: name, pageSize: 50 }).data.filter((c) => c.name === name);
}

describe("create_contact is atomic outside Snowball (#568)", () => {
  beforeEach(() => {
    resetCoreTables();
    failRecalc.next = false;
    failRecalc.skip = 0;
  });

  afterEach(() => {
    failRecalc.next = false;
  });

  it("rolls back the contact and its identity when a write after the insert fails, so a retry creates exactly one", async () => {
    const input = {
      name: "Atomic Row",
      platform: "x",
      platformUserId: "atomic_row",
      notes: "cohort import",
      provenance: { kind: "self_declared", sourceUrl: "https://lu.ma/user/atomic" },
    };

    failRecalc.next = true;
    await expect(invokeAgentTool("create_contact", input)).rejects.toThrow(
      "simulated post-insert failure",
    );
    expect(contactsNamed("Atomic Row")).toHaveLength(0);
    expect(await invokeAgentTool("resolve_platform_claim", { platform: "x", platformUserId: "atomic_row" }))
      .toEqual({ claimed: false });

    const retried = (await invokeAgentTool("create_contact", input)) as {
      id: string;
      isExisting: boolean;
      identityProvenanceWrite?: string;
    };
    expect(retried.isExisting).toBe(false);
    expect(retried.identityProvenanceWrite).toBe("applied");
    expect(contactsNamed("Atomic Row")).toHaveLength(1);
    expect(await invokeAgentTool("resolve_platform_claim", { platform: "x", platformUserId: "atomic_row" }))
      .toMatchObject({ claimed: true, claimant: { kind: "contact", contactId: retried.id } });
  });

  it("rolls back the existing-contact enrichment branch too", async () => {
    const created = (await invokeAgentTool("create_contact", {
      name: "Matched Row",
      platform: "x",
      platformUserId: "matched_row",
    })) as { id: string };

    // Calibrate: count the recalculations a successful matched create makes on a twin contact,
    // then fail only the last one, after the bio has been written.
    await invokeAgentTool("create_contact", { name: "Twin Row", platform: "x", platformUserId: "twin_row" });
    failRecalc.calls = 0;
    await invokeAgentTool("create_contact", {
      name: "Twin Row",
      platform: "x",
      platformUserId: "twin_row",
      bio: "Builds things",
    });
    expect(failRecalc.calls).toBeGreaterThan(0);
    failRecalc.skip = failRecalc.calls - 1;

    failRecalc.next = true;
    await expect(
      invokeAgentTool("create_contact", {
        name: "Matched Row",
        platform: "x",
        platformUserId: "matched_row",
        bio: "Builds things",
      }),
    ).rejects.toThrow("simulated post-insert failure");

    const contact = (await invokeAgentTool("get_contact", { contactId: created.id })) as {
      bio: string | null;
    };
    expect(contact.bio ?? null).toBeNull();
    expect(contactsNamed("Matched Row")).toHaveLength(1);
  });
});
