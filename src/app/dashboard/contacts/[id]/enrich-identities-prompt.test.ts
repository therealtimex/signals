// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnrichIdentitiesPrompt } from "./enrich-identities-prompt";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function render(email: string | null): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderToStaticMarkup(
    createElement(EnrichIdentitiesPrompt, {
      contactId: "c1",
      contactName: "Bùi Sỹ Giang",
      email,
      needsWebResearch: true,
      profilePipelineTemplateId: null,
    }),
  );
  return wrapper;
}

describe("EnrichIdentitiesPrompt", () => {
  it("names the employer domain when the email has one", () => {
    const prompt = render("bui-sy.giang@mes-engineering.com.vn");
    expect(prompt.textContent).toContain(
      "Enrich public social profiles for Bùi Sỹ Giang at mes-engineering.com.vn?",
    );
    expect(prompt.textContent).toContain(
      "Runs Contact Enrich Profile in RealTimeX and links what it finds here.",
    );
    // The same control as the header, routed to web research.
    expect(prompt.querySelector('[data-enrichment-route="web-research"]')?.textContent).toContain(
      "Enrich profile",
    );
  });

  it("falls back to generic copy for free mail or no email", () => {
    for (const email of ["giang.bui@gmail.com", null]) {
      const text = render(email).textContent ?? "";
      expect(text).toContain("Enrich public social profiles for Bùi Sỹ Giang?");
      expect(text).not.toContain(" at ");
    }
  });
});
