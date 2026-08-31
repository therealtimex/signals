import { describe, expect, it } from "vitest";
import {
  buildContactWebResearchBriefSection,
  buildContactWebResearchTemplateConfig,
  getContactWebResearchArppMissing,
  isContactWebResearchTemplateConfig,
  resolveContactWebResearchCascadeTarget,
  resolveContactWebResearchKnownProfileCandidates,
} from "@/lib/workflows/contact-web-research";
import type { ArppPersonDocument } from "@/lib/arpp/types";
import type { ContactWebResearchBriefContact } from "@/lib/workflows/contact-web-research";
import type { ContactWebResearchPreparedTarget } from "@/lib/workflows/contact-web-research-target";
import { resolveTemplateThreadName } from "@/lib/workflows/template-brief";

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

const researchTarget: ContactWebResearchPreparedTarget = {
  targetId: "target-linkedin",
  platform: "linkedin",
  source: "default",
  sessionName: "signals-publish",
  startUrl: "https://www.linkedin.com/in/current",
  expectedHandle: "/in/current",
  verifiedHandle: "/in/current",
  leaseId: "lease-research",
  leaseExpiresAt: 1_800_000_000,
  preparedAt: 1_799_999_400,
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
      context: {
        contact,
        arppMissing: ["sameAs", "biography", "experience"],
        researchTarget,
      },
    });

    expect(brief).toContain("Contact ID: contact-1");
    expect(brief).toContain("Ryan Carson Untangle · Founder & CEO");
    expect(brief).toContain("https://www.google.com/search?q=");
    expect(brief).toContain("workflow-runs/run-1/serp-candidates.json");
    expect(brief).toContain("LinkedIn /in/ +100");
    expect(brief).toContain("totalScore >= 60");
    expect(brief).toContain('"Ryan Carson" "Untangle" linkedin');
    expect(brief).toContain("complete_workflow_run.result");
    expect(brief).toContain("No safe direct profile URL can be derived");
    expect(brief).toContain("Session name: signals-publish");
    expect(brief).toContain("Target ID: target-linkedin");
    expect(brief).toContain("Lease ID: lease-research");
    expect(brief).toContain("--compact=false");
    expect(brief).toContain("Ignore devtools://");
    expect(brief).toContain("Never run create-browser-session");
    expect(brief).toContain("result.blockedUrls");
    expect(brief).not.toContain("Open this in RealTimeX Browser");
  });

  it("puts a linked profile ahead of Google", () => {
    const brief = buildContactWebResearchBriefSection({
      workflowRunId: "run-2",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: {
        contact: { ...contact, profileUrl: "https://www.linkedin.com/in/ryancarson" },
        arppMissing: [],
        researchTarget,
      },
    });

    expect(brief).toContain("Open and verify every candidate below");
    expect(brief).toContain(
      "URL (contact): https://www.linkedin.com/in/ryancarson",
    );
    expect(brief.indexOf("https://www.linkedin.com/in/ryancarson")).toBeLessThan(
      brief.indexOf("### Hop 0a — search"),
    );
  });

  it("derives and prioritizes a handle-only X identity for William", () => {
    const william = {
      ...contact,
      name: "William",
      company: "Latitude.so",
      title: "Developer Relations",
      identities: [
        {
          id: "identity-william-x",
          platform: "x",
          platformUserId: "WillyDevRel",
          platformHandle: "WillyDevRel",
          platformUrl: null,
          isPrimary: 0,
          isActive: 1,
        } as ContactWebResearchBriefContact["identities"][number],
      ],
    };

    expect(resolveContactWebResearchKnownProfileCandidates(william)).toEqual([
      expect.objectContaining({
        identityId: "identity-william-x",
        platform: "x",
        platformHandle: "WillyDevRel",
        url: "https://x.com/WillyDevRel",
        source: "derived",
      }),
    ]);

    const brief = buildContactWebResearchBriefSection({
      workflowRunId: "run-william",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: william.id },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: {
        contact: william,
        arppMissing: ["sameAs", "biography", "experience"],
        researchTarget: { ...researchTarget, platform: "x" },
      },
    });

    expect(brief).toContain("URL (derived): https://x.com/WillyDevRel");
    expect(brief).toContain(
      "William Latitude.so · Developer Relations @WillyDevRel",
    );
    expect(brief).toContain('"William" "Latitude.so" "@WillyDevRel" linkedin');
    expect(brief).toContain("strongest full display name verified on a known profile");
    expect(brief).toContain("exact outbound LinkedIn /in/ link");
    expect(brief).toContain("Do not stop merely because an X identity was already stored");
    expect(brief.indexOf("https://x.com/WillyDevRel")).toBeLessThan(
      brief.indexOf("### Hop 0a — search"),
    );
  });

  it("visits all active known identities and rejects unsafe derived handles", () => {
    const identities = [
      {
        id: "identity-x",
        platform: "x",
        platformUserId: "1234567890",
        platformHandle: "WillyDevRel",
        platformUrl: null,
        isPrimary: 1,
        isActive: 1,
      },
      {
        id: "identity-linkedin",
        platform: "linkedin",
        platformUserId: "opaque-linkedin-id",
        platformHandle: "/in/williamisaacbeckes",
        platformUrl: "https://www.linkedin.com/in/williamisaacbeckes/",
        isPrimary: 0,
        isActive: 1,
      },
      {
        id: "identity-unsafe-linkedin",
        platform: "linkedin",
        platformUserId: "another-opaque-id",
        platformHandle: "William Isaac Beckes",
        platformUrl: null,
        isPrimary: 0,
        isActive: 1,
      },
      {
        id: "identity-inactive",
        platform: "x",
        platformUserId: "inactive",
        platformHandle: "inactive",
        platformUrl: null,
        isPrimary: 0,
        isActive: 0,
      },
    ] as ContactWebResearchBriefContact["identities"];

    const candidates = resolveContactWebResearchKnownProfileCandidates({
      ...contact,
      identities,
    });

    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "https://x.com/WillyDevRel",
      "https://www.linkedin.com/in/williamisaacbeckes/",
    ]);

    const brief = buildContactWebResearchBriefSection({
      workflowRunId: "run-known-identities",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: {
        contact: { ...contact, identities },
        arppMissing: [],
        researchTarget,
      },
    });

    expect(brief).toContain("Existing identity ID: identity-x");
    expect(brief).toContain("Existing identity ID: identity-linkedin");
    expect(brief).toContain("using its exact identity ID and contactId");
    expect(brief).not.toContain("identity-unsafe-linkedin");
    expect(brief).not.toContain("identity-inactive");
  });

  it("uses the user-facing enrichment thread name without renaming the technical template", () => {
    expect(
      resolveTemplateThreadName({
        name: "Contact Web Research",
        config: JSON.stringify(buildContactWebResearchTemplateConfig()),
      }),
    ).toBe("Contact Enrich Profile");
    expect(resolveTemplateThreadName({ name: "Other workflow", config: "{}" })).toBe(
      "Other workflow",
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
