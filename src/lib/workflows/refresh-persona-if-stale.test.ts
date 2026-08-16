import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import { getActivePersona, upsertPersona } from "@/lib/db/queries/personas";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { refreshPersonaIfStale } from "@/lib/workflows/refresh-persona-if-stale";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";
import { db } from "@/lib/db/client";
import { contactPersonas, contentItems, contentPosts, platformAccounts, workflowRuns } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

const synthesisFixture = {
  archetype: "Tech Founder",
  tone: "Direct",
  summary: "Building in public with a product lens",
  description: "Operator who shares learnings openly",
  interests: ["startups", "devtools"],
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

describe("refreshPersonaIfStale", () => {
  beforeEach(() => {
    resetCoreTables();
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
    for (let i = 0; i < 2; i += 1) {
      const itemId = nanoid();
      db.insert(contentItems)
        .values({
          id: itemId,
          contactId: contact.id,
          contentType: "post",
          title: `Post ${i}`,
          body: `Public content ${i}`,
          status: "published",
        })
        .run();
      db.insert(contentPosts)
        .values({
          id: nanoid(),
          contentItemId: itemId,
          platformAccountId: seedPlatformAccount(),
          publishedAt: now - i * 100,
          status: "published",
        })
        .run();
    }

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

  it("skips fresh personas without LLM calls", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    fetchImpl.mockClear();

    const result = await refreshPersonaIfStale(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(result).toMatchObject({ refreshed: false, skipped: true, reason: "fresh" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.select().from(workflowRuns).all().length).toBe(1);
  });

  it("regenerates when evidence hash drifts", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture), JSON.stringify(synthesisFixture)]);

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const persona = getActivePersona(contact.id)!;
    db.update(contactPersonas)
      .set({
        sourceWindow: JSON.stringify({ evidenceHash: "stale-hash" }),
      })
      .where(eq(contactPersonas.id, persona.id))
      .run();

    fetchImpl.mockClear();

    const result = await refreshPersonaIfStale(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(result.refreshed).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
    expect(db.select().from(workflowRuns).all().length).toBe(2);
  });

  it("regenerates when age exceeds PERSONA_STALE_AFTER_SECONDS", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture), JSON.stringify(synthesisFixture)]);
    const now = 1_800_000_000;

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const persona = getActivePersona(contact.id)!;
    const bundle = assemblePersonaEvidence(contact.id);
    db.update(contactPersonas)
      .set({
        generatedAt: now - PERSONA_STALE_AFTER_SECONDS - 1,
        sourceWindow: JSON.stringify({ evidenceHash: bundle.provenance.evidenceHash }),
      })
      .where(eq(contactPersonas.id, persona.id))
      .run();

    fetchImpl.mockClear();

    const result = await refreshPersonaIfStale(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      now,
    });

    expect(result.refreshed).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("skips contacts without a persona", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    const result = await refreshPersonaIfStale(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(result).toMatchObject({ refreshed: false, skipped: true, reason: "no_persona" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips local_only personas", async () => {
    const contact = seedEvidenceContact();
    upsertPersona({
      contactId: contact.id,
      archetype: "Private",
      scope: "local_only",
    });

    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);
    const result = await refreshPersonaIfStale(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(result).toMatchObject({ refreshed: false, skipped: true, reason: "local_only" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
