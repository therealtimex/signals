import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLeaseById,
  releaseSessionLease,
} from "@/lib/leases/session-lease";
import {
  acquireAuthorizedEventBrowserLease,
  EventBrowserError,
  inspectAuthorizedLumaHtml,
  inspectVisibleLumaViewerIdentity,
  observeAuthorizedLumaParticipants,
  recheckAuthorizedLumaBoundary,
  renewAuthorizedEventBrowserLease,
  verifyAuthorizedLumaParticipantProfiles,
} from "@/lib/rtx/event-browser";
import { resetCoreTables } from "@/test/db";

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

const scope = { kind: "authorized" as const, ownerWorkspace: "signals", runId: "run-1", grantId: "grant-1" };

describe("registered Luma guest boundary", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.useRealTimers();
    vi.mocked(chromium.connectOverCDP).mockReset();
  });

  it("reuses and preserves an existing run-owned lease on the selected connection", () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const existing = acquireSessionLease(connection.id, {
      holder: "network-snowball:run-shared",
      intent: "publish",
      ttlSeconds: 300,
    });

    const resolved = acquireAuthorizedEventBrowserLease({
      connectionId: connection.id,
      runId: "run-shared",
    });

    expect(resolved).toMatchObject({ leaseId: existing.leaseId, reused: true });
    expect(getSessionLeaseById(existing.leaseId)).toMatchObject({
      holder: "network-snowball:run-shared",
      intent: "publish",
    });
    releaseSessionLease(existing.leaseId);
  });

  it("rejects an expired run lease before further authorized traversal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T08:00:00.000Z"));
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const lease = acquireSessionLease(connection.id, {
      holder: "network-snowball:run-expired",
      intent: "browse",
      ttlSeconds: 30,
    });
    vi.advanceTimersByTime(31_000);

    expect(() => renewAuthorizedEventBrowserLease({
      connectionId: connection.id,
      leaseId: lease.leaseId,
      runId: "run-expired",
    })).toThrowError(EventBrowserError);
  });

  it("requires a visible viewer and accessible guest-list container", () => {
    expect(() => inspectAuthorizedLumaHtml({
      html: '<body><button data-testid="user-menu" aria-label="Account: Operator"></button><p>Register to View Guest List</p></body>',
      canonicalUrl: "https://luma.com/demo",
      scope,
      maxParticipants: 30,
    })).toThrowError(EventBrowserError);
  });

  it("returns bounded authorized observations without claiming attendance", () => {
    const result = inspectAuthorizedLumaHtml({
      html: `<body>
        <button data-testid="user-menu" data-viewer-identity="operator@example.com"></button>
        <section data-guest-list-access="authorized">
          <a href="/user/alice" data-participant-name="Alice Builder"></a>
          <a href="/user/bob?tk=private" data-participant-name="Bob Founder"></a>
        </section>
      </body>`,
      canonicalUrl: "https://luma.com/demo",
      scope,
      observedAt: 1_789_171_200,
      maxParticipants: 1,
    });
    expect(result.viewerIdentity).toBe("operator@example.com");
    expect(result.participants).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({
      displayName: "Alice Builder",
      profileUrl: "https://luma.com/user/alice",
      rsvp: "registered",
      attendance: "unknown",
      evidence: { scope },
    });
  });

  it("keeps same-name participants with distinct visible profile identities separate", () => {
    const result = inspectAuthorizedLumaHtml({
      html: `<body>
        <button data-testid="user-menu" data-viewer-identity="operator@example.com"></button>
        <section data-guest-list-access="authorized">
          <a href="/user/alice-one" data-participant-name="Alice Builder"></a>
          <a href="/user/alice-two" data-participant-name="Alice Builder"></a>
        </section>
      </body>`,
      canonicalUrl: "https://luma.com/demo",
      scope,
      maxParticipants: 30,
    });
    expect(result.participants).toHaveLength(2);
    expect(new Set(result.participants.map((participant) => participant.subjectKey)).size).toBe(2);
    expect(result.participants.every((participant) => participant.attendance === "unknown")).toBe(true);
  });

  it.each([
    ["neutral copy", "Welcome to the event"],
    ["designing", "Designing agent workflows for teams"],
    ["assigning", "We will be assigning mentors"],
    ["blog in", "Read our blog in English"],
    ["hidden sign-in dialog", '<div style="display:none"><button>Sign in with Google</button></div>'],
    ["script sign-in route", '<script>window.route = "/signin"</script>'],
  ])("accepts a visible signed-in viewer with %s", (_name, pageContent) => {
    expect(inspectVisibleLumaViewerIdentity(`<body>
      <button data-testid="user-menu" data-viewer-identity="QA Viewer"></button>
      ${pageContent}
    </body>`)).toBe("QA Viewer");
  });

  it("requires login for an anonymous page with a visible sign-in control", () => {
    try {
      inspectVisibleLumaViewerIdentity('<body><a href="/signin">Sign In</a></body>');
      throw new Error("expected inspection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EventBrowserError);
      expect((error as EventBrowserError).reason).toBe("login_required");
    }
  });

  it("recognizes registration gate copy split across adjacent visible elements", () => {
    try {
      inspectVisibleLumaViewerIdentity(`<body>
        <button data-testid="user-menu" data-viewer-identity="QA Viewer">QA Viewer</button>
        <p>Register to View Guest List</p><p>The full guest list is only accessible to registered guests.</p>
      </body>`);
      throw new Error("expected inspection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EventBrowserError);
      expect((error as EventBrowserError).reason).toBe("registration_required");
    }
  });

  it("opens a click-to-view guest list when page JSON contains waitlist metadata", async () => {
    const sessionName = "signals-publish";
    ensureBrowserConnection({ sessionName });
    let guestListOpen = false;
    let guestTriggerClicks = 0;
    const html = () => `<html><body>
      <button data-testid="user-menu" data-viewer-identity="QA Viewer">QA Viewer</button>
      <button>3 going</button>
      ${guestListOpen ? `<section data-guest-list-access="authorized">
        <a href="/user/alice" data-participant-name="Alice"></a>
        <a href="/user/bob" data-participant-name="Bob"></a>
        <a href="/user/cara" data-participant-name="Cara"></a>
      </section>` : ""}
      <script id="__NEXT_DATA__" type="application/json">
        {"waitlist_enabled":true,"waitlist_status":"active","waitlist_active":false}
      </script>
    </body></html>`;
    const page = {
      url: () => "https://luma.com/demo",
      goto: vi.fn(async () => {
        guestListOpen = false;
      }),
      evaluate: vi.fn(async () => html()),
      getByText: vi.fn((matcher: RegExp) => ({
        first: () => ({
          isVisible: async () => matcher.test("3 going"),
          click: async () => {
            guestTriggerClicks += 1;
            guestListOpen = true;
          },
        }),
      })),
      getByRole: vi.fn(() => ({
        first: () => ({ isVisible: async () => false }),
      })),
      waitForTimeout: vi.fn(async () => undefined),
    };
    const browser = {
      contexts: () => [{ pages: () => [page], newPage: async () => page }],
      close: async () => undefined,
    };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(
      browser as unknown as Awaited<ReturnType<typeof chromium.connectOverCDP>>,
    );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      sessions: [{ sessionName, running: true, remoteDebugPort: 9222 }],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await observeAuthorizedLumaParticipants({
      runId: "run-modal-json",
      ownerWorkspace: "signals",
      grantId: "grant-modal-json",
      sessionName,
      url: "https://luma.com/demo?tk=private",
      maxParticipants: 3,
      maxGuestPages: 1,
      maxProfileVisits: 0,
      env: { RTX_APP_ID: "signals-app", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl,
    });

    expect(result.viewerIdentity).toBe("QA Viewer");
    expect(result.participants.map((participant) => participant.displayName)).toEqual([
      "Alice",
      "Bob",
      "Cara",
    ]);
    expect(guestTriggerClicks).toBe(2);
  });

  it.each([
    ["anonymous", '<section data-guest-list-access="authorized"><a data-participant-name="Alice"></a></section>', "permission_missing"],
    ["login", "<button>Sign in to view</button>", "login_required"],
    ["generic sign in", "<button>Sign In</button><p>Waitlist enabled</p>", "login_required"],
    ["anonymous waitlist metadata", "<p>Waitlist enabled</p>", "permission_missing"],
    ["waitlist", '<button data-testid="user-menu" aria-label="Account: Operator"></button><p>You are waitlisted</p>', "waitlisted"],
    ["hidden payload", '<script>{"guest":"Alice"}</script>', "permission_missing"],
    ["hidden guest container", '<button data-testid="user-menu" aria-label="Account: Operator"></button><section style="display:none" data-guest-list-access="authorized"><a data-participant-name="Alice"></a></section>', "permission_missing"],
    ["computed-hidden guest container", '<button data-testid="user-menu" aria-label="Account: Operator"></button><section data-signals-computed-hidden="true" data-guest-list-access="authorized"><a data-participant-name="Alice"></a></section>', "permission_missing"],
  ])("rejects %s DOM without producing participant observations", (_name, html, reason) => {
    try {
      inspectAuthorizedLumaHtml({
        html,
        canonicalUrl: "https://luma.com/demo",
        scope,
        maxParticipants: 30,
      });
      throw new Error("expected inspection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EventBrowserError);
      expect((error as EventBrowserError).reason).toBe(reason);
    }
  });

  it("rejects source-access loss when the authorized boundary is rechecked", () => {
    expect(() => recheckAuthorizedLumaBoundary({
      html: '<button data-testid="user-menu" data-viewer-identity="operator@example.com"></button><p>Register to View Guest List</p>',
      canonicalUrl: "https://luma.com/demo",
      scope,
      expectedViewerIdentity: "operator@example.com",
      maxParticipants: 30,
    })).toThrowError(EventBrowserError);
  });

  it("rejects a visible viewer identity change when the guest boundary is rechecked", () => {
    expect(() => recheckAuthorizedLumaBoundary({
      html: `<button data-testid="user-menu" data-viewer-identity="changed@example.com"></button>
        <section data-guest-list-access="authorized">
          <a href="/user/alice" data-participant-name="Alice Builder"></a>
        </section>`,
      canonicalUrl: "https://luma.com/demo",
      scope,
      expectedViewerIdentity: "operator@example.com",
      maxParticipants: 30,
    })).toThrowError(EventBrowserError);
  });

  it("visits only the bounded visible profile set and stops when viewer identity changes", async () => {
    const visited: string[] = [];
    await expect(verifyAuthorizedLumaParticipantProfiles({
      participants: [
        {
          subjectKey: "one",
          displayName: "Alice",
          profileUrl: "https://luma.com/user/alice",
          rsvp: "registered",
          attendance: "unknown",
          evidence: {
            eventKey: "https://luma.com/demo",
            sourceUrl: "https://luma.com/demo",
            observedAt: 1,
            observedRole: "participant",
            confidence: "high",
            scope,
            provider: "luma",
            extractorVersion: 1,
            observationId: "one",
          },
        },
        {
          subjectKey: "two",
          displayName: "Bob",
          profileUrl: "https://luma.com/user/bob",
          rsvp: "registered",
          attendance: "unknown",
          evidence: {
            eventKey: "https://luma.com/demo",
            sourceUrl: "https://luma.com/demo",
            observedAt: 1,
            observedRole: "participant",
            confidence: "high",
            scope,
            provider: "luma",
            extractorVersion: 1,
            observationId: "two",
          },
        },
      ],
      expectedViewerIdentity: "operator@example.com",
      maxProfileVisits: 2,
      navigate: async (url) => {
        visited.push(url);
        const viewer = visited.length === 1 ? "operator@example.com" : "changed@example.com";
        return `<button data-testid="user-menu" data-viewer-identity="${viewer}"></button>`;
      },
      renewLease: () => undefined,
      sleep: async () => undefined,
    })).rejects.toMatchObject({ reason: "session_changed" });
    expect(visited).toEqual([
      "https://luma.com/user/alice",
      "https://luma.com/user/bob",
    ]);
  });

  it("stops profile traversal immediately when the lease is lost between pages", async () => {
    const visited: string[] = [];
    let renewals = 0;
    await expect(verifyAuthorizedLumaParticipantProfiles({
      participants: ["alice", "bob"].map((slug) => ({
        subjectKey: slug,
        displayName: slug,
        profileUrl: `https://luma.com/user/${slug}`,
        rsvp: "registered" as const,
        attendance: "unknown" as const,
        evidence: {
          eventKey: "https://luma.com/demo",
          sourceUrl: "https://luma.com/demo",
          observedAt: 1,
          observedRole: "participant" as const,
          confidence: "high" as const,
          scope,
          provider: "luma" as const,
          extractorVersion: 1,
          observationId: slug,
        },
      })),
      expectedViewerIdentity: "operator@example.com",
      maxProfileVisits: 2,
      navigate: async (url) => {
        visited.push(url);
        return '<button data-testid="user-menu" data-viewer-identity="operator@example.com"></button>';
      },
      renewLease: () => {
        renewals += 1;
        if (renewals === 3) {
          throw new EventBrowserError("lease_lost", "lease changed");
        }
      },
      sleep: async () => undefined,
    })).rejects.toMatchObject({ reason: "lease_lost" });
    expect(visited).toEqual(["https://luma.com/user/alice"]);
  });
});
