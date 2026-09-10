import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import {
  countContacts,
  createContact,
  getContactById,
  updateContact,
} from "@/lib/db/queries/contacts";
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
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { acquireSessionLease, releaseSessionLease } from "@/lib/leases/session-lease";
import { SNOWBALL_BROWSER_TARGET_CONFIG_KEY } from "@/lib/workflows/network-snowball-target";
import {
  listSnowballCandidates,
  recordSnowballCandidateFailure,
} from "@/lib/workflows/snowball-candidates";

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
  const sessionName = `signals-publish-${run.id}`;
  const ownerHandle = `/in/session-owner-${run.id}`;
  const connection = ensureBrowserConnection({ sessionName });
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform: "linkedin",
    kind: "profile",
    name: ownerHandle,
    handle: ownerHandle,
    capabilities: ["browse", "publish"],
    source: "test",
  });
  const lease = acquireSessionLease(connection.id, {
    holder: `network-snowball:${run.id}`,
    targetId: target.id,
    intent: "browse",
    ttlSeconds: 1_800,
  });
  const scope = mintSnowballIdentityScopeToken(run.id);
  updateWorkflowRun(run.id, {
    config: JSON.stringify({
      ...buildNetworkSnowballTemplateConfig(),
      [SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY]: scope.tokenHash,
      [SNOWBALL_BROWSER_TARGET_CONFIG_KEY]: {
        targetId: target.id,
        platform: "linkedin",
        source: "session",
        sessionName,
        startUrl: `https://www.linkedin.com${ownerHandle}`,
        expectedHandle: ownerHandle,
        verifiedHandle: ownerHandle,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1_000),
      },
    }),
  });
  return { template, run: getWorkflowRun(run.id)!, scopeToken: scope.token, sessionName };
}

const VIEWER_NAV_THUMB =
  "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_100_100/0/1";
const VIEWER_TOP_CARD =
  "https://media.licdn.com/dms/image/v2/C5103AQHThgCA9BePxw/profile-displayphoto-shrink_400_400/0/1";
const JANE_TOP_CARD =
  "https://media.licdn.com/dms/image/v2/D4E03AQJaneAsset99/profile-displayphoto-shrink_400_400/0/1";

function observe(overrides: Partial<{
  finalUrl: string;
  authenticated: boolean;
  visibleName: string;
  headline: string;
  topCardText: string;
  unavailable: boolean;
  avatarUrl: string | null;
  sessionViewerAvatarUrl: string | null;
}> = {}) {
  return async () => ({
    finalUrl: "https://www.linkedin.com/in/jane-doe/?trk=public_profile",
    authenticated: true,
    visibleName: "Jane Doe",
    headline: "Founder & CEO at Acme, Inc.",
    topCardText: "Jane Doe Founder & CEO at Acme San Francisco",
    unavailable: false,
    avatarUrl: null,
    sessionViewerAvatarUrl: null,
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
    const { template, run, scopeToken, sessionName } = createSnowballRun();
    recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme Inc.",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/guessed-jane/",
      reason: "profile_corroboration_missing",
      message: "The first pass did not show corroboration",
    });
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
      browserSessionName: sessionName,
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
    expect(listSnowballCandidates({ workflowRunId: run.id }).data[0]).toMatchObject({
      status: "promoted",
      promotedContactId: contact.id,
      promotedIdentityId: contact.identities[0].id,
      promotedOrgId: contact.currentEmployment?.orgId,
    });
  });

  it("rejects direct Snowball create and upsert paths without evidence", async () => {
    const { template, run } = createSnowballRun();

    await expect(invokeAgentTool("create_contact", {
      name: "Bare LinkedIn Candidate",
      company: "Acme Inc.",
      title: "Investor",
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "linkedin_identity_evidence_required" },
    });
    expect(countContacts()).toBe(0);

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

  it("requires every accepted LinkedIn cohort contact to have run-bound evidence", () => {
    const { template, run } = createSnowballRun();
    const bareContact = createContact(
      { name: "Bare Candidate", company: "Acme Inc.", title: "Investor" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );

    expect(auditSnowballLinkedInIdentityEvidence(
      getWorkflowRun(run.id)!,
      [bareContact.id],
    )).toEqual({
      errors: [`snowball_linkedin_identity_missing:${bareContact.id}`],
      auditedIdentityIds: [],
    });
  });

  it("keeps bare contact creation available to X-only Snowball runs", async () => {
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
      config: JSON.stringify({
        ...buildNetworkSnowballTemplateConfig(),
        targetPlatform: "x",
        [SNOWBALL_BROWSER_TARGET_CONFIG_KEY]: {
          targetId: "target-x",
          platform: "x",
          source: "session",
          sessionName: "signals-publish",
          startUrl: "https://x.com/operator",
          expectedHandle: "@operator",
          verifiedHandle: "@operator",
          leaseId: "lease-x",
          leaseExpiresAt: Math.floor(Date.now() / 1_000) + 1_800,
          preparedAt: Math.floor(Date.now() / 1_000),
        },
      }),
    });

    const created = await invokeAgentTool("create_contact", {
      name: "X Candidate",
      company: "Acme Inc.",
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    expect(getContactById(created.id)).toMatchObject({
      name: "X Candidate",
      createdWorkflowRunId: run.id,
      identities: [],
    });
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

  it("binds direct create and upsert writes to the corroborated company and title", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);

    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Different Company",
      title: "Founder",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        reason: "evidence_candidate_mismatch",
        candidateField: "company",
      },
    });
    expect(countContacts()).toBe(0);

    const existing = createContact(
      {
        name: "Jane Doe",
        company: "Acme Inc.",
        title: "Chief Financial Officer",
      },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );
    await expect(invokeAgentTool("upsert_contact_identity", {
      contactId: existing.id,
      platform: "linkedin",
      candidateCompany: "Acme Inc.",
      candidateTitle: "Founder",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        reason: "evidence_candidate_mismatch",
        candidateField: "title",
      },
    });
    expect(getContactById(existing.id)).toMatchObject({
      company: "Acme Inc.",
      title: "Chief Financial Officer",
      identities: [],
    });
  });

  it("does not let completion bless a contact whose candidate context drifted", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);
    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    updateContact(created.id, { title: "Chief Financial Officer" }, "test:context-drift");
    const identityId = getContactById(created.id)!.identities[0].id;
    expect(auditSnowballLinkedInIdentityEvidence(
      getWorkflowRun(run.id)!,
      [created.id],
    )).toEqual({
      errors: [`snowball_linkedin_identity_evidence_missing:${created.id}`],
      auditedIdentityIds: [identityId],
    });
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
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: first.run.id,
      templateId: first.template.id,
    });
    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
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
        candidateCompany: "Acme Inc.",
        candidateTitle: "Founder",
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

  it("binds the attested top-card avatar and drops a session-viewer navbar thumb", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken, {
      avatarUrl: JANE_TOP_CARD,
      sessionViewerAvatarUrl: VIEWER_NAV_THUMB,
    });
    expect(evidence.avatarUrl).toBe(JANE_TOP_CARD);

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      avatarUrl: VIEWER_NAV_THUMB,
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    const contact = getContactById(created.id)!;
    expect(contact.identities[0].avatarUrl).toBe(JANE_TOP_CARD);
  });

  it("drops an attested CDN photo that collides with the session viewer's asset", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken, {
      avatarUrl: VIEWER_TOP_CARD,
      sessionViewerAvatarUrl: VIEWER_NAV_THUMB,
    });
    expect(evidence.avatarUrl).toBeNull();

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      avatarUrl: VIEWER_TOP_CARD,
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    const contact = getContactById(created.id)!;
    expect(contact.identities[0].avatarUrl).toBeNull();
  });

  it("drops a navbar thumbnail when attestation did not bind a top-card photo", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken, {
      avatarUrl: VIEWER_NAV_THUMB,
      sessionViewerAvatarUrl: VIEWER_NAV_THUMB,
    });
    expect(evidence.avatarUrl).toBeNull();

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      avatarUrl: VIEWER_NAV_THUMB,
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    const contact = getContactById(created.id)!;
    expect(contact.identities[0].avatarUrl).toBeNull();
  });

  it("drops a larger CDN photo that collides with the session viewer's asset", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken, {
      avatarUrl: null,
      sessionViewerAvatarUrl: VIEWER_NAV_THUMB,
    });

    const created = await invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
      platform: "linkedin",
      avatarUrl: VIEWER_TOP_CARD,
      identityEvidenceToken: evidence.identityEvidenceToken,
      workflowRunId: run.id,
      templateId: template.id,
    }) as { id: string };

    const contact = getContactById(created.id)!;
    expect(contact.identities[0].avatarUrl).toBeNull();
  });

  it("rejects an avatar resolver slug that differs from the attested identity", async () => {
    const { template, run, scopeToken } = createSnowballRun();
    const evidence = await attest(scopeToken);

    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme Inc.",
      title: "Founder",
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

  it("rejects attestation before browser navigation when the bound lease is gone", async () => {
    const { run, scopeToken } = createSnowballRun();
    const config = JSON.parse(run.config ?? "{}") as Record<string, unknown>;
    const target = config[SNOWBALL_BROWSER_TARGET_CONFIG_KEY] as { leaseId: string };
    releaseSessionLease(target.leaseId);
    const observer = vi.fn(observe());

    await expect(attestSnowballLinkedInIdentity(
      {
        snowballScopeToken: scopeToken,
        candidateName: "Jane Doe",
        candidateCompany: "Acme Inc.",
        candidateTitle: "Founder",
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
      },
      { observe: observer },
    )).rejects.toMatchObject({ reason: "browser_target_unavailable" });
    expect(observer).not.toHaveBeenCalled();
  });
});
