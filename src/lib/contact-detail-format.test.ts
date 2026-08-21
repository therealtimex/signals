import { describe, expect, it } from "vitest";
import {
  formatAttachmentError,
  formatInteractionType,
  formatLastTouch,
  formatRelationshipStage,
  formatTimelineOccurredAt,
  formatWebsiteLabel,
  hrefForWebsite,
  isRedundantHeadline,
} from "@/lib/contact-detail-format";

describe("formatWebsiteLabel", () => {
  it("strips protocol and trailing slash", () => {
    expect(formatWebsiteLabel("http://blog.samaltman.com/")).toBe("blog.samaltman.com");
  });

  it("keeps a non-root path", () => {
    expect(formatWebsiteLabel("https://example.com/about")).toBe("example.com/about");
  });
});

describe("hrefForWebsite", () => {
  it("adds https when the protocol is missing", () => {
    expect(hrefForWebsite("blog.samaltman.com")).toBe("https://blog.samaltman.com");
  });
});

describe("formatRelationshipStage", () => {
  it("humanizes inner_circle", () => {
    expect(formatRelationshipStage("inner_circle")).toBe("Inner circle");
  });
});

describe("formatLastTouch", () => {
  it("formats a unix timestamp as a short date", () => {
    const timestamp = Math.floor(new Date(2026, 7, 15, 12).getTime() / 1000);
    expect(formatLastTouch(timestamp)).toBe("Aug 15");
  });
});

describe("formatInteractionType", () => {
  it("keeps DM uppercase and humanizes other types", () => {
    expect(formatInteractionType("dm")).toBe("DM");
    expect(formatInteractionType("note")).toBe("Note");
    expect(formatInteractionType("restack")).toBe("Restack");
  });
});

describe("formatTimelineOccurredAt", () => {
  it("formats a unix timestamp as a short datetime", () => {
    const timestamp = Math.floor(new Date(2026, 7, 20, 23, 2).getTime() / 1000);
    expect(formatTimelineOccurredAt(timestamp)).toBe("Aug 20, 11:02 PM");
  });
});

describe("formatAttachmentError", () => {
  it("rewrites MIME rejection into a readable file-type message", () => {
    expect(formatAttachmentError("Unsupported attachment type: image/svg+xml")).toBe(
      "SVG files aren't supported. Try a PNG, JPEG, PDF, or Office file.",
    );
  });
});

describe("isRedundantHeadline", () => {
  it("treats title-at-company as a duplicate of the header line", () => {
    expect(isRedundantHeadline("CEO at OpenAI", "CEO", "OpenAI")).toBe(true);
  });

  it("keeps a distinct headline", () => {
    expect(isRedundantHeadline("Building AGI", "CEO", "OpenAI")).toBe(false);
  });
});
