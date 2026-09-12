import { beforeEach, describe, expect, it, vi } from "vitest";
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
  recheckAuthorizedLumaBoundary,
  renewAuthorizedEventBrowserLease,
  verifyAuthorizedLumaParticipantProfiles,
} from "@/lib/rtx/event-browser";
import { resetCoreTables } from "@/test/db";

const scope = { kind: "authorized" as const, ownerWorkspace: "signals", runId: "run-1", grantId: "grant-1" };

describe("registered Luma guest boundary", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.useRealTimers();
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
    ["anonymous", '<section data-guest-list-access="authorized"><a data-participant-name="Alice"></a></section>', "permission_missing"],
    ["login", "<p>Sign in to view</p>", "login_required"],
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
