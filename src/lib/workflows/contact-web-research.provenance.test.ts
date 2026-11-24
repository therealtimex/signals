import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { completeWorkflowRunSchema } from "@/lib/agent-tools/schemas";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { CONTACT_WEB_RESEARCH_TEMPLATE_NAME, seedTemplates } from "@/lib/db/seed-templates";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import * as workflowEvents from "@/lib/webhooks/workflow-events";
import { IDENTITY_PROVENANCE_KIND_ENUM, type IdentityProvenanceKind } from "@/lib/identity-provenance";
import {
  CONTACT_WEB_RESEARCH_IDENTITY_PROVENANCE_USED,
  buildContactWebResearchBriefSection,
  buildContactWebResearchTemplateConfig,
  resolveContactWebResearchPrimaryIdentity,
  type ContactWebResearchBriefContact,
} from "@/lib/workflows/contact-web-research";
import type { ContactWebResearchPreparedTarget } from "@/lib/workflows/contact-web-research-target";
import { resetCoreTables } from "@/test/db";

/**
 * #571 part B: the research brief branches on where the primary identity came from. A
 * self-declared or agent-verified identity is mined without the same-human check, and a
 * differing display name becomes an alias; inferred and unknown keep today's ambiguity rule.
 */

const LUMA = "https://lu.ma/user/sas-p";
const AMBIGUITY_RULE =
  "If ambiguity remains, do not call upsert_contact_identity. Complete with ambiguous=true, partial=true, and unresolvedFields including sameAs.";
const SELF_DECLARED_BRANCH = "Skip the name-match and same-human check for this identity.";

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

function identity(overrides: Partial<Identity>): Identity {
  return {
    id: "identity-linkedin",
    platform: "linkedin",
    platformUserId: "sasmita-s",
    platformHandle: "sasmita-s",
    platformUrl: "https://www.linkedin.com/in/sasmita-s",
    isPrimary: 0,
    isActive: 1,
    provenanceKind: null,
    provenanceSourceUrl: null,
    provenanceObservedAt: null,
    ...overrides,
  } as Identity;
}

function contactWith(identities: Identity[], aliases?: string[]): ContactWebResearchBriefContact {
  return {
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
    ...(aliases ? { aliases } : {}),
  };
}

function brief(contact: ContactWebResearchBriefContact) {
  return buildContactWebResearchBriefSection({
    workflowRunId: "run-571",
    config: { ...buildContactWebResearchTemplateConfig(), contactId: contact.id },
    signalsBaseUrl: "http://127.0.0.1:3010",
    context: { contact, arppMissing: ["experience"], researchTarget },
  });
}

describe("Contact Web Research primary identity provenance (#571)", () => {
  it.each(["self_declared", "agent_verified"] as const)(
    "runs the confirmed-identity branch for a %s primary identity",
    (kind) => {
      const text = brief(
        contactWith([
          identity({ isPrimary: 1, provenanceKind: kind, provenanceSourceUrl: LUMA }),
        ]),
      );

      expect(text).toContain(`### Primary identity provenance: ${kind}`);
      expect(text).toContain("Primary identity ID: identity-linkedin; platform: linkedin");
      expect(text).toContain(SELF_DECLARED_BRANCH);
      expect(text).toContain('differs from "Sas P"');
      expect(text).toContain("Never complete with ambiguous=true because of it.");
      expect(text).toContain('enrich_contact { "contactId": "<contact ID>", "aliases": [');
      expect(text).toContain("Never send provenance kind self_declared");
      expect(text).toContain("still needs the same-human check");
      expect(text).toContain(`result.identityProvenanceUsed: "${kind}"`);
      expect(text).toContain("except the primary identity whose provenance is stated above");
      // The unconditional rule would stop the run on the name difference; it is replaced.
      expect(text).not.toContain(AMBIGUITY_RULE);
      expect(text).toContain(
        "If ambiguity remains about another candidate, do not call upsert_contact_identity for it. The primary identity (identity-linkedin) stays confirmed",
      );
    },
  );

  it("names the declaring page only for a self-declared identity and says which account it is", () => {
    const self = brief(
      contactWith([identity({ isPrimary: 1, provenanceKind: "self_declared", provenanceSourceUrl: LUMA })]),
    );
    expect(self).toContain(`declared on ${LUMA}`);
    expect(self).toContain("The person linked this account to a profile they control.");

    const verified = brief(contactWith([identity({ isPrimary: 1, provenanceKind: "agent_verified" })]));
    expect(verified).toContain("An agent already verified this account");
    expect(verified).not.toContain("declared on");
  });

  it("lists the aliases already stored so the agent does not resend them", () => {
    expect(
      brief(contactWith([identity({ provenanceKind: "self_declared" })], ["Sasmita S"])),
    ).toContain('Known aliases (already stored, do not resend): "Sasmita S".');
    expect(brief(contactWith([identity({ provenanceKind: "self_declared" })]))).toContain(
      "No aliases are stored yet.",
    );
  });

  it.each([
    ["inferred", "inferred"],
    [null, "unknown"],
  ] as const)("keeps today's ambiguity rule for a %s primary identity", (kind, used) => {
    const text = brief(contactWith([identity({ isPrimary: 1, provenanceKind: kind })]));

    expect(text).toContain(AMBIGUITY_RULE);
    expect(text).toContain(`### Primary identity provenance: ${used}`);
    expect(text).toContain("the same-human check and the ambiguity rule below apply");
    expect(text).toContain(`result.identityProvenanceUsed: "${used}"`);
    expect(text).not.toContain(SELF_DECLARED_BRANCH);
    expect(text).not.toContain("aliases\": [");
    expect(text).toContain("not proof that its visible person matches the contact.");
  });

  it("keeps the ambiguity rule when there are no identities at all", () => {
    const text = brief(contactWith([]));
    expect(text).toContain("### Primary identity provenance: unknown");
    expect(text).toContain(AMBIGUITY_RULE);
    expect(text).not.toContain(SELF_DECLARED_BRANCH);
  });

  it("does not let a self-declared identity that is not primary switch the branch", () => {
    const text = brief(
      contactWith([
        identity({ id: "identity-x", platform: "x", platformUserId: "sasp", platformHandle: "sasp", platformUrl: "https://x.com/sasp", isPrimary: 1, provenanceKind: null }),
        identity({ provenanceKind: "self_declared" }),
      ]),
    );
    expect(text).toContain("### Primary identity provenance: unknown");
    expect(text).toContain(AMBIGUITY_RULE);
  });
});

describe("resolveContactWebResearchPrimaryIdentity", () => {
  const first = identity({ id: "first", provenanceKind: "inferred" });
  const second = identity({ id: "second", provenanceKind: "self_declared" });

  it("prefers the identity marked primary", () => {
    const primary = resolveContactWebResearchPrimaryIdentity(
      contactWith([first, { ...second, isPrimary: 1 }]),
    );
    expect(primary.identity?.id).toBe("second");
    expect(primary.provenanceUsed).toBe("self_declared");
  });

  it("falls back to the first identity when none is marked primary", () => {
    const primary = resolveContactWebResearchPrimaryIdentity(contactWith([first, second]));
    expect(primary.identity?.id).toBe("first");
    expect(primary.provenanceUsed).toBe("inferred");
  });

  it("reads no identities, and a null provenance, as unknown", () => {
    expect(resolveContactWebResearchPrimaryIdentity(contactWith([]))).toEqual({
      identity: null,
      provenanceUsed: "unknown",
    });
    expect(
      resolveContactWebResearchPrimaryIdentity(contactWith([identity({ provenanceKind: null })]))
        .provenanceUsed,
    ).toBe("unknown");
  });

  it("skips inactive identities, which the brief never visits", () => {
    const primary = resolveContactWebResearchPrimaryIdentity(
      contactWith([{ ...second, isPrimary: 1, isActive: 0 }, first]),
    );
    expect(primary.identity?.id).toBe("first");
    expect(
      resolveContactWebResearchPrimaryIdentity(contactWith([{ ...second, isActive: 0 }])),
    ).toEqual({ identity: null, provenanceUsed: "unknown" });
  });

  it("reports one value for every stored kind plus unknown", () => {
    expect(CONTACT_WEB_RESEARCH_IDENTITY_PROVENANCE_USED).toEqual([
      ...IDENTITY_PROVENANCE_KIND_ENUM,
      "unknown",
    ]);
  });
});

describe("provenance from the database reaches the brief", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  async function briefForStoredContact(kind: IdentityProvenanceKind | null) {
    const contact = createContact({ name: "Sas P" });
    await invokeAgentTool("upsert_contact_identity", {
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "sasmita-s",
      platformUrl: "https://www.linkedin.com/in/sasmita-s",
      isPrimary: true,
      ...(kind ? { provenance: { kind, sourceUrl: LUMA } } : {}),
    });
    await invokeAgentTool("enrich_contact", { contactId: contact.id, aliases: ["Sasmita S"] });
    // The same loader runTemplateViaRtx uses to build the research context.
    return brief(getContactById(contact.id)!);
  }

  it("branches on a self_declared identity written through upsert_contact_identity", async () => {
    const text = await briefForStoredContact("self_declared");
    expect(text).toContain("### Primary identity provenance: self_declared");
    expect(text).toContain(`declared on ${LUMA}`);
    expect(text).toContain('Known aliases (already stored, do not resend): "Sasmita S".');
    expect(text).not.toContain(AMBIGUITY_RULE);
  });

  it("keeps the ambiguity rule for an identity stored without provenance (every pre-0040 row)", async () => {
    const contact = createContact({ name: "Legacy Guest" });
    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "legacy-guest",
      platformUrl: "https://www.linkedin.com/in/legacy-guest",
      isPrimary: 1,
    });
    const text = brief(getContactById(contact.id)!);
    expect(text).toContain("### Primary identity provenance: unknown");
    expect(text).toContain(AMBIGUITY_RULE);
    expect(await briefForStoredContact(null)).toContain(AMBIGUITY_RULE);
  });
});

describe("complete_workflow_run accepts the #571 result keys", () => {
  const base = { runId: "run-571", status: "completed" as const };

  it.each(CONTACT_WEB_RESEARCH_IDENTITY_PROVENANCE_USED)(
    "accepts identityProvenanceUsed %s with aliasesAdded",
    (value) => {
      const parsed = completeWorkflowRunSchema.parse({
        ...base,
        result: { identityProvenanceUsed: value, aliasesAdded: ["Sasmita S"] },
      });
      expect(parsed.result).toMatchObject({
        identityProvenanceUsed: value,
        aliasesAdded: ["Sasmita S"],
      });
    },
  );

  it("still accepts a result without them", () => {
    expect(completeWorkflowRunSchema.safeParse({ ...base, result: { fieldsUpdated: [] } }).success).toBe(
      true,
    );
    expect(completeWorkflowRunSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an undeclared branch and an empty alias", () => {
    expect(
      completeWorkflowRunSchema.safeParse({ ...base, result: { identityProvenanceUsed: "guessed" } })
        .success,
    ).toBe(false);
    expect(
      completeWorkflowRunSchema.safeParse({ ...base, result: { aliasesAdded: [""] } }).success,
    ).toBe(false);
  });
});

describe("complete_workflow_run stores the #571 result keys", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    seedTemplates();
    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue({
      emitted: false,
    } as Awaited<ReturnType<typeof workflowEvents.emitWorkflowCompletedEvent>>);
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
  });

  it("persists identityProvenanceUsed and aliasesAdded on a research run", async () => {
    const contact = createContact({ name: "Sas P" });
    const run = createWorkflowRun({
      templateId: getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      config: JSON.stringify({ ...buildContactWebResearchTemplateConfig(), contactId: contact.id }),
    });

    await invokeAgentTool("complete_workflow_run", {
      runId: run.id,
      status: "completed",
      result: {
        fieldsUpdated: ["company", "title", "aliases"],
        verifiedProfileUrls: [],
        profileSectionsInspected: [],
        emailsObserved: 0,
        experiencesUpserted: 2,
        ambiguous: false,
        identityProvenanceUsed: "self_declared",
        aliasesAdded: ["Sasmita S"],
      },
    });

    const stored = getWorkflowRun(run.id)!;
    expect(stored.status).toBe("completed");
    expect(JSON.parse(stored.result ?? "{}")).toMatchObject({
      identityProvenanceUsed: "self_declared",
      aliasesAdded: ["Sasmita S"],
      ambiguous: false,
    });
  });
});
