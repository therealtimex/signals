import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLease,
  releaseSessionLease,
  renewSessionLease,
} from "@/lib/leases/session-lease";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { resetCoreTables } from "@/test/db";

describe("browser session leases", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("acquires, renews idempotently for one holder, and releases", () => {
    const connection = ensureBrowserConnection({ sessionName: "shared" });
    const first = acquireSessionLease(connection.id, {
      holder: "agent-a",
      intent: "browse",
      ttlSeconds: 60,
    });
    vi.advanceTimersByTime(10_000);
    const reentered = acquireSessionLease(connection.id, {
      holder: "agent-a",
      intent: "publish",
      ttlSeconds: 60,
    });
    expect(reentered.leaseId).toBe(first.leaseId);
    expect(reentered.expiresAt).toBeGreaterThan(first.expiresAt);
    expect(renewSessionLease(first.leaseId, 120).expiresAt).toBeGreaterThan(reentered.expiresAt);
    releaseSessionLease(first.leaseId);
    expect(getSessionLease(connection.id)).toBeUndefined();
  });

  it("reports contention details, steals after expiry, and fences the stale owner", () => {
    const connection = ensureBrowserConnection({ sessionName: "shared" });
    const first = acquireSessionLease(connection.id, {
      holder: "agent-a",
      targetId: null,
      ttlSeconds: 30,
    });
    expect(() =>
      acquireSessionLease(connection.id, { holder: "agent-b", ttlSeconds: 30 })
    ).toThrowError(
      expect.objectContaining({
        code: "SESSION_LEASE_HELD",
        details: expect.objectContaining({ holder: "agent-a", retryAfterSeconds: 31 }),
      })
    );

    vi.advanceTimersByTime(31_000);
    const stolen = acquireSessionLease(connection.id, { holder: "agent-b", ttlSeconds: 30 });
    expect(stolen.leaseId).not.toBe(first.leaseId);
    expect(() => renewSessionLease(first.leaseId)).toThrowError(
      expect.objectContaining({ code: "LEASE_LOST" })
    );
    expect(() => releaseSessionLease(first.leaseId)).toThrowError(PlatformTargetError);
  });

  it("allows concurrent leases on independent dedicated connections", () => {
    const first = ensureBrowserConnection({ sessionName: "dedicated-a", kind: "dedicated" });
    const second = ensureBrowserConnection({ sessionName: "dedicated-b", kind: "dedicated" });
    const leaseA = acquireSessionLease(first.id, { holder: "agent-a" });
    const leaseB = acquireSessionLease(second.id, { holder: "agent-b" });
    expect(leaseA.connectionId).toBe(first.id);
    expect(leaseB.connectionId).toBe(second.id);
    expect(leaseA.leaseId).not.toBe(leaseB.leaseId);
  });
});
