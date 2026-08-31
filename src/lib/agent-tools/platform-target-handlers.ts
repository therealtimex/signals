import { z } from "zod";
import {
  getBrowserConnectionById,
  listBrowserConnections,
  listPlatformTargets,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";
import { getSessionLease } from "@/lib/leases/session-lease";
import {
  preparePlatformTarget,
  releasePreparedPlatformTarget,
  requirePlatformTarget,
} from "@/lib/platforms/platform-target-service";
import { platformTargetErrorResult } from "@/lib/platforms/target-errors";
import { setTargetRepresentation } from "@/lib/personality/use-cases";
import { targetRepresentationSchema } from "@/lib/writing/personality-lineage";

const platformSchema = z.enum(["x", "linkedin", "facebook"]);
const kindSchema = z.enum(["account", "profile", "page", "organization"]);

export const listPlatformTargetsSchema = z.object({
  platform: platformSchema.optional(),
  kind: kindSchema.optional(),
  connectionId: z.string().min(1).optional(),
  includeForgotten: z.boolean().optional(),
});

export const getPlatformTargetSchema = z.object({
  targetId: z.string().min(1),
});

export const preparePlatformTargetSchema = z.object({
  targetId: z.string().min(1),
  intent: z.enum(["browse", "publish"]),
  leaseId: z.string().min(1).optional(),
  leaseTtlSeconds: z.number().int().min(30).max(1800).optional(),
  holder: z.string().min(1).optional(),
});

export const releasePlatformTargetSchema = z.object({
  leaseId: z.string().min(1),
});

export const setTargetRepresentationSchema = z.object({
  targetId: z.string().min(1),
  bindingId: z.string().regex(/^pb_[A-Za-z0-9_-]{6,}$/),
  represents: targetRepresentationSchema,
  evidence: z.object({
    kind: z.literal("thread_message"),
    workspaceSlug: z.string().min(1),
    threadSlug: z.string().min(1),
    note: z.string().optional(),
  }).strict(),
}).strict();

export async function handleListPlatformTargets(
  input: z.infer<typeof listPlatformTargetsSchema>
) {
  return {
    targets: listPlatformTargets(input).map(toPlatformTargetView),
    connections: listBrowserConnections(),
  };
}

export async function handleGetPlatformTarget(
  input: z.infer<typeof getPlatformTargetSchema>
) {
  try {
    const target = requirePlatformTarget(input.targetId);
    const connection = getBrowserConnectionById(target.connectionId);
    const lease = getSessionLease(target.connectionId);
    const held = !!lease && lease.expiresAt >= Math.floor(Date.now() / 1000);
    return {
      ...toPlatformTargetView(target),
      connection,
      lease: {
        held,
        ...(held
          ? { holder: lease!.holder, targetId: lease!.targetId, expiresAt: lease!.expiresAt }
          : {}),
      },
    };
  } catch (error) {
    return platformTargetErrorResult(error) ?? { error: "Failed to get platform target" };
  }
}

export async function handlePreparePlatformTarget(
  input: z.infer<typeof preparePlatformTargetSchema>
) {
  try {
    return await preparePlatformTarget(input);
  } catch (error) {
    return platformTargetErrorResult(error) ?? {
      error: error instanceof Error ? error.message : "Failed to prepare platform target",
      code: "CONNECTION_UNAVAILABLE" as const,
    };
  }
}

export async function handleReleasePlatformTarget(
  input: z.infer<typeof releasePlatformTargetSchema>
) {
  try {
    return releasePreparedPlatformTarget(input.leaseId);
  } catch (error) {
    return platformTargetErrorResult(error) ?? { error: "Failed to release platform target" };
  }
}

export async function handleSetTargetRepresentation(
  input: z.infer<typeof setTargetRepresentationSchema>,
) {
  return setTargetRepresentation(input);
}
