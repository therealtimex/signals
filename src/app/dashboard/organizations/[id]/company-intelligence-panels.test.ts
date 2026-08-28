// @vitest-environment happy-dom

import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyFeed, CompanyPeopleTable, EmailIntelligenceCard } from "./company-intelligence-panels";

describe("company intelligence panels", () => {
  it("renders people linking, employment controls, unlinking, and strength evidence", () => {
    const markup = renderToStaticMarkup(createElement(CompanyPeopleTable, {
      orgId: "org-1",
      companyName: "Acme",
      people: [{
        id: "contact-1", name: "Ada Lovelace", worksAtTitle: "CTO", funnelStage: null, identities: [],
        contact: { id: "contact-1", name: "Ada Lovelace", avatarUrl: null, funnelStage: null, identities: [] },
        employment: { id: "employment-1", title: "CTO", isCurrent: true, startedAt: null, endedAt: null, source: "test" },
        strength: { score: 88, band: "strong", computedAt: 1, components: [{ key: "warmth", label: "Your rating", value: 88, weight: 0.4, detail: "Rated 88/100" }] },
        lastInteractionAt: 1, emailStatus: { status: "verified", address: "ada@acme.test" },
        nextAction: { kind: "reach_out", label: "Reach out" },
      }],
    }));
    expect(markup).toContain("Link person");
    expect(markup).toContain("Search contacts");
    expect(markup).toContain("Employment filter");
    expect(markup).toContain("People sort");
    expect(markup).toContain("Unlink Ada Lovelace");
    expect(markup).toContain("Rated 88/100");
  });

  it("renders ranked pattern evidence and every candidate correction action", () => {
    const markup = renderToStaticMarkup(createElement(EmailIntelligenceCard, {
      orgId: "org-1",
      initial: {
        canInfer: true, domain: "acme.test",
        domains: [{ id: "domain-1", orgId: "org-1", domain: "acme.test", kind: "primary", source: "test", mxStatus: "ok", catchAll: "no", mailCheckedAt: 1, mailEvidence: "{}", createdAt: 1, updatedAt: 1 }],
        patterns: [{ id: "pattern-1", orgId: "org-1", pattern: "{first}.{last}", rank: 1, confidence: "high", score: 1, matchCount: 2, sampleCount: 2, evidence: "[]", isSelected: true, source: "test", evaluatedAt: 1, createdAt: 1, updatedAt: 1 }],
        selected: { id: "pattern-1", orgId: "org-1", pattern: "{first}.{last}", rank: 1, confidence: "high", score: 1, matchCount: 2, sampleCount: 2, evidence: "[]", isSelected: true, source: "test", evaluatedAt: 1, createdAt: 1, updatedAt: 1 },
        candidates: [{ id: "candidate-1", contactId: "contact-1", orgId: "org-1", address: "ada@acme.test", addressNormalized: "ada@acme.test", pattern: "{first}", status: "predicted", confidence: "high", evidence: "{}", source: "test", verificationMethod: null, verifiedAt: null, checkedAt: null, probeAttempts: 0, promotedChannelId: null, createdAt: 1, updatedAt: 1, sendable: false, reason: "predicted_email_disabled" }],
        candidateCounts: { predicted: 1, uncertain: 0, verified: 0, invalid: 0 }, evaluatedAt: 1,
        automationEligibility: { storedValue: false, effectiveValue: false, source: "default", envLocked: false },
      },
    }));
    for (const text of ["Ranked alternatives", "Inspect evidence", "Use pattern", "Verify", "Invalidate", "Probe", "Correct"]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain("blocked from outreach by workspace policy");
  });

  it("renders task/workflow actions and partial, stale scan states", () => {
    const markup = renderToStaticMarkup(createElement(CompanyFeed, {
      orgId: "org-1", initial: { data: [], total: 0 }, category: "signal", followedAt: null,
      onLaunchWorkflow: () => undefined,
      signalScanState: { status: "partial", stale: true, permissionDenied: false, lastRunAt: 1, message: "one source failed" },
    }));
    expect(markup).toContain("Create task");
    expect(markup).toContain("Snowball workflow");
    expect(markup).toContain("last scan was partial");
    expect(markup).toContain("coverage is stale");
  });
});

describe("company feed actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderFeed(category: "signal" | "note") {
    await act(async () => {
      root.render(createElement(CompanyFeed, {
        orgId: "org-1", initial: { data: [], total: 0 }, category, followedAt: null,
        signalScanState: category === "signal"
          ? { status: "idle", stale: false, permissionDenied: false, lastRunAt: null, message: null }
          : undefined,
      }));
    });
  }

  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes(label))!;
  }

  it("shows permission details when follow is forbidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Following companies is restricted", code: "FORBIDDEN" }),
      { status: 403 },
    )));
    await renderFeed("signal");
    await act(async () => { button("Follow").click(); await Promise.resolve(); });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Permission denied: Following companies is restricted",
    );
  });

  it("preserves the not-embedded task message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Company tasks are available inside RealTimeX", code: "RTX_UNAVAILABLE" }),
      { status: 503 },
    )));
    await renderFeed("signal");
    await act(async () => { button("Create task").click(); await Promise.resolve(); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Company tasks are available inside RealTimeX",
    );
  });

  it("preserves note API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Notes are read-only for this company" }),
      { status: 409 },
    )));
    await renderFeed("note");
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Important note");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Add note").click(); await Promise.resolve(); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Notes are read-only for this company",
    );
  });
});
