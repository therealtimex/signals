import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { getPersonaByWorkflowRunId } from "@/lib/db/queries/personas";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { persistPersonaSynthesis } from "@/lib/persona/generation/persist";
import { resetCoreTables } from "@/test/db";

describe("persistPersonaSynthesis", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("saves the persona and bounds an embedding fetch that ignores abort", async () => {
    const contact = createContact({ name: "Bounded Embedding Subject" });
    const run = createWorkflowRun({
      workflowType: "persona",
      status: "running",
      trigger: "user",
    });
    let aborted = false;
    const fetchImpl = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>(() => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    ) as unknown as typeof fetch;

    const persisted = await persistPersonaSynthesis({
      contactId: contact.id,
      synthesis: {
        archetype: "Technical Founder",
        tone: "Concise",
        summary: "Builds reliable products",
        interests: [],
        conversionTriggers: ["working demos"],
        engagementFormats: ["technical threads"],
        confidence: 0.8,
      },
      bundle: {
        provenance: {
          identityIds: [],
          metricSnapshotAt: {},
          contentItemIds: [],
          interactionWindow: null,
          orgIds: [],
          nicheSlugs: [],
          evidenceHash: "bounded-embedding-evidence",
          assembledAt: 1_700_000_000,
        },
      },
      activePersona: null,
      qualifiedModel: "codex:gpt-test",
      workflowRunId: run.id,
      fetchImpl,
      env: {
        RTX_APP_ID: "signals-app",
        SERVER_URL: "http://127.0.0.1:3101",
      },
      embeddingTimeoutMs: 5,
    });

    expect(aborted).toBe(true);
    expect(persisted).toMatchObject({
      persona: { contactId: contact.id, workflowRunId: run.id },
      embedded: false,
    });
    expect(persisted.embedErrors[0]).toContain("timed out after 5ms");
    expect(getPersonaByWorkflowRunId(run.id)?.id).toBe(persisted.persona.id);
  });
});
