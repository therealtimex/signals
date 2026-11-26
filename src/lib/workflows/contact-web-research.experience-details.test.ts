import { beforeEach, describe, expect, it } from "vitest";
import { classifyResearchPageUrl } from "@/lib/contacts/web-research-page-state";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME, seedTemplates } from "@/lib/db/seed-templates";
import { buildDefaultAllowedOrigins } from "@/lib/platforms/platform-urls";
import {
  buildContactWebResearchBriefSection,
  buildContactWebResearchTemplateConfig,
  linkedInExperienceDetailsUrl,
  type ContactWebResearchBriefContact,
} from "@/lib/workflows/contact-web-research";
import type { ContactWebResearchPreparedTarget } from "@/lib/workflows/contact-web-research-target";
import { resetCoreTables } from "@/test/db";

/**
 * #571 gap 2: LinkedIn renders Experience lazily, so the research brief tells the agent to scroll
 * and wait before deciding it is missing, then to fall back to the profile's own
 * /details/experience/ view.
 */

const DETAILS = "https://www.linkedin.com/in/sasmita-s/details/experience/";
const LAZY_LOAD = "LinkedIn renders Experience lazily, below the fold";
const SCROLL = 'agent-browser --session signals-publish scrollintoview "#experience"';
const FALLBACK =
  "open the profile's own Experience details view in the same session: https://www.linkedin.com/in/<slug>/details/experience/";
const KNOWN_DETAILS_HEADER = "Experience details views for the known LinkedIn candidates:";

type Identity = ContactWebResearchBriefContact["identities"][number];

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

const linkedIn = {
  id: "identity-linkedin",
  platform: "linkedin",
  platformUserId: "sasmita-s",
  platformHandle: "sasmita-s",
  platformUrl: "https://www.linkedin.com/in/sasmita-s",
  isPrimary: 1,
  isActive: 1,
  provenanceKind: null,
} as unknown as Identity;

const x = {
  id: "identity-x",
  platform: "x",
  platformUserId: "sasp",
  platformHandle: "sasp",
  platformUrl: "https://x.com/sasp",
  isPrimary: 1,
  isActive: 1,
  provenanceKind: null,
} as unknown as Identity;

function brief(identities: Identity[]) {
  const contact: ContactWebResearchBriefContact = {
    id: "contact-sas",
    name: "Sas P",
    company: null,
    title: null,
    headline: null,
    location: null,
    website: null,
    profileUrl: null,
    enrichmentScore: 10,
    identities,
    email: null,
  };
  return buildContactWebResearchBriefSection({
    workflowRunId: "run-571-exp",
    config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
    signalsBaseUrl: "http://127.0.0.1:3010",
    context: { contact, arppMissing: ["experience"], researchTarget },
  });
}

describe("linkedInExperienceDetailsUrl", () => {
  it.each([
    ["https://www.linkedin.com/in/sasmita-s", DETAILS],
    ["https://www.linkedin.com/in/sasmita-s/", DETAILS],
    ["https://linkedin.com/in/sasmita-s/recent-activity/", DETAILS],
    ["http://www.linkedin.com/in/sasmita-s?trk=x", DETAILS],
    ["https://uk.linkedin.com/in/sasmita-s", DETAILS],
  ])("maps the member profile %s to its details view", (input, expected) => {
    expect(linkedInExperienceDetailsUrl(input)).toBe(expected);
  });

  it.each([
    "https://www.linkedin.com/company/hackwithbay",
    "https://www.linkedin.com/in/",
    "https://x.com/in/sasmita-s",
    "https://evil-linkedin.com/in/sasmita-s",
    "https://lnkd.in/abc",
    "javascript:alert(1)",
    "not a url",
  ])("returns null for %s", (input) => {
    expect(linkedInExperienceDetailsUrl(input)).toBeNull();
  });
});

describe("Contact Web Research brief: lazily loaded Experience (#571 gap 2)", () => {
  it("tells the agent to scroll, wait, re-snapshot and fall back for a LinkedIn primary", () => {
    const text = brief([linkedIn]);
    const lazy = text.indexOf(LAZY_LOAD);
    const fallback = text.indexOf(FALLBACK);

    expect(lazy).toBeGreaterThan(text.indexOf("### Verified LinkedIn profile mining gate"));
    expect(text).toContain(SCROLL);
    expect(text).toContain("wait for it to render (wait 2000), then take a fresh snapshot");
    // Scroll and wait come first; the details view is the fallback.
    expect(fallback).toBeGreaterThan(lazy);
    expect(text).toContain("It is the page Show all experiences opens, so it is part of the same profile and does not consume another page visit.");
    expect(text).toContain(KNOWN_DETAILS_HEADER);
    expect(text).toContain(`  - https://www.linkedin.com/in/sasmita-s → ${DETAILS}`);
    expect(text).toContain(
      "including opening its /details/experience/ view, does not consume another page visit.",
    );
  });

  it("keeps an auth wall on the details view an auth-state failure, and the profile URL canonical", () => {
    const text = brief([linkedIn]);
    const authLine = text
      .split("\n")
      .find((line) => line.startsWith("- If the details view redirects to an auth wall"));
    // The server only sees an auth wall through the landed URL: /details/experience/ itself
    // classifies as content, so recording only that URL would slip past the blocked-URL floor.
    expect(authLine).toContain(
      "record the landed auth-wall URL (not the details URL) in blockedUrls and follow the auth_state_lost rule.",
    );
    expect(authLine).not.toContain("visitedUrls");
    expect(text).toContain(
      "- Whenever you open the details view, add its URL to visitedUrls. Keep the /in/<slug>/ profile URL itself in verifiedProfileUrls and as the identity platformUrl",
    );
    // The existing auth-wall rule the details view defers to is unchanged.
    expect(text).toContain(
      'On linkedin itself an auth wall means the verified session was lost: call complete_workflow_run with status "failed" and errors ["auth_state_lost: <url>"].',
    );
  });

  it("offers no details view for a non-LinkedIn identity that carries a LinkedIn URL (PR #574 review W12)", () => {
    const xWithForeignLinkedIn = {
      ...x,
      platformUrl: "https://www.linkedin.com/in/someone-else",
    } as unknown as Identity;
    const text = brief([xWithForeignLinkedIn]);
    expect(text).not.toContain(KNOWN_DETAILS_HEADER);
    expect(text).not.toContain("https://www.linkedin.com/in/someone-else/details/experience/");
  });

  it("still offers the details view for the contact's own LinkedIn profile URL", () => {
    const text = buildContactWebResearchBriefSection({
      workflowRunId: "run-571-exp",
      config: { ...buildContactWebResearchTemplateConfig(), contactId: "contact-sas" },
      signalsBaseUrl: "http://127.0.0.1:3010",
      context: {
        contact: {
          id: "contact-sas",
          name: "Sas P",
          company: null,
          title: null,
          headline: null,
          location: null,
          website: null,
          profileUrl: "https://www.linkedin.com/in/sasmita-s",
          enrichmentScore: 10,
          identities: [],
          email: null,
        },
        arppMissing: ["experience"],
        researchTarget,
      },
    });
    expect(text).toContain(KNOWN_DETAILS_HEADER);
    expect(text).toContain(`  - https://www.linkedin.com/in/sasmita-s → ${DETAILS}`);
  });

  it("names no LinkedIn details URL for a contact whose only known profile is on X", () => {
    const text = brief([x]);
    expect(text).not.toContain(KNOWN_DETAILS_HEADER);
    expect(text).not.toMatch(/linkedin\.com\/in\/[a-z0-9-]+\/details\/experience/i);
    // The X candidate line itself is unchanged.
    expect(text).toContain(
      "1. Existing identity ID: identity-x; platform: x; platform user ID: sasp; handle: sasp; URL (stored): https://x.com/sasp",
    );
  });
});

describe("the details view against the existing server rules", () => {
  it("is ordinary content to the blocked-URL classifier, while its auth redirects stay blocked", () => {
    expect(classifyResearchPageUrl(DETAILS)).toBe("content");
    expect(
      classifyResearchPageUrl(
        "https://www.linkedin.com/authwall?sessionRedirect=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fsasmita-s%2Fdetails%2Fexperience%2F",
      ),
    ).toBe("authwall");
    expect(classifyResearchPageUrl("https://www.linkedin.com/login?session_redirect=%2Fin%2Fsasmita-s%2Fdetails%2Fexperience%2F")).toBe("login");
    expect(classifyResearchPageUrl("https://www.linkedin.com/checkpoint/challenge/x")).toBe("authwall");
  });

  it("is on an origin every browser connection already allows", () => {
    expect(buildDefaultAllowedOrigins()).toContain(new URL(DETAILS).origin);
  });
});

describe("seeded Contact Web Research system prompt: lazily loaded Experience", () => {
  beforeEach(() => {
    resetCoreTables();
    seedTemplates();
  });

  it("tells the agent to scroll and wait, then use the details view, at no extra page visit", () => {
    const prompt = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!.systemPrompt;
    expect(prompt).toContain(
      "Experience loads lazily: scroll it into view and wait before deciding it is missing, and if it still does not render, open the profile's /in/<slug>/details/experience/ view as the brief describes.",
    );
    expect(prompt).toContain(
      "Same-profile section expansion, including the profile's /details/experience/ view, is not another page visit.",
    );
  });
});
