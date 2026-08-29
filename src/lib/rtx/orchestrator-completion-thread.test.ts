import { describe, expect, it } from "vitest";
import { formatOrchestratorDispatchThreadMessage } from "@/lib/rtx/orchestrator-completion-thread";

describe("formatOrchestratorDispatchThreadMessage", () => {
  it("includes parent run, follow-on action, and child runs", () => {
    const message = formatOrchestratorDispatchThreadMessage({
      parentRunId: "run_parent",
      followOnAction: "profile_pipeline",
      targetTemplateName: "Contact profile pipeline",
      childRunIds: ["run_child_1", "run_child_2"],
    });

    expect(message).toContain("**Orchestrator dispatch — Done**");
    expect(message).toContain("run_parent");
    expect(message).toContain("**profile_pipeline**");
    expect(message).toContain("Contact profile pipeline");
    expect(message).toContain("run_child_1");
    expect(message).toContain("run_child_2");
  });
});
