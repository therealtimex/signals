import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import {
  PersonaEvidenceError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import { getActivePersona, upsertPersona } from "@/lib/db/queries/personas";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { db } from "@/lib/db/client";
import {
  contactPersonas,
  contentItems,
  contentPosts,
  embeddings,
  graphEdges,
  platformAccounts,
  workflowRuns,
} from "@/lib/db/schema";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
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

describe("generatePersona", () => {
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

  it("generates persona, workflow run, niches, and embedding", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    const result = await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(result.generated).toBe(true);
    if (!result.generated) return;

    expect(result.embedded).toBe(true);
    expect(result.persona.archetype).toBe(synthesisFixture.archetype);
    expect(result.persona.scope).toBe("shared");
    expect(result.persona.model).toBe("openai:gpt-4o");
    expect(result.persona.workflowRunId).toBe(result.workflowRunId);

    const run = db.select().from(workflowRuns).where(eq(workflowRuns.id, result.workflowRunId)).get();
    expect(run?.workflowType).toBe("persona");
    expect(run?.status).toBe("completed");

    const embeddingRows = db.select().from(embeddings).all();
    expect(embeddingRows.some((row) => row.kind === "persona")).toBe(true);

    const toolPersona = await invokeAgentTool("get_persona", { contactId: contact.id });
    expect(toolPersona).toMatchObject({
      archetype: synthesisFixture.archetype,
      tone: synthesisFixture.tone,
      summary: synthesisFixture.summary,
    });
  });

  it("skips generation when evidence hash is unchanged", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const second = await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(second).toMatchObject({ generated: false, reason: "evidence_unchanged" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(db.select().from(workflowRuns).all().length).toBe(1);
  });

  it("skips generation when interests overlap a pre-existing manual niche edge", async () => {
    const contact = seedEvidenceContact();
    const devtools = ensureNicheByName("devtools", { source: "manual", nicheType: "interest" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: devtools.id,
      edgeType: "belongs_to_niche",
      scope: "shared",
      source: "manual",
    });

    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const manualEdge = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.dstId, devtools.id))
      .get();
    expect(manualEdge?.source).toBe("manual");

    const second = await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(second).toMatchObject({ generated: false, reason: "evidence_unchanged" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(db.select().from(workflowRuns).all().length).toBe(1);
  });

  it("skips generation when interests overlap a source-less legacy niche edge", async () => {
    const contact = seedEvidenceContact();
    const devtools = ensureNicheByName("devtools", { source: "manual", nicheType: "interest" });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: devtools.id,
      edgeType: "belongs_to_niche",
      scope: "shared",
    });

    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);

    await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const legacyEdge = db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.dstId, devtools.id))
      .get();
    expect(legacyEdge?.source).toBeNull();

    const second = await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(second).toMatchObject({ generated: false, reason: "evidence_unchanged" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(db.select().from(workflowRuns).all().length).toBe(1);
  });

  it("aggregates token usage across repair attempts on failed runs", async () => {
    const contact = seedEvidenceContact();
    const fetchImpl = mockRtxFetch(["not-json", "still-not-json"]);

    await expect(
      generatePersona(contact.id, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      }),
    ).rejects.toThrow(PersonaSynthesisError);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const failedRun = db.select().from(workflowRuns).all()[0];
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.inputTokens).toBe(240);
    expect(failedRun?.outputTokens).toBe(120);
  });

  it("refuses when active persona is local_only", async () => {
    const contact = seedEvidenceContact();
    upsertPersona({
      contactId: contact.id,
      archetype: PRIVACY_SENTINELS.personaArchetype,
      scope: "local_only",
    });

    await expect(generatePersona(contact.id)).rejects.toThrow(PersonaScopeError);
    expect(db.select().from(workflowRuns).all()).toHaveLength(0);
  });

  it("refuses before workflow run when evidence is insufficient", async () => {
    const contact = createContact({ name: "No evidence", platform: "x", platformUserId: nanoid() });
    await expect(generatePersona(contact.id)).rejects.toThrow(PersonaEvidenceError);
    expect(db.select().from(workflowRuns).all()).toHaveLength(0);
  });

  it("supersedes prior persona without mutating the old row", async () => {
    const contact = seedEvidenceContact();
    const prior = upsertPersona({
      contactId: contact.id,
      archetype: "Old archetype",
      tone: "Warm",
      summary: "Old summary",
      scope: "shared",
    });

    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);
    const result = await generatePersona(contact.id, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      force: true,
    });

    expect(result.generated).toBe(true);
    if (!result.generated) return;
    expect(result.supersededPersonaId).toBe(prior.id);

    const oldRow = db.select().from(contactPersonas).where(eq(contactPersonas.id, prior.id)).get();
    expect(oldRow?.status).toBe("superseded");
    expect(oldRow?.archetype).toBe("Old archetype");

    const active = getActivePersona(contact.id);
    expect(active?.archetype).toBe(synthesisFixture.archetype);
    assertNoPrivacySentinels(active);
  });
});
