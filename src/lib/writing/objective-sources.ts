/**
 * Objective sources that change after launch (#549, ADR-549-24 / -27).
 *
 * The stamped objective is a snapshot: it stays the run's authority whatever happens to the saved
 * brief or the mentioned files afterwards. What the operator must not miss is that the context
 * they approved against moved. So, on the read paths that already touch a launch
 * (`get_writing_context`, the run proposals projection, `materialize_variant`), Signals re-reads
 * the sources, and on a change revokes every approved, unmaterialized proposal on the launch with
 * `objective_source_stale` — once per change, because the observed hash is stored server-side.
 * The draft text and its audit are unaffected, which is why this mirrors
 * `revokeVariantsForSpineChange` rather than the Personality audit guard.
 */

import { eq, sql } from "drizzle-orm";
import { db, type DbRunner } from "@/lib/db/client";
import { launches, variants } from "@/lib/db/schema";
import {
  parseProductsCatalog,
  readWorkspaceResource,
} from "@/lib/personality/workspace-resources";
import {
  parseObjectiveBriefPath,
  readSavedObjectiveBrief,
} from "@/lib/rtx/objective-brief-files";
import { resolvePersonalityWorkspace, type PersonalityWorkspace } from "@/lib/personality/workspace";
import {
  computeObjectiveSourceHash,
  objectiveSourceEntries,
  type AccountObjective,
  type ObjectiveSourceEntry,
} from "@/lib/writing/account-objective";
import {
  launchCompositionSchema,
  launchObjectiveStateSchema,
  variantWritingSchema,
  type LaunchObjectiveState,
} from "@/lib/writing/contracts";
import { sha256 } from "@/lib/writing/hash";
import { revokeWritingVariantWithRunner } from "@/lib/writing/personality-revocation";
import type { ObjectiveMentionFile } from "@/lib/writing/objective-brief";

export type ObjectiveSourceStatus = {
  status: "current" | "stale" | "unavailable";
  /** Sources whose current hash differs from the snapshot, in snapshot order. */
  changedPaths: string[];
  observedAt: number | null;
};

export type ObjectiveSourceObservation = {
  objectiveSource: ObjectiveSourceStatus;
  /** Variants revoked by this observation (empty unless the sources changed since the last one). */
  revokedVariantIds: string[];
};

export type ObjectiveWorkspaceResolver = () => Promise<PersonalityWorkspace>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Current hash of one snapshotted source, or `null` when it can no longer be read safely. */
function currentSourceHash(workspace: PersonalityWorkspace, entry: ObjectiveSourceEntry): string | null {
  try {
    if (entry.kind === "saved_brief") {
      const name = parseObjectiveBriefPath(entry.path);
      return name ? readSavedObjectiveBrief(workspace, name)?.fileHash ?? null : null;
    }
    const file = readWorkspaceResource(workspace, entry.path as ObjectiveMentionFile);
    if (!file) return null;
    if (entry.kind === "file") return file.fileHash;
    const product = parseProductsCatalog(file.content).find((candidate) => candidate.slug === entry.anchor);
    return product ? sha256(product.excerpt) : null;
  } catch {
    return null;
  }
}

/** Compare the snapshot with the workspace as it is now. Pure apart from the file reads. */
export function compareObjectiveSources(
  objective: Pick<AccountObjective, "brief" | "mentions">,
  workspace: PersonalityWorkspace,
): { sourceHash: string; changedPaths: string[] } {
  const entries = objectiveSourceEntries(objective);
  const current = entries.map((entry) => ({ ...entry, current: currentSourceHash(workspace, entry) }));
  return {
    sourceHash: computeObjectiveSourceHash(current.map((entry) => ({ key: entry.key, hash: entry.current }))),
    changedPaths: current.flatMap((entry) => (entry.current !== entry.hash ? [entry.key] : [])),
  };
}

function readLaunchObjective(runner: DbRunner, launchId: string) {
  const launch = runner.select().from(launches).where(eq(launches.id, launchId)).get();
  if (!launch) return null;
  const metadata = object(launch.metadata);
  const writing = object(metadata.writing);
  const composition = launchCompositionSchema.safeParse(writing.composition);
  if (!composition.success || !composition.data.objective) return null;
  const state = launchObjectiveStateSchema.safeParse(writing.objectiveState);
  return {
    launch,
    metadata,
    writing,
    objective: composition.data.objective,
    stampedAt: composition.data.stampedAt,
    state: state.success ? state.data : null,
  };
}

/**
 * Observe one launch's objective sources against an already-resolved workspace (`null` when the
 * workspace could not be resolved: nothing is revoked and nothing is recorded, since there is no
 * evidence of a change).
 */
export function observeLaunchObjectiveSourcesWithRunner(
  runner: DbRunner,
  input: { launchId: string; workspace: PersonalityWorkspace | null; now?: number },
): ObjectiveSourceObservation | null {
  const initial = readLaunchObjective(runner, input.launchId);
  if (!initial) return null;
  const entries = objectiveSourceEntries(initial.objective);
  if (entries.length === 0) {
    return {
      objectiveSource: { status: "current", changedPaths: [], observedAt: initial.state?.observedAt ?? initial.stampedAt },
      revokedVariantIds: [],
    };
  }
  if (!input.workspace) {
    return {
      objectiveSource: { status: "unavailable", changedPaths: [], observedAt: initial.state?.observedAt ?? null },
      revokedVariantIds: [],
    };
  }
  const comparison = compareObjectiveSources(initial.objective, input.workspace);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const status: ObjectiveSourceStatus["status"] = comparison.changedPaths.length ? "stale" : "current";

  // Re-read inside the caller's transaction boundary so two concurrent reads revoke once.
  const fresh = readLaunchObjective(runner, input.launchId)!;
  const observed = fresh.state?.observedSourceHash ?? fresh.objective.sourceHash;
  const revokedVariantIds: string[] = [];
  const unchanged = observed === comparison.sourceHash
    && fresh.state?.status === status
    && JSON.stringify(fresh.state.changedPaths) === JSON.stringify(comparison.changedPaths);
  if (observed !== comparison.sourceHash) {
    for (const variant of runner.select().from(variants).where(eq(variants.launchId, input.launchId)).all()) {
      const parsed = variantWritingSchema.safeParse(object(variant.metadata).writing);
      if (!parsed.success || parsed.data.approval.state !== "approved") continue;
      if (parsed.data.materializedContentItemId || variant.contentItemId) continue;
      const result = revokeWritingVariantWithRunner(runner, {
        variant,
        reason: "objective_source_stale",
        allowQueuedNoop: true,
        now,
      });
      if (result.mutated) revokedVariantIds.push(variant.id);
    }
  }
  const state: LaunchObjectiveState = unchanged && fresh.state
    ? fresh.state
    : {
        observedSourceHash: comparison.sourceHash,
        observedAt: now,
        status,
        changedPaths: comparison.changedPaths,
      };
  if (!unchanged) {
    runner.update(launches).set({
      metadata: JSON.stringify({ ...fresh.metadata, writing: { ...fresh.writing, objectiveState: state } }),
      updatedAt: now,
    }).where(eq(launches.id, input.launchId)).run();
  }
  return {
    objectiveSource: { status, changedPaths: comparison.changedPaths, observedAt: state.observedAt },
    revokedVariantIds,
  };
}

async function resolveWorkspaceOrNull(resolveWorkspace: ObjectiveWorkspaceResolver): Promise<PersonalityWorkspace | null> {
  try {
    return await resolveWorkspace();
  } catch {
    return null;
  }
}

function needsWorkspace(launchIds: string[]): boolean {
  return launchIds.some((launchId) => {
    const read = readLaunchObjective(db, launchId);
    return Boolean(read && objectiveSourceEntries(read.objective).length);
  });
}

export async function observeObjectiveSources(
  launchId: string,
  resolveWorkspace: ObjectiveWorkspaceResolver = () => resolvePersonalityWorkspace(),
): Promise<ObjectiveSourceObservation | null> {
  const workspace = needsWorkspace([launchId]) ? await resolveWorkspaceOrNull(resolveWorkspace) : null;
  return db.transaction((tx) => observeLaunchObjectiveSourcesWithRunner(tx, { launchId, workspace }));
}

/**
 * Observe every launch of a composed run. Every launch of a run stamps the same objective, so the
 * run-level status is the most severe launch status and the union of changed paths.
 */
export async function observeObjectiveSourcesForRun(
  workflowRunId: string,
  resolveWorkspace: ObjectiveWorkspaceResolver = () => resolvePersonalityWorkspace(),
): Promise<ObjectiveSourceObservation | null> {
  const launchIds = db.select({ id: launches.id }).from(launches).where(sql`
    json_extract(${launches.metadata}, '$.writing.composition.workflowRunId') = ${workflowRunId}
  `).all().map((row) => row.id);
  if (!launchIds.length) return null;
  const workspace = needsWorkspace(launchIds) ? await resolveWorkspaceOrNull(resolveWorkspace) : null;
  const observations = db.transaction((tx) => launchIds
    .map((launchId) => observeLaunchObjectiveSourcesWithRunner(tx, { launchId, workspace }))
    .filter((observation): observation is ObjectiveSourceObservation => observation !== null));
  if (!observations.length) return null;
  const rank = { current: 0, unavailable: 1, stale: 2 } as const;
  const status = observations.reduce<ObjectiveSourceStatus["status"]>(
    (worst, observation) => rank[observation.objectiveSource.status] > rank[worst] ? observation.objectiveSource.status : worst,
    "current",
  );
  const changedPaths = [...new Set(observations.flatMap((observation) => observation.objectiveSource.changedPaths))];
  const observedAt = observations.reduce<number | null>(
    (latest, observation) => {
      const at = observation.objectiveSource.observedAt;
      return at !== null && (latest === null || at > latest) ? at : latest;
    },
    null,
  );
  return {
    objectiveSource: { status, changedPaths, observedAt },
    revokedVariantIds: observations.flatMap((observation) => observation.revokedVariantIds),
  };
}

/** Last recorded observation for a launch, without touching the workspace (read models only). */
export function readObjectiveSourceStatus(launchId: string, runner: DbRunner = db): ObjectiveSourceStatus | null {
  const read = readLaunchObjective(runner, launchId);
  if (!read) return null;
  if (!objectiveSourceEntries(read.objective).length) {
    return { status: "current", changedPaths: [], observedAt: read.state?.observedAt ?? read.stampedAt };
  }
  return read.state
    ? { status: read.state.status, changedPaths: read.state.changedPaths, observedAt: read.state.observedAt }
    : { status: "current", changedPaths: [], observedAt: null };
}
