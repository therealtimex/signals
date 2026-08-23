// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactAvatarUpload } from "@/components/contact-avatar-upload";
import { ContactDetailClient } from "@/app/dashboard/contacts/[id]/contact-detail-client";
import { ContactRelationshipSection } from "@/components/contact-relationship-section";
import { ContactTimelineTab, filesFromDataTransfer } from "@/components/contact-timeline-tab";
import { ActivityMarkdown } from "@/components/activity-markdown";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";
import type { ContactWithIdentities } from "@/lib/db/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/contacts/c1",
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h } = await import("react");
  const passthrough =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      h(tag, null, children);
  return {
    Dialog: passthrough("div"),
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: ({ children }: { children?: React.ReactNode }) => h("h2", null, children),
    DialogDescription: passthrough("p"),
  };
});

const contactFixture: ContactWithIdentities = {
  id: "c1",
  name: "Jordan Lee",
  firstName: "Jordan",
  lastName: "Lee",
  headline: "Founder",
  company: "Acme",
  title: "Founder",
  profileUrl: "https://example.com/jordan",
  avatarUrl: null,
  email: "jordan@example.com",
  phone: null,
  primaryEmail: "jordan@example.com",
  primaryPhone: null,
  channelCount: 1,
  channels: [],
  employments: [],
  currentEmployment: {
    orgId: "org1",
    orgName: "Acme",
    title: "Founder",
  },
  bio: "Builds things",
  location: "SF",
  website: "http://jordan.example/",
  photoUrl: null,
  resolvedAvatarUrl: null,
  profile: {
    headline: "Founder",
    bio: "Builds things",
    location: "SF",
    website: "http://jordan.example/",
  },
  tags: JSON.stringify(["Founder"]),
  funnelStage: "prospect",
  relationshipGoal: null,
  relationshipGoalStatus: null,
  relationshipGoalUpdatedAt: null,
  score: 0,
  enrichmentScore: 67,
  lastInteractionAt: null,
  metadata: "{}",
  isSelf: false,
  createdAt: 1,
  updatedAt: 1,
  createdSource: "agent",
  createdSourceDetail: "agent:create_contact",
  createdWorkflowRunId: null,
  createdTemplateId: null,
  identities: [
    {
      id: "id1",
      contactId: "c1",
      platform: "x",
      platformUserId: "x1",
      platformHandle: "jordan",
      platformUrl: null,
      platformData: "{}",
      displayName: "Jordan Lee",
      headline: null,
      bio: null,
      avatarUrl: null,
      location: null,
      websiteUrl: null,
      isVerified: null,
      followersCount: null,
      followingCount: null,
      postsCount: null,
      listedCount: null,
      platformCreatedAt: null,
      statsUpdatedAt: null,
      isPrimary: 1,
      isActive: 1,
      lastSyncedAt: null,
      syncErrors: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

const exploreFixture: ContactExploreCard = {
  contact: {
    id: "c1",
    name: "Jordan Lee",
    headline: "Founder",
    avatarUrl: null,
    location: "SF",
  },
  persona: {
    visibility: "shared",
    archetype: null,
    tone: null,
    summary: null,
    interests: [],
    confidence: null,
    generatedAt: null,
    stale: false,
    conversionTriggers: [],
    engagementFormats: [],
  },
  identities: [],
  niches: [],
  relationship: null,
  org: null,
  recentPosts: [],
};

describe("ActivityMarkdown", () => {
  it("renders headings and lists from markdown", () => {
    const html = renderToStaticMarkup(
      createElement(ActivityMarkdown, {
        content: "## POC meeting\n- agreed on timeline\n- follow up next week",
      }),
    );
    expect(html).toContain("<h2>");
    expect(html).toContain("POC meeting");
    expect(html).not.toContain("## POC meeting");
    expect(html).toContain("<li>");
    expect(html).toContain("agreed on timeline");
  });
});

describe("ContactAvatarUpload", () => {
  it("hides the native file picker chrome", () => {
    const html = renderToStaticMarkup(
      createElement(ContactAvatarUpload, {
        contactId: "c1",
        currentAvatarUrl: null,
        name: "Jordan Lee",
      }),
    );
    expect(html).not.toContain("Choose File");
    expect(html).not.toContain("No file chosen");
    expect(html).toContain("sr-only");
    expect(html).toContain("Change photo");
    expect(html).toContain("JL");
  });
});

describe("ContactDetailClient details layout", () => {
  it("shows a read snapshot instead of stacked edit fields", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetailClient, {
        contact: contactFixture,
        tasks: [],
        explore: exploreFixture,
        profilePipelineTemplateId: "tmpl-1",
      }),
    );
    expect(html).toContain("Edit");
    expect(html).toContain(">jordan.example<");
    expect(html).toContain("SF");
    expect(html).not.toContain("Contact Information");
    expect(html).not.toContain("Save relationship");
    expect(html).toContain("Enrich profile");
    expect(html).toContain("This is me");
    expect(html).toContain("Added");
  });

  it("hides a headline that repeats title and company", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetailClient, {
        contact: {
          ...contactFixture,
          name: "Sam Altman",
          title: "CEO",
          company: "OpenAI",
          headline: "CEO at OpenAI",
        },
        tasks: [],
        explore: exploreFixture,
        profilePipelineTemplateId: "tmpl-1",
      }),
    );
    expect(html).toContain("OpenAI");
    expect(html).toContain("CEO");
    expect(html).not.toContain(">CEO at OpenAI<");
  });

  it("prompts to enrich a thin profile", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetailClient, {
        contact: { ...contactFixture, enrichmentScore: 20, bio: null, headline: null },
        tasks: [],
        explore: exploreFixture,
        profilePipelineTemplateId: "tmpl-1",
      }),
    );
    expect(html).toContain("This profile is still thin");
  });
});

describe("ContactRelationshipSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders stage pills and a warmth slider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          relationship: {
            edgeId: "e1",
            ownerContactId: "owner",
            contactId: "c1",
            stage: "warm",
            warmth: 72,
            notes: "Met at a dinner",
            relationshipType: null,
            lastMeaningfulInteraction: null,
            desiredDirection: null,
            context: null,
          },
        }),
      }),
    );

    await act(async () => {
      root.render(createElement(ContactRelationshipSection, { contactId: "c1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Warm");
    expect(document.body.textContent).toContain("Inner circle");
    expect(document.body.textContent).not.toContain("Save relationship");
    const slider = document.querySelector("#relationship-warmth") as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.type).toBe("range");
    expect(slider.value).toBe("72");
    const selected = document.body.querySelector('[aria-pressed="true"]');
    expect(selected?.textContent).toBe("Warm");
  });

  it("does not fetch a self-relationship editor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(ContactRelationshipSection, { contactId: "c1", isSelf: true }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("This contact is you");
  });
});

describe("ContactTimelineTab", () => {
  it("hides native file picker chrome and stacked admin headings", () => {
    const html = renderToStaticMarkup(createElement(ContactTimelineTab, { contactId: "c1" }));
    expect(html).not.toContain("Choose File");
    expect(html).not.toContain("No file chosen");
    expect(html).not.toContain("Log interaction");
    expect(html).not.toContain("Activity timeline");
    expect(html).toContain("sr-only");
    expect(html).toContain("Attach");
    expect(html).toContain("What happened?");
    expect(html).toContain(">Log<");
    expect(html).toContain("Drop files to attach");
    expect(html).toContain("min-h-20");
  });

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows a compact empty timeline hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );

    await act(async () => {
      root.render(createElement(ContactTimelineTab, { contactId: "c1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("No activity yet.");
    expect(document.body.textContent).not.toContain("Choose File");
    expect(document.body.textContent).not.toContain("Activity timeline");
  });

  it("shows the note first and keeps type with the timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "i1",
              kind: "interaction",
              eventType: "message",
              category: "communication",
              direction: null,
              summary: "what's up",
              occurredAt: Math.floor(new Date(2026, 7, 20, 23, 10).getTime() / 1000),
              scope: "local_only",
              source: "manual",
              contentItemId: null,
              contentPostId: null,
              platform: null,
              isMeaningful: true,
              attachments: [],
            },
          ],
        }),
      }),
    );

    await act(async () => {
      root.render(createElement(ContactTimelineTab, { contactId: "c1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const timeline = container.querySelector("[data-timeline]")?.textContent ?? "";
    expect(timeline).toContain("what's up");
    expect(timeline).toContain("Message · Aug 20, 11:10 PM");
    expect(timeline.indexOf("what's up")).toBeLessThan(timeline.indexOf("Message"));
  });

  it("renders markdown notes and opens attachments in a modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "i2",
              kind: "interaction",
              eventType: "meeting",
              category: "communication",
              direction: null,
              summary: "## POC meeting\n- agreed on timeline\n- follow up next week",
              occurredAt: Math.floor(new Date(2026, 7, 20, 23, 23).getTime() / 1000),
              scope: "local_only",
              source: "manual",
              contentItemId: null,
              contentPostId: null,
              platform: null,
              isMeaningful: true,
              attachments: [
                {
                  id: "a1",
                  mediaAssetId: "m1",
                  role: "attachment",
                  sortOrder: 0,
                  caption: null,
                  filename: "shot.png",
                  mimeType: "image/png",
                  fileSize: 12,
                  scope: "local_only",
                  url: "/api/media/m1",
                },
              ],
            },
          ],
        }),
      }),
    );

    await act(async () => {
      root.render(createElement(ContactTimelineTab, { contactId: "c1" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const heading = container.querySelector("[data-timeline] h2");
    expect(heading?.textContent).toBe("POC meeting");
    expect(container.textContent).toContain("agreed on timeline");
    expect(container.textContent).not.toContain("## POC meeting");
    expect(container.querySelector('[data-timeline] img[src="/api/media/m1"]')).toBeTruthy();

    const previewButton = container.querySelector(
      '[aria-label="Preview shot.png"]',
    ) as HTMLButtonElement;
    await act(async () => {
      previewButton.click();
    });
    expect(container.textContent).toContain("Open original");
    expect(container.querySelector('img[alt="shot.png"]')).toBeTruthy();
  });

  it("reads dropped files from dataTransfer", () => {
    const file = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    expect(filesFromDataTransfer({ files: [file] }).map((item) => item.name)).toEqual(["notes.pdf"]);
    expect(filesFromDataTransfer(null)).toEqual([]);
  });
});
