import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  browserConnections,
  browserSessionLeases,
} from "@/lib/db/schema";
import type { BrowserSessionLease } from "@/lib/db/types";
import { PlatformTargetError } from "@/lib/platforms/target-errors";

export const DEFAULT_SESSION_LEASE_TTL_SECONDS = 300;
export const MIN_SESSION_LEASE_TTL_SECONDS = 30;
export const MAX_SESSION_LEASE_TTL_SECONDS = 1800;

export type SessionLeaseIntent = "browse" | "publish" | "discover" | "verify";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function boundedTtl(ttlSeconds = DEFAULT_SESSION_LEASE_TTL_SECONDS): number {
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_SESSION_LEASE_TTL_SECONDS ||
    ttlSeconds > MAX_SESSION_LEASE_TTL_SECONDS
  ) {
    throw new RangeError(
      `Lease TTL must be an integer between ${MIN_SESSION_LEASE_TTL_SECONDS} and ${MAX_SESSION_LEASE_TTL_SECONDS} seconds`
    );
  }
  return ttlSeconds;
}

function leaseLost(leaseId: string): PlatformTargetError {
  return new PlatformTargetError(
    "LEASE_LOST",
    `Lease is no longer current: ${leaseId}`,
    { leaseId }
  );
}

export function getSessionLease(connectionId: string): BrowserSessionLease | undefined {
  return db
    .select()
    .from(browserSessionLeases)
    .where(eq(browserSessionLeases.connectionId, connectionId))
    .get();
}

export function getSessionLeaseById(leaseId: string): BrowserSessionLease | undefined {
  return db
    .select()
    .from(browserSessionLeases)
    .where(eq(browserSessionLeases.leaseId, leaseId))
    .get();
}

export function acquireSessionLease(
  connectionId: string,
  input: {
    holder: string;
    targetId?: string | null;
    intent?: SessionLeaseIntent | null;
    ttlSeconds?: number;
  }
): BrowserSessionLease {
  const holder = input.holder.trim();
  if (!holder) throw new Error("Lease holder is required");
  const ttlSeconds = boundedTtl(input.ttlSeconds);

  return db.transaction((tx) => {
    const connection = tx
      .select({ id: browserConnections.id, status: browserConnections.status })
      .from(browserConnections)
      .where(eq(browserConnections.id, connectionId))
      .get();
    if (!connection || connection.status !== "active") {
      throw new PlatformTargetError(
        "CONNECTION_UNAVAILABLE",
        `Browser connection is unavailable: ${connectionId}`,
        { connectionId }
      );
    }

    const now = nowSec();
    const current = tx
      .select()
      .from(browserSessionLeases)
      .where(eq(browserSessionLeases.connectionId, connectionId))
      .get();

    if (current && current.expiresAt >= now && current.holder !== holder) {
      throw new PlatformTargetError(
        "SESSION_LEASE_HELD",
        `Browser session is in use by ${current.holder}`,
        {
          connectionId,
          holder: current.holder,
          targetId: current.targetId,
          expiresAt: current.expiresAt,
          retryAfterSeconds: Math.max(1, current.expiresAt - now + 1),
        }
      );
    }

    const reentering = !!current && current.expiresAt >= now && current.holder === holder;
    const leaseId = reentering ? current.leaseId : `lease_${nanoid()}`;
    const acquiredAt = reentering ? current.acquiredAt : now;
    const values = {
      connectionId,
      leaseId,
      holder,
      targetId: input.targetId ?? null,
      intent: input.intent ?? null,
      acquiredAt,
      renewedAt: now,
      expiresAt: now + ttlSeconds,
    };

    tx.insert(browserSessionLeases)
      .values(values)
      .onConflictDoUpdate({
        target: browserSessionLeases.connectionId,
        set: values,
      })
      .run();

    return tx
      .select()
      .from(browserSessionLeases)
      .where(eq(browserSessionLeases.connectionId, connectionId))
      .get()!;
  });
}

export function renewSessionLease(
  leaseId: string,
  ttlSeconds?: number
): BrowserSessionLease {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(browserSessionLeases)
      .where(eq(browserSessionLeases.leaseId, leaseId))
      .get();
    const now = nowSec();
    if (!current || current.expiresAt < now) throw leaseLost(leaseId);
    const ttl = boundedTtl(ttlSeconds ?? current.expiresAt - current.renewedAt);

    tx.update(browserSessionLeases)
      .set({ renewedAt: now, expiresAt: now + ttl })
      .where(eq(browserSessionLeases.leaseId, leaseId))
      .run();
    return tx
      .select()
      .from(browserSessionLeases)
      .where(eq(browserSessionLeases.leaseId, leaseId))
      .get()!;
  });
}

export function releaseSessionLease(leaseId: string): void {
  const result = db
    .delete(browserSessionLeases)
    .where(eq(browserSessionLeases.leaseId, leaseId))
    .run();
  if (result.changes === 0) throw leaseLost(leaseId);
}

export function isSessionLeaseCurrent(leaseId: string): boolean {
  const lease = getSessionLeaseById(leaseId);
  return !!lease && lease.expiresAt >= nowSec();
}
