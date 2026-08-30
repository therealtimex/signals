import { describe, expect, it } from "vitest";
import {
  buildContactWebResearchBriefSection,
  buildContactWebResearchTemplateConfig,
  getContactWebResearchArppMissing,
  isContactWebResearchTemplateConfig,
  resolveContactWebResearchCascadeTarget,
} from "@/lib/workflows/contact-web-research";
import type { ArppPersonDocument } from "@/lib/arpp/types";
import type { ContactWebResearchBriefContact } from "@/lib/workflows/contact-web-research";

const contact: ContactWebResearchBriefContact = {
  id: "contact-1",
  name: "Ryan Carson",
  company: "Untangle",
  title: "Founder & CEO",
  headline: null,
  location: null,
  website: "https://untangle.ai",
  profileUrl: null,
  enrichmentScore: 20,
  identities: [],
};

describe("Contact Web Research workflow contract", () => {
  it("recognizes the seeded config and conditionally resolves a cascade target", () => {
    const config = { ...buildContactWebResearchTemplateConfig(), contactId: "contact-1" };
    expect(isContactWebResearchTemplateConfig(config)).toBe(true);
    expect(resolveContactWebResearchCascadeTarget(config, { identityLinked: false })).toBeNull();
    expect(resolveContactWebResearchCascadeTarget(config, { identityLinked: true })).toBe(
      "contact-1",
    );
  });

  it("builds a brief with deterministic search, scoring, ambiguity, and tool contracts", () => {
    const brief = buildContactWebResearchBriefSection({
      workflowRunId: "run-1",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: { contact, arppMissing: ["sameAs", "biography", "experience"] },
    });

    expect(brief).toContain("Contact ID: contact-1");
    expect(brief).toContain("Ryan Carson Untangle · Founder & CEO");
    expect(brief).toContain("https://www.google.com/search?q=");
    expect(brief).toContain("workflow-runs/run-1/serp-candidates.json");
    expect(brief).toContain("LinkedIn /in/ +100");
    expect(brief).toContain("totalScore >= 60");
    expect(brief).toContain('"Ryan Carson" "Untangle" linkedin');
    expect(brief).toContain("complete_workflow_run.result");
    expect(brief).toContain("No direct profile URL is linked");
  });

  it("puts a linked profile ahead of Google", () => {
    const brief = buildContactWebResearchBriefSection({
      workflowRunId: "run-2",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: {
        contact: { ...contact, profileUrl: "https://www.linkedin.com/in/ryancarson" },
        arppMissing: [],
      },
    });

    expect(brief).toContain(
      "Open this existing verified profile before Google: https://www.linkedin.com/in/ryancarson",
    );
  });

  it("limits the ARPP checklist to v1 research gaps", () => {
    const profile = {
      sameAs: [],
      experience: [],
      identity: { biography: null, disambiguatingDescription: null },
    } as unknown as ArppPersonDocument;
    expect(getContactWebResearchArppMissing(profile)).toEqual([
      "sameAs (linked public profile)",
      "biography or headline",
      "experience",
    ]);
  });
});
