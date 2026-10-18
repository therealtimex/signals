// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalAsk, RunObjectiveBlock } from "@/app/dashboard/workflows/[id]/workflow-run-objective";
import { WorkflowRunProposalsPanel } from "@/app/dashboard/workflows/[id]/workflow-run-proposals";
import type { AccountObjective } from "@/lib/writing/account-objective";
import type { ObjectiveSourceStatus } from "@/lib/writing/objective-sources";
import type {
  ValidWorkflowRunProposal,
  WorkflowRunProposalAsk,
  WorkflowRunProposals,
} from "@/lib/writing/workflow-run-proposals";

const BRIEF = [
  "## Outcome",
  "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.",
  "",
  "## Unknowns",
  "1. Whether they use a coding agent today",
  "2. Who owns onboarding",
  "",
  "Tone: follow @BRAND.md.",
].join("\n");

function commercial(overrides: Partial<AccountObjective> = {}): AccountObjective {
  return {
    schemaVersion: 2,
    objectiveId: "aobj_abcdef1",
    kind: "commercial",
    brief: { source: { kind: "saved", path: "objectives/eng-founders.md", fileHash: "h" }, text: BRIEF, hash: "b" },
    parsed: {
      outcome: "Agree to a 20-minute evaluation of @PRODUCTS.md#engineering-workflow.",
      fit: "Technical founders hiring engineers",
      unknowns: ["Whether they use a coding agent today", "Who owns onboarding"],
      nextStep: "Ask which workflow they use.",
      success: "A reply naming their workflow.",
    },
    mentions: [
      {
        raw: "@PRODUCTS.md#engineering-workflow",
        path: "PRODUCTS.md",
        anchor: "engineering-workflow",
        resolved: {
          fileHash: "p",
          excerpt: "## Engineering Workflow\n- **Slug:** `engineering-workflow`",
          excerptHash: "e",
          entry: { slug: "engineering-workflow", name: "Engineering Workflow", oneLiner: "Ship in week one.", proofPointCount: 2 },
        },
        unresolvedReason: null,
      },
      {
        raw: "@BRAND.md",
        path: "BRAND.md",
        anchor: null,
        resolved: { fileHash: "b", excerpt: "# Brand\nPlain, technical.", excerptHash: "x", entry: null },
        unresolvedReason: null,
      },
    ],
    offering: { slug: "engineering-workflow", name: "Engineering Workflow", oneLiner: "Ship in week one.", proofPointCount: 2, mentionIndex: 0 },
    limitations: [],
    sourceHash: "s",
    source: "run_config",
    authoredAt: 1_792_000_000,
    hash: "o",
    ...overrides,
  };
}

function relationshipOnly(source: AccountObjective["source"]): AccountObjective {
  return {
    ...commercial(),
    kind: "relationship_only",
    brief: null,
    parsed: null,
    mentions: [],
    offering: null,
    limitations: [],
    source,
  };
}

const current: ObjectiveSourceStatus = { status: "current", changedPaths: [], observedAt: 1 };

function block(objective: AccountObjective, options: {
  source?: ObjectiveSourceStatus | null;
  open?: boolean;
  revoked?: number;
  pendingReview?: number;
} = {}) {
  return renderToStaticMarkup(createElement(RunObjectiveBlock, {
    objective,
    objectiveSource: options.source ?? current,
    revokedForObjective: options.revoked ?? 0,
    pendingReview: options.pendingReview ?? 0,
    open: options.open ?? true,
    onOpenChange: vi.fn(),
  }));
}

describe("RunObjectiveBlock", () => {
  it("shows a business-outcome snapshot with mentions as names", () => {
    const html = block(commercial());
    expect(html).toContain("Run objective");
    expect(html).toContain("Business outcome");
    expect(html).toContain("Set when the run started");
    expect(html).toContain("· Saved brief objectives/eng-founders.md");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Hide details");
    expect(html).toContain('title="@PRODUCTS.md#engineering-workflow"');
    expect(html).toContain(">Engineering Workflow</span>");
    expect(html).toContain("Ship in week one.");
    expect(html).toContain("2 proof points");
    expect(html).toContain("Who owns onboarding");
    expect(html).toContain("Engineering Workflow (@PRODUCTS.md#engineering-workflow)");
    expect(html).toContain("Show the brief as written");
    expect(html).toContain("<details>");
    expect(html).not.toContain("Limits on these drafts");
  });

  it("renders a brief written for the run and empty fields", () => {
    const html = block(commercial({
      brief: { source: { kind: "inline" }, text: "## Outcome\nBook a call.", hash: "b" },
      parsed: { outcome: "Book a call.", fit: null, unknowns: [], nextStep: null, success: null },
      mentions: [],
      offering: null,
      limitations: ["offering_missing", "fit_missing", "success_missing"],
      source: "template_config",
    }));
    expect(html).toContain("From the template&#x27;s default");
    expect(html).toContain("· Brief written for this run");
    expect(html).toContain("None");
    expect(html).toContain("Not stated");
    expect(html).toContain("None listed");
    expect(html).toContain("Not defined");
    expect(html).toContain("Limits on these drafts");
    expect(html).toContain("No product from PRODUCTS.md is mentioned");
    expect(html).toContain("The brief has no Fit");
    expect(html).toContain("The brief has no Success");
  });

  it("lists unresolved mentions and explains each limitation", () => {
    const html = block(commercial({
      mentions: [
        { raw: "@PRODUCTS.md#onboarding-kit", path: "PRODUCTS.md", anchor: "onboarding-kit", resolved: null, unresolvedReason: "entry_absent" },
        { raw: "@VOICE.md", path: "VOICE.md", anchor: null, resolved: null, unresolvedReason: "file_absent" },
      ],
      parsed: { ...commercial().parsed!, outcome: "Agree to try @PRODUCTS.md#onboarding-kit." },
      offering: null,
      limitations: ["offering_unresolved", "mention_unresolved"],
    }));
    expect(html).toContain("@PRODUCTS.md#onboarding-kit (not found)");
    expect(html).toContain("@VOICE.md — not found");
    expect(html).toContain("@PRODUCTS.md#onboarding-kit isn&#x27;t in PRODUCTS.md");
    expect(html).toContain("@VOICE.md isn&#x27;t in the workspace, so the agent doesn&#x27;t have it.");
  });

  it("collapses to the outcome line and short limits", () => {
    const html = block(commercial({ limitations: ["fit_missing", "success_missing"] }), { open: false });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show details");
    expect(html).toContain("Business outcome: </span>");
    expect(html).toContain("Limits: fit not stated · success not defined");
    expect(html).not.toContain("Show the brief as written");
  });

  it("shows relationship-only runs, chosen or by default, without details", () => {
    const chosen = block(relationshipOnly("run_config"));
    expect(chosen).toContain("Relationship only");
    expect(chosen).toContain("Keep in touch. Drafts don&#x27;t mention an offering, pricing or a pitch.");
    expect(chosen).not.toContain("Hide details");
    const byDefault = block(relationshipOnly("default"));
    expect(byDefault).toContain("No objective was given");
    expect(byDefault).toContain("This run started without an objective");
  });

  it("B1: keeps the stale alert visible when collapsed and shows only the sentences that hold", () => {
    const stale: ObjectiveSourceStatus = { status: "stale", changedPaths: ["BRAND.md", "objectives/eng-founders.md"], observedAt: 2 };
    const pendingOnly = block(commercial(), { source: stale, open: false, pendingReview: 2 });
    expect(pendingOnly).toContain("The objective&#x27;s files changed after this run started");
    expect(pendingOnly).toContain("Changed: BRAND.md, objectives/eng-founders.md. This run keeps using the snapshot below.");
    expect(pendingOnly).toContain("Proposals awaiting review were drafted against this snapshot, and approving one uses it. To use the new text, start a new run.");
    expect(pendingOnly).not.toContain("were revoked");

    const revoked = block(commercial(), { source: stale, revoked: 1, pendingReview: 0 });
    expect(revoked).toContain("1 approval that wasn&#x27;t materialized yet was revoked, so review that proposal again. To use the new text, start a new run.");
    expect(revoked).not.toContain("Proposals awaiting review");
  });

  it("shows one quiet caption when the workspace could not be checked", () => {
    const html = block(commercial(), { source: { status: "unavailable", changedPaths: [], observedAt: null } });
    expect(html).toContain("Couldn&#x27;t check the workspace just now");
    expect(html).not.toContain("objective-sources-stale");
  });
});

describe("ProposalAsk", () => {
  const ask = (overrides: Partial<WorkflowRunProposalAsk>): WorkflowRunProposalAsk => ({
    statement: "Ask how Alex onboards engineers.",
    relation: "tests",
    testsUncertainty: 2,
    customerPain: { status: "none_assumed" },
    ...overrides,
  });

  it("names the unknown a test finds out and the reason a touch defers", () => {
    const tests = renderToStaticMarkup(createElement(ProposalAsk, { ask: ask({}), objective: commercial() }));
    expect(tests).toContain('role="group"');
    expect(tests).toContain('aria-label="Ask"');
    expect(tests).toContain("Tests unknown 2");
    expect(tests).toContain("Finds out: </span>");
    expect(tests).toContain("Who owns onboarding");
    expect(tests).toContain("Customer pain: </span>none assumed");
    expect(tests).not.toContain("Limits:");

    const defers = renderToStaticMarkup(createElement(ProposalAsk, {
      ask: ask({ relation: "defers", testsUncertainty: undefined, deferReason: "We messaged on Oct 9." }),
      objective: commercial({ limitations: ["fit_missing"] }),
    }));
    expect(defers).toContain("Defers outcome");
    expect(defers).toContain("Why: </span>We messaged on Oct 9.");
    expect(defers).toContain("Limits: </span>fit not stated");
  });
});

function proposal(overrides: Partial<ValidWorkflowRunProposal> = {}): ValidWorkflowRunProposal {
  return {
    valid: true,
    variantId: "var_1",
    launchId: "launch_1",
    launchName: "Nurture",
    platform: "linkedin",
    surface: "linkedin/direct_message",
    contentType: "dm",
    recipient: { contactId: "c1", handle: "alexr", name: "Alex Rivera", href: "/dashboard/contacts/c1" },
    goal: { relationshipGoal: "warm_conversation", writingGoal: "replies" },
    ask: {
      statement: "Ask how Alex onboards engineers.",
      relation: "tests",
      testsUncertainty: 1,
      customerPain: { status: "none_assumed" },
    },
    body: "Hi Alex",
    audit: { verdict: "pass", findings: [] },
    approval: { schemaVersion: 1, state: "pending", riskTier: "low", policy: "explicit" },
    capability: { publish: "draft_only" },
    mandate: "assist_only",
    materializedContentItemId: null,
    revisionRequest: null,
    variantStatus: "draft",
    href: "/dashboard/launches/launch_1/variants/var_1",
    ...overrides,
  };
}

function payload(overrides: Partial<WorkflowRunProposals> = {}): WorkflowRunProposals {
  return {
    launches: [{ id: "launch_1", name: "Nurture", href: "/dashboard/launches/launch_1" }],
    objective: commercial(),
    objectiveSource: current,
    proposals: [proposal()],
    summary: { total: 1, pendingReview: 1, approved: 0, materialized: 0, rejected: 0, blocked: 0, revoked: 0 },
    ...overrides,
  };
}

describe("WorkflowRunProposalsPanel with a run objective", () => {
  let container: HTMLDivElement;
  let root: Root;
  let responses: WorkflowRunProposals[];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    responses = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responses.shift() ?? payload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(createElement(WorkflowRunProposalsPanel, { runId: "run_1", refreshKey: "k", onSummaryChange: vi.fn() }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  const toggle = () => [...container.querySelectorAll("button")].find((button) => /details/.test(button.textContent ?? ""));

  it("shows the block and each card's Ask and platform metric", async () => {
    await render();
    expect(container.querySelector('[data-testid="run-objective"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="proposal-ask"]')?.textContent).toContain("Tests unknown 1");
    expect(container.querySelector('[data-testid="proposal-goal"]')?.textContent).toBe(
      "Warm Conversation · platform metric: replies",
    );
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows no block and no Ask box for a run from before #549", async () => {
    responses = [payload({ objective: null, objectiveSource: null })];
    await render();
    expect(container.querySelector('[data-testid="run-objective"]')).toBeNull();
    expect(container.querySelector('[data-testid="proposal-ask"]')).toBeNull();
    expect(container.querySelector('[data-testid="proposal-goal"]')?.textContent).toContain("platform metric: replies");
  });

  it("loads collapsed when nothing awaits review, and never flips on its own", async () => {
    const reviewed = payload({
      proposals: [proposal({ materializedContentItemId: "ci_1", approval: { schemaVersion: 1, state: "approved", riskTier: "low", policy: "explicit" } })],
      summary: { total: 1, pendingReview: 0, approved: 0, materialized: 1, rejected: 0, blocked: 0, revoked: 0 },
    });
    responses = [reviewed, payload()];
    await render();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Refresh"))!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("labels an objective-stale revocation and announces a change detected on refresh", async () => {
    const approved = proposal({ approval: { schemaVersion: 1, state: "approved", riskTier: "low", policy: "explicit" } });
    const revoked = proposal({
      approval: { schemaVersion: 1, state: "revoked", riskTier: "low", policy: "explicit", revokedReason: "objective_source_stale" },
    });
    responses = [
      payload({ proposals: [approved], summary: { total: 1, pendingReview: 0, approved: 1, materialized: 0, rejected: 0, blocked: 0, revoked: 0 } }),
      payload({
        objectiveSource: { status: "stale", changedPaths: ["BRAND.md"], observedAt: 3 },
        proposals: [revoked],
        summary: { total: 1, pendingReview: 1, approved: 0, materialized: 0, rejected: 0, blocked: 0, revoked: 1 },
      }),
    ];
    await render();
    await act(async () => {
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Refresh"))!.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(container.querySelector('[data-testid="proposal-status"]')?.textContent).toBe("Revoked · objective changed");
    expect(container.querySelector('[data-testid="proposal-status"]')?.getAttribute("data-variant")).toBe("warning");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Approve & materialize"))).toBe(true);
    expect(container.querySelector('[data-testid="objective-sources-stale"]')?.textContent).toContain(
      "1 approval that wasn't materialized yet was revoked, so review that proposal again.",
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "The objective's files changed since this run started. 1 approval was revoked.",
    );
  });
});
