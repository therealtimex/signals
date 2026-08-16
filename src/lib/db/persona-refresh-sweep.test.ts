import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import { upsertPersona } from "@/lib/db/queries/personas";
import { generatePersona } from "@/lib/workflows/generate-persona";
import {
  PERSONA_REFRESH_BATCH,
  PERSONA_REFRESH_JOB_TYPE,
  resolvePersonaRefreshBatchSize,
  runPersonaRefreshSweep,
} from "@/lib/db/persona-refresh-sweep";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";
import { executeScheduledJob } from "@/lib/scheduler/runner";
import { getScheduledJob } from "@/lib/db/queries/scheduled-jobs";
import { db } from "@/lib/db/client";
import {
  contactPersonas,
  contentItems,
  contentPosts,
  platformAccounts,
  scheduledJobs,
  workflowRuns,
} from "@/lib/db/schema";
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

describe("persona refresh sweep", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("resolvePersonaRefreshBatchSize enforces the hard cap at 10", () => {
    expect(resolvePersonaRefreshBatchSize()).toBe(PERSONA_REFRESH_BATCH);
    expect(resolvePersonaRefreshBatchSize(5)).toBe(5);
    expect(resolvePersonaRefreshBatchSize(100)).toBe(PERSONA_REFRESH_BATCH);
    expect(resolvePersonaRefreshBatchSize(0)).toBe(PERSONA_REFRESH_BATCH);
    expect(resolvePersonaRefreshBatchSize(-1)).toBe(PERSONA_REFRESH_BATCH);
  });

  function seedPlatformAccount() {
    const id = nanoid();
    db.insert(platformAccounts)
      .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
      .run();
    return id;
  }

  function seedEvidenceContact(name: string) {
    const contact = createContact({ name, platform: "x", platformUserId: nanoid() });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: name.toLowerCase().replace(/\s+/g, "-"),
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
        body: `Public content for ${name}`,
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

    logInteraction({
      contactId: contact.id,
      interactionType: "like",
      scope: "shared",
      occurredAt: now,
    });

    return contact;
  }

  async function seedSharedPersona(contactId: string, generatedAt: number) {
    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture)]);
    await generatePersona(contactId, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    const persona = db
      .select()
      .from(contactPersonas)
      .where(eq(contactPersonas.contactId, contactId))
      .get();
    if (persona) {
      db.update(contactPersonas)
        .set({ generatedAt })
        .where(eq(contactPersonas.id, persona.id))
        .run();
    }
  }

  it("processes oldest shared personas first and caps batch size", async () => {
    const now = 2_000_000_000;
    const contacts = Array.from({ length: 12 }, (_, i) => seedEvidenceContact(`Contact ${i}`));

    for (let i = 0; i < contacts.length; i += 1) {
      await seedSharedPersona(contacts[i]!.id, now - (contacts.length - i) * 1_000);
    }

    const localOnlyContact = seedEvidenceContact("Local Only");
    upsertPersona({
      contactId: localOnlyContact.id,
      archetype: "Private",
      scope: "local_only",
    });

    seedEvidenceContact("No Persona");

    const staleAt = now - PERSONA_STALE_AFTER_SECONDS - 1;
    for (const contact of contacts) {
      const persona = db
        .select()
        .from(contactPersonas)
        .where(eq(contactPersonas.contactId, contact.id))
        .get();
      if (persona) {
        const bundle = assemblePersonaEvidence(contact.id);
        db.update(contactPersonas)
          .set({
            generatedAt: staleAt,
            sourceWindow: JSON.stringify({ evidenceHash: bundle.provenance.evidenceHash }),
          })
          .where(eq(contactPersonas.id, persona.id))
          .run();
      }
    }

    const chatResponses = Array.from({ length: 20 }, () => JSON.stringify(synthesisFixture));
    const fetchImpl = mockRtxFetch(chatResponses);

    const report = await runPersonaRefreshSweep({
      batchSize: PERSONA_REFRESH_BATCH,
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(report.contactsConsidered).toBe(PERSONA_REFRESH_BATCH);
    expect(report.contactsRefreshed).toBe(PERSONA_REFRESH_BATCH);

    const sweepRun = db.select().from(workflowRuns).where(eq(workflowRuns.id, report.workflowRunId)).get();
    expect(sweepRun?.workflowType).toBe("persona");

    const childRuns = db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.parentWorkflowId, report.workflowRunId))
      .all();
    expect(childRuns.length).toBe(PERSONA_REFRESH_BATCH);

    const localOnlyRuns = childRuns.filter((run) => {
      const config = JSON.parse(run.config ?? "{}") as { contactId?: string };
      return config.contactId === localOnlyContact.id;
    });
    expect(localOnlyRuns).toHaveLength(0);
  });

  it("ignores caller batch sizes above PERSONA_REFRESH_BATCH", async () => {
    const now = 2_000_000_000;
    const contacts = Array.from({ length: 12 }, (_, i) => seedEvidenceContact(`Oversize ${i}`));

    for (let i = 0; i < contacts.length; i += 1) {
      await seedSharedPersona(contacts[i]!.id, now - (contacts.length - i) * 1_000);
    }

    const staleAt = now - PERSONA_STALE_AFTER_SECONDS - 1;
    for (const contact of contacts) {
      const persona = db
        .select()
        .from(contactPersonas)
        .where(eq(contactPersonas.contactId, contact.id))
        .get();
      if (persona) {
        const bundle = assemblePersonaEvidence(contact.id);
        db.update(contactPersonas)
          .set({
            generatedAt: staleAt,
            sourceWindow: JSON.stringify({ evidenceHash: bundle.provenance.evidenceHash }),
          })
          .where(eq(contactPersonas.id, persona.id))
          .run();
      }
    }

    const fetchImpl = mockRtxFetch(
      Array.from({ length: 20 }, () => JSON.stringify(synthesisFixture)),
    );

    const report = await runPersonaRefreshSweep({
      batchSize: 100,
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
    });

    expect(report.contactsConsidered).toBe(PERSONA_REFRESH_BATCH);

    const childRuns = db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.parentWorkflowId, report.workflowRunId))
      .all();
    expect(childRuns.length).toBe(PERSONA_REFRESH_BATCH);
  });

  it("dispatches maintenance:persona-refresh via scheduler", async () => {
    const contact = seedEvidenceContact("Scheduled");
    const now = 2_000_000_000;
    await seedSharedPersona(contact.id, now - PERSONA_STALE_AFTER_SECONDS - 1);

    const persona = db
      .select()
      .from(contactPersonas)
      .where(eq(contactPersonas.contactId, contact.id))
      .get();
    const bundle = assemblePersonaEvidence(contact.id);
    db.update(contactPersonas)
      .set({
        generatedAt: now - PERSONA_STALE_AFTER_SECONDS - 1,
        sourceWindow: JSON.stringify({ evidenceHash: bundle.provenance.evidenceHash }),
      })
      .where(eq(contactPersonas.id, persona!.id))
      .run();

    const jobId = nanoid();
    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: PERSONA_REFRESH_JOB_TYPE,
        status: "pending",
        runAt: now - 10,
        enabled: 1,
        payload: JSON.stringify({ batchSize: 100 }),
      })
      .run();

    const fetchImpl = mockRtxFetch([JSON.stringify(synthesisFixture), JSON.stringify(synthesisFixture)]);
    vi.stubGlobal(
      "fetch",
      fetchImpl as unknown as typeof fetch,
    );

    executeScheduledJob(jobId);
    await vi.waitFor(() => {
      expect(getScheduledJob(jobId)?.status).toBe("completed");
    });

    vi.unstubAllGlobals();
  });
});
