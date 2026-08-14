import { beforeEach, describe, expect, it } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { getActivePersona, upsertPersona } from "@/lib/db/queries/personas";
import { db } from "@/lib/db/client";
import { contactPersonas } from "@/lib/db/schema";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { resetCoreTables } from "@/test/db";

describe("contact personas", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("supersedes prior active persona on upsert", () => {
    const contact = createContact({ name: "Persona Subject", platform: "x", platformUserId: "p1" });

    const first = upsertPersona({
      contactId: contact.id,
      archetype: "Founder",
      tone: "Direct",
      summary: "First version",
    });
    const second = upsertPersona({
      contactId: contact.id,
      archetype: "Operator",
      tone: "Warm",
      summary: "Second version",
    });

    expect(second.id).not.toBe(first.id);
    expect(getActivePersona(contact.id)?.archetype).toBe("Operator");

    const rows = db.select().from(contactPersonas).all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "superseded")).toHaveLength(1);
  });

  it("hides local_only persona unless includeLocalOnly is set", () => {
    const contact = createContact({ name: "Private Persona", platform: "x", platformUserId: "p2" });

    upsertPersona({
      contactId: contact.id,
      archetype: "Private archetype",
      scope: "local_only",
    });

    expect(getActivePersona(contact.id)).toBeUndefined();
    expect(getActivePersona(contact.id, { includeLocalOnly: true })?.archetype).toBe(
      "Private archetype",
    );
  });
});

describe("get_persona agent tool", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns persona via agent-tools invoke", async () => {
    const contact = createContact({ name: "Tool Persona", platform: "x", platformUserId: "p3" });

    await invokeAgentTool("upsert_persona", {
      contactId: contact.id,
      archetype: "Builder",
      interests: ["devtools", "startups"],
    });

    const result = await invokeAgentTool("get_persona", { contactId: contact.id });
    expect(result).toMatchObject({
      archetype: "Builder",
      interests: ["devtools", "startups"],
    });
  });

  it("rejects upsert_persona with only contactId", async () => {
    const contact = createContact({ name: "Guarded", platform: "x", platformUserId: "p4" });

    await invokeAgentTool("upsert_persona", {
      contactId: contact.id,
      archetype: "Founder",
    });

    await expect(invokeAgentTool("upsert_persona", { contactId: contact.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const persona = await invokeAgentTool("get_persona", { contactId: contact.id });
    expect(persona).toMatchObject({ archetype: "Founder" });
  });

  it("merges partial persona updates with the active persona", async () => {
    const contact = createContact({ name: "Partial", platform: "x", platformUserId: "p5" });

    await invokeAgentTool("upsert_persona", {
      contactId: contact.id,
      archetype: "Founder",
      tone: "Direct",
    });

    await invokeAgentTool("upsert_persona", {
      contactId: contact.id,
      tone: "Warm",
    });

    const result = await invokeAgentTool("get_persona", { contactId: contact.id });
    expect(result).toMatchObject({
      archetype: "Founder",
      tone: "Warm",
    });
  });
});
