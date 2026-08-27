import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import {
  createPersonaJob,
  getActivePersonaJobForContact,
  getPersonaJobById,
  markPersonaJobCompleted,
  markPersonaJobRunning,
  markPersonaJobSuperseded,
  markPersonaJobTimedOut,
  recordPersonaJobValidationFailure,
} from "@/lib/db/queries/persona-jobs";
import type { PersonaEvidenceProvenance } from "@/lib/db/queries/persona-evidence";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { personaJobs } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

const provenance = (): PersonaEvidenceProvenance => ({
  identityIds: [],
  metricSnapshotAt: {},
  contentItemIds: [],
  interactionWindow: null,
  orgIds: [],
  nicheSlugs: [],
  evidenceHash: "evidence-hash",
  assembledAt: 1_700_000_000,
});

describe("persona job query state machine", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedJob() {
    const contact = createContact({ name: "Persona Job Subject" });
    const run = createWorkflowRun({
      workflowType: "persona",
      status: "running",
      trigger: "user",
    });
    const job = createPersonaJob({
      id: `pa_${contact.id}`,
      contactId: contact.id,
      trigger: "user",
      force: false,
      promptVersion: 1,
      agentPromptVersion: 1,
      evidenceHash: "evidence-hash",
      provenance: provenance(),
      supersededPersonaId: null,
      workflowRunId: run.id,
    });
    return { contact, job, run };
  }

  it("moves queued jobs to running with isolated RTX references", () => {
    const { contact, job } = seedJob();
    const running = markPersonaJobRunning(job.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: "persona-contact-1",
      rtxRuntimeSessionId: "session-1",
      agentModel: "codex:gpt-5.6-sol",
    });

    expect(running).toMatchObject({
      status: "running",
      rtxThreadSlug: "persona-contact-1",
      agentModel: "codex:gpt-5.6-sol",
      threadPath: "/workspace/signals/t/persona-contact-1",
    });
    expect(getActivePersonaJobForContact(contact.id)?.id).toBe(job.id);
  });

  it("keeps one repair attempt then fails when validation attempts are exhausted", () => {
    const { job } = seedJob();
    markPersonaJobRunning(job.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: "thread-1",
      rtxRuntimeSessionId: "",
      agentModel: null,
    });

    const repair = recordPersonaJobValidationFailure(job.id, "invalid one", 2);
    expect(repair).toMatchObject({ status: "running", attempts: 1 });

    const exhausted = recordPersonaJobValidationFailure(job.id, "invalid two", 2);
    expect(exhausted).toMatchObject({
      status: "failed",
      attempts: 2,
      errorCode: "synthesis_invalid",
    });
  });

  it("uses CAS so timeout cannot overwrite a concurrent completion", () => {
    const { job } = seedJob();
    markPersonaJobRunning(job.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: "thread-1",
      rtxRuntimeSessionId: "",
      agentModel: null,
    });
    markPersonaJobCompleted(job.id, { resultPersonaId: "persona-1" });

    const afterTimeoutAttempt = markPersonaJobTimedOut(job.id, "too late");
    expect(afterTimeoutAttempt).toMatchObject({
      status: "completed",
      resultPersonaId: "persona-1",
    });
  });

  it("accepts a late valid completion after timeout", () => {
    const { job } = seedJob();
    markPersonaJobRunning(job.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: "thread-1",
      rtxRuntimeSessionId: "",
      agentModel: null,
    });
    expect(markPersonaJobTimedOut(job.id, "timed out")?.status).toBe("timeout");

    const completed = markPersonaJobCompleted(job.id, { resultPersonaId: "persona-late" });
    expect(completed).toMatchObject({
      status: "completed",
      resultPersonaId: "persona-late",
      error: null,
      errorCode: null,
    });
  });

  it("annotates old active jobs as stale and supersedes them", () => {
    const { job } = seedJob();
    const old = Math.floor(Date.now() / 1000) - 31 * 60;
    db.update(personaJobs).set({ updatedAt: old }).where(eq(personaJobs.id, job.id)).run();

    expect(getPersonaJobById(job.id)?.stale).toBe(true);
    expect(markPersonaJobSuperseded(job.id)?.status).toBe("superseded");
    expect(getPersonaJobById(job.id)?.stale).toBe(false);
  });
});
