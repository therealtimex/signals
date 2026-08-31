import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createContact } from "@/lib/db/queries/contacts";
import { createWorkflowRun, getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleCompleteWorkflowRun } from "@/lib/agent-tools/handlers";
import * as workflowEvents from "@/lib/webhooks/workflow-events";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLeaseById,
} from "@/lib/leases/session-lease";

const mockWorkflowCompletedEvent: workflowEvents.EmitWorkflowCompletedResult = {
  emitted: true,
  event: {
    event: "workflow.completed",
    runId: "run_test",
    templateId: "tpl_test",
    templateName: "Network Snowball",
    templateType: "search",
    status: "completed",
    createdContactIds: [],
    totalProcessed: 0,
    timestamp: 1,
  },
  routingRecommendation: { suggestedAction: "review", rationale: "test" },
};

function createResearchRun(platform: "linkedin" | "x", leaseId?: string) {
  const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform,
    kind: platform === "x" ? "account" : "profile",
    name: platform === "x" ? "@current" : "/in/current",
    handle: platform === "x" ? "@current" : "/in/current",
    capabilities: ["browse", "publish"],
    source: "test",
  });
  const lease = leaseId
    ? { leaseId, expiresAt: Math.floor(Date.now() / 1000) + 600 }
    : acquireSessionLease(connection.id, {
        holder: "contact-web-research:run",
        targetId: target.id,
        intent: "browse",
        ttlSeconds: 600,
      });
  const run = createWorkflowRun({
    workflowType: "enrich",
    status: "running",
    trigger: "template",
    config: JSON.stringify({
      contactWebResearch: { version: 1 },
      researchTarget: {
        targetId: target.id,
        platform,
        source: "default",
        sessionName: "signals-publish",
        startUrl:
          platform === "x" ? "https://x.com/current" : "https://www.linkedin.com/in/current",
        expectedHandle: target.handle,
        verifiedHandle: target.handle,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1000),
      },
    }),
  });
  return { run, leaseId: lease.leaseId };
}

describe("complete_workflow_run terminal teardown", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("stops browsers and schedules workflow terminal release on completion", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:session-abc",
      }),
    });

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent
    );
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const browserSpy = vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: ["network-snowball"],
      failed: [],
    });
    const scheduleSpy = vi
      .spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease")
      .mockReturnValue({
        scheduled: true,
        sessionId: "cli-agent:session-abc",
      });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Mapped investor cluster",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(browserSpy).toHaveBeenCalledWith({ stopAllRunning: true });
    expect(scheduleSpy).toHaveBeenCalledWith("cli-agent:session-abc");
    expect(result.terminalSessionTeardown).toEqual({
      scheduled: true,
      sessionId: "cli-agent:session-abc",
    });
    expect(result.browserSessionTeardown).toEqual({
      stopped: ["network-snowball"],
      failed: [],
    });
    expect(result.message).toContain(
      "Terminal session release scheduled after the chat-linked turn finishes."
    );
    expect(workflowCompletionThread.postWorkflowCompletionThreadMessage).toHaveBeenCalled();
    expect(result.message).toContain("Browser sessions stopped: network-snowball.");
  });

  it("still completes the workflow when no runtime session is stored", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const run = updateWorkflowRun(
      createWorkflowRun({
        templateId: template.id,
        workflowType: "search",
        status: "running",
        trigger: "template",
        config: JSON.stringify({}),
      }).id,
      {
        config: JSON.stringify({}),
      }
    )!;

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    const scheduleSpy = vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease");

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Done",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(scheduleSpy).toHaveBeenCalledWith(null);
    expect(result.terminalSessionTeardown).toEqual({ scheduled: false });
  });

  it("unions explicit, stored, and birth cohorts while leaving config as fallback only", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });
    const explicit = createContact({ name: "Explicit" });
    const stored = createContact({ name: "Stored" });
    const config = createContact({ name: "Config fallback" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ createdContactIds: [stored.id] }),
      config: JSON.stringify({ targetContactIds: [config.id] }),
    });
    const birth = createContact(
      { name: "Birth" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );

    const emitSpy = vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      createdContactIds: [explicit.id],
    });
    if (!result.success) throw new Error(result.error);

    expect(result.createdContactIds).toEqual([explicit.id, stored.id, birth.id]);
    expect(result.cohortSources).toEqual(["explicit", "stored", "birth"]);
    expect(result.processedItems).toBe(3);
    expect(getWorkflowRun(run.id)?.processedItems).toBe(3);
    expect(emitSpy).toHaveBeenCalledWith(run.id, {
      summary: undefined,
      createdContactIds: [explicit.id, stored.id, birth.id],
    });
  });

  it("preserves an explicitly supplied processed-item count", async () => {
    const first = createContact({ name: "First" });
    const second = createContact({ name: "Second" });
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ createdContactIds: [first.id, second.id] }),
    });

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      processedItems: 1,
    });
    if (!result.success) throw new Error(result.error);

    expect(result.createdContactIds).toEqual([first.id, second.id]);
    expect(result.processedItems).toBe(1);
    expect(getWorkflowRun(run.id)?.processedItems).toBe(1);
  });

  it("persists structured workflow result fields", async () => {
    const run = createWorkflowRun({
      workflowType: "enrich",
      status: "running",
      trigger: "template",
    });
    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      result: {
        fieldsUpdated: ["bio"],
        unresolvedFields: ["experience"],
        identityLinked: true,
        verifiedProfileUrls: ["https://www.linkedin.com/in/example"],
        profileSectionsInspected: ["linkedin_about", "linkedin_experience"],
        emailsObserved: 1,
        experiencesUpserted: 2,
        visitedUrls: ["https://www.linkedin.com/in/example"],
        ambiguous: false,
        partial: true,
      },
    });

    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toMatchObject({
      fieldsUpdated: ["bio"],
      unresolvedFields: ["experience"],
      identityLinked: true,
      verifiedProfileUrls: ["https://www.linkedin.com/in/example"],
      profileSectionsInspected: ["linkedin_about", "linkedin_experience"],
      emailsObserved: 1,
      experiencesUpserted: 2,
      partial: true,
    });
  });

  it("fails a research run on target-platform auth loss and releases its lease", async () => {
    const { run, leaseId } = createResearchRun("linkedin");
    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: ["signals-publish"],
      failed: [],
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      result: {
        visitedUrls: ["https://www.linkedin.com/authwall?trk=foo"],
        identityLinked: false,
      },
    });
    if (!result.success) throw new Error(result.error);

    expect(result.status).toBe("failed");
    expect(result.leaseRelease).toEqual({
      leaseId,
      released: true,
      alreadyGone: false,
    });
    expect(getSessionLeaseById(leaseId)).toBeUndefined();
    const stored = getWorkflowRun(run.id)!;
    expect(JSON.parse(stored.result ?? "{}")).toMatchObject({
      partial: true,
      blockedUrls: ["https://www.linkedin.com/authwall?trk=foo"],
    });
    expect(JSON.parse(stored.errors ?? "[]")).toContain(
      "source_blocked:https://www.linkedin.com/authwall?trk=foo",
    );
  });

  it("keeps cross-source and explicit same-URL blocks partial and tolerates a gone lease", async () => {
    const { run, leaseId } = createResearchRun("x", "lease-already-gone");
    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      result: {
        visitedUrls: ["https://www.linkedin.com/authwall"],
        blockedUrls: ["https://www.google.com/search?q=same-url-captcha"],
      },
    });
    if (!result.success) throw new Error(result.error);

    expect(result.status).toBe("completed");
    expect(result.leaseRelease).toEqual({
      leaseId,
      released: false,
      alreadyGone: true,
    });
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")).toMatchObject({
      partial: true,
      blockedUrls: [
        "https://www.google.com/search?q=same-url-captcha",
        "https://www.linkedin.com/authwall",
      ],
    });
  });

  it("releases the research lease even when browser teardown throws", async () => {
    const { run, leaseId } = createResearchRun("linkedin");
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockRejectedValue(
      new Error("teardown exploded"),
    );

    await expect(
      handleCompleteWorkflowRun({ runId: run.id, status: "failed" }),
    ).rejects.toThrow("teardown exploded");
    expect(getSessionLeaseById(leaseId)).toBeUndefined();
  });
});
