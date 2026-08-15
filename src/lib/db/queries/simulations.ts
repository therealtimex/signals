import { and, count, desc, eq, inArray, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  graphEdges,
  interactions,
  niches,
  orgs,
  simulationAgents,
  simulationRuns,
  variants,
} from "@/lib/db/schema";
import { getActivePersona } from "@/lib/db/queries/personas";
import { getLaunchById } from "@/lib/db/queries/launches";
import { getVariantById } from "@/lib/db/queries/variants";
import { assertSimulationOutcome } from "@/lib/db/simulation-outcomes";
import {
  SimulationAgentOwnershipError,
  SimulationRunStateError,
  SimulationScopeError,
} from "@/lib/db/queries/simulation-errors";
import type { PaginatedResult, SimulationAgent, SimulationRun, Variant } from "@/lib/db/types";

export type PopulationSpec = {
  contactIds?: string[];
  nicheIds?: string[];
  orgIds?: string[];
  sampleSize?: number;
  seed?: number;
};

export type CreateSimulationRunInput = {
  variantId: string;
  populationSpec?: PopulationSpec;
  batchId?: string | null;
  predictionModel?: string | null;
  config?: Record<string, unknown>;
  workflowRunId?: string | null;
  source?: "agent" | "workflow";
};

export type SimulationAgentWithGrounding = Omit<SimulationAgent, "grounding"> & {
  grounding: Record<string, unknown>;
};

export type CreateSimulationRunResult = {
  run: SimulationRun;
  agents: SimulationAgentWithGrounding[];
};

export type SimulationAgentResultInput = {
  agentId: string;
  engagementScore?: number | null;
  outcome?: string | null;
  predictedActions?: Record<string, unknown>[] | Record<string, unknown>;
  /** Transcript writes activate in slice 3.3 — accepted but ignored until then. */
  transcript?: unknown;
};

export type CompleteSimulationRunInput = {
  status?: "completed" | "failed" | "cancelled";
  predictedScore?: number;
  predictionConfidence?: number;
  predictedMetrics?: Record<string, unknown>;
  error?: string;
};

const TERMINAL_STATUSES = new Set<SimulationRun["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

const DEFAULT_SAMPLE_SIZE = 100;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mergePopulationSpec(
  explicit: PopulationSpec | undefined,
  launchAudienceSpec: string | null | undefined,
): PopulationSpec {
  const fromLaunch = parseJsonRecord(launchAudienceSpec) as PopulationSpec;
  return {
    contactIds: explicit?.contactIds ?? fromLaunch.contactIds,
    nicheIds: explicit?.nicheIds ?? fromLaunch.nicheIds,
    orgIds: explicit?.orgIds ?? fromLaunch.orgIds,
    sampleSize: explicit?.sampleSize ?? fromLaunch.sampleSize,
    seed: explicit?.seed ?? fromLaunch.seed,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleContactIds(contactIds: string[], sampleSize: number, seed?: number): string[] {
  if (contactIds.length <= sampleSize) return contactIds;
  const rng = mulberry32(seed ?? Date.now());
  const scored = contactIds.map((id) => ({ id, score: rng() }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, sampleSize).map((row) => row.id);
}

function contactsForNiches(nicheIds: string[]): string[] {
  if (nicheIds.length === 0) return [];
  return db
    .select({ contactId: graphEdges.srcId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "niche"),
        eq(graphEdges.scope, "shared"),
        inArray(graphEdges.dstId, nicheIds),
      ),
    )
    .all()
    .map((row) => row.contactId);
}

function contactsForOrgs(orgIds: string[]): string[] {
  if (orgIds.length === 0) return [];
  return db
    .select({ contactId: graphEdges.srcId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "works_at"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "org"),
        eq(graphEdges.scope, "shared"),
        inArray(graphEdges.dstId, orgIds),
      ),
    )
    .all()
    .map((row) => row.contactId);
}

export function resolvePopulationContactIds(
  spec: PopulationSpec,
  launchAudienceSpec?: string | null,
): string[] {
  const merged = mergePopulationSpec(spec, launchAudienceSpec);
  const ids = new Set<string>(merged.contactIds ?? []);
  for (const id of contactsForNiches(merged.nicheIds ?? [])) ids.add(id);
  for (const id of contactsForOrgs(merged.orgIds ?? [])) ids.add(id);
  const sampleSize = merged.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  return sampleContactIds([...ids], sampleSize, merged.seed);
}

function primaryOrgIdForContact(contactId: string): string | undefined {
  const edge = db
    .select({ orgId: graphEdges.dstId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "works_at"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "org"),
        eq(graphEdges.scope, "shared"),
      ),
    )
    .get();
  return edge?.orgId;
}

function sharedNichesForContact(
  contactId: string,
): { name: string; nicheType: string; weight: number | null }[] {
  const edges = db
    .select({
      nicheId: graphEdges.dstId,
      weight: graphEdges.weight,
    })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "niche"),
        eq(graphEdges.scope, "shared"),
      ),
    )
    .all();

  const results: { name: string; nicheType: string; weight: number | null }[] = [];
  for (const edge of edges) {
    const niche = db.select().from(niches).where(eq(niches.id, edge.nicheId)).get();
    if (!niche || niche.scope !== "shared") continue;
    results.push({
      name: niche.name,
      nicheType: niche.nicheType,
      weight: edge.weight ?? null,
    });
  }
  return results;
}

function sharedInteractionCount(contactId: string): number {
  return (
    db
      .select({ value: count() })
      .from(interactions)
      .where(and(eq(interactions.contactId, contactId), eq(interactions.scope, "shared")))
      .get()?.value ?? 0
  );
}

/** Public-grounding projection — §8.2 allowlist; the only simulation CRM read surface. */
export function assembleAgentGrounding(contactId: string): Record<string, unknown> {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const identities = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all()
    .map((identity) => ({
      platform: identity.platform,
      platformHandle: identity.platformHandle,
      displayName: identity.displayName,
      bio: identity.bio,
      isVerified: identity.isVerified,
      followersCount: identity.followersCount,
      followingCount: identity.followingCount,
      postsCount: identity.postsCount,
      platformCreatedAt: identity.platformCreatedAt,
    }));

  const persona = getActivePersona(contactId);
  const personaFields =
    persona && persona.scope === "shared"
      ? {
          archetype: persona.archetype,
          tone: persona.tone,
          summary: persona.summary,
          interests: JSON.parse(persona.interests ?? "[]") as string[],
          conversionTriggers: JSON.parse(persona.conversionTriggers ?? "[]") as string[],
          engagementFormats: JSON.parse(persona.engagementFormats ?? "[]") as string[],
        }
      : null;

  const orgId = primaryOrgIdForContact(contactId);
  let orgFields: Record<string, unknown> | null = null;
  if (orgId) {
    const org = db.select().from(orgs).where(eq(orgs.id, orgId)).get();
    if (org && org.scope === "shared") {
      orgFields = {
        name: org.name,
        orgType: org.orgType,
        domain: org.domain,
        description: org.description,
      };
    }
  }

  return {
    contact: {
      name: contact.name,
      title: contact.title,
      company: contact.company,
      location: contact.location,
      bio: contact.bio,
    },
    identities,
    persona: personaFields,
    org: orgFields,
    niches: sharedNichesForContact(contactId),
    interactions: { sharedCount: sharedInteractionCount(contactId) },
  };
}

function assertSharedLaunchForVariant(variantId: string): void {
  const variant = getVariantById(variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }
  const launch = getLaunchById(variant.launchId);
  if (!launch) {
    throw new Error(`Launch not found: ${variant.launchId}`);
  }
  if (launch.scope !== "shared") {
    throw new SimulationScopeError(
      "Simulation requires a shared launch — mark the launch shared, or keep it out of the Wind Tunnel",
    );
  }
}

function materializeAgents(
  runId: string,
  contactIds: string[],
): SimulationAgentWithGrounding[] {
  return contactIds.map((contactId) => {
    const persona = getActivePersona(contactId);
    const personaId = persona && persona.scope === "shared" ? persona.id : null;
    const grounding = assembleAgentGrounding(contactId);
    const agentId = nanoid();

    db.insert(simulationAgents)
      .values({
        id: agentId,
        simulationRunId: runId,
        contactId,
        orgId: primaryOrgIdForContact(contactId) ?? null,
        contactPersonaId: personaId,
        grounding: JSON.stringify(grounding),
      })
      .run();

    const agent = db.select().from(simulationAgents).where(eq(simulationAgents.id, agentId)).get()!;
    const { grounding: groundingRaw, ...rest } = agent;
    return {
      ...rest,
      grounding,
    };
  });
}

export function createSimulationRun(input: CreateSimulationRunInput): CreateSimulationRunResult {
  assertSharedLaunchForVariant(input.variantId);
  const variant = getVariantById(input.variantId)!;
  const launch = getLaunchById(variant.launchId)!;
  const populationSpec = mergePopulationSpec(input.populationSpec, launch.audienceSpec);
  const contactIds = resolvePopulationContactIds(populationSpec, launch.audienceSpec);
  const runId = nanoid();

  db.insert(simulationRuns)
    .values({
      id: runId,
      variantId: input.variantId,
      batchId: input.batchId ?? null,
      status: "pending",
      populationSpec: JSON.stringify(populationSpec),
      agentCount: contactIds.length,
      predictionModel: input.predictionModel ?? null,
      config: JSON.stringify(input.config ?? {}),
      scope: "shared",
      source: input.source ?? "agent",
      workflowRunId: input.workflowRunId ?? null,
    })
    .run();

  const agents = materializeAgents(runId, contactIds);
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get()!;
  return { run, agents };
}

export function startSimulationRun(runId: string): SimulationRun {
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get();
  if (!run) {
    throw new Error(`Simulation run not found: ${runId}`);
  }
  if (run.status === "running") return run;
  if (run.status !== "pending") {
    throw new SimulationRunStateError(
      `Cannot start simulation run in status '${run.status}' — expected 'pending'`,
    );
  }

  const now = nowUnix();
  db.update(simulationRuns)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(eq(simulationRuns.id, runId))
    .run();

  return db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get()!;
}

/** Agent-tool path: create + start atomically (§4.4a). */
export function createAndStartSimulationRun(
  input: CreateSimulationRunInput,
): CreateSimulationRunResult {
  return db.transaction(() => {
    const created = createSimulationRun({ ...input, source: input.source ?? "agent" });
    const run = startSimulationRun(created.run.id);
    return { run, agents: created.agents };
  });
}

function parseAgentGrounding(agent: SimulationAgent): SimulationAgentWithGrounding {
  const { grounding: groundingRaw, ...rest } = agent;
  return {
    ...rest,
    grounding: parseJsonRecord(groundingRaw),
  };
}

export function listSimulationRuns(opts?: {
  variantId?: string;
  launchId?: string;
  batchId?: string;
  status?: SimulationRun["status"];
  page?: number;
  pageSize?: number;
}): PaginatedResult<SimulationRun> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (opts?.variantId) {
    conditions.push(eq(simulationRuns.variantId, opts.variantId));
  }
  if (opts?.batchId) {
    conditions.push(eq(simulationRuns.batchId, opts.batchId));
  }
  if (opts?.status) {
    conditions.push(eq(simulationRuns.status, opts.status));
  }
  if (opts?.launchId) {
    conditions.push(eq(variants.launchId, opts.launchId));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const countFrom = opts?.launchId
    ? db
        .select({ value: count() })
        .from(simulationRuns)
        .innerJoin(variants, eq(simulationRuns.variantId, variants.id))
    : db.select({ value: count() }).from(simulationRuns);

  const total = countFrom.where(where).get()?.value ?? 0;

  const rows = opts?.launchId
    ? db
        .select({ run: simulationRuns })
        .from(simulationRuns)
        .innerJoin(variants, eq(simulationRuns.variantId, variants.id))
        .where(where)
        .orderBy(desc(simulationRuns.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all()
    : db
        .select()
        .from(simulationRuns)
        .where(where)
        .orderBy(desc(simulationRuns.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

  const data = rows.map((row) => ("run" in row ? row.run : row) as SimulationRun);
  return { data, total };
}

export function getSimulationRun(
  id: string,
  opts?: { includeAgents?: boolean },
): (SimulationRun & { agents?: SimulationAgentWithGrounding[] }) | undefined {
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, id)).get();
  if (!run) return undefined;

  if (!opts?.includeAgents) return run;

  const agents = db
    .select()
    .from(simulationAgents)
    .where(eq(simulationAgents.simulationRunId, id))
    .all()
    .map(parseAgentGrounding);

  return { ...run, agents };
}

function assertRunIsRunning(run: SimulationRun): void {
  if (run.status !== "running") {
    throw new SimulationRunStateError(
      `Simulation run must be 'running' — current status is '${run.status}'`,
    );
  }
}

function projectVariantFromRunIfLatest(run: SimulationRun, now: number): void {
  if (run.status !== "completed") return;

  const latest = db
    .select()
    .from(simulationRuns)
    .where(
      and(eq(simulationRuns.variantId, run.variantId), eq(simulationRuns.status, "completed")),
    )
    .orderBy(desc(simulationRuns.completedAt), desc(simulationRuns.id))
    .get();

  if (!latest || latest.id !== run.id) return;

  const variant = getVariantById(run.variantId);
  if (!variant) return;

  const variantUpdate: {
    predictedScore: number | null;
    predictionConfidence: number | null;
    predictedMetrics: string;
    predictionModel: string | null;
    simulatedAt: number | null;
    status?: Variant["status"];
    updatedAt: number;
  } = {
    predictedScore: run.predictedScore,
    predictionConfidence: run.predictionConfidence,
    predictedMetrics: run.predictedMetrics ?? "{}",
    predictionModel: run.predictionModel,
    simulatedAt: run.completedAt,
    updatedAt: now,
  };

  if (variant.status === "draft") {
    variantUpdate.status = "simulated";
  }

  db.update(variants).set(variantUpdate).where(eq(variants.id, run.variantId)).run();
}

export function recordSimulationAgentResults(
  runId: string,
  results: SimulationAgentResultInput[],
): void {
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get();
  if (!run) {
    throw new Error(`Simulation run not found: ${runId}`);
  }
  assertRunIsRunning(run);

  if (results.length === 0) return;

  db.transaction(() => {
    for (const result of results) {
      const agent = db
        .select()
        .from(simulationAgents)
        .where(eq(simulationAgents.id, result.agentId))
        .get();

      if (!agent || agent.simulationRunId !== runId) {
        throw new SimulationAgentOwnershipError(
          `Agent ${result.agentId} does not belong to simulation run ${runId}`,
        );
      }

      const outcome =
        result.outcome === undefined || result.outcome === null
          ? agent.outcome
          : assertSimulationOutcome(result.outcome);

      const predictedActions =
        result.predictedActions === undefined
          ? agent.predictedActions
          : JSON.stringify(result.predictedActions);

      db.update(simulationAgents)
        .set({
          engagementScore:
            result.engagementScore !== undefined
              ? result.engagementScore
              : agent.engagementScore,
          outcome,
          predictedActions,
        })
        .where(eq(simulationAgents.id, result.agentId))
        .run();
    }
  });
}

export function completeSimulationRun(
  runId: string,
  input: CompleteSimulationRunInput = {},
): SimulationRun {
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get();
  if (!run) {
    throw new Error(`Simulation run not found: ${runId}`);
  }

  const targetStatus = input.status ?? "completed";
  const now = nowUnix();

  if (TERMINAL_STATUSES.has(run.status)) {
    if (run.status === targetStatus) {
      return run;
    }
    throw new SimulationRunStateError(
      `Cannot transition simulation run from '${run.status}' to '${targetStatus}'`,
    );
  }

  if (targetStatus === "completed") {
    if (run.status !== "running") {
      throw new SimulationRunStateError(
        `Cannot complete simulation run in status '${run.status}' — expected 'running'`,
      );
    }
    if (input.predictedScore === undefined || input.predictionConfidence === undefined) {
      throw new SimulationRunStateError(
        "Completing a simulation run requires predictedScore and predictionConfidence",
      );
    }

    db.transaction(() => {
      db.update(simulationRuns)
        .set({
          status: "completed",
          predictedScore: input.predictedScore,
          predictionConfidence: input.predictionConfidence,
          predictedMetrics: JSON.stringify(input.predictedMetrics ?? {}),
          completedAt: now,
          updatedAt: now,
          error: null,
        })
        .where(eq(simulationRuns.id, runId))
        .run();

      const completed = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get()!;
      projectVariantFromRunIfLatest(completed, now);
    });
  } else if (targetStatus === "failed") {
    if (run.status !== "pending" && run.status !== "running") {
      throw new SimulationRunStateError(
        `Cannot fail simulation run in status '${run.status}'`,
      );
    }
    if (!input.error) {
      throw new SimulationRunStateError("Failing a simulation run requires error");
    }
    db.update(simulationRuns)
      .set({
        status: "failed",
        error: input.error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(simulationRuns.id, runId))
      .run();
  } else if (targetStatus === "cancelled") {
    if (run.status !== "pending" && run.status !== "running") {
      throw new SimulationRunStateError(
        `Cannot cancel simulation run in status '${run.status}'`,
      );
    }
    db.update(simulationRuns)
      .set({
        status: "cancelled",
        error: input.error ?? run.error,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(simulationRuns.id, runId))
      .run();
  } else {
    throw new SimulationRunStateError(`Unsupported terminal status: ${targetStatus}`);
  }

  return db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get()!;
}
