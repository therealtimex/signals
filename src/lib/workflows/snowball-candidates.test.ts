import { beforeEach, describe, expect, it } from "vitest";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AgentToolError } from "@/lib/agent-tools/types";
import { handleAttestSnowballLinkedInIdentity } from "@/lib/agent-tools/handlers";
import { PATCH as updateCandidateRoute } from "@/app/api/snowball-candidates/[id]/route";
import { db } from "@/lib/db/client";
import {
  contactEmployments,
  contactIdentities,
  contacts,
  orgs,
} from "@/lib/db/schema";
import { createContact, getContactById } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { createOrgIdentity } from "@/lib/db/queries/org-identities";
import { createOrg } from "@/lib/db/queries/orgs";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import {
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";
import {
  SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY,
  SNOWBALL_HUMAN_QUARANTINE_PROMOTION_KEY,
  SnowballIdentityEvidenceError,
  auditSnowballLinkedInIdentityEvidence,
  mintSnowballIdentityScopeToken,
} from "@/lib/workflows/snowball-identity-evidence";
import {
  buildNetworkSnowballRunConfig,
  readNetworkSnowballConfig,
} from "@/lib/workflows/network-snowball";
import {
  getSnowballCandidateStats,
  listSnowballCandidateFailureReasons,
  listSnowballCandidates,
  markMatchingSnowballCandidatesPromoted,
  recordSnowballCandidateFailure,
  SnowballCandidateTransitionError,
  summarizeSnowballCandidates,
  updateSnowballCandidateReviewStatus,
} from "@/lib/workflows/snowball-candidates";
import {
  promoteSnowballCandidate,
  SnowballCandidatePromoteError,
} from "@/lib/workflows/snowball-candidate-promote";

function createScopedSnowballRun() {
  const config = buildNetworkSnowballRunConfig(readNetworkSnowballConfig({
    seedType: "event_url",
    seedValue: "https://example.com/acme-seed",
    focus: "founding_team",
    maxContacts: 10,
    maxHops: 1,
    targetPlatform: "linkedin",
    autoLinkGraphEdges: true,
    requireApproval: false,
  }));
  const template = createTemplate({
    name: "Network Snowball",
    templateType: "prospecting",
    status: "active",
    config: JSON.stringify(config),
  });
  const run = createWorkflowRun({
    templateId: template.id,
    workflowType: "search",
    status: "running",
    trigger: "template",
    config: JSON.stringify(config),
  });
  const scope = mintSnowballIdentityScopeToken(run.id);
  updateWorkflowRun(run.id, {
    config: JSON.stringify({
      ...config,
      [SNOWBALL_IDENTITY_SCOPE_TOKEN_CONFIG_KEY]: scope.tokenHash,
    }),
  });
  return { run: getWorkflowRun(run.id)!, scopeToken: scope.token };
}

describe("Snowball candidate quarantine", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("automatically quarantines a failed scoped attestation without graph writes", async () => {
    const { run, scopeToken } = createScopedSnowballRun();
    const input = {
      snowballScopeToken: scopeToken,
      candidateName: "Jane Doe",
      candidateCompany: "Acme Inc.",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/jane-doe/?trk=search",
    };

    const thrown = await handleAttestSnowballLinkedInIdentity(input, {
      attest: async () => {
        throw new SnowballIdentityEvidenceError(
          "profile_corroboration_missing",
          "The LinkedIn top card did not corroborate the candidate company or role.",
          { finalUrl: "https://www.linkedin.com/in/jane-doe/" },
        );
      },
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentToolError);
    expect((thrown as AgentToolError).details).toMatchObject({
      reason: "profile_corroboration_missing",
      candidateStatus: "identity_unverified",
      quarantined: true,
    });
    expect(listSnowballCandidates({ workflowRunId: run.id }).data).toMatchObject([
      {
        workflowRunId: run.id,
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
        proposedName: "Jane Doe",
        proposedCompany: "Acme Inc.",
        proposedTitle: "Founder",
        seedValue: "https://example.com/acme-seed",
        status: "identity_unverified",
        failureReason: "profile_corroboration_missing",
        attemptCount: 1,
      },
    ]);
    expect(db.select().from(contacts).all()).toHaveLength(0);
    expect(db.select().from(orgs).all()).toHaveLength(0);
    expect(db.select().from(contactIdentities).all()).toHaveLength(0);
    expect(db.select().from(contactEmployments).all()).toHaveLength(0);
  });

  it("upserts repeat failures idempotently and preserves bounded attempt history", () => {
    const { run } = createScopedSnowballRun();
    const base = {
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      candidateTitle: "Founder",
      profileUrl: "https://linkedin.com/in/Jane-Doe/?trk=one",
      reason: "profile_name_mismatch",
      message: "Name mismatch",
    };
    recordSnowballCandidateFailure({ ...base, now: 100 });
    recordSnowballCandidateFailure({
      ...base,
      reason: "profile_corroboration_missing",
      message: "Company mismatch",
      now: 200,
    });

    const candidates = listSnowballCandidates({ workflowRunId: run.id }).data;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      attemptCount: 2,
      lastAttemptAt: 200,
      failureReason: "profile_corroboration_missing",
    });
    expect(candidates[0].failureHistory).toHaveLength(2);
    expect(summarizeSnowballCandidates(run.id)).toEqual({
      total: 1,
      awaitingVerification: 1,
      promoted: 0,
      dismissed: 0,
    });
  });

  it("filters the global queue by search and gate failure", () => {
    const { run } = createScopedSnowballRun();
    recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme Robotics",
      candidateTitle: "Founder",
      profileUrl: "https://linkedin.com/in/jane-doe/",
      reason: "profile_corroboration_missing",
      message: "Company was not visible",
    });
    recordSnowballCandidateFailure({
      run,
      candidateName: "John Smith",
      candidateCompany: "Beta Labs",
      candidateTitle: "CTO",
      profileUrl: "https://linkedin.com/in/john-smith/",
      reason: "profile_name_mismatch",
      message: "Name did not match",
    });

    expect(listSnowballCandidates({ search: "robotics" }).data).toMatchObject([
      { proposedName: "Jane Doe" },
    ]);
    expect(listSnowballCandidates({ failureReason: "profile_name_mismatch" }).data).toMatchObject([
      { proposedName: "John Smith" },
    ]);
    expect(listSnowballCandidateFailureReasons()).toEqual([
      "profile_corroboration_missing",
      "profile_name_mismatch",
    ]);
  });

  it("dismisses and reopens unverified candidates without promoting them", () => {
    const { run } = createScopedSnowballRun();
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      profileUrl: "https://linkedin.com/in/jane-doe/",
      reason: "profile_corroboration_missing",
      message: "Company was not visible",
    })!;

    expect(updateSnowballCandidateReviewStatus(candidate.id, "dismissed", 200)).toMatchObject({
      status: "dismissed",
      updatedAt: 200,
    });
    expect(getSnowballCandidateStats()).toEqual({
      identity_unverified: 0,
      promoted: 0,
      dismissed: 1,
    });
    expect(updateSnowballCandidateReviewStatus(candidate.id, "identity_unverified", 300))
      .toMatchObject({ status: "identity_unverified", updatedAt: 300 });
    expect(updateSnowballCandidateReviewStatus("missing", "dismissed")).toBeUndefined();
  });

  it("exposes reversible review status through the candidate route", async () => {
    const { run } = createScopedSnowballRun();
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      profileUrl: "https://linkedin.com/in/jane-doe/",
      reason: "profile_corroboration_missing",
      message: "Company was not visible",
    })!;

    const response = await updateCandidateRoute(new Request("http://signals.local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    }), { params: Promise.resolve({ id: candidate.id }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "dismissed" });

    const missing = await updateCandidateRoute(new Request("http://signals.local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    }), { params: Promise.resolve({ id: "missing" }) });
    expect(missing.status).toBe(404);
  });

  it("marks the exact person/company candidate promoted after canonical evidence is bound", () => {
    const { run } = createScopedSnowballRun();
    recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      reason: "profile_corroboration_missing",
      message: "Company was not visible yet",
    });
    const contact = createContact(
      { name: "Jane Doe", company: "Acme", title: "Founder" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: run.templateId },
    );
    const identity = createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: "jane-doe",
      platformHandle: "jane-doe",
      platformUrl: "https://www.linkedin.com/in/jane-doe/",
    });

    const ids = markMatchingSnowballCandidatesPromoted({
      profileUrl: identity.platformUrl!,
      candidateName: contact.name,
      candidateCompany: contact.company,
      candidateTitle: contact.title,
      contactId: contact.id,
      identityId: identity.id,
      orgId: contact.currentEmployment?.orgId,
      now: 300,
    });

    expect(ids).toHaveLength(1);
    expect(listSnowballCandidates({ workflowRunId: run.id }).data[0]).toMatchObject({
      status: "promoted",
      promotedContactId: contact.id,
      promotedIdentityId: identity.id,
      promotedOrgId: contact.currentEmployment?.orgId,
      promotedAt: 300,
    });
    expect(() => updateSnowballCandidateReviewStatus(ids[0], "dismissed"))
      .toThrow(SnowballCandidateTransitionError);
  });
});

describe("Snowball candidate human promote", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("promotes an unverified candidate into canonical contact, identity, and company records", () => {
    const { run } = createScopedSnowballRun();
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/jane-doe/?trk=search",
      reason: "profile_name_missing",
      message: "No visible profile name was found in the LinkedIn top card.",
    })!;

    const promoted = promoteSnowballCandidate(candidate.id, {
      confirmed: true,
      now: 400,
    });

    expect(promoted).toMatchObject({
      status: "promoted",
      proposedName: "Jane Doe",
      promotedAt: 400,
    });
    const contact = getContactById(promoted.promotedContactId!)!;
    expect(contact).toMatchObject({
      name: "Jane Doe",
      company: "Acme",
      title: "Founder",
      createdSource: "manual",
      createdSourceDetail: "manual:snowball_quarantine",
      createdWorkflowRunId: run.id,
      createdTemplateId: run.templateId,
    });
    expect(contact.identities).toEqual([
      expect.objectContaining({
        platform: "linkedin",
        platformUserId: "jane-doe",
        platformUrl: "https://www.linkedin.com/in/jane-doe/",
      }),
    ]);
    const platformData = JSON.parse(contact.identities[0].platformData ?? "{}");
    expect(platformData[SNOWBALL_HUMAN_QUARANTINE_PROMOTION_KEY]).toMatchObject({
      version: 1,
      candidateId: candidate.id,
      workflowRunId: run.id,
      failureReason: "profile_name_missing",
    });
    expect(platformData.signalsIdentityEvidence).toBeUndefined();
    expect(JSON.parse(getWorkflowRun(run.id)?.result ?? "{}")._snowballIdentityEvidence ?? [])
      .toEqual([]);
    expect(contact.currentEmployment?.orgId).toBe(promoted.promotedOrgId);
    expect(db.select().from(orgs).all()).toHaveLength(1);
    expect(auditSnowballLinkedInIdentityEvidence(getWorkflowRun(run.id)!, [contact.id])).toEqual({
      errors: [],
      auditedIdentityIds: [contact.identities[0].id],
    });
  });

  it("reuses an existing LinkedIn contact instead of creating a duplicate", () => {
    const { run } = createScopedSnowballRun();
    const existing = createContact({ name: "Jane Existing" }, "manual:create_contact");
    const identity = createIdentity({
      contactId: existing.id,
      platform: "linkedin",
      platformUserId: "jane-doe",
      platformHandle: "jane-doe",
      platformUrl: "https://www.linkedin.com/in/jane-doe/",
    });
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      reason: "profile_corroboration_missing",
      message: "Company was not visible",
    })!;

    const promoted = promoteSnowballCandidate(candidate.id, { confirmed: true });
    expect(promoted.promotedContactId).toBe(existing.id);
    expect(promoted.promotedIdentityId).toBe(identity.id);
    expect(db.select().from(contacts).all()).toHaveLength(1);
  });

  it("rejects dismissed rows, missing confirmation, invalid URLs, and org-held LinkedIn identities", async () => {
    const { run } = createScopedSnowballRun();
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      reason: "profile_name_missing",
      message: "No visible profile name",
    })!;

    updateSnowballCandidateReviewStatus(candidate.id, "dismissed");
    expect(() => promoteSnowballCandidate(candidate.id, { confirmed: true }))
      .toThrow(SnowballCandidateTransitionError);
    updateSnowballCandidateReviewStatus(candidate.id, "identity_unverified");

    const unconfirmed = await updateCandidateRoute(new Request("http://signals.local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "promote" }),
    }), { params: Promise.resolve({ id: candidate.id }) });
    expect(unconfirmed.status).toBe(400);

    expect(() => promoteSnowballCandidate(candidate.id, {
      confirmed: true,
      profileUrl: "https://example.com/jane",
    })).toThrow(SnowballCandidatePromoteError);

    const org = createOrg({ name: "Acme Org" });
    createOrgIdentity({
      orgId: org.id,
      platform: "linkedin",
      platformUserId: "jane-doe",
      platformHandle: "jane-doe",
      platformUrl: "https://www.linkedin.com/in/jane-doe/",
    });
    expect(() => promoteSnowballCandidate(candidate.id, { confirmed: true }))
      .toThrow(/organization/i);
    expect(db.select().from(contacts).all()).toHaveLength(0);
  });

  it("keeps agent create_contact fail-closed while the dashboard promote path works", async () => {
    const { run } = createScopedSnowballRun();
    const candidate = recordSnowballCandidateFailure({
      run,
      candidateName: "Jane Doe",
      candidateCompany: "Acme",
      candidateTitle: "Founder",
      profileUrl: "https://www.linkedin.com/in/jane-doe/",
      reason: "profile_name_missing",
      message: "No visible profile name",
    })!;

    await expect(invokeAgentTool("create_contact", {
      name: "Jane Doe",
      company: "Acme",
      title: "Founder",
      platform: "linkedin",
      platformUserId: "jane-doe",
      workflowRunId: run.id,
      templateId: run.templateId,
    })).rejects.toMatchObject({
      details: { reason: "linkedin_identity_evidence_required" },
    });

    const response = await updateCandidateRoute(new Request("http://signals.local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "promote",
        confirmed: true,
        name: "Jane Doe",
        company: "Acme",
        title: "Founder",
        profileUrl: "https://www.linkedin.com/in/jane-doe/",
      }),
    }), { params: Promise.resolve({ id: candidate.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "promoted" });
    expect(db.select().from(contacts).all()).toHaveLength(1);
  });
});
