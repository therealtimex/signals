import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import {
  createContactEmployment,
  resolveContactCareerSummary,
  resolveCurrentEmployment,
} from "@/lib/db/queries/contact-employments";
import { createOrg } from "@/lib/db/queries/orgs";
import { assembleEmbedText } from "@/lib/db/queries/embeddings";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import { assembleAgentGrounding } from "@/lib/db/queries/simulations";
import { queryGraphEdges } from "@/lib/db/queries/graph";
import { db } from "@/lib/db/client";
import { contacts, orgs } from "@/lib/db/schema";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

function createLocalOrg(name: string) {
  const id = nanoid();
  db.insert(orgs)
    .values({
      id,
      name,
      orgType: "company",
      scope: "local_only",
      source: "test",
    })
    .run();
  return id;
}

describe("employment privacy on shared surfaces", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedSharedEvidence(contactId: string) {
    createIdentity({
      contactId,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: "@career",
    });
  }

  it("excludes local_only employments from shared career resolution and public surfaces", () => {
    const contact = createContact({ name: "Scoped", platform: "x", platformUserId: "scoped-1" });
    const sharedOrg = createOrg({ name: "Visible Corp", source: "test" });
    const privateOrgId = createLocalOrg(PRIVACY_SENTINELS.privateEmployer);

    createContactEmployment({
      contactId: contact.id,
      orgId: privateOrgId,
      title: PRIVACY_SENTINELS.privateEmploymentTitle,
      scope: "local_only",
      isCurrent: true,
      startedAt: 300,
      source: "test",
    });
    createContactEmployment({
      contactId: contact.id,
      orgId: sharedOrg.id,
      title: "Public Role",
      scope: "shared",
      isCurrent: true,
      startedAt: 100,
      source: "test",
    });

    expect(resolveCurrentEmployment(contact.id, { visibility: "all" })?.title).toBe(
      PRIVACY_SENTINELS.privateEmploymentTitle,
    );
    expect(resolveCurrentEmployment(contact.id, { visibility: "shared" })).toMatchObject({
      orgName: "Visible Corp",
      title: "Public Role",
    });
    expect(resolveContactCareerSummary(contact.id)).toEqual({
      company: "Visible Corp",
      title: "Public Role",
    });

    const profileText = assembleEmbedText("contact", contact.id, "profile");
    expect(profileText).toContain("Visible Corp");
    expect(profileText).not.toContain(PRIVACY_SENTINELS.privateEmployer);
    expect(profileText).not.toContain(PRIVACY_SENTINELS.privateEmploymentTitle);

    seedSharedEvidence(contact.id);
    const persona = assemblePersonaEvidence(contact.id);
    expect(persona.evidence.contact.company).toBe("Visible Corp");
    expect(persona.evidence.contact.title).toBe("Public Role");
    assertNoPrivacySentinels(persona.evidence.contact);

    const grounding = assembleAgentGrounding(contact.id) as {
      contact: { company: string | null; title: string | null };
      org: { name: string } | null;
    };
    expect(grounding.contact.company).toBe("Visible Corp");
    expect(grounding.contact.title).toBe("Public Role");
    assertNoPrivacySentinels(grounding.contact);
    assertNoPrivacySentinels(grounding.org);

    const explore = getContactExploreCard(contact.id);
    expect(explore?.org?.name).toBe("Visible Corp");
    assertNoPrivacySentinels(explore?.org);
  });

  it("omits org from explore when only local_only employments exist", () => {
    const contact = createContact({ name: "Hidden", platform: "x", platformUserId: "hidden-1" });
    const privateOrgId = createLocalOrg(PRIVACY_SENTINELS.privateEmployer);

    createContactEmployment({
      contactId: contact.id,
      orgId: privateOrgId,
      title: PRIVACY_SENTINELS.privateEmploymentTitle,
      scope: "local_only",
      isCurrent: true,
      source: "test",
    });

    db.update(contacts)
      .set({
        company: PRIVACY_SENTINELS.privateEmployer,
        title: PRIVACY_SENTINELS.privateEmploymentTitle,
      })
      .where(eq(contacts.id, contact.id))
      .run();

    expect(resolveContactCareerSummary(contact.id)).toEqual({
      company: null,
      title: null,
    });
    expect(getContactExploreCard(contact.id)?.org).toBeNull();
  });

  it("hides works_at edges for shared employments at local_only orgs from default query_graph", () => {
    const contact = createContact({ name: "Graph", platform: "x", platformUserId: "graph-1" });
    const privateOrgId = createLocalOrg(PRIVACY_SENTINELS.privateEmployer);

    createContactEmployment({
      contactId: contact.id,
      orgId: privateOrgId,
      title: PRIVACY_SENTINELS.privateEmploymentTitle,
      scope: "shared",
      isCurrent: true,
      source: "test",
    });

    const publicEdges = queryGraphEdges({
      srcType: "contact",
      srcId: contact.id,
      edgeTypes: ["works_at"],
    });
    expect(publicEdges).toHaveLength(0);

    const privateEdges = queryGraphEdges({
      srcType: "contact",
      srcId: contact.id,
      edgeTypes: ["works_at"],
      includeLocalOnly: true,
    });
    expect(privateEdges).toHaveLength(1);
    expect(privateEdges[0]?.dstId).toBe(privateOrgId);
    assertNoPrivacySentinels(publicEdges);
  });
});
