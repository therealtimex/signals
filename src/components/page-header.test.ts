import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/page-header";

describe("PageHeader", () => {
  it("renders title, description, and actions on the server", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Content",
        description: "Browse and manage content.",
        actions: createElement("button", null, "Compose"),
      })
    );

    expect(html).toContain("<h1");
    expect(html).toContain("text-heading-1");
    expect(html).toContain("Content");
    expect(html).toContain("Browse and manage content.");
    expect(html).toContain("Compose");
  });
});
