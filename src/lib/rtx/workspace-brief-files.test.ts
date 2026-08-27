import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPersonaJobBriefRoutingMessage,
  buildPublishJobBriefRoutingMessage,
  buildWorkflowRunBriefRoutingMessage,
  personaJobBriefRelativePath,
  publishJobBriefRelativePath,
  workflowRunBriefRelativePath,
  writeRtxWorkspaceBriefFile,
} from "@/lib/rtx/workspace-brief-files";

describe("workspace brief files", () => {
  it("writes workflow and publish briefs under the workspace working directory", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "signals-brief-"));
    const workspaceSlug = "signals";
    const workspaceDir = join(storageDir, "working-data", workspaceSlug);
    mkdirSync(workspaceDir, { recursive: true });

    const workflowBrief = "# Workflow brief";
    const publishBrief = "# Publish brief";

    const workflowWrite = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      workflowRunBriefRelativePath("run-42"),
      workflowBrief,
      { STORAGE_DIR: storageDir }
    );
    const publishWrite = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      publishJobBriefRelativePath("job-99"),
      publishBrief,
      { STORAGE_DIR: storageDir }
    );

    expect(workflowWrite).toEqual({
      success: true,
      relativePath: "workflow-runs/run-42/brief.md",
      absolutePath: join(workspaceDir, "workflow-runs/run-42/brief.md"),
    });
    expect(publishWrite).toEqual({
      success: true,
      relativePath: "publish-jobs/job-99/brief.md",
      absolutePath: join(workspaceDir, "publish-jobs/job-99/brief.md"),
    });

    expect(
      readFileSync(join(workspaceDir, "workflow-runs/run-42/brief.md"), "utf8")
    ).toBe(workflowBrief);
    expect(
      readFileSync(join(workspaceDir, "publish-jobs/job-99/brief.md"), "utf8")
    ).toBe(publishBrief);
  });

  it("builds Loop-inspired structured handoff routing messages for workflow runs", () => {
    const message = buildWorkflowRunBriefRoutingMessage({
      templateName: "Social Intent Patrol",
      runId: "run-1",
      runNumber: 1,
      absolutePath: "/path/to/workspace/workflow-runs/run-1/brief.md",
    });

    expect(message).toBe([
      "Signals workflow handoff -> Social Intent Patrol",
      "Run: #1 (run-1)",
      "State: ready",
      "Type: workflow-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions.",
      "File: @/path/to/workspace/workflow-runs/run-1/brief.md",
    ].join("\n"));

    // String fallback
    expect(buildWorkflowRunBriefRoutingMessage("run-1")).toContain(
      "File: @workflow-runs/run-1/brief.md"
    );
    expect(buildWorkflowRunBriefRoutingMessage("run-1")).toContain("AGENTS.md");
  });

  it("builds Loop-inspired structured handoff routing messages for publish jobs", () => {
    const message = buildPublishJobBriefRoutingMessage({
      jobId: "job-1",
      title: "AI Agent Migration",
      platforms: ["X", "LinkedIn"],
      absolutePath: "/path/to/workspace/publish-jobs/job-1/brief.md",
    });

    expect(message).toBe([
      "Signals publish handoff -> AI Agent Migration",
      "Job: job-1",
      "Platforms: X, LinkedIn",
      "State: ready",
      "Type: publish-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions.",
      "File: @/path/to/workspace/publish-jobs/job-1/brief.md",
    ].join("\n"));

    // String fallback
    expect(buildPublishJobBriefRoutingMessage("job-1")).toContain(
      "File: @publish-jobs/job-1/brief.md"
    );
    expect(buildPublishJobBriefRoutingMessage("job-1")).toContain("AGENTS.md");
  });

  it("builds a stateless persona-job routing message with the absolute brief path", () => {
    const message = buildPersonaJobBriefRoutingMessage({
      jobId: "pa_1",
      contactId: "contact-1",
      contactName: "Ada Lovelace",
      absolutePath: "/path/to/workspace/persona-jobs/pa_1/brief.md",
    });

    expect(message).toBe([
      "Signals persona handoff -> Ada Lovelace",
      "Job: pa_1",
      "Contact: contact-1",
      "State: ready",
      "Type: persona-brief",
      "Context: Follow workspace guidelines and operating model in AGENTS.md.",
      "Required: Read the brief file before acting and follow its instructions. This job is stateless; ignore all prior jobs and messages in this shared thread.",
      "File: @/path/to/workspace/persona-jobs/pa_1/brief.md",
    ].join("\n"));
    expect(personaJobBriefRelativePath("pa_1")).toBe("persona-jobs/pa_1/brief.md");
  });
});
