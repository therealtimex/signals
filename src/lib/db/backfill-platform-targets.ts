import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformAccounts, platformTargets } from "@/lib/db/schema";
import {
  ensureBrowserConnection,
  getBrowserConnectionBySessionName,
  registerPlatformTarget,
  setDefaultTarget,
} from "@/lib/db/queries/platform-targets";
import {
  defaultTargetCapabilities,
  defaultTargetKind,
  normalizePlatformTargetIdentity,
  type PlatformTargetPlatform,
} from "@/lib/platforms/target-identity";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";

const SOURCE = "backfill:platform-targets-v1";
const PLATFORMS: PlatformTargetPlatform[] = ["x", "linkedin", "facebook"];

function candidateHandle(platform: PlatformTargetPlatform, displayName: string): string | null {
  const value = displayName.trim();
  if (platform === "x") return value.startsWith("@") ? value : null;
  if (platform === "linkedin") return /^\/?in\//i.test(value) ? value : null;
  if (/^(Facebook|.+\(RTX Browser\))$/i.test(value)) return null;
  return /^(?:id:\d+|[a-z0-9.]+)$/i.test(value) ? value : null;
}

export function backfillPlatformTargets(): { connectionsCreated: number; targetsCreated: number } {
  const connectionBefore = getBrowserConnectionBySessionName(RTX_PUBLISH_SESSION_NAME);
  const targetCountBefore = db.select({ id: platformTargets.id }).from(platformTargets).all().length;
  const existingConnection = ensureBrowserConnection({
    sessionName: RTX_PUBLISH_SESSION_NAME,
    kind: "shared",
    source: SOURCE,
  });
  const connectionsCreated = connectionBefore ? 0 : 1;

  for (const platform of PLATFORMS) {
    const accounts = db
      .select()
      .from(platformAccounts)
      .where(eq(platformAccounts.platform, platform))
      .orderBy(asc(platformAccounts.createdAt), asc(platformAccounts.id))
      .all();

    for (const account of accounts) {
      const handle = candidateHandle(platform, account.displayName);
      const normalized = normalizePlatformTargetIdentity(platform, handle);
      const target = registerPlatformTarget({
        connectionId: existingConnection.id,
        platform,
        kind: defaultTargetKind(platform),
        externalId: normalized.externalId,
        name: account.displayName,
        handle: normalized.handle,
        platformAccountId: account.id,
        capabilities: defaultTargetCapabilities(platform),
        source: SOURCE,
        verifiedAt: account.lastSyncedAt,
      });
      if (accounts[0]?.id === account.id) setDefaultTarget(target.id);
    }
  }

  const targetCountAfter = db.select({ id: platformTargets.id }).from(platformTargets).all().length;
  return { connectionsCreated, targetsCreated: targetCountAfter - targetCountBefore };
}
