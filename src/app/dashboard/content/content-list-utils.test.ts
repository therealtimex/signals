import { describe, expect, it } from "vitest";
import {
  getContentOriginView,
  hasNonDefaultContentFilters,
  resetContentListParams,
  shouldActivateContentRow,
  updateContentListParams,
} from "./content-list-utils";

describe("content list URL params", () => {
  it("maps Drafts to status=draft and clears origin/page", () => {
    const params = updateContentListParams(
      new URLSearchParams("origin=authored&platform=x&page=3"),
      "origin",
      "drafts"
    );
    expect(params.toString()).toBe("platform=x&status=draft");
    expect(getContentOriginView(undefined, "draft")).toBe("drafts");
  });

  it("switches away from Drafts and resets pagination", () => {
    const params = updateContentListParams(
      new URLSearchParams("status=draft&platform=linkedin&page=2"),
      "origin",
      "received"
    );
    expect(params.toString()).toBe("platform=linkedin&origin=received");
  });

  it("resets only Content filter and pagination params", () => {
    const params = resetContentListParams(
      new URLSearchParams("origin=received&status=draft&platform=x&page=4&type=post")
    );
    expect(params.toString()).toBe("type=post");
  });

  it("detects non-default filters", () => {
    expect(hasNonDefaultContentFilters()).toBe(false);
    expect(hasNonDefaultContentFilters(undefined, undefined, "all")).toBe(false);
    expect(hasNonDefaultContentFilters("authored", undefined, "all")).toBe(true);
  });
});

describe("Content row keyboard activation", () => {
  it("activates the row with Enter or Space", () => {
    expect(shouldActivateContentRow("Enter", true)).toBe(true);
    expect(shouldActivateContentRow(" ", true)).toBe(true);
  });

  it("ignores other keys and events from nested controls", () => {
    expect(shouldActivateContentRow("Escape", true)).toBe(false);
    expect(shouldActivateContentRow("Enter", false)).toBe(false);
  });
});
