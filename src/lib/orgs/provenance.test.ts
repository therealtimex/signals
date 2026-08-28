import { describe, expect, it } from "vitest";
import { formatProvenanceLine } from "@/lib/orgs/provenance";

const base = {
  createdWorkflowRunId: null,
  createdTemplateId: null,
  createdTemplateName: null,
  createdAt: 1_700_000_000,
};

describe("formatProvenanceLine", () => {
  it.each([
    [{ createdSource: "manual", createdSourceDetail: "manual:create_org" }, "Manually added"],
    [{ createdSource: "agent", createdSourceDetail: "agent:create_org" }, "Agent added"],
    [{ createdSource: "api", createdSourceDetail: "api:create_org" }, "Added via API"],
    [{ createdSource: null, createdSourceDetail: null, legacySource: "email_domain" }, "Derived from an email domain"],
    [{ createdSource: null, createdSourceDetail: null, legacySource: "backfill:org" }, "Derived from contact records"],
  ] as const)("maps source to human copy", (input, label) => {
    expect(formatProvenanceLine({ ...base, ...input }).label).toBe(label);
  });

  it("keeps the raw tag in secondary detail", () => {
    expect(
      formatProvenanceLine({
        ...base,
        createdSource: "agent",
        createdSourceDetail: "agent:create_contact",
      }),
    ).toMatchObject({ label: "Agent added", sourceDetail: "agent:create_contact" });
  });
});
