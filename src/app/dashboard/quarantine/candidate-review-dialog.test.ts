import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CandidatePromoteFields } from "./candidate-review-dialog";

describe("CandidatePromoteFields", () => {
  it("asks the operator to confirm the LinkedIn identity before promoting", () => {
    const html = renderToStaticMarkup(createElement(CandidatePromoteFields, {
      name: "Jane Doe",
      title: "Founder",
      company: "Acme",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      confirmed: false,
      onNameChange: vi.fn(),
      onTitleChange: vi.fn(),
      onCompanyChange: vi.fn(),
      onProfileUrlChange: vi.fn(),
      onConfirmedChange: vi.fn(),
    }));

    expect(html).toContain("Promote to contacts and companies");
    expect(html).toContain("I opened this LinkedIn profile and confirm this identity");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("https://www.linkedin.com/in/jane-doe/");
    expect(html).toContain("does not mint LinkedIn identity evidence");
  });
});
