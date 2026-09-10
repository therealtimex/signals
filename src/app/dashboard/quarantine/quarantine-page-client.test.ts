import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CandidateCard } from "./quarantine-page-client";
import {
  failureReasonFilterParam,
  formatCandidateTimestamp,
  statusFilterParam,
  updateQuarantineFilterUrl,
} from "./quarantine-utils";
import type { QuarantineCandidateItem } from "./types";

const candidate: QuarantineCandidateItem = {
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
  runStatus: "completed",
  agentThread: { state: "none", threadPath: null },
};

describe("CandidateCard", () => {
  it("presents quarantined person and company context without implying a CRM record", () => {
    const html = renderToStaticMarkup(createElement(CandidateCard, {
      candidate,
      onReview: vi.fn(),
    }));

    expect(html).toContain("Jane Doe");
    expect(html).toContain("Founder · Acme");
    expect(html).toContain("Needs verification");
    expect(html).toContain("profile corroboration missing");
    expect(html).toContain("Review candidate");
    expect(html).toContain("https://www.linkedin.com/in/jane-doe/");
  });
});

describe("quarantine filter parameters", () => {
  it("keeps All as an explicit status while clearing default status and failure reason", () => {
    expect(statusFilterParam("all")).toBe("all");
    expect(updateQuarantineFilterUrl(
      new URLSearchParams(),
      "status",
      statusFilterParam("all"),
    )).toBe("/dashboard/quarantine?status=all");
    expect(statusFilterParam("identity_unverified")).toBeUndefined();
    expect(failureReasonFilterParam("profile_corroboration_missing"))
      .toBe("profile_corroboration_missing");
    expect(failureReasonFilterParam("all")).toBeUndefined();
    expect(formatCandidateTimestamp(0)).toBe("1970-01-01 00:00 UTC");
  });
});
