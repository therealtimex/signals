import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  SNOWBALL_IDENTITY_EVIDENCE_RESULT_KEY,
  SNOWBALL_IDENTITY_PLATFORM_DATA_KEY,
  SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY,
  SnowballIdentityEvidenceError,
  auditSnowballLinkedInIdentityEvidence,
  attestSnowballLinkedInIdentity,
  claimSnowballLinkedInEvidence,
  mintSnowballIdentityScopeToken,
} from "@/lib/workflows/snowball-identity-evidence";
import { buildNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";

function createSnowballRun() {
  const template = createTemplate({
    name: "Network Snowball",
    templateType: "prospecting",
    status: "active",
    config: JSON.stringify(buildNetworkSnowballTemplateConfig()),
  });
  const run = createWorkflowRun({
    templateId: template.id,
    workflowType: "search",
    status: "running",
    trigger: "template",
    startedAt: 1_800_000_000,
    config: JSON.stringify(buildNetworkSnowballTemplateConfig()),
  });
  const scope = mintSnowballIdentityScopeToken(run.id);
  updateWorkflowRun(run.id, {
    config: JSON.stringify({
      ...buildNetworkSnowballTemplateConfig(),
      [SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY]: scope.tokenHash,
    }),
  });
  return { template, run: getWorkflowRun(run.id)!, scopeToken: scope.token };
}

function observe(overrides: Partial<{
  finalUrl: string;
  authenticated: boolean;
  visibleName: string;
  headline: string;
  topCardText: string;
  unavailable: boolean;
}> = {}) {
  return async () => ({
    finalUrl: "https://www.linkedin.com/in/jane-doe/?trk=public_profile",
    authenticated: true,
    visibleName: "Jane Doe",
    headline: "Founder & CEO at Acme, Inc.",
    topCardText: "Jane Doe Founder & CEO at Acme San Francisco",
    unavailable: false,
    ...overrides,
  });
}

async function attest(
  scopeToken: string,
  overrides: Parameters<typeof observe>[0] = {},
) {
  return attestSnowballLinkedInIdentity(
    {
      snowballScopeToken: scopeToken,
      candidateName: "Jane Doe",
      candidateCompany: "Acme Inc.",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/guessed-jane/",
    },
    { observe: observe(overrides), now: () => 1_800_000_100 },
  );
}

describe("Snowball LinkedIn identity evidence", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("derives the persisted identity from the final browser URL before auto-commit", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      platformUserId: "guessed-jane",
      platformHandle: "guessed-jane",
      platformUrl: "https://www.linkedin.com/in/guessed-jane/",
      avatarUrl: "https://unavatar.io/linkedin/user:jane-doe",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    const contact = getContactById(created.id)!;
    expect(contact.createdWorkflowRunId).toBe(run.id);
    expect(contact.identities).toHaveLength(1);
    expect(contact.identities[0]).toMatchObject({
      platform: "linkedin",
      platformUserId: "jane-doe",
      platformHandle: "jane-doe",
      platformUrl: "https://www.linkedin.com/in/jane-doe/",
      displayName: "Jane Doe",
      headline: "Founder & CEO at Acme, Inc.",
    });
    const platformData = JSON.parse(contact.identities[0].platformData ?? "{}");
    expect(platformData[SNOWBALL_IDENTITY_PLATFORM_DATA_KEY]).toMatchObject({
      version: 1,
      workflowRunId: run.id,
      browserSessionName: "signals-publish",
      matchedSignals: expect.arrayContaining(["company:Acme Inc.", "title:Founder"]),
    });
    const ledger = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")[
      SNOWBALL_IDENTITY_EVIDENCE_RESULT_KEY
    ];
    expect(ledger).toEqual([
      expect.objectContaining({
        platformUserId: "jane-doe",
        contactId: created.id,
        identityId: contact.identities[0].id,
        consumedAt: expect.any(Number),
      }),
    ]);
    expect(auditSnowballLinkedInIdentityEvidence(
      getWorkflowRun(run.id)!,
      [created.id],
    )).toEqual({
      errors: [],
      auditedIdentityIds: [contact.identities[0].id],
    });
  });

  it("rejects direct Snowball create and upsert paths without evidence", async () => {
    const { template, run } = createSnowballRun();

    await expect(invokeAgentTool("create_contact", {
      name: "Guessed Person",
      platform: "linkedin",
      platformUserId: "guessed-person",
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "linkedin_identity_evidence_required" },
    });

    await expect(invokeAgentTool("create_contact", {
      name: "Unattributed Bypass",
      platform: "linkedin",
      platformUserId: "unattributed-bypass",
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "linkedin_identity_evidence_required" },
    });

    const contact = createContact(
      { name: "Guessed Person" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );
    await expect(invokeAgentTool("upsert_contact_identity", {
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "guessed-person",
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "linkedin_identity_evidence_required" },
    });
    expect(getContactById(contact.id)?.identities).toHaveLength(0);
  });

  it("rejects mismatched, uncorroborated, and unauthenticated browser observations", async () => {
    const { scopeToken } = createSnowballRun();

    await expect(attest(scopeToken, { visibleName: "A Different Jane" })).rejects.toMatchObject({
      reason: "profile_name_mismatch",
    });
    await expect(attest(scopeToken, {
      headline: "Independent consultant",
      topCardText: "Jane Doe Independent consultant London",
    })).rejects.toMatchObject({ reason: "profile_corroboration_missing" });
    await expect(attest(scopeToken, {
      finalUrl: "https://www.linkedin.com/authwall?trk=profile",
      authenticated: false,
    })).rejects.toMatchObject({ reason: "profile_not_authenticated" });
  });

  it("binds tokens to one run and candidate and rejects replay", async () => {
    const first = createSnowballRun();
    const second = createSnowballRun();
    const evidence = await attest(first.scopeToken);

    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: second.run.id,
      templateId: second.template.id,
    })).rejects.toMatchObject({
      details: { reason: "evidence_run_mismatch" },
    });

    await expect(invokeAgentTool("create_contact", {
      name: "Someone Else",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: first.run.id,
      templateId: first.template.id,
    })).rejects.toMatchObject({
      details: { reason: "evidence_candidate_mismatch" },
    });

    await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: first.run.id,
      templateId: first.template.id,
    });
    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: first.run.id,
      templateId: first.template.id,
    })).rejects.toMatchObject({ details: { reason: "evidence_replayed" } });
  });

  it("rejects expired evidence before a Snowball write can consume it", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);

    try {
      claimSnowballLinkedInEvidence({
        identityEvidenceToken: evidence.identityEvidenceToken,
        candidateName: "Jane Doe",
        workflowRunId: run.id,
        templateId: template.id,
        now: 1_800_001_001,
      });
      throw new Error("Expected expired Snowball identity evidence to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(SnowballIdentityEvidenceError);
      expect(error).toMatchObject({ reason: "evidence_expired" });
    }
  });

  it("rejects an avatar resolver slug that differs from the attested identity", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);

    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      platform: "linkedin",
      avatarUrl: "https://unavatar.io/linkedin/user:guessed-jane",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "A LinkedIn Unavatar URL must use the exact profile slug derived from browser evidence.",
    });
  });

  it("fails closed when the scope token belongs to another dispatch", async () => {
    const first = createSnowballRun();
    const second = createSnowballRun();
    await expect(attestSnowballLinkedInIdentity(
      {
        snowballScopeToken: `${first.run.id}.${second.scopeToken.split(".").at(-1)}`,
        candidateName: "Jane Doe",
        candidateCompany: "Acme",
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
      },
      { observe: observe() },
    )).rejects.toBeInstanceOf(SnowballIdentityEvidenceError);
  });
});
