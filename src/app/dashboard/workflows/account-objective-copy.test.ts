import { describe, expect, it } from "vitest";
import {
  buildAccountObjectiveRunInput,
  customerPainText,
  emptyObjectiveDraft,
  launchedObjectiveLine,
  limitationSentence,
  limitationsShort,
  objectiveDraftFromTemplate,
  refusalText,
  relationBadge,
  sourcesChangedAnnouncement,
  sourcesStaleFollowUp,
  splitMentions,
  suggestBriefName,
  validateObjectiveDraft,
  type ObjectiveLimitsView,
} from "@/app/dashboard/workflows/account-objective-copy";
import { OBJECTIVE_BRIEF_TEMPLATE } from "@/lib/writing/objective-brief";

const entry = (slug: string, name: string, proofPointCount = 2) => ({
  raw: `@PRODUCTS.md#${slug}`,
  path: "PRODUCTS.md" as const,
  anchor: slug,
  resolved: {
    fileHash: "f",
    excerpt: `## ${name}`,
    excerptHash: "e",
    entry: { slug, name, oneLiner: null, proofPointCount, sectionHash: "s" },
  },
  unresolvedReason: null,
});
const file = (path: "BRAND.md" | "VOICE.md", resolved: boolean) => ({
  raw: `@${path}`,
  path,
  anchor: null,
  resolved: resolved ? { fileHash: "f", excerpt: "# Brand", excerptHash: "e", entry: null } : null,
  unresolvedReason: resolved ? null : "file_absent" as const,
});

describe("limitation copy (contract §4.3)", () => {
  it("renders every limitation sentence from the view", () => {
    const missingEntry = { ...entry("onboarding-kit", "x"), resolved: null, unresolvedReason: "entry_absent" as const };
    const view: ObjectiveLimitsView = {
      mentions: [missingEntry, file("VOICE.md", false)],
      offering: null,
      limitations: [],
    };
    expect(limitationSentence("offering_missing", view)).toBe(
      "No product from PRODUCTS.md is mentioned, so drafts ask discovery questions only and don't name or pitch an offering.",
    );
    expect(limitationSentence("offering_unresolved", view)).toBe(
      "@PRODUCTS.md#onboarding-kit isn't in PRODUCTS.md, so drafts treat the offering as missing: discovery questions only.",
    );
    expect(limitationSentence("offering_unresolved", {
      ...view,
      mentions: [{ ...missingEntry, unresolvedReason: "file_absent" }],
    })).toBe(
      "There's no PRODUCTS.md in the workspace, so @PRODUCTS.md#onboarding-kit can't be found. Drafts treat the offering as missing: discovery questions only.",
    );
    expect(limitationSentence("offering_ambiguous", {
      ...view,
      mentions: [entry("engineering-workflow", "Engineering Workflow"), entry("release-ops", "Release Ops Pilot", 0)],
    })).toBe(
      "The brief mentions more than one product (Engineering Workflow, Release Ops Pilot), so drafts don't name or pitch any of them.",
    );
    expect(limitationSentence("offering_proof_missing", {
      ...view,
      offering: { name: "Release Ops Pilot", proofPointCount: 0 },
    })).toBe(
      "Release Ops Pilot has no proof points in PRODUCTS.md, so drafts make no claims about what it does or achieves.",
    );
    expect(limitationSentence("mention_unresolved", view)).toBe(
      "@VOICE.md isn't in the workspace, so the agent doesn't have it.",
    );
    expect(limitationSentence("mention_unresolved", {
      ...view,
      mentions: [file("VOICE.md", false), { ...file("BRAND.md", false) }],
    })).toBe("@VOICE.md, @BRAND.md aren't in the workspace, so the agent doesn't have them.");
    expect(limitationSentence("fit_missing", view)).toBe(
      "The brief has no Fit, so drafts can test whether there's a fit but don't assume one.",
    );
    expect(limitationSentence("success_missing", view)).toBe(
      "The brief has no Success, so success isn't defined for this run. The next step still applies.",
    );
    expect(limitationsShort(["offering_missing", "fit_missing", "success_missing"])).toBe(
      "no offering · fit not stated · success not defined",
    );
  });
});

describe("Ask copy (contract §4.1–4.2)", () => {
  it("labels each relation", () => {
    expect(relationBadge({ relation: "advances" })).toEqual({ label: "Advances outcome", variant: "success" });
    expect(relationBadge({ relation: "tests", testsUncertainty: 2 })).toEqual({ label: "Tests unknown 2", variant: "info" });
    expect(relationBadge({ relation: "defers" })).toEqual({ label: "Defers outcome", variant: "warning" });
    expect(relationBadge({ relation: "relationship_only" })).toEqual({ label: "Relationship only", variant: "secondary" });
  });

  it("describes customer pain without claim ids", () => {
    expect(customerPainText({ status: "none_assumed" })).toBe("none assumed");
    expect(customerPainText({ status: "asked", text: "Whether onboarding slows releases" })).toBe(
      "asked, not assumed — “Whether onboarding slows releases”",
    );
    expect(customerPainText({
      status: "evidenced",
      claims: [
        { claimId: "clm_1", text: null, sensitivity: "public" },
        { claimId: "clm_2", text: "Asked publicly for onboarding tools", sensitivity: "public" },
        { claimId: "clm_3", text: "Another", sensitivity: "public" },
      ],
    })).toBe("from a source — “Asked publicly for onboarding tools” and 2 more");
    expect(customerPainText({
      status: "evidenced",
      claims: [{ claimId: "clm_1", text: "DM said onboarding hurts", sensitivity: "private" }],
    })).toBe("from a private source — “DM said onboarding hurts”");
    expect(customerPainText({
      status: "evidenced",
      claims: [{ claimId: "clm_1", text: null, sensitivity: "public" }, { claimId: "clm_2", text: null, sensitivity: "public" }],
    })).toBe("from 2 cited sources");
    expect(customerPainText({ status: "evidenced", claims: [{ claimId: "clm_1", text: null, sensitivity: "public" }] }))
      .toBe("from 1 cited source");
  });
});

describe("stale sources copy (contract v2 addendum 1)", () => {
  it("B1: shows only the sentences whose condition holds, in order", () => {
    expect(sourcesStaleFollowUp({ revoked: 0, pendingReview: 0 })).toEqual(["To use the new text, start a new run."]);
    expect(sourcesStaleFollowUp({ revoked: 0, pendingReview: 3 })).toEqual([
      "Proposals awaiting review were drafted against this snapshot, and approving one uses it.",
      "To use the new text, start a new run.",
    ]);
    expect(sourcesStaleFollowUp({ revoked: 2, pendingReview: 2 })).toEqual([
      "2 approvals that weren't materialized yet were revoked, so review those proposals again.",
      "Proposals awaiting review were drafted against this snapshot, and approving one uses it.",
      "To use the new text, start a new run.",
    ]);
    expect(sourcesStaleFollowUp({ revoked: 1, pendingReview: 0 })[0]).toBe(
      "1 approval that wasn't materialized yet was revoked, so review that proposal again.",
    );
  });

  it("B2: announces the revoke count only when something was revoked", () => {
    expect(sourcesChangedAnnouncement(0)).toBe("The objective's files changed since this run started.");
    expect(sourcesChangedAnnouncement(1)).toBe("The objective's files changed since this run started. 1 approval was revoked.");
    expect(sourcesChangedAnnouncement(3)).toBe("The objective's files changed since this run started. 3 approvals were revoked.");
  });
});

describe("dialog run input (contract §1, §6)", () => {
  const written = "## Outcome\nAgree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.\n";

  it("sends the chosen kind and brief", () => {
    expect(buildAccountObjectiveRunInput({ ...emptyObjectiveDraft(), kind: null }, null)).toBeUndefined();
    expect(buildAccountObjectiveRunInput({ ...emptyObjectiveDraft(), kind: "relationship_only", text: written }, null))
      .toEqual({ kind: "relationship_only" });
    expect(buildAccountObjectiveRunInput({ ...emptyObjectiveDraft(), kind: "commercial", text: written }, null))
      .toEqual({ kind: "commercial", brief: { kind: "inline", text: written } });
    expect(buildAccountObjectiveRunInput({ ...emptyObjectiveDraft(), kind: "commercial", text: written, save: true, name: "eng-q4" }, null))
      .toEqual({ kind: "commercial", brief: { kind: "saved", path: "objectives/eng-q4.md" } });
    expect(buildAccountObjectiveRunInput({
      ...emptyObjectiveDraft(),
      kind: "commercial",
      mode: "saved",
      savedPath: "objectives/eng.md",
      save: true,
    }, null)).toEqual({ kind: "commercial", brief: { kind: "saved", path: "objectives/eng.md" } });
  });

  it("omits an untouched template default and sends an edited one", () => {
    const fromTemplate = objectiveDraftFromTemplate({ kind: "commercial", brief: { kind: "inline", text: written } })!;
    expect(fromTemplate).toMatchObject({ kind: "commercial", mode: "write", text: written });
    expect(buildAccountObjectiveRunInput(fromTemplate, fromTemplate)).toBeUndefined();
    expect(buildAccountObjectiveRunInput({ ...fromTemplate, text: `${written}More.` }, fromTemplate))
      .toEqual({ kind: "commercial", brief: { kind: "inline", text: `${written}More.` } });
    expect(buildAccountObjectiveRunInput({ ...fromTemplate, kind: "relationship_only" }, fromTemplate))
      .toEqual({ kind: "relationship_only" });
    expect(objectiveDraftFromTemplate({ kind: "commercial", brief: { kind: "saved", path: "objectives/eng.md" } }))
      .toMatchObject({ mode: "saved", savedPath: "objectives/eng.md" });
    expect(objectiveDraftFromTemplate({ kind: "relationship_only" })).toMatchObject({ kind: "relationship_only" });
    expect(objectiveDraftFromTemplate("nope")).toBeNull();
  });

  it("validates per contract §1.5", () => {
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "commercial" }, undefined)).toEqual({
      brief: "Add an Outcome: a line under ## Outcome that says what you want to happen for these accounts.",
    });
    expect(OBJECTIVE_BRIEF_TEMPLATE).toContain("## Outcome");
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "commercial", text: written, save: true, name: "Bad Name" }, undefined))
      .toEqual({ name: "Use 2 to 63 lowercase letters, numbers and dashes, starting with a letter or number." });
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "commercial", text: written, save: true, name: "preview" }, undefined))
      .toHaveProperty("name");
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "commercial", mode: "saved", savedPath: "objectives/x.md" }, null))
      .toEqual({ saved: "This saved brief has no Outcome. Edit a copy and add one." });
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "commercial", mode: "saved", savedPath: "objectives/x.md" }, undefined))
      .toEqual({});
    expect(validateObjectiveDraft({ ...emptyObjectiveDraft(), kind: "relationship_only" }, undefined)).toEqual({});
  });

  it("suggests a name from the first five words of the Outcome", () => {
    expect(suggestBriefName(written)).toBe("agree-to-a-20-minute");
    expect(suggestBriefName("## Outcome\n@PRODUCTS.md#engineering-workflow pilot for founders now please\n"))
      .toBe("engineering-workflow-pilot-for-founders");
    expect(suggestBriefName(OBJECTIVE_BRIEF_TEMPLATE)).toBe("");
  });

  it("keys refusal copy off details.reason", () => {
    expect(refusalText("outcome_missing", {})).toBeNull();
    expect(refusalText("workspace_unavailable", {})).toMatch(/^Signals can't reach its RealTimeX workspace/);
    expect(refusalText("saved_brief_not_found", { path: "objectives/eng.md" })).toBe(
      "The saved brief eng isn't in the workspace anymore. Nothing was started. Write a brief, or choose another saved one.",
    );
    expect(refusalText("saved_brief_unsafe", { name: "eng" })).toBe(
      "Signals can't safely read the saved brief eng. It must be a plain markdown file in objectives/. Nothing was started. Write a brief, or choose another saved one.",
    );
    expect(refusalText("too_large", {})).toBe(
      "The brief and the files it mentions are too long to attach. Nothing was started. Mention one product instead of all of PRODUCTS.md, or shorten the brief.",
    );
    expect(refusalText("invalid", {})).toBe("The objective couldn't be attached. Nothing was started. Check the brief and run again.");
  });

  it("confirms the attached objective with mentions as names", () => {
    const view = { mentions: [entry("engineering-workflow", "Engineering Workflow")] };
    expect(launchedObjectiveLine({
      kind: "commercial",
      outcome: "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.",
      view,
      savedNow: "objectives/eng-q4.md",
      fromSaved: "objectives/eng-q4.md",
    })).toBe("Objective attached: Business outcome — Agree to a 20-minute evaluation of Engineering Workflow. · brief saved as objectives/eng-q4.md");
    expect(launchedObjectiveLine({ kind: "commercial", outcome: "Book a call.", view, savedNow: null, fromSaved: "objectives/eng.md" }))
      .toBe("Objective attached: Business outcome — Book a call. · from objectives/eng.md");
    expect(launchedObjectiveLine({ kind: "relationship_only", outcome: null, view, savedNow: null, fromSaved: null }))
      .toBe("Objective attached: Relationship only");
  });

  it("renders unresolved mentions as not found", () => {
    const segments = splitMentions("Try @PRODUCTS.md#onboarding-kit and @BRAND.md.", { mentions: [file("BRAND.md", true)] });
    expect(segments).toEqual([
      { kind: "text", text: "Try " },
      { kind: "mention", raw: "@PRODUCTS.md#onboarding-kit", label: "@PRODUCTS.md#onboarding-kit (not found)", resolved: false },
      { kind: "text", text: " and " },
      { kind: "mention", raw: "@BRAND.md", label: "BRAND.md", resolved: true },
      { kind: "text", text: "." },
    ]);
  });
});
