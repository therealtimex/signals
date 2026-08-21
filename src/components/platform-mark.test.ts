import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlatformMark } from "@/components/platform-mark";

describe("PlatformMark", () => {
  it("exposes a recognizable X label", () => {
    const html = renderToStaticMarkup(createElement(PlatformMark, { platform: "x" }));
    expect(html).toContain("X / Twitter");
  });

  it("exposes a LinkedIn label", () => {
    const html = renderToStaticMarkup(createElement(PlatformMark, { platform: "linkedin" }));
    expect(html).toContain("LinkedIn");
  });

  it("renders a Facebook logo instead of a letter fallback", () => {
    const html = renderToStaticMarkup(createElement(PlatformMark, { platform: "facebook" }));
    expect(html).toContain("Facebook");
    expect(html).toContain("<svg");
    expect(html).toContain("bg-[#1877F2]");
    expect(html).not.toContain(">F<");
  });
});
