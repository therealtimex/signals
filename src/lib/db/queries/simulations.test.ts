import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  orgs,
  simulationAgents,
  simulationRuns,
} from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { logInteraction } from "@/lib/db/queries/interactions";
import { upsertLaunch } from "@/lib/db/queries/launches";
import { upsertNiche } from "@/lib/db/queries/niches";
import { upsertPersona } from "@/lib/db/queries/personas";
import { upsertVariant, getVariantById } from "@/lib/db/queries/variants";
import {
  createAndStartSimulationRun,
  completeSimulationRun,
  createSimulationRun,
  getSimulationRun,
  listSimulationRuns,
  recordSimulationAgentResults,
  startSimulationRun,
} from "@/lib/db/queries/simulations";
import {
  SimulationAgentOwnershipError,
  SimulationRunStateError,
  SimulationScopeError,
} from "@/lib/db/queries/simulation-errors";
import { SimulationValidationError } from "@/lib/db/simulation-validation";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

/** Matches SQLite `TEXT` default BINARY collation for ASCII nanoid IDs. */
function compareBinaryDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

describe("simulation runs (slice 3.1)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedSharedLaunchWithVariant() {
    const launch = upsertLaunch({ name: "Wind Tunnel Launch", primaryPlatform: "x" });
    const variant = upsertVariant({
      launchId: launch.id,
      label: "A",
      body: "Test copy",
    });
    return { launch, variant };
  }

  it("create_simulation_run atomically starts the run with grounded agents", async () => {
    const contact = createContact({ name: "Agent Subject", platform: "x", platformUserId: "sim-1" });
    upsertPersona({
      contactId: contact.id,
      archetype: "Builder",
      tone: "Direct",
      interests: ["devtools"],
    });
    const { variant } = seedSharedLaunchWithVariant();

    const result = await invokeAgentTool("create_simulation_run", {
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });

    const run = (result as { run: { status: string; agentCount: number } }).run;
    expect(run.status).toBe("running");
    expect(run.agentCount).toBe(1);

    const agents = (result as { run: { agents: { contactPersonaId: string | null }[] } }).run
      .agents;
    expect(agents[0]?.contactPersonaId).toBeTruthy();
  });

  it("rejects simulation for local_only launches", () => {
    const launch = upsertLaunch({
      name: "Private Launch",
      primaryPlatform: "x",
      scope: "local_only",
    });
    const variant = upsertVariant({ launchId: launch.id, body: "secret" });

    expect(() =>
      createAndStartSimulationRun({
        variantId: variant.id,
        populationSpec: { contactIds: [] },
      }),
    ).toThrow(SimulationScopeError);
  });

  it("grounds contacts with only local_only personas without persona fields", () => {
    const contact = createContact({ name: "Private Persona", platform: "x", platformUserId: "sim-2" });
    upsertPersona({
      contactId: contact.id,
      archetype: PRIVACY_SENTINELS.personaArchetype,
      scope: "local_only",
    });
    const { variant } = seedSharedLaunchWithVariant();

    const { agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });

    expect(agents[0]?.contactPersonaId).toBeNull();
    expect(agents[0]?.grounding.persona).toBeNull();
    assertNoPrivacySentinels(agents[0]?.grounding);
  });

  it("never leaks private CRM fields through grounding or query_simulations", async () => {
    const contact = createContact({
      name: "Public Name",
      platform: "x",
      platformUserId: "sim-3",
      email: PRIVACY_SENTINELS.email,
      phone: PRIVACY_SENTINELS.phone,
      tags: JSON.stringify([PRIVACY_SENTINELS.tags]),
    });
    const peer = createContact({ name: "Peer", platform: "x", platformUserId: "sim-3-peer" });
    db.update(contacts)
      .set({ title: "Engineer", company: "Acme" })
      .where(eq(contacts.id, contact.id))
      .run();
    db.update(contactIdentities)
      .set({
        platformData: JSON.stringify({ secret: PRIVACY_SENTINELS.platformData }),
        syncErrors: PRIVACY_SENTINELS.syncErrors,
      })
      .where(eq(contactIdentities.contactId, contact.id))
      .run();

    const localOrgId = nanoid();
    db.insert(orgs)
      .values({
        id: localOrgId,
        name: "Hidden Org",
        description: PRIVACY_SENTINELS.propertiesPrivate,
        scope: "local_only",
        source: "test",
      })
      .run();

    const sharedOrgId = nanoid();
    db.insert(orgs)
      .values({
        id: sharedOrgId,
        name: "Visible Org",
        scope: "shared",
        source: "test",
      })
      .run();

    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: localOrgId,
      edgeType: "works_at",
      scope: "local_only",
      propertiesPrivate: JSON.stringify({ notes: PRIVACY_SENTINELS.propertiesPrivate }),
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "org",
      dstId: sharedOrgId,
      edgeType: "works_at",
      scope: "shared",
      propertiesPrivate: JSON.stringify({ notes: PRIVACY_SENTINELS.propertiesPrivate }),
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "contact",
      dstId: peer.id,
      edgeType: "relationship",
      scope: "local_only",
      propertiesPrivate: JSON.stringify({ notes: PRIVACY_SENTINELS.propertiesPrivate }),
    });

    const sharedNiche = upsertNiche({ name: "devtools", nicheType: "interest", scope: "shared" });
    const privateNiche = upsertNiche({
      name: PRIVACY_SENTINELS.propertiesPrivate,
      nicheType: "interest",
      scope: "local_only",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: sharedNiche.id,
      edgeType: "belongs_to_niche",
      scope: "shared",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: contact.id,
      dstType: "niche",
      dstId: privateNiche.id,
      edgeType: "belongs_to_niche",
      scope: "local_only",
    });

    logInteraction({
      contactId: contact.id,
      interactionType: "dm",
      summary: PRIVACY_SENTINELS.propertiesPrivate,
      scope: "local_only",
    });
    logInteraction({
      contactId: contact.id,
      interactionType: "like",
      summary: "public like",
      scope: "shared",
    });

    const { variant } = seedSharedLaunchWithVariant();
    const created = await invokeAgentTool("create_simulation_run", {
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    assertNoPrivacySentinels(created);

    const listed = await invokeAgentTool("query_simulations", {
      variantId: variant.id,
      includeAgents: true,
    });
    assertNoPrivacySentinels(listed);
  });

  it("rolls back workflow-path run creation when agent materialization fails", () => {
    const contact = createContact({ name: "Good", platform: "x", platformUserId: "sim-atomic-1" });
    const { variant } = seedSharedLaunchWithVariant();

    expect(() =>
      createSimulationRun({
        variantId: variant.id,
        populationSpec: { contactIds: [contact.id, "missing-contact-id"] },
        source: "workflow",
      }),
    ).toThrow(/Contact not found/);

    expect(listSimulationRuns({ variantId: variant.id }).total).toBe(0);
    expect(db.select().from(simulationAgents).all()).toHaveLength(0);
  });

  it("enforces startSimulationRun state transitions", () => {
    const contact = createContact({ name: "State", platform: "x", platformUserId: "sim-4" });
    const { variant } = seedSharedLaunchWithVariant();
    const { run } = createSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
      source: "workflow",
    });

    expect(run.status).toBe("pending");
    const started = startSimulationRun(run.id);
    expect(started.status).toBe("running");
    expect(startSimulationRun(run.id).status).toBe("running");

    expect(() => startSimulationRun(run.id.replace(/.$/, "x"))).toThrow(/not found/);
  });

  it("rejects starting a non-pending run", () => {
    const { variant } = seedSharedLaunchWithVariant();
    const { run } = createSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [] },
    });
    startSimulationRun(run.id);
    const now = Math.floor(Date.now() / 1000);
    db.update(simulationRuns)
      .set({ status: "completed", completedAt: now })
      .where(eq(simulationRuns.id, run.id))
      .run();

    expect(() => startSimulationRun(run.id)).toThrow(SimulationRunStateError);
  });

  it("query_simulations filters by launchId", async () => {
    const contact = createContact({ name: "Batch", platform: "x", platformUserId: "sim-5" });
    const launchA = upsertLaunch({ name: "A", primaryPlatform: "x" });
    const launchB = upsertLaunch({ name: "B", primaryPlatform: "x" });
    const variantA = upsertVariant({ launchId: launchA.id, body: "a" });
    const variantB = upsertVariant({ launchId: launchB.id, body: "b" });

    await invokeAgentTool("create_simulation_run", {
      variantId: variantA.id,
      populationSpec: { contactIds: [contact.id] },
      batchId: "batch-a",
    });
    await invokeAgentTool("create_simulation_run", {
      variantId: variantB.id,
      populationSpec: { contactIds: [contact.id] },
    });

    const forLaunchA = await invokeAgentTool("query_simulations", { launchId: launchA.id });
    expect((forLaunchA as { total: number }).total).toBe(1);
    expect((forLaunchA as { runs: { batchId: string | null }[] }).runs[0]?.batchId).toBe("batch-a");
  });

  it("getSimulationRun returns agents only when requested", () => {
    const contact = createContact({ name: "Detail", platform: "x", platformUserId: "sim-6" });
    const { variant } = seedSharedLaunchWithVariant();
    const { run } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });

    expect(getSimulationRun(run.id)?.agents).toBeUndefined();
    expect(getSimulationRun(run.id, { includeAgents: true })?.agents).toHaveLength(1);
  });
});

describe("simulation results and projection (slice 3.2)", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function seedRunningRun() {
    const contact = createContact({ name: "Sim Agent", platform: "x", platformUserId: "sim-3.2" });
    const launch = upsertLaunch({ name: "Projection Launch", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, label: "A", body: "copy" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
      predictionModel: "rtx:default",
    });
    return { contact, launch, variant, run, agent: agents[0]! };
  }

  it("runs the direct-agent happy path through all three tools", async () => {
    const { variant, run, agent } = seedRunningRun();

    await invokeAgentTool("record_simulation_results", {
      runId: run.id,
      results: [{ agentId: agent.id, engagementScore: 72, outcome: "like" }],
    });

    const completed = await invokeAgentTool("complete_simulation_run", {
      runId: run.id,
      predictedScore: 78,
      predictionConfidence: 0.85,
      predictedMetrics: { likes: 120 },
    });

    expect((completed as { run: { status: string } }).run.status).toBe("completed");
    const updated = getVariantById(variant.id)!;
    expect(updated.predictedScore).toBe(78);
    expect(updated.predictionConfidence).toBe(0.85);
    expect(updated.status).toBe("simulated");
    expect(updated.predictionModel).toBe("rtx:default");
  });

  it("projects the run with the latest completed_at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:00:00Z"));

    const { variant, run, agent } = seedRunningRun();

    recordSimulationAgentResults(run.id, [
      { agentId: agent.id, engagementScore: 50, outcome: "impression" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: 60,
      predictionConfidence: 0.5,
    });

    vi.setSystemTime(new Date("2026-08-15T10:00:01Z"));

    const second = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [agent.contactId!] },
      predictionModel: "rtx:new",
    });
    recordSimulationAgentResults(second.run.id, [
      { agentId: second.agents[0]!.id, engagementScore: 80, outcome: "reply" },
    ]);
    completeSimulationRun(second.run.id, {
      predictedScore: 90,
      predictionConfidence: 0.9,
    });

    const updated = getVariantById(variant.id)!;
    expect(updated.predictedScore).toBe(90);
    expect(updated.predictionModel).toBe("rtx:new");
  });

  it("breaks completed_at ties by descending run id (§6)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T10:00:00Z"));

    const { variant, run: firstRun, agent } = seedRunningRun();
    const second = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [agent.contactId!] },
      predictionModel: "rtx:new",
    });

    const [winner, loser] = [firstRun, second.run].sort((a, b) =>
      compareBinaryDesc(a.id, b.id),
    );
    const scores = {
      [firstRun.id]: { score: 60, confidence: 0.5, model: "rtx:default" },
      [second.run.id]: { score: 90, confidence: 0.9, model: "rtx:new" },
    } as const;
    const winnerMeta = scores[winner.id as keyof typeof scores];

    completeSimulationRun(loser.id, {
      predictedScore: scores[loser.id as keyof typeof scores].score,
      predictionConfidence: scores[loser.id as keyof typeof scores].confidence,
    });
    completeSimulationRun(winner.id, {
      predictedScore: winnerMeta.score,
      predictionConfidence: winnerMeta.confidence,
    });

    const updated = getVariantById(variant.id)!;
    expect(updated.predictedScore).toBe(winnerMeta.score);
    expect(updated.predictionModel).toBe(winnerMeta.model);
  });

  it("does not downgrade selected variants on projection", () => {
    const { variant, run, agent } = seedRunningRun();
    upsertVariant({ id: variant.id, launchId: variant.launchId, status: "selected" });

    recordSimulationAgentResults(run.id, [{ agentId: agent.id, outcome: "like" }]);
    completeSimulationRun(run.id, { predictedScore: 70, predictionConfidence: 0.7 });

    expect(getVariantById(variant.id)?.status).toBe("selected");
    expect(getVariantById(variant.id)?.predictedScore).toBe(70);
  });

  it("rejects cross-run agent ownership", () => {
    const first = seedRunningRun();
    const second = createAndStartSimulationRun({
      variantId: first.variant.id,
      populationSpec: { contactIds: [first.contact.id] },
    });

    expect(() =>
      recordSimulationAgentResults(second.run.id, [
        { agentId: first.agent.id, engagementScore: 10, outcome: "like" },
      ]),
    ).toThrow(SimulationAgentOwnershipError);
  });

  it("rolls back earlier agent updates when a later result violates ownership", () => {
    const first = seedRunningRun();
    const second = createAndStartSimulationRun({
      variantId: first.variant.id,
      populationSpec: { contactIds: [first.contact.id] },
    });

    expect(() =>
      recordSimulationAgentResults(second.run.id, [
        { agentId: second.agents[0]!.id, engagementScore: 55, outcome: "like" },
        { agentId: first.agent.id, engagementScore: 10, outcome: "like" },
      ]),
    ).toThrow(SimulationAgentOwnershipError);

    const secondAgent = db
      .select()
      .from(simulationAgents)
      .where(eq(simulationAgents.id, second.agents[0]!.id))
      .get()!;
    expect(secondAgent.engagementScore).toBeNull();
    expect(secondAgent.outcome).toBeNull();
  });

  it("round-trips predictedActions through record and query tools", async () => {
    const { variant, run, agent } = seedRunningRun();
    const predictedActions = [{ action: "reply", confidence: 0.8 }];

    const recorded = await invokeAgentTool("record_simulation_results", {
      runId: run.id,
      results: [{ agentId: agent.id, engagementScore: 60, outcome: "reply", predictedActions }],
    });
    const recordedAgent = (recorded as { run: { agents: { predictedActions: unknown }[] } }).run
      .agents[0];
    expect(recordedAgent?.predictedActions).toEqual(predictedActions);

    const listed = await invokeAgentTool("query_simulations", {
      variantId: variant.id,
      includeAgents: true,
    });
    const listedAgent = (listed as { runs: { agents: { predictedActions: unknown }[] }[] }).runs[0]
      ?.agents[0];
    expect(listedAgent?.predictedActions).toEqual(predictedActions);
  });

  it("rejects invalid numeric simulation contracts", () => {
    const { run, agent } = seedRunningRun();

    expect(() =>
      recordSimulationAgentResults(run.id, [
        { agentId: agent.id, engagementScore: 150, outcome: "like" },
      ]),
    ).toThrow(SimulationValidationError);

    expect(() =>
      completeSimulationRun(run.id, { predictedScore: 101, predictionConfidence: 0.5 }),
    ).toThrow(SimulationValidationError);

    expect(() =>
      completeSimulationRun(run.id, { predictedScore: 50, predictionConfidence: 1.5 }),
    ).toThrow(SimulationValidationError);

    expect(() =>
      completeSimulationRun(run.id, {
        predictedScore: 50,
        predictionConfidence: 0.5,
        predictedMetrics: { invalid_metric: 10 },
      }),
    ).toThrow(SimulationValidationError);
  });

  it("rejects record on non-running runs and invalid completions", () => {
    const { variant, run } = seedRunningRun();
    const pending = createSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [] },
    });

    expect(() =>
      recordSimulationAgentResults(pending.run.id, [{ agentId: "missing", outcome: "like" }]),
    ).toThrow(SimulationRunStateError);

    expect(() => completeSimulationRun(run.id)).toThrow(SimulationRunStateError);
    expect(() => completeSimulationRun(run.id, { status: "failed" })).toThrow(
      SimulationRunStateError,
    );

    completeSimulationRun(run.id, { predictedScore: 50, predictionConfidence: 0.5 });
    expect(() =>
      completeSimulationRun(run.id, { status: "failed", error: "retry" }),
    ).toThrow(SimulationRunStateError);
  });

  it("§8.5(3.2): results and projection responses contain no privacy sentinels", async () => {
    const contact = createContact({
      name: "Public",
      platform: "x",
      platformUserId: "sim-privacy-3.2",
      email: PRIVACY_SENTINELS.email,
    });
    const launch = upsertLaunch({ name: "Privacy", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "x" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });

    const recorded = await invokeAgentTool("record_simulation_results", {
      runId: run.id,
      results: [{ agentId: agents[0]!.id, engagementScore: 40, outcome: "click" }],
    });
    assertNoPrivacySentinels(recorded);

    const completed = await invokeAgentTool("complete_simulation_run", {
      runId: run.id,
      predictedScore: 55,
      predictionConfidence: 0.6,
    });
    assertNoPrivacySentinels(completed);
  });
});
