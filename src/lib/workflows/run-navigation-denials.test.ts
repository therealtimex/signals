import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { browserConnections } from "@/lib/db/schema";
import { ensureBrowserConnection, registerPlatformTarget } from "@/lib/db/queries/platform-targets";
import { createWorkflowRun, createWorkflowStep, getWorkflowRun } from "@/lib/db/queries/workflows";
import { GET as getProgress } from "@/app/api/workflows/[id]/progress/route";
import {
  resolveDenialSession,
  resolveRunNavigationDenials,
} from "@/lib/workflows/run-navigation-denials";
import { resetCoreTables } from "@/test/db";

const LNKD_DENIAL = "The RealTimeX Browser session does not allow https://lnkd.in.";

function run(config: Record<string, unknown>, errors: string[] = [], steps: { error: string | null; url: string | null }[] = []) {
  return { config: JSON.stringify(config), errors: JSON.stringify(errors), steps };
}

function preparedTarget(sessionName: string) {
  return {
    targetId: "pt_1",
    platform: "linkedin",
    source: "session",
    sessionName,
    startUrl: "https://www.linkedin.com/feed/",
    leaseId: "lease_1",
    leaseExpiresAt: 1_800_000_000,
    preparedAt: 1_700_000_000,
  };
}

describe("resolveDenialSession (ADR-547-15)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("resolves a scout run with the default name and a targetId to the target's connection", () => {
    ensureBrowserConnection({ sessionName: "signals-publish" });
    const brand = ensureBrowserConnection({ sessionName: "brand-linkedin", kind: "dedicated" });
    const target = registerPlatformTarget({
      connectionId: brand.id,
      platform: "linkedin",
      kind: "profile",
      name: "Brand",
      handle: "/in/brand",
      source: "test",
    });

    const resolved = resolveDenialSession(
      null,
      JSON.stringify({ browserSessionName: "signals-publish", targetId: target.id }),
    );

    expect(resolved.sessionName).toBe("brand-linkedin");
    expect(resolved.connection?.id).toBe(brand.id);
  });

  it("prefers the session named in the error, then the run's prepared target", () => {
    const named = ensureBrowserConnection({ sessionName: "named", kind: "dedicated" });
    const bound = ensureBrowserConnection({ sessionName: "bound", kind: "dedicated" });
    const config = JSON.stringify({
      _snowballBrowserTarget: preparedTarget("bound"),
      participantAccess: { enabled: true, browserSessionName: "signals-publish" },
    });

    expect(resolveDenialSession("named", config).connection?.id).toBe(named.id);
    expect(resolveDenialSession(null, config).connection?.id).toBe(bound.id);
    expect(
      resolveDenialSession(null, JSON.stringify({ researchTarget: { ...preparedTarget("bound"), source: "config" } }))
        .connection?.id,
    ).toBe(bound.id);
  });

  it("uses a custom configured name before the targetId, and the default name last", () => {
    const custom = ensureBrowserConnection({ sessionName: "custom", kind: "dedicated" });
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });

    expect(
      resolveDenialSession(null, JSON.stringify({ browserSessionName: "custom", targetId: "pt_missing" }))
        .connection?.id,
    ).toBe(custom.id);
    expect(
      resolveDenialSession(
        null,
        JSON.stringify({ participantAccess: { browserSessionName: "signals-publish" } }),
      ).connection?.id,
    ).toBe(publish.id);
  });

  it("never guesses: no session in the error or config resolves to nothing", () => {
    ensureBrowserConnection({ sessionName: "signals-publish" });
    expect(resolveDenialSession(null, JSON.stringify({}))).toEqual({ sessionName: null, connection: null });
  });

  it("names a session without a connection row but leaves it unmanaged", () => {
    expect(resolveDenialSession("signals-scout-1", "{}")).toEqual({
      sessionName: "signals-scout-1",
      connection: null,
    });
  });

  it("does not resolve to an archived connection", () => {
    const archived = ensureBrowserConnection({ sessionName: "old", kind: "dedicated" });
    db.update(browserConnections).set({ status: "archived" }).where(eq(browserConnections.id, archived.id)).run();

    expect(resolveDenialSession("old", "{}").connection).toBeNull();
  });
});

describe("resolveRunNavigationDenials", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("collects one recoverable denial per website from run errors and steps", () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });

    const denials = resolveRunNavigationDenials(
      run(
        { participantAccess: { browserSessionName: "signals-publish" } },
        [LNKD_DENIAL, "fetch failed"],
        [
          { error: `Failed to process seed: ${LNKD_DENIAL}`, url: "https://lnkd.in/p/ggz83Nmd" },
          { error: null, url: "https://www.linkedin.com/feed/" },
        ],
      ),
    );

    expect(denials).toEqual([
      {
        code: "RTX_NAVIGATION_BLOCKED",
        reason: "guardrail-origin-not-allowed",
        action: null,
        sessionName: "signals-publish",
        connectionId: publish.id,
        deniedOrigin: "https://lnkd.in",
        requestedUrl: "https://lnkd.in/p/ggz83Nmd",
        recoverable: true,
        recovery: { kind: "allow_origin", connectionId: publish.id, origin: "https://lnkd.in" },
        sources: [LNKD_DENIAL, `Failed to process seed: ${LNKD_DENIAL}`],
      },
    ]);
  });

  it("takes the blocked link from a step only when the step's origin is the denied one", () => {
    ensureBrowserConnection({ sessionName: "signals-publish" });

    const [denial] = resolveRunNavigationDenials(
      run({ browserSessionName: "signals-publish" }, [], [
        { error: LNKD_DENIAL, url: "https://www.linkedin.com/posts/abc" },
      ]),
    );

    expect(denial.requestedUrl).toBeNull();
  });

  it("marks an unmanaged session's denial as not recoverable, with no recovery", () => {
    const raw = `RTX_NAVIGATION_BLOCKED:${JSON.stringify({
      reason: "guardrail-origin-not-allowed",
      sessionName: "signals-scout-7",
      deniedOrigin: "https://lnkd.in",
    })}`;

    expect(resolveRunNavigationDenials(run({}, [raw]))).toMatchObject([
      { sessionName: "signals-scout-7", connectionId: null, recoverable: false, recovery: null },
    ]);
  });

  it("does not offer recovery for an anchored-session mismatch", () => {
    ensureBrowserConnection({ sessionName: "brand-x", kind: "dedicated" });
    const raw = `RTX_NAVIGATION_BLOCKED:${JSON.stringify({
      reason: "guardrail-origin-mismatch",
      sessionName: "brand-x",
      deniedOrigin: "https://www.linkedin.com",
    })}`;

    expect(resolveRunNavigationDenials(run({}, [raw]))).toMatchObject([
      { sessionName: "brand-x", recoverable: false, recovery: null },
    ]);
  });

  it("is served with the run's progress", async () => {
    const publish = ensureBrowserConnection({ sessionName: "signals-publish" });
    const created = createWorkflowRun({
      workflowType: "agent",
      status: "failed",
      config: JSON.stringify({ participantAccess: { browserSessionName: "signals-publish" } }),
      errors: JSON.stringify([LNKD_DENIAL]),
    });
    createWorkflowStep({ workflowRunId: created.id, stepIndex: 0, stepType: "tool_call", status: "failed", error: LNKD_DENIAL });
    expect(getWorkflowRun(created.id)).toBeTruthy();

    const response = await getProgress(new Request(`http://localhost/api/workflows/${created.id}/progress`), {
      params: Promise.resolve({ id: created.id }),
    });
    const body = await response.json();

    expect(body.navigationDenials).toMatchObject([
      { deniedOrigin: "https://lnkd.in", recovery: { connectionId: publish.id } },
    ]);
  });
});
