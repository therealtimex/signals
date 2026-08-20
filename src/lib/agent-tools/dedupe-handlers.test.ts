import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";
import { createContact } from "@/lib/db/queries/contacts";
import { createContactChannel } from "@/lib/db/queries/contact-channels";
import { resetCoreTables } from "@/test/db";

function seedDuplicatePair(email = "sam@openai.com") {
  const primary = createContact({ name: "Sam Altman" });
  const secondary = createContact({ name: "Sam Altman" });
  for (const contact of [primary, secondary]) {
    createContactChannel({
      contactId: contact.id,
      channelType: "email",
      value: email,
      source: "test",
    });
  }
  return { primary, secondary };
}

describe("dedupe agent tools", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("registers find_duplicate_contacts and merge_contacts under contacts", () => {
    const manifest = listAgentToolsManifest();
    const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));

    expect(byName.get("find_duplicate_contacts")?.category).toBe("contacts");
    expect(byName.get("merge_contacts")).toMatchObject({
      category: "contacts",
      parameters: expect.objectContaining({
        type: "object",
        required: expect.arrayContaining(["primaryContactId", "secondaryContactIds"]),
      }),
    });
  });

  it("find_duplicate_contacts reports candidates with a suggested primary", async () => {
    const { primary, secondary } = seedDuplicatePair();

    const result = (await invokeAgentTool("find_duplicate_contacts", {})) as {
      total: number;
      candidates: {
        primaryContactId: string;
        secondaryContactIds: string[];
        tier: number;
        confidence: number;
        contacts: { id: string }[];
      }[];
    };

    expect(result.total).toBe(1);
    const [candidate] = result.candidates;
    expect(candidate.tier).toBe(1);
    expect(candidate.confidence).toBe(1);
    expect(candidate.contacts.map((contact) => contact.id).sort()).toEqual(
      [primary.id, secondary.id].sort(),
    );
    expect([candidate.primaryContactId, ...candidate.secondaryContactIds].sort()).toEqual(
      [primary.id, secondary.id].sort(),
    );
  });

  it("merge_contacts consolidates the pair and clears the duplicate from detection", async () => {
    const { primary, secondary } = seedDuplicatePair();

    const merged = (await invokeAgentTool("merge_contacts", {
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
      options: { autoRecalculateScore: true },
    })) as { primaryContactId: string; merged: { status: string }[]; dryRun: boolean };

    expect(merged.primaryContactId).toBe(primary.id);
    expect(merged.merged).toEqual([expect.objectContaining({ status: "merged" })]);
    expect(merged.dryRun).toBe(false);

    const after = (await invokeAgentTool("find_duplicate_contacts", {})) as { total: number };
    expect(after.total).toBe(0);
  });

  it("merge_contacts honours dryRun", async () => {
    const { primary, secondary } = seedDuplicatePair();

    const preview = (await invokeAgentTool("merge_contacts", {
      primaryContactId: primary.id,
      secondaryContactIds: [secondary.id],
      options: { dryRun: true },
    })) as { dryRun: boolean; moved: Record<string, number> };

    expect(preview.dryRun).toBe(true);
    expect(preview.moved).toEqual({});
    expect(((await invokeAgentTool("find_duplicate_contacts", {})) as { total: number }).total).toBe(
      1,
    );
  });

  it("merge_contacts rejects an empty secondary list", async () => {
    const { primary } = seedDuplicatePair();
    await expect(
      invokeAgentTool("merge_contacts", {
        primaryContactId: primary.id,
        secondaryContactIds: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("merge_contacts surfaces NOT_FOUND for an unknown primary", async () => {
    await expect(
      invokeAgentTool("merge_contacts", {
        primaryContactId: "missing",
        secondaryContactIds: ["also-missing"],
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
