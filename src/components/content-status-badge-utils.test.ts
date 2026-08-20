import { describe, expect, it } from "vitest";
import { getContentStatusPresentation } from "@/components/content-status-badge-utils";

describe("getContentStatusPresentation", () => {
  it.each([
    ["draft", { tone: "neutral", label: "Draft" }],
    ["queued", { tone: "neutral", label: "Queued", icon: "clock" }],
    ["publishing", { tone: "info", label: "Publishing", icon: "loader" }],
    ["published", { tone: "success", label: "Published" }],
    ["imported", { tone: "neutral", label: "Imported" }],
    ["failed", { tone: "danger", label: "Failed", icon: "alert" }],
  ])("maps %s to its semantic presentation", (status, expected) => {
    expect(getContentStatusPresentation(status)).toEqual(expected);
  });

  it("suppresses draft when the active view already communicates it", () => {
    expect(getContentStatusPresentation("draft", { activeView: "drafts" })).toBeNull();
  });
});
