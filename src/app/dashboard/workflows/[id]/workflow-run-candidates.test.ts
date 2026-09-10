import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowRunCandidates } from "./workflow-run-candidates";
import type { SnowballCandidateView } from "@/lib/workflows/snowball-candidates";

const candidate: SnowballCandidateView = {
  id: "candidate-1",
  workflowRunId: "run-1",
  templateId: "template-1",
  platform: "linkedin",
  profileUrl: "https://www.linkedin.com/in/jane-doe/",
  profileKey: "linkedin.com/in/jane-doe",
  proposedName: "Jane Doe",
  proposedNameKey: "jane doe",
  proposedCompany: "Acme",
  proposedTitle: "Founder",
  seedType: "event_url",
  seedValue: "https://example.com/seed",
  status: "identity_unverified",
  failureReason: "profile_corroboration_missing",
  failureMessage: "Company was not visible",
  failureDetails: {},
  failureHistory: [],
  attemptCount: 2,
  lastAttemptAt: 200,
  promotedContactId: null,
  promotedIdentityId: null,
  promotedOrgId: null,
  promotedAt: null,
  createdAt: 100,
  updatedAt: 200,
};

describe("WorkflowRunCandidates", () => {
  it("renders proposed contact/company data as quarantined rather than canonical", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowRunCandidates, { candidates: [candidate] }),
    );

    expect(html).toContain("Candidate quarantine");
    expect(html).toContain("1 awaiting verification");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Founder · Acme");
    expect(html).toContain("profile corroboration missing");
    expect(html).toContain("list_snowball_candidates");
    expect(html).toContain("https://www.linkedin.com/in/jane-doe/");
    expect(html).toContain("/dashboard/quarantine?workflowRunId=run-1");
  });

  it("stays hidden for runs without candidates", () => {
    expect(renderToStaticMarkup(
      createElement(WorkflowRunCandidates, { candidates: [] }),
    )).toBe("");
  });
});
