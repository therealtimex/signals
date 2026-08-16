import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { POST } from "@/app/api/contacts/[id]/generate-persona/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertPersona } from "@/lib/db/queries/personas";
import { PersonaGenerationUnavailableError, PersonaSynthesisError } from "@/lib/db/queries/persona-errors";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { db } from "@/lib/db/client";
import { contactPersonas, contentItems, contentPosts, platformAccounts } from "@/lib/db/schema";
import { PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/workflows/generate-persona", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflows/generate-persona")>();
  return {
    ...actual,
    generatePersona: vi.fn(actual.generatePersona),
  };
});

const synthesisFixture = {
  archetype: "Tech Founder",
  tone: "Direct",
  summary: "Building in public",
  interests: ["startups"],
  conversionTriggers: ["case studies"],
  engagementFormats: ["threads"],
  confidence: 0.75,
};

function mockRtxFetch(chatResponses: string[]) {
  let chatIndex = 0;
  return vi.fn(async (url: string) => {
    if (url.includes("/sdk/llm/chat")) {
      const content = chatResponses[chatIndex] ?? chatResponses[chatResponses.length - 1]!;
      chatIndex += 1;
      return {
        ok: true,
        json: async () => ({
          success: true,
          response: {
            content,
            provider: "openai",
            model: "gpt-4o",
            metrics: { prompt_tokens: 120, completion_tokens: 60 },
          },
        }),
      };
    }
    if (url.includes("/sdk/llm/embed")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          embeddings: [Array.from({ length: 4 }, (_, i) => (i + 1) * 0.01)],
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 4,
        }),
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

describe("POST /api/contacts/[id]/generate-persona", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.mocked(generatePersona).mockReset();
    process.env.RTX_APP_ID = "app-1";
    process.env.SERVER_URL = "http://127.0.0.1:3001";
  });

  function seedPlatformAccount() {
    const id = nanoid();
    db.insert(platformAccounts)
      .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
      .run();
    return id;
  }

  function seedEvidenceContact() {
    const contact = createContact({ name: "Persona Subject", platform: "x", platformUserId: nanoid() });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: "founder",
      isActive: 1,
    });

    const now = Math.floor(Date.now() / 1000);
    const itemId = nanoid();
    db.insert(contentItems)
      .values({
        id: itemId,
        contactId: contact.id,
        contentType: "post",
        title: "Post",
        body: "Public content",
        status: "published",
      })
      .run();
    db.insert(contentPosts)
      .values({
        id: nanoid(),
        contentItemId: itemId,
        platformAccountId: seedPlatformAccount(),
        publishedAt: now,
        status: "published",
      })
      .run();

    for (let i = 0; i < 3; i += 1) {
      logInteraction({
        contactId: contact.id,
        interactionType: "like",
        scope: "shared",
        occurredAt: now - 500 + i,
      });
    }

    return contact;
  }

  it("returns 404 for unknown contact", async () => {
    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Contact not found", code: "NOT_FOUND" });
  });

  it("returns 400 VALIDATION_ERROR for malformed JSON", async () => {
    const contact = createContact({ name: "Malformed JSON" });
    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{" }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: {
        formErrors: ["Invalid JSON body"],
        fieldErrors: {},
      },
    });
    expect(generatePersona).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid body", async () => {
    const contact = createContact({ name: "Bad body" });
    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ force: "yes" }),
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns explore projection on successful generation", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);
    vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);

    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ force: false }),
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();
    vi.unstubAllGlobals();

    expect(res.status).toBe(200);
    expect(body.generated).toBe(true);
    expect(body.persona.visibility).toBe("shared");
    expect(body.persona.summary).toBe(synthesisFixture.summary);
    expect(body.workflowRunId).toBeTruthy();
  });

  it("returns skipped response with explore projection when evidence unchanged", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture), JSON.stringify(synthesisFixture)]);

    vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);
    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });
    vi.unstubAllGlobals();

    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ force: false }),
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      generated: false,
      skipped: true,
      reason: "evidence_unchanged",
    });
    expect(body.persona.visibility).toBe("shared");
  });

  it("returns 409 PERSONA_SCOPE_ERROR for local_only persona", async () => {
    const contact = seedEvidenceContact();
    upsertPersona({
      contactId: contact.id,
      archetype: PRIVACY_SENTINELS.personaArchetype,
      scope: "local_only",
    });

    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("PERSONA_SCOPE_ERROR");
  });

  it("returns 409 PERSONA_EVIDENCE_ERROR when evidence is insufficient", async () => {
    const contact = createContact({ name: "No evidence", platform: "x", platformUserId: nanoid() });

    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("PERSONA_EVIDENCE_ERROR");
  });

  it("returns 503 PERSONA_GENERATION_UNAVAILABLE when RTX chat is unavailable", async () => {
    const contact = seedEvidenceContact();
    vi.mocked(generatePersona).mockRejectedValueOnce(
      new PersonaGenerationUnavailableError("RTX_NOT_CONFIGURED", "RTX is not configured"),
    );

    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("PERSONA_GENERATION_UNAVAILABLE");
  });

  it("returns 502 PERSONA_SYNTHESIS_ERROR when synthesis fails", async () => {
    const contact = seedEvidenceContact();
    vi.mocked(generatePersona).mockRejectedValueOnce(
      new PersonaSynthesisError("Persona synthesis output failed validation"),
    );

    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("PERSONA_SYNTHESIS_ERROR");
  });

  it("auto-forces generation when persona projection is age-stale", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture), JSON.stringify(synthesisFixture)]);

    vi.stubGlobal("fetch", fetchImpl as unknown as typeof fetch);
    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const persona = db
      .select()
      .from(contactPersonas)
      .where(eq(contactPersonas.contactId, contact.id))
      .get();
    db.update(contactPersonas)
      .set({ generatedAt: Math.floor(Date.now() / 1000) - PERSONA_STALE_AFTER_SECONDS - 1 })
      .where(eq(contactPersonas.id, persona!.id))
      .run();
    vi.unstubAllGlobals();

    const fetchImpl2 = mockRtxFetch([JSON.stringify(synthesisFixture)]);
    vi.stubGlobal("fetch", fetchImpl2 as unknown as typeof fetch);

    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ force: false }),
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const body = await res.json();
    vi.unstubAllGlobals();

    expect(res.status).toBe(200);
    expect(body.generated).toBe(true);
    expect(body.persona.stale).toBe(false);
  });
});
