import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  browserConnections,
  browserSessionLeases,
  contentPosts,
  platformTargets,
} from "@/lib/db/schema";
import type { BrowserConnection, PlatformTarget } from "@/lib/db/types";
import {
  defaultTargetCapabilities,
  isPlatformTargetKind,
  isPlatformTargetPlatform,
  normalizePlatformTargetIdentity,
  type PlatformTargetCapability,
  type PlatformTargetKind,
  type PlatformTargetPlatform,
} from "@/lib/platforms/target-identity";

export type BrowserConnectionView = BrowserConnection & {
  lease: {
    held: boolean;
    holder: string | null;
    targetId: string | null;
    expiresAt: number | null;
  };
};

export type PlatformTargetView = Omit<PlatformTarget, "capabilities" | "metadata"> & {
  capabilities: PlatformTargetCapability[];
  metadata: Record<string, unknown>;
};

export type RegisterPlatformTargetInput = {
  connectionId: string;
  platform: PlatformTargetPlatform;
  kind: PlatformTargetKind;
  externalId?: string | null;
  name: string;
  handle?: string | null;
  canonicalUrl?: string | null;
  authPrincipalTargetId?: string | null;
  platformAccountId?: string | null;
  capabilities?: PlatformTargetCapability[];
  source: string;
  verifiedAt?: number | null;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseCapabilities(value: string): PlatformTargetCapability[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is PlatformTargetCapability =>
          item === "browse" || item === "publish"
        )
      : [];
  } catch {
    return [];
  }
}

export function toPlatformTargetView(target: PlatformTarget): PlatformTargetView {
  return {
    ...target,
    capabilities: parseCapabilities(target.capabilities),
    metadata: parseJsonObject(target.metadata),
  };
}

export function ensureBrowserConnection(input: {
  sessionName: string;
  kind?: "shared" | "dedicated";
  source?: string;
}): BrowserConnection {
  const sessionName = input.sessionName.trim();
  if (!sessionName) throw new Error("Browser connection sessionName is required");

  const existing = db
    .select()
    .from(browserConnections)
    .where(eq(browserConnections.sessionName, sessionName))
    .get();
  if (existing) {
    if (existing.status === "archived") {
      db.update(browserConnections)
        .set({
          status: "active",
          kind: input.kind ?? existing.kind,
          updatedAt: nowSec(),
        })
        .where(eq(browserConnections.id, existing.id))
        .run();
      return getBrowserConnectionById(existing.id)!;
    }
    return existing;
  }

  const id = `bc_${nanoid()}`;
  db.insert(browserConnections)
    .values({
      id,
      sessionName,
      kind: input.kind ?? "shared",
      metadata: JSON.stringify(input.source ? { source: input.source } : {}),
    })
    .run();
  return getBrowserConnectionById(id)!;
}

export function getBrowserConnectionById(id: string): BrowserConnection | undefined {
  return db.select().from(browserConnections).where(eq(browserConnections.id, id)).get();
}

export function getBrowserConnectionBySessionName(
  sessionName: string
): BrowserConnection | undefined {
  return db
    .select()
    .from(browserConnections)
    .where(eq(browserConnections.sessionName, sessionName))
    .get();
}

export function listBrowserConnections(includeArchived = false): BrowserConnectionView[] {
  const rows = includeArchived
    ? db.select().from(browserConnections).orderBy(asc(browserConnections.createdAt)).all()
    : db
        .select()
        .from(browserConnections)
        .where(eq(browserConnections.status, "active"))
        .orderBy(asc(browserConnections.createdAt))
        .all();
  const leases = new Map(
    db
      .select()
      .from(browserSessionLeases)
      .all()
      .map((lease) => [lease.connectionId, lease])
  );
  const now = nowSec();
  return rows.map((row) => {
    const lease = leases.get(row.id);
    const held = !!lease && lease.expiresAt >= now;
    return {
      ...row,
      lease: {
        held,
        holder: held ? lease!.holder : null,
        targetId: held ? lease!.targetId : null,
        expiresAt: held ? lease!.expiresAt : null,
      },
    };
  });
}

function validateRegisterInput(input: RegisterPlatformTargetInput): void {
  if (!isPlatformTargetPlatform(input.platform)) {
    throw new Error(`Invalid platform target platform: ${input.platform}`);
  }
  if (!isPlatformTargetKind(input.kind)) {
    throw new Error(`Invalid platform target kind: ${input.kind}`);
  }
  if (!input.name.trim()) throw new Error("Platform target name is required");
  if (!getBrowserConnectionById(input.connectionId)) {
    throw new Error(`Browser connection not found: ${input.connectionId}`);
  }
  if (input.authPrincipalTargetId) {
    const principal = resolveTargetById(input.authPrincipalTargetId);
    if (!principal || principal.status !== "active") {
      throw new Error(`Auth principal target not found: ${input.authPrincipalTargetId}`);
    }
  }
}

export function registerPlatformTarget(input: RegisterPlatformTargetInput): PlatformTarget {
  validateRegisterInput(input);
  const normalized = normalizePlatformTargetIdentity(input.platform, input.handle);
  const externalId = input.externalId?.trim() || normalized.externalId;
  const handle = normalized.handle;
  const handleNormalized = normalized.handleNormalized;
  const capabilities = input.capabilities ?? defaultTargetCapabilities(input.platform);
  const timestamp = input.verifiedAt === undefined ? nowSec() : input.verifiedAt;

  return db.transaction((tx) => {
    const externalMatch = externalId
      ? tx
          .select()
          .from(platformTargets)
          .where(
            and(
              eq(platformTargets.platform, input.platform),
              eq(platformTargets.kind, input.kind),
              eq(platformTargets.externalId, externalId)
            )
          )
          .get()
      : undefined;
    const handleMatch = handleNormalized
      ? tx
          .select()
          .from(platformTargets)
          .where(
            and(
              eq(platformTargets.platform, input.platform),
              eq(platformTargets.kind, input.kind),
              eq(platformTargets.handleNormalized, handleNormalized),
              isNull(platformTargets.externalId),
              ne(platformTargets.status, "merged")
            )
          )
          .orderBy(asc(platformTargets.createdAt), asc(platformTargets.id))
          .get()
      : undefined;

    const target = externalMatch ?? handleMatch;
    if (target) {
      const existingMetadata = parseJsonObject(target.metadata);
      const metadata = {
        ...existingMetadata,
        source: input.source,
        ...(target.connectionId !== input.connectionId
          ? { previousConnectionId: target.connectionId }
          : {}),
      };
      tx.update(platformTargets)
        .set({
          connectionId: input.connectionId,
          externalId: externalId ?? target.externalId,
          name: input.name.trim(),
          handle,
          handleNormalized,
          canonicalUrl: input.canonicalUrl ?? target.canonicalUrl,
          authPrincipalTargetId:
            input.authPrincipalTargetId ?? target.authPrincipalTargetId,
          platformAccountId: input.platformAccountId ?? target.platformAccountId,
          capabilities: JSON.stringify(capabilities),
          status: "active",
          mergedIntoTargetId: null,
          lastVerifiedAt: timestamp,
          metadata: JSON.stringify(metadata),
          updatedAt: nowSec(),
        })
        .where(eq(platformTargets.id, target.id))
        .run();

      if (externalMatch && handleMatch && externalMatch.id !== handleMatch.id) {
        tx.update(contentPosts)
          .set({ targetId: externalMatch.id })
          .where(eq(contentPosts.targetId, handleMatch.id))
          .run();
        if (handleMatch.isDefault && !externalMatch.isDefault) {
          tx.update(platformTargets)
            .set({ isDefault: true, updatedAt: nowSec() })
            .where(eq(platformTargets.id, externalMatch.id))
            .run();
        }
        tx.update(platformTargets)
          .set({
            isDefault: false,
            status: "merged",
            mergedIntoTargetId: externalMatch.id,
            updatedAt: nowSec(),
          })
          .where(eq(platformTargets.id, handleMatch.id))
          .run();
      }

      return tx.select().from(platformTargets).where(eq(platformTargets.id, target.id)).get()!;
    }

    const alreadyHasActive = tx
      .select({ id: platformTargets.id })
      .from(platformTargets)
      .where(
        and(
          eq(platformTargets.platform, input.platform),
          eq(platformTargets.status, "active")
        )
      )
      .get();
    const id = `tgt_${nanoid()}`;
    tx.insert(platformTargets)
      .values({
        id,
        connectionId: input.connectionId,
        platform: input.platform,
        kind: input.kind,
        externalId: externalId ?? null,
        name: input.name.trim(),
        handle,
        handleNormalized,
        canonicalUrl: input.canonicalUrl ?? null,
        authPrincipalTargetId: input.authPrincipalTargetId ?? null,
        platformAccountId: input.platformAccountId ?? null,
        capabilities: JSON.stringify(capabilities),
        isDefault: !alreadyHasActive,
        lastVerifiedAt: timestamp,
        metadata: JSON.stringify({ source: input.source }),
      })
      .run();
    return tx.select().from(platformTargets).where(eq(platformTargets.id, id)).get()!;
  });
}

export function resolveTargetById(id: string): PlatformTarget | undefined {
  const target = db.select().from(platformTargets).where(eq(platformTargets.id, id)).get();
  if (target?.status === "merged" && target.mergedIntoTargetId) {
    return db
      .select()
      .from(platformTargets)
      .where(eq(platformTargets.id, target.mergedIntoTargetId))
      .get();
  }
  return target;
}

export function getPlatformTargetById(id: string): PlatformTarget | undefined {
  return db.select().from(platformTargets).where(eq(platformTargets.id, id)).get();
}

export function listPlatformTargets(filters?: {
  platform?: PlatformTargetPlatform;
  kind?: PlatformTargetKind;
  connectionId?: string;
  includeForgotten?: boolean;
}): PlatformTarget[] {
  const conditions = [ne(platformTargets.status, "merged")];
  if (!filters?.includeForgotten) conditions.push(eq(platformTargets.status, "active"));
  if (filters?.platform) conditions.push(eq(platformTargets.platform, filters.platform));
  if (filters?.kind) conditions.push(eq(platformTargets.kind, filters.kind));
  if (filters?.connectionId) conditions.push(eq(platformTargets.connectionId, filters.connectionId));
  return db
    .select()
    .from(platformTargets)
    .where(and(...conditions))
    .orderBy(asc(platformTargets.createdAt), asc(platformTargets.id))
    .all();
}

export function resolveDefaultTarget(
  platform: PlatformTargetPlatform
): PlatformTarget | undefined {
  const active = and(
    eq(platformTargets.platform, platform),
    eq(platformTargets.status, "active")
  );
  return (
    db
      .select()
      .from(platformTargets)
      .where(and(active, eq(platformTargets.isDefault, true)))
      .orderBy(asc(platformTargets.createdAt), asc(platformTargets.id))
      .get() ??
    db
      .select()
      .from(platformTargets)
      .where(active)
      .orderBy(asc(platformTargets.createdAt), asc(platformTargets.id))
      .get()
  );
}

export function setDefaultTarget(id: string): PlatformTarget | undefined {
  const target = resolveTargetById(id);
  if (!target || target.status !== "active") return undefined;
  db.transaction((tx) => {
    tx.update(platformTargets)
      .set({ isDefault: false, updatedAt: nowSec() })
      .where(eq(platformTargets.platform, target.platform))
      .run();
    tx.update(platformTargets)
      .set({ isDefault: true, updatedAt: nowSec() })
      .where(eq(platformTargets.id, target.id))
      .run();
  });
  return resolveTargetById(target.id);
}

export function forgetPlatformTarget(id: string): boolean {
  const target = db.select().from(platformTargets).where(eq(platformTargets.id, id)).get();
  if (!target || target.status === "merged") return false;
  db.update(platformTargets)
    .set({ status: "forgotten", isDefault: false, updatedAt: nowSec() })
    .where(eq(platformTargets.id, id))
    .run();
  return true;
}

export function markPlatformTargetVerified(
  id: string,
  verifiedAt = nowSec()
): PlatformTarget | undefined {
  const target = resolveTargetById(id);
  if (!target || target.status !== "active") return undefined;
  db.update(platformTargets)
    .set({ lastVerifiedAt: verifiedAt, updatedAt: nowSec() })
    .where(eq(platformTargets.id, target.id))
    .run();
  return resolveTargetById(target.id);
}
