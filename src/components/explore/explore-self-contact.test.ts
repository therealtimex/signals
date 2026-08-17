// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreSelfPicker } from "@/components/explore/explore-self-picker";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { ContactDetailClient } from "@/app/dashboard/contacts/[id]/contact-detail-client";
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

const contactFixture: ContactWithIdentities = {
  id: "c1",
  name: "Jordan Lee",
  firstName: "Jordan",
  lastName: "Lee",
  headline: null,
  company: "Acme",
  title: "Founder",
  profileUrl: null,
  avatarUrl: null,
  email: "jordan@example.com",
  phone: null,
  primaryEmail: "jordan@example.com",
  primaryPhone: null,
  channelCount: 1,
  channels: [
    {
      id: "ch1",
      contactId: "c1",
      channelType: "email",
      value: "jordan@example.com",
      valueNormalized: "jordan@example.com",
      label: null,
      isPrimary: true,
      isVerified: false,
      contactIdentityId: null,
      scope: "shared",
      source: "test",
      metadata: "{}",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  employments: [
    {
      id: "emp1",
      contactId: "c1",
      orgId: "org1",
      orgName: "Acme",
      title: "Founder",
      startedAt: null,
      endedAt: null,
      isCurrent: true,
      scope: "shared",
      source: "test",
      metadata: "{}",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  currentEmployment: {
    orgId: "org1",
    orgName: "Acme",
    title: "Founder",
  },
  bio: null,
  location: null,
  website: null,
  photoUrl: null,
  tags: null,
  funnelStage: "prospect",
  score: 0,
  enrichmentScore: 10,
  lastInteractionAt: null,
  metadata: "{}",
  isSelf: false,
  createdAt: 1,
  updatedAt: 1,
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
    headline: null,
    avatarUrl: null,
    location: null,
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

describe("ExploreSelfPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("marks the current owner row as Current and not selectable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            contactFixture,
            { ...contactFixture, id: "c2", name: "Other", isSelf: true },
          ],
        }),
      }),
    );

    await act(async () => {
      root.render(
        createElement(ExploreSelfPicker, {
          open: true,
          onOpenChange: () => {},
          currentOwnerId: "c2",
          onOwnerChanged: () => {},
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Current");
    expect(document.body.textContent).toContain("Other");

    const currentRow = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Current"),
    );
    expect(currentRow).toBeTruthy();
    expect(currentRow?.disabled).toBe(true);
  });
});

describe("AddContactDialog", () => {
  it("renders default trigger unchanged", () => {
    const html = renderToStaticMarkup(createElement(AddContactDialog));
    expect(html).toContain("Add Contact");
  });
});

describe("ContactDetailClient self toggle", () => {
  it("shows This is me for active contacts", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetailClient, {
        contact: contactFixture,
        tasks: [],
        explore: exploreFixture,
      }),
    );
    expect(html).toContain("This is me");
  });

  it("hides This is me for archived contacts", () => {
    const html = renderToStaticMarkup(
      createElement(ContactDetailClient, {
        contact: {
          ...contactFixture,
          metadata: JSON.stringify({ archived: 1, archiveReason: "test" }),
        },
        tasks: [],
        explore: exploreFixture,
      }),
    );
    expect(html).not.toContain("This is me");
    expect(html).toContain("archived");
  });
});
