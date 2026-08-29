import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import {
  createPersonaJob,
  markPersonaJobRunning,
} from "@/lib/db/queries/persona-jobs";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import * as personaCompletionThread from "@/lib/rtx/persona-completion-thread";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import { releasePersonaJobTerminalSession } from "@/lib/rtx/persona-terminal-teardown";
import { resetCoreTables } from "@/test/db";

describe("releasePersonaJobTerminalSession", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  function seedJob(sessionId: string) {
    const contact = createContact({ name: `Persona ${nanoid()}` });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: "persona-subject",
      isActive: 1,
    });
    const bundle = assemblePersonaEvidence(contact.id);
    const run = createWorkflowRun({
      workflowType: "persona",
      status: "running",
      trigger: "user",
    });
    const queued = createPersonaJob({
      id: `pa_${nanoid()}`,
      contactId: contact.id,
      trigger: "user",
      force: false,
      promptVersion: 1,
      agentPromptVersion: 1,
      evidenceHash: bundle.provenance.evidenceHash,
      provenance: bundle.provenance,
      supersededPersonaId: null,
      workflowRunId: run.id,
    });
    const job = markPersonaJobRunning(queued.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: `persona-${contact.id}`,
      rtxRuntimeSessionId: sessionId,
      agentModel: "codex:gpt-5.6-sol",
    })!;
    return { contact, job };
  }

  it("skips release while another persona job is active on the same runtime session", async () => {
    const sharedSession = "cli-agent:shared-persona";
    const { job: first } = seedJob(sharedSession);
    seedJob(sharedSession);

    const finalizeSpy = vi.spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession");

    const result = await releasePersonaJobTerminalSession(first, {
      status: "completed",
      summary: "done",
    });

    expect(result.skippedSharedSession).toBe(true);
    expect(result.terminalSessionTeardown).toEqual({ scheduled: false });
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("finalizes the terminal session when no other persona jobs are active", async () => {
    const { job } = seedJob("cli-agent:persona-only");
    vi.spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession").mockResolvedValue({
      browserSessionTeardown: { stopped: [], failed: [] },
      terminalSessionTeardown: { scheduled: true, sessionId: "cli-agent:persona-only" },
    });
    vi.spyOn(personaCompletionThread, "postPersonaCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const result = await releasePersonaJobTerminalSession(job, {
      status: "completed",
      summary: "Archetype: Builder",
    });

    expect(result.skippedSharedSession).toBe(false);
    expect(result.terminalSessionTeardown).toEqual({
      scheduled: true,
      sessionId: "cli-agent:persona-only",
    });
    expect(result.completionThreadMessage).toEqual({ posted: true });
  });
});
