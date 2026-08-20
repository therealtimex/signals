import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublishJobBriefRoutingMessage,
  buildWorkflowRunBriefRoutingMessage,
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
    });
    expect(publishWrite).toEqual({
      success: true,
      relativePath: "publish-jobs/job-99/brief.md",
    });

    expect(
      readFileSync(join(workspaceDir, "workflow-runs/run-42/brief.md"), "utf8")
    ).toBe(workflowBrief);
    expect(
      readFileSync(join(workspaceDir, "publish-jobs/job-99/brief.md"), "utf8")
    ).toBe(publishBrief);
  });

  it("builds short routing messages that point at brief paths", () => {
    expect(buildWorkflowRunBriefRoutingMessage("run-1")).toContain(
      "workflow-runs/run-1/brief.md"
    );
    expect(buildPublishJobBriefRoutingMessage("job-1")).toContain(
      "publish-jobs/job-1/brief.md"
    );
  });

  it("labels the run ordinal so a shared template thread stays readable", () => {
    expect(buildWorkflowRunBriefRoutingMessage("run-1", 3)).toMatch(/^Run #3 — /);
    expect(buildWorkflowRunBriefRoutingMessage("run-1")).not.toContain("Run #");
  });
});
