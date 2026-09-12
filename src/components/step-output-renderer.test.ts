import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepOutputRenderer } from "@/components/step-output-renderer";

describe("StepOutputRenderer", () => {
  it("renders a clear guest-access boundary instead of an object coercion", () => {
    const html = renderToStaticMarkup(createElement(StepOutputRenderer, {
      output: {
        provider: "luma",
        guestBoundary: { state: "gated", reason: "registration_required" },
      },
      variant: "inline",
    }));

    expect(html).toContain("Guest list gated: event registration is required");
    expect(html).not.toContain("[object Object]");
  });
});
