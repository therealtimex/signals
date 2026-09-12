import { describe, expect, it } from "vitest";
import {
  NETWORK_SNOWBALL_TEMPLATE_NAME,
  buildNetworkSnowballBriefSection,
  buildNetworkSnowballRunConfig,
  buildNetworkSnowballTemplateConfig,
  clampNetworkSnowballSlider,
  isNetworkSnowballTemplateConfig,
  readNetworkSnowballConfig,
  sanitizeNetworkSnowballConfigRecord,
} from "@/lib/workflows/network-snowball";

const browserTarget = {
  targetId: "target-linkedin",
  platform: "linkedin" as const,
  source: "session" as const,
  sessionName: "signals-publish",
  startUrl: "https://www.linkedin.com/in/operator",
  expectedHandle: "/in/operator",
  verifiedHandle: "/in/operator",
  leaseId: "lease-snowball",
  leaseExpiresAt: 1_800_000_000,
  preparedAt: 1_799_999_400,
};

describe("clampNetworkSnowballSlider", () => {
  it("clamps maxContacts into range 1..30", () => {
    expect(clampNetworkSnowballSlider("maxContacts", 0)).toBe(1);
    expect(clampNetworkSnowballSlider("maxContacts", 50)).toBe(30);
    expect(clampNetworkSnowballSlider("maxContacts", 12)).toBe(12);
  });

  it("clamps maxHops into range 1..2", () => {
    expect(clampNetworkSnowballSlider("maxHops", 0)).toBe(1);
    expect(clampNetworkSnowballSlider("maxHops", 5)).toBe(2);
    expect(clampNetworkSnowballSlider("maxHops", 2)).toBe(2);
  });

  it("falls back to default on invalid inputs", () => {
    expect(clampNetworkSnowballSlider("maxContacts", "invalid")).toBe(10);
    expect(clampNetworkSnowballSlider("maxHops", null)).toBe(1);
  });
});

describe("readNetworkSnowballConfig", () => {
  it("fills defaults for an empty config", () => {
    expect(readNetworkSnowballConfig({})).toEqual({
      seedType: "event_url",
      seedValue: "",
      focus: "investors_and_angels",
      maxContacts: 10,
      maxHops: 1,
      targetPlatform: "all",
      autoLinkGraphEdges: true,
      requireApproval: false,
      eventTraversal: {
        adjacentEventDepth: 1,
        eventsPerCalendar: 3,
        maxEvents: 6,
        maxCalendarPages: 2,
        maxGuestPages: 2,
        maxParticipantObservations: 30,
        maxProfileVisits: 20,
        maxProviderRequests: 40,
      },
      participantAccess: { enabled: false, browserSessionName: "signals-publish" },
      followOnActions: [],
      followOnAction: undefined,
      cascadePolicy: "immediate",
    });
  });

  it("reads custom config and trims strings", () => {
    expect(
      readNetworkSnowballConfig({
        seedType: "contact_id",
        seedValue: "  c_123  ",
        focus: "founding_team",
        maxContacts: 20,
        maxHops: 2,
        targetPlatform: "x",
        autoLinkGraphEdges: false,
        requireApproval: true,
        followOnActions: ["profile_pipeline", "contact_nurture"],
      }),
    ).toEqual({
      seedType: "contact_id",
      seedValue: "c_123",
      focus: "founding_team",
      maxContacts: 20,
      maxHops: 2,
      targetPlatform: "x",
      autoLinkGraphEdges: false,
      requireApproval: true,
      eventTraversal: {
        adjacentEventDepth: 1,
        eventsPerCalendar: 3,
        maxEvents: 6,
        maxCalendarPages: 2,
        maxGuestPages: 2,
        maxParticipantObservations: 30,
        maxProfileVisits: 20,
        maxProviderRequests: 40,
      },
      participantAccess: { enabled: false, browserSessionName: "signals-publish" },
      followOnActions: ["profile_pipeline", "contact_nurture"],
      followOnAction: "profile_pipeline",
      cascadePolicy: "immediate",
    });
  });

  it("resolves an enabled empty session to Signals Publish", () => {
    expect(
      readNetworkSnowballConfig({
        participantAccess: { enabled: true, browserSessionName: "   " },
      }).participantAccess,
    ).toEqual({ enabled: true, browserSessionName: "signals-publish" });
  });
});

describe("buildNetworkSnowballTemplateConfig & buildNetworkSnowballRunConfig", () => {
  it("detects template config marker correctly", () => {
    const templateConfig = buildNetworkSnowballTemplateConfig();
    expect(isNetworkSnowballTemplateConfig(templateConfig)).toBe(true);
    expect(isNetworkSnowballTemplateConfig({ otherKey: true })).toBe(false);
  });

  it("round trips through run config", () => {
    const draft = readNetworkSnowballConfig({
      seedType: "event_url",
      seedValue: "https://x.com/founder/status/123",
      focus: "ecosystem_advocates",
      maxContacts: 15,
      maxHops: 1,
      targetPlatform: "all",
      autoLinkGraphEdges: true,
      requireApproval: false,
    });
    const runConfig = buildNetworkSnowballRunConfig(draft);
    expect(readNetworkSnowballConfig(runConfig)).toEqual(draft);
  });

  it("sanitizes event tokens before config persistence", () => {
    const sanitized = sanitizeNetworkSnowballConfigRecord({
      networkSnowball: { version: 1 },
      seedType: "event_url",
      seedValue: "https://luma.com/EventCase?tk=secret&utm_source=test#guests",
      inviteToken: "also-secret",
    });
    expect(sanitized.seedValue).toBe("https://luma.com/EventCase");
    expect(sanitized).not.toHaveProperty("inviteToken");
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });
});

describe("buildNetworkSnowballBriefSection", () => {
  it("generates the server evidence gate while preserving automatic write-back", () => {
    const brief = buildNetworkSnowballBriefSection({
      workflowRunId: "run_snow_1",
      templateId: "tpl_snow_1",
      config: {
        networkSnowball: { version: 1 },
        seedType: "event_url",
        seedValue: "https://x.com/acme/status/987",
        focus: "investors_and_angels",
        maxContacts: 12,
        maxHops: 1,
      },
      snowballIdentityScopeToken: "run_snow_1.scope-secret",
      browserTarget,
    });

    expect(brief).toContain("Network Snowball execution contract:");
    expect(brief).toContain("https://x.com/acme/status/987");
    expect(brief).toContain("Hop 0 graph anchors");
    expect(brief).toContain("Hop 0 Seed Ingestion");
    expect(brief).toContain("create_org");
    expect(brief).toContain("hop0OrgId");
    expect(brief).toContain("PR Newswire");
    expect(brief).toContain("12 connected Hop 1/Hop 2 contact(s)");
    expect(brief).toContain("does not count against maxContacts");
    expect(brief).toContain("Lead VCs, participating funds, and angel investors");
    expect(brief).toContain("Anti-Hallucination & Bot Filter Gate");
    expect(brief).toContain("Engage for visibility, skip for contacts");
    expect(brief).toContain("Anti-Hallucination Rule");
    expect(brief).toContain("Server-Enforced LinkedIn Gate");
    expect(brief).toContain("attest_snowball_linkedin_identity");
    expect(brief).toContain('snowballScopeToken: "run_snow_1.scope-secret"');
    expect(brief).toContain("identity_evidence_token");
    expect(brief).toContain("candidateCompany");
    expect(brief).toContain("same-name candidate with different context");
    expect(brief).toContain("automatically saves every failed attestation");
    expect(brief).toContain("identity_unverified");
    expect(brief).toContain("list_snowball_candidates");
    expect(brief).toContain("Auto-commit & Graph Edge Linking");
    expect(brief).toContain("link_contact_to_org");
    expect(brief).toContain("investor_in");
    expect(brief).toContain("advisor_of");
    expect(brief).toContain("board_member");
    expect(brief).toContain("Do not write `works_at` through `upsert_edge`");
    expect(brief).toContain("org-only, author skipped as aggregator");
    expect(brief).toContain("Avatar Enrichment (downstream of identity attestation)");
    expect(brief).toContain("use the `avatarUrl` returned by `attest_snowball_linkedin_identity`");
    expect(brief).toContain("pv-top-card-profile-picture__image");
    expect(brief).toContain("[componentkey^=\"topcard-\"]");
    expect(brief).toContain("shrink_100_100");
    expect(brief).toContain("scale_100_100");
    expect(brief).toContain("unavatar.io/linkedin/user:");
    expect(brief).toContain("Prefer the platform CDN");
    expect(brief).toContain("Resolver is optional and downstream");
    expect(brief).toContain("leave avatar_url blank");
    expect(brief).toContain("missing imagery must never create pressure to guess an identity");
    expect(brief).toContain("avatars: N/M");
    expect(brief).toContain("N discovered · X committed · Y awaiting verification");
    expect(brief).toContain("workflow-runs/run_snow_1/contacts.csv");
    expect(brief).toContain(
      ".claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/run_snow_1/contacts.csv --dedupe --workflow-run-id run_snow_1 --template-id tpl_snow_1",
    );
    expect(brief).toContain("server-bound session named `signals-publish` only");
    expect(brief).toContain("Never read document.cookie");
    expect(brief).toContain("Never inspect or edit the Signals source tree");
    expect(brief).toContain("Server-Owned Browser Teardown");
    expect(brief).toContain("stops the exact bound session `signals-publish`");
    expect(brief).toContain("releases this run's lease");
    expect(brief).toContain(
      "schedules release of this workflow's linked terminal session after the chat-linked turn finishes"
    );
  });

  it("reuses a company-page orgId as hop0OrgId and skips graph writes when auto-link is off", () => {
    const brief = buildNetworkSnowballBriefSection({
      workflowRunId: "run_org_seed",
      templateId: "tpl_snow_1",
      config: {
        networkSnowball: { version: 1 },
        seedType: "org_id",
        seedValue: "Kepler Computing",
        orgId: "org_kepler",
        autoLinkGraphEdges: false,
        maxContacts: 8,
        maxHops: 1,
      },
      snowballIdentityScopeToken: "run_org_seed.scope-secret",
      browserTarget,
    });

    expect(brief).toContain("reuse config.orgId `org_kepler` as hop0OrgId");
    expect(brief).toContain("autoLinkGraphEdges is false");
    expect(brief).not.toContain("investor_in");
  });

  it("keeps LinkedIn identities out of scope for an X-only bound session", () => {
    const brief = buildNetworkSnowballBriefSection({
      workflowRunId: "run_x_only",
      config: {
        networkSnowball: { version: 1 },
        targetPlatform: "x",
      },
      snowballIdentityScopeToken: "run_x_only.scope-secret",
      browserTarget: {
        ...browserTarget,
        targetId: "target-x",
        platform: "x",
        startUrl: "https://x.com/operator",
        expectedHandle: "@operator",
        verifiedHandle: "@operator",
      },
    });

    expect(brief).toContain("This is an X-only run with no bound LinkedIn target");
    expect(brief).toContain("Do not discover or write LinkedIn identities");
  });
});
