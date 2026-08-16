import { describe, expect, it } from "vitest";
import { contentDispositionForMime } from "@/lib/media/serving-policy";

describe("contentDispositionForMime", () => {
  it("serves images and PDF inline", () => {
    expect(contentDispositionForMime("image/png", "photo.png")).toBe("inline");
    expect(contentDispositionForMime("application/pdf", "deck.pdf")).toBe("inline");
  });

  it("forces download for SVG, HTML, and office documents", () => {
    expect(contentDispositionForMime("image/svg+xml", "x.svg")).toContain("attachment");
    expect(contentDispositionForMime("text/html", "x.html")).toContain("attachment");
    expect(
      contentDispositionForMime(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "deck.pptx",
      ),
    ).toContain("attachment");
  });
});
