import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { db } from "@/lib/db/client";
import { contactIdentities, contacts, simulationRuns } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertLaunch } from "@/lib/db/queries/launches";
import { upsertPersona } from "@/lib/db/queries/personas";
import { upsertVariant } from "@/lib/db/queries/variants";
import {
  createAndStartSimulationRun,
  createSimulationRun,
  getSimulationRun,
  startSimulationRun,
} from "@/lib/db/queries/simulations";
import { SimulationRunStateError, SimulationScopeError } from "@/lib/db/queries/simulation-errors";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

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
