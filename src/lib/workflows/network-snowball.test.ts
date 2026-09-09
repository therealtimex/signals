import { describe, expect, it } from "vitest";
import {
  NETWORK_SNOWBALL_TEMPLATE_NAME,
  buildNetworkSnowballBriefSection,
  buildNetworkSnowballRunConfig,
  buildNetworkSnowballTemplateConfig,
  clampNetworkSnowballSlider,
  isNetworkSnowballTemplateConfig,
  readNetworkSnowballConfig,
} from "@/lib/workflows/network-snowball";

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
      followOnActions: ["profile_pipeline", "contact_nurture"],
      followOnAction: "profile_pipeline",
      cascadePolicy: "immediate",
    });
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
    });

    expect(brief).toContain("Network Snowball execution contract:");
    expect(brief).toContain("https://x.com/acme/status/987");
    expect(brief).toContain("12 connected contact(s)");
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
    expect(brief).toContain("Auto-commit & Graph Edge Linking");
    expect(brief).toContain("Avatar Enrichment (downstream of identity attestation)");
    expect(brief).toContain("pv-top-card-profile-picture__image");
    expect(brief).toContain("unavatar.io/linkedin/user:");
    expect(brief).toContain("Prefer the platform CDN");
    expect(brief).toContain("Resolver is optional and downstream");
    expect(brief).toContain("leave avatar_url blank");
    expect(brief).toContain("missing imagery must never create pressure to guess an identity");
    expect(brief).toContain("avatars: N/M");
    expect(brief).toContain("workflow-runs/run_snow_1/contacts.csv");
    expect(brief).toContain(
      ".claude/skills/realtimex-signals/scripts/run-signals-pp-cli.sh import contacts --file workflow-runs/run_snow_1/contacts.csv --dedupe --workflow-run-id run_snow_1 --template-id tpl_snow_1",
    );
    expect(brief).toContain("Terminate Spawned Browser Sessions");
    expect(brief).toContain(
      "schedules release of this workflow's linked terminal session after the chat-linked turn finishes"
    );
  });
});
