// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidatePromoteFields, CandidateReviewDialog } from "./candidate-review-dialog";
import type { QuarantineCandidateItem } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

function buildQuarantineCandidate(
  failureDetails: Record<string, unknown>,
): QuarantineCandidateItem {
  return {
    id: "cand_test",
    workflowRunId: "run_test",
    templateId: "tpl_test",
    platform: "linkedin",
    profileUrl: "https://www.linkedin.com/in/hoangleitvn/",
    profileKey: "linkedin.com/in/hoangleitvn",
    proposedName: "Hoang Le",
    proposedNameKey: "hoang le",
    proposedCompany: "Zalos",
    proposedTitle: "Co-Founder",
    seedType: "contact_id",
    seedValue: "@hoangleitvn",
    status: "identity_unverified",
    failureReason: "profile_corroboration_missing",
    failureMessage: "LinkedIn profile did not corroborate the proposed company.",
    failureDetails,
    failureHistory: [],
    attemptCount: 1,
    lastAttemptAt: 1_800_000_200,
    promotedContactId: null,
    promotedIdentityId: null,
    promotedOrgId: null,
    createdAt: 1_800_000_200,
    updatedAt: 1_800_000_200,
    runStatus: "running",
    agentThread: { state: "none", threadPath: null },
  };
}

describe("CandidateReviewDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows Observed on LinkedIn when attestation stored observedProfile", async () => {
    const candidate = buildQuarantineCandidate({
      observedProfile: {
        headline: "Engineer at Vybe",
        affiliationLine: "Vybe",
        experience: {
          roleTitle: "Senior Engineer",
          roleCompany: "Vybe",
          snippet: "Senior Engineer · Vybe · Full-time · 2022 – Present",
        },
      },
    });

    await act(async () => {
      root.render(createElement(CandidateReviewDialog, {
        candidate,
        open: true,
        onOpenChange: vi.fn(),
      }));
    });

    expect(document.body.textContent).toContain("Observed on LinkedIn (attestation)");
    expect(document.body.textContent).toContain("Engineer at Vybe");
    expect(document.body.textContent).toContain("Vybe");
    expect(document.body.textContent).toContain(
      "Experience: Senior Engineer · Vybe · Full-time · 2022 – Present",
    );
    expect(document.body.textContent).toContain("Zalos");
  });
});
