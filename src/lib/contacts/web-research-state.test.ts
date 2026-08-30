import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_WEB_RESEARCH_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import {
  getContactWebResearchState,
} from "@/lib/contacts/web-research-state";
import { shouldRunWebResearch } from "@/lib/contacts/web-research-router";

describe("contact web research state", () => {
  beforeEach(() => resetCoreTables());

  it("returns idle before the seeded template has a contact run", () => {
    seedTemplates();
    expect(getContactWebResearchState("contact-1")).toMatchObject({
      status: "idle",
      workflowRunId: null,
    });
  });

  it("reports a pending matching run", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      config: JSON.stringify({ contactId: "contact-1" }),
    });

    expect(getContactWebResearchState("contact-1")).toMatchObject({
      status: "pending",
      workflowRunId: run.id,
    });
  });

  it("parses a partial completion result", () => {
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({ contactId: "contact-1" }),
      result: JSON.stringify({
        fieldsUpdated: ["bio"],
        unresolvedFields: ["experience"],
        identityLinked: true,
        visitedUrls: ["https://www.linkedin.com/in/ryan"],
        ambiguous: false,
        partial: true,
        serpCandidates: [
          { url: "https://www.linkedin.com/in/ryan", totalScore: 155, reason: "linkedin" },
        ],
        message: "Linked LinkedIn; experience remains unresolved.",
      }),
    });

    expect(getContactWebResearchState("contact-1")).toMatchObject({
      status: "partial",
      fieldsUpdated: ["bio"],
      unresolvedFields: ["experience"],
      identityLinked: true,
      visitedUrls: ["https://www.linkedin.com/in/ryan"],
      serpCandidates: [
        { url: "https://www.linkedin.com/in/ryan", totalScore: 155, reason: "linkedin" },
      ],
    });
  });
});

describe("shouldRunWebResearch", () => {
  beforeEach(() => resetCoreTables());

  it("routes an identity-less sparse contact to web research", () => {
    const contact = createContact({ name: "Sparse Person", enrichmentScore: 20 });
    expect(shouldRunWebResearch(getContactById(contact.id)!)).toBe(true);
  });

  it("keeps a rich linked contact on the profile pipeline", () => {
    const contact = createContact({ name: "Linked Person", enrichmentScore: 80 });
    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "linked-person",
      platformUrl: "https://www.linkedin.com/in/linked-person",
      isActive: 1,
      isPrimary: 1,
    });
    expect(
      shouldRunWebResearch({ ...getContactById(contact.id)!, enrichmentScore: 80 }),
    ).toBe(false);
  });
});
