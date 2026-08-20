import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentStatusBadge } from "@/components/content-status-badge";

describe("ContentStatusBadge", () => {
  it("exposes stale guidance from a keyboard-focusable control", () => {
    const html = renderToStaticMarkup(
      createElement(ContentStatusBadge, { status: "publishing", stale: true })
    );

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain(
      'aria-label="Attention: Check the thread — the agent may need input"'
    );
    expect(html).toContain("Attention");
  });
});
