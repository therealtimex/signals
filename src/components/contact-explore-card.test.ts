import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactExploreCardView, formatPlatformHandle } from "@/components/contact-explore-card";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";

describe("ContactExploreCardView", () => {
  it("renders shared persona summary and niche chips", () => {
    const explore: ContactExploreCard = {
      persona: {
        visibility: "shared",
        archetype: "Builder",
        tone: "Direct",
        summary: "Visible summary",
        interests: ["AI"],
        confidence: 0.8,
        generatedAt: 1_700_000_000,
      },
      identities: [],
      niches: [
        {
          id: "niche-1",
          name: "AI Builders",
          slug: "ai-builders",
          nicheType: "interest",
          weight: 0.9,
        },
      ],
    };

    const html = renderToStaticMarkup(createElement(ContactExploreCardView, { explore }));
    expect(html).toContain("Visible summary");
    expect(html).toContain("AI Builders");
    expect(html).toContain('href="#"');
    expect(html).toContain('title="Niche detail coming soon"');
    expect(html).not.toContain("Private persona");
  });

  it("renders platform handles verbatim without extra @ prefix", () => {
    const explore: ContactExploreCard = {
      persona: {
        visibility: "absent",
        archetype: null,
        tone: null,
        summary: null,
        interests: [],
        confidence: null,
        generatedAt: null,
      },
      identities: [
        {
          id: "id-x",
          platform: "x",
          platformHandle: "@username",
          displayName: "User",
          followersCount: 10,
          followingCount: 1,
          postsCount: 2,
          listedCount: null,
          engagementRate: null,
          statsUpdatedAt: null,
          metricSnapshotAt: null,
        },
        {
          id: "id-li",
          platform: "linkedin",
          platformHandle: "/in/name",
          displayName: "Linked",
          followersCount: 20,
          followingCount: 2,
          postsCount: 3,
          listedCount: null,
          engagementRate: null,
          statsUpdatedAt: null,
          metricSnapshotAt: null,
        },
      ],
      niches: [],
    };

    const html = renderToStaticMarkup(createElement(ContactExploreCardView, { explore }));
    expect(html).toContain("@username");
    expect(html).toContain("/in/name");
    expect(html).not.toContain("@@username");
    expect(html).not.toContain("@/in/name");
  });

  it("formatPlatformHandle returns stored value unchanged", () => {
    expect(formatPlatformHandle("@username")).toBe("@username");
    expect(formatPlatformHandle("/in/name")).toBe("/in/name");
  });

  it("shows local-only badge without leaking summary text", () => {
    const explore: ContactExploreCard = {
      persona: {
        visibility: "local_only",
        archetype: null,
        tone: null,
        summary: null,
        interests: [],
        confidence: null,
        generatedAt: null,
      },
      identities: [],
      niches: [],
    };

    const html = renderToStaticMarkup(createElement(ContactExploreCardView, { explore }));
    expect(html).toContain("Private persona");
    expect(html).not.toContain("Should not leak");
  });
});
