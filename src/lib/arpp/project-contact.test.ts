import { describe, expect, it } from "vitest";
import { projectContactToArpp } from "@/lib/arpp/project-contact";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Org } from "@/lib/db/types";

function baseContact(overrides: Partial<ContactDTO> = {}): ContactDTO {
  return {
    id: "cnt_dhh",
    name: "David Heinemeier Hansson",
    firstName: "David",
    lastName: "Hansson",
    enrichmentScore: 26,
    tags: null,
    funnelStage: "prospect",
    relationshipGoal: null,
    relationshipGoalStatus: null,
    relationshipGoalUpdatedAt: null,
    score: 0,
    metadata: "{}",
    lastInteractionAt: null,
    isSelf: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_727_500_000,
    identities: [
      {
        id: "id_x",
        contactId: "cnt_dhh",
        platform: "x",
        platformUserId: "12",
        platformHandle: "dhh",
        platformUrl: "https://x.com/dhh",
        platformData: "{}",
        displayName: "DHH",
        headline: "Co-owner & CTO at 37signals",
        bio: null,
        avatarUrl: "https://example.com/dhh.jpg",
        location: null,
        websiteUrl: null,
        isVerified: true,
        followersCount: 500_000,
        followingCount: 100,
        postsCount: 40_000,
        listedCount: null,
        platformCreatedAt: null,
        statsUpdatedAt: null,
        isPrimary: 1,
        isActive: 1,
        lastSyncedAt: 1_727_500_000,
        syncErrors: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    channels: [],
    employments: [],
    currentEmployment: null,
    primaryEmail: null,
    primaryPhone: null,
    channelCount: 0,
    resolvedAvatarUrl: "https://example.com/dhh.jpg",
    profile: {
      headline: "Co-owner & CTO at 37signals",
      bio: null,
      location: null,
      website: null,
    },
    email: null,
    phone: null,
    company: "37signals",
    title: "Co-owner & CTO",
    avatarUrl: "https://example.com/dhh.jpg",
    photoUrl: "https://example.com/dhh.jpg",
    profileUrl: "https://x.com/dhh",
    headline: "Co-owner & CTO at 37signals",
    bio: null,
    location: null,
    website: null,
    createdSource: "manual",
    createdSourceDetail: null,
    createdWorkflowRunId: null,
    createdTemplateId: null,
    ...overrides,
  };
}

describe("projectContactToArpp", () => {
  it("projects a sparse contact to L0 with platform profile", () => {
    const doc = projectContactToArpp({
      contact: baseContact(),
      orgsById: new Map(),
    });

    expect(doc.spec).toBe("arpp/1.1");
    expect(doc.identity.fullName).toBe("David Heinemeier Hansson");
    expect(doc.identity.disambiguatingDescription).toBe("Co-owner & CTO at 37signals");
    expect(doc.profiles).toHaveLength(1);
    expect(doc.profiles[0]).toMatchObject({
      network: "x",
      url: "https://x.com/dhh",
      verification: { status: "challenge-passed" },
    });
    expect(doc.sameAs).toContain("https://x.com/dhh");
    expect(doc.experience).toHaveLength(0);
    expect(doc.signals.conformance).toBe("L0");
    expect(doc.signals.contactId).toBe("cnt_dhh");
    expect(JSON.stringify(doc)).not.toContain("contact_personas");
    expect(JSON.stringify(doc)).not.toContain("persona");
  });

  it("includes employment experience with org reference", () => {
    const org: Org = {
      id: "org_37",
      name: "37signals",
      orgType: "company",
      domain: "37signals.com",
      website: "https://37signals.com",
      description: "Project management software",
      location: "Chicago, IL",
      avatarUrl: null,
      industry: "Computer Software",
      companySize: "51-200",
      tags: "[]",
      ownerContactId: null,
      accountStage: null,
      followedAt: null,
      feedSeenAt: null,
      enrichmentScore: 40,
      scope: "shared",
      metadata: "{}",
      source: null,
      createdSource: "manual",
      createdSourceDetail: null,
      createdWorkflowRunId: null,
      createdTemplateId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const contact = baseContact({
      employments: [
        {
          id: "emp_1",
          contactId: "cnt_dhh",
          orgId: "org_37",
          orgName: "37signals",
          title: "Co-owner & CTO",
          startedAt: 1_075_161_600,
          endedAt: null,
          isCurrent: true,
          scope: "shared",
          source: "manual:update_contact",
          metadata: JSON.stringify({ employmentType: "founder" }),
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      currentEmployment: { orgId: "org_37", orgName: "37signals", title: "Co-owner & CTO" },
    });

    const doc = projectContactToArpp({
      contact,
      orgsById: new Map([["org_37", org]]),
    });

    expect(doc.experience).toHaveLength(1);
    expect(doc.experience[0]).toMatchObject({
      role: "Co-owner & CTO",
      employmentType: "founder",
      organization: {
        name: "37signals",
        url: "https://37signals.com",
      },
      timePeriod: { start: "2004-01", end: null, current: true },
    });
    expect(doc.identity.jobTitle).toBe("Co-owner & CTO");
  });

  it("strips local_only employments in public visibility", () => {
    const org: Org = {
      id: "org_secret",
      name: "Stealth Co",
      orgType: "company",
      domain: null,
      website: null,
      description: null,
      location: null,
      avatarUrl: null,
      industry: null,
      companySize: null,
      tags: "[]",
      ownerContactId: null,
      accountStage: null,
      followedAt: null,
      feedSeenAt: null,
      enrichmentScore: 0,
      scope: "local_only",
      metadata: "{}",
      source: null,
      createdSource: null,
      createdSourceDetail: null,
      createdWorkflowRunId: null,
      createdTemplateId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const contact = baseContact({
      employments: [
        {
          id: "emp_secret",
          contactId: "cnt_dhh",
          orgId: "org_secret",
          orgName: "Stealth Co",
          title: "Advisor",
          startedAt: null,
          endedAt: null,
          isCurrent: true,
          scope: "local_only",
          source: "manual",
          metadata: "{}",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const doc = projectContactToArpp(
      { contact, orgsById: new Map([["org_secret", org]]) },
      { visibility: "public" },
    );

    expect(doc.experience).toHaveLength(0);
    expect(doc.meta.visibility).toBe("public");
  });

  it("derives public job title only from shared current employment", () => {
    const privateOrg: Org = {
      id: "org_private",
      name: "Private Venture",
      orgType: "company",
      domain: null,
      website: null,
      description: null,
      location: null,
      avatarUrl: null,
      industry: null,
      companySize: null,
      tags: "[]",
      ownerContactId: null,
      accountStage: null,
      followedAt: null,
      feedSeenAt: null,
      enrichmentScore: 0,
      scope: "local_only",
      metadata: "{}",
      source: null,
      createdSource: null,
      createdSourceDetail: null,
      createdWorkflowRunId: null,
      createdTemplateId: null,
      createdAt: 2,
      updatedAt: 2,
    };
    const sharedOrg: Org = {
      ...privateOrg,
      id: "org_shared",
      name: "Shared Company",
      domain: "shared.example",
      website: "https://shared.example",
      scope: "shared",
      createdAt: 1,
      updatedAt: 1,
    };
    const contact = baseContact({
      employments: [
        {
          id: "emp_private",
          contactId: "cnt_dhh",
          orgId: "org_private",
          orgName: "Private Venture",
          title: "Secret Strategist",
          startedAt: 1_725_000_000,
          endedAt: null,
          isCurrent: true,
          scope: "local_only",
          source: "manual",
          metadata: "{}",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: "emp_shared",
          contactId: "cnt_dhh",
          orgId: "org_shared",
          orgName: "Shared Company",
          title: "Public Advisor",
          startedAt: 1_700_000_000,
          endedAt: null,
          isCurrent: true,
          scope: "shared",
          source: "manual",
          metadata: "{}",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      currentEmployment: {
        orgId: "org_private",
        orgName: "Private Venture",
        title: "Secret Strategist",
      },
      company: "Private Venture",
      title: "Secret Strategist",
    });

    const doc = projectContactToArpp(
      {
        contact,
        orgsById: new Map([
          [privateOrg.id, privateOrg],
          [sharedOrg.id, sharedOrg],
        ]),
      },
      { visibility: "public" },
    );

    expect(doc.identity.jobTitle).toBe("Public Advisor");
    expect(doc.experience).toHaveLength(1);
    expect(doc.experience[0]).toMatchObject({
      role: "Public Advisor",
      organization: { name: "Shared Company" },
      timePeriod: { current: true },
    });
    expect(JSON.stringify(doc)).not.toContain("Private Venture");
    expect(JSON.stringify(doc)).not.toContain("Secret Strategist");
  });

  it("selects the public current job title deterministically", () => {
    const sharedOrg: Org = {
      id: "org_shared",
      name: "Shared Company",
      orgType: "company",
      domain: "shared.example",
      website: "https://shared.example",
      description: null,
      location: null,
      avatarUrl: null,
      industry: null,
      companySize: null,
      tags: "[]",
      ownerContactId: null,
      accountStage: null,
      followedAt: null,
      feedSeenAt: null,
      enrichmentScore: 0,
      scope: "shared",
      metadata: "{}",
      source: null,
      createdSource: null,
      createdSourceDetail: null,
      createdWorkflowRunId: null,
      createdTemplateId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const contact = baseContact({
      employments: [
        {
          id: "emp_older",
          contactId: "cnt_dhh",
          orgId: "org_shared",
          orgName: "Shared Company",
          title: "Older Role",
          startedAt: 1_700_000_000,
          endedAt: null,
          isCurrent: true,
          scope: "shared",
          source: "manual",
          metadata: "{}",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: "emp_newer",
          contactId: "cnt_dhh",
          orgId: "org_shared",
          orgName: "Shared Company",
          title: "Newer Role",
          startedAt: 1_725_000_000,
          endedAt: null,
          isCurrent: true,
          scope: "shared",
          source: "manual",
          metadata: "{}",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      currentEmployment: {
        orgId: "org_shared",
        orgName: "Shared Company",
        title: "Newer Role",
      },
    });

    const doc = projectContactToArpp(
      { contact, orgsById: new Map([[sharedOrg.id, sharedOrg]]) },
      { visibility: "public" },
    );

    expect(doc.identity.jobTitle).toBe("Newer Role");

    const tiedStartDoc = projectContactToArpp(
      {
        contact: {
          ...contact,
          employments: contact.employments.map((employment) => ({
            ...employment,
            startedAt: 1_700_000_000,
            createdAt: employment.id === "emp_newer" ? 3 : 2,
          })),
        },
        orgsById: new Map([[sharedOrg.id, sharedOrg]]),
      },
      { visibility: "public" },
    );

    expect(tiedStartDoc.identity.jobTitle).toBe("Newer Role");
  });

  it("includes verified email in public mode only when verified", () => {
    const withVerified = baseContact({
      channels: [
        {
          id: "ch_1",
          contactId: "cnt_dhh",
          channelType: "email",
          value: "dhh@37signals.com",
          valueNormalized: "dhh@37signals.com",
          label: null,
          isPrimary: true,
          isVerified: true,
          contactIdentityId: null,
          scope: "shared",
          source: "import",
          metadata: "{}",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      primaryEmail: "dhh@37signals.com",
      email: "dhh@37signals.com",
    });

    const publicDoc = projectContactToArpp(
      { contact: withVerified, orgsById: new Map() },
      { visibility: "public" },
    );
    expect(publicDoc.identity.email).toBe("dhh@37signals.com");

    const unverified = baseContact({
      channels: [
        {
          id: "ch_2",
          contactId: "cnt_dhh",
          channelType: "email",
          value: "guess@example.com",
          valueNormalized: "guess@example.com",
          label: null,
          isPrimary: true,
          isVerified: false,
          contactIdentityId: null,
          scope: "shared",
          source: "agent",
          metadata: "{}",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      primaryEmail: "guess@example.com",
    });

    const publicNoEmail = projectContactToArpp(
      { contact: unverified, orgsById: new Map() },
      { visibility: "public" },
    );
    expect(publicNoEmail.identity.email).toBeUndefined();
  });
});
