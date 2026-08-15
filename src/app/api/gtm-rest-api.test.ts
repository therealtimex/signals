import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { nanoid } from "nanoid";
import { GET as listLaunches, POST as createLaunch } from "@/app/api/launches/route";
import { GET as getLaunch, PUT as updateLaunch } from "@/app/api/launches/[id]/route";
import { POST as createVariantUnderLaunch } from "@/app/api/launches/[id]/variants/route";
import { GET as getVariant, PUT as updateVariant } from "@/app/api/variants/[id]/route";
import { GET as listSimulations } from "@/app/api/simulations/route";
import { GET as getSimulation } from "@/app/api/simulations/[id]/route";
import { GET as getTranscript } from "@/app/api/simulations/[id]/agents/[agentId]/transcript/route";
import { GET as getGtmContext } from "@/app/api/content/[id]/gtm-context/route";
import { createContact } from "@/lib/db/queries/contacts";
import { createContentItem } from "@/lib/db/queries/content";
import { createGoal } from "@/lib/db/queries/goals";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { calibrateSimulationRun } from "@/lib/db/queries/calibrations";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  completeSimulationRun,
  createAndStartSimulationRun,
  recordSimulationAgentResults,
} from "@/lib/db/queries/simulations";
import { publishVariant, upsertVariant } from "@/lib/db/queries/variants";
import { scoreEngagementMetrics } from "@/lib/db/simulation-scoring";
import * as gtmSerializer from "@/lib/serializers/gtm";
import { resetCoreTables } from "@/test/db";
import { db } from "@/lib/db/client";
import { contentPosts, engagementMetrics, platformAccounts, workflowTemplates } from "@/lib/db/schema";

describe("UI 4.1 REST API", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("lists launches with pagination, search, status, and scope filtering", async () => {
    upsertLaunch({ name: "Shared Launch", primaryPlatform: "x", scope: "shared", status: "live" });
    upsertLaunch({
      name: "Private Launch",
      primaryPlatform: "x",
      scope: "local_only",
      status: "draft",
    });
    upsertLaunch({ name: "Archive Alpha", primaryPlatform: "x", status: "archived" });
    upsertLaunch({ name: "Archive Beta", primaryPlatform: "x", status: "archived" });

    const sharedOnly = await listLaunches(new NextRequest("http://localhost/api/launches"));
    const sharedBody = await sharedOnly.json();
    expect(sharedOnly.status).toBe(200);
    expect(sharedBody.total).toBe(3);

    const withLocal = await listLaunches(
      new NextRequest("http://localhost/api/launches?includeLocalOnly=true"),
    );
    expect((await withLocal.json()).total).toBe(4);

    const search = await listLaunches(
      new NextRequest("http://localhost/api/launches?search=Archive"),
    );
    expect((await search.json()).total).toBe(2);

    const status = await listLaunches(
      new NextRequest("http://localhost/api/launches?status=live"),
    );
    expect((await status.json()).data[0].name).toBe("Shared Launch");

    const page = await listLaunches(
      new NextRequest("http://localhost/api/launches?status=archived&pageSize=1&page=2"),
    );
    const pageBody = await page.json();
    expect(pageBody.total).toBe(2);
    expect(pageBody.data).toHaveLength(1);
  });

  it("POST /api/launches returns 201 and GET detail returns 404 for unknown id", async () => {
    const created = await createLaunch(
      new NextRequest("http://localhost/api/launches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Created Launch", brief: "hello", primaryPlatform: "x" }),
      }),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.name).toBe("Created Launch");
    expect(body.brief).toBe("hello");

    const missing = await getLaunch(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing-launch-id" }),
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
  });

  it("PUT clears nullable launch and variant fields with explicit null", async () => {
    const workflowTemplateId = nanoid();
    db.insert(workflowTemplates)
      .values({
        id: workflowTemplateId,
        name: "Test Workflow",
        templateType: "content",
        status: "active",
        config: "{}",
      })
      .run();

    const launch = upsertLaunch({
      name: "Nullable Launch",
      primaryPlatform: "x",
      brief: "keep until cleared",
      workflowTemplateId,
      launchedAt: 1_700_000_000,
    });
    const variant = upsertVariant({
      launchId: launch.id,
      label: "Label",
      body: "Body text",
    });

    const clearedLaunch = await updateLaunch(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nullable Launch",
          brief: null,
          workflowTemplateId: null,
          launchedAt: null,
          completedAt: null,
        }),
      }),
      { params: Promise.resolve({ id: launch.id }) },
    );
    const launchBody = await clearedLaunch.json();
    expect(launchBody.brief).toBeNull();
    expect(launchBody.workflowTemplateId).toBeNull();
    expect(launchBody.launchedAt).toBeNull();

    const clearedVariant = await updateVariant(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: null, body: null }),
      }),
      { params: Promise.resolve({ id: variant.id }) },
    );
    const variantBody = await clearedVariant.json();
    expect(variantBody.label).toBeNull();
    expect(variantBody.body).toBeNull();
  });

  it("returns launch detail with variants and goal links", async () => {
    const goal = createGoal({
      name: "Grow audience",
      goalType: "audience_growth",
      targetValue: 100,
      unit: "followers",
    });
    const launch = upsertLaunch({ name: "Goal Linked", primaryPlatform: "x" });
    upsertVariant({ launchId: launch.id, label: "Hook", body: "text" });
    upsertGraphEdge({
      edgeType: "contributes_to",
      srcType: "launch",
      srcId: launch.id,
      dstType: "goal",
      dstId: goal.id,
      scope: "shared",
      source: "test",
    });

    const res = await getLaunch(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: launch.id }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.variants).toHaveLength(1);
    expect(body.goalIds).toContain(goal.id);
  });

  it("launch PUT returns 404 for unknown id and POST validates platform", async () => {
    const missing = await updateLaunch(
      new NextRequest("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ name: "x" }),
      }),
      { params: Promise.resolve({ id: "missing-launch" }) },
    );
    expect(missing.status).toBe(404);

    const badPlatform = await createLaunch(
      new NextRequest("http://localhost/api/launches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bad", primaryPlatform: "not-a-platform" }),
      }),
    );
    expect(badPlatform.status).toBe(400);
    const err = await badPlatform.json();
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("creates variant under launch and rejects published status on PUT", async () => {
    const launch = upsertLaunch({ name: "Variants", primaryPlatform: "x" });
    const missingLaunch = await createVariantUnderLaunch(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ label: "A" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missingLaunch.status).toBe(404);

    const created = await createVariantUnderLaunch(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Hook A", body: "copy" }),
      }),
      { params: Promise.resolve({ id: launch.id }) },
    );
    expect(created.status).toBe(201);
    const variant = await created.json();

    const rejectPublish = await updateVariant(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      }),
      { params: Promise.resolve({ id: variant.id }) },
    );
    expect(rejectPublish.status).toBe(400);

    const fetched = await getVariant(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: variant.id }),
    });
    const fetchedBody = await fetched.json();
    expect(fetchedBody.launchId).toBe(launch.id);

    const otherLaunch = upsertLaunch({ name: "Other", primaryPlatform: "x" });
    const afterPut = await updateVariant(
      new NextRequest("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Moved?" }),
      }),
      { params: Promise.resolve({ id: variant.id }) },
    );
    const afterPutBody = await afterPut.json();
    expect(afterPutBody.launchId).toBe(launch.id);
    expect(afterPutBody.launchId).not.toBe(otherLaunch.id);
  });

  it("lists slim simulation runs with filters", async () => {
    const launch = upsertLaunch({ name: "Sim list", primaryPlatform: "x" });
    const variantA = upsertVariant({ launchId: launch.id, body: "a" });
    const variantB = upsertVariant({ launchId: launch.id, body: "b" });
    const contact = createContact({ name: "Sim", platform: "x", platformUserId: "sim-list" });
    const runA = createAndStartSimulationRun({
      variantId: variantA.id,
      populationSpec: { contactIds: [contact.id] },
    }).run;
    createAndStartSimulationRun({
      variantId: variantB.id,
      populationSpec: { contactIds: [contact.id] },
    });

    const byVariant = await listSimulations(
      new NextRequest(`http://localhost/api/simulations?variantId=${variantA.id}`),
    );
    const variantBody = await byVariant.json();
    expect(variantBody.total).toBe(1);
    expect(variantBody.data[0].id).toBe(runA.id);
    expect(variantBody.data[0].agents).toBeUndefined();

    const byLaunch = await listSimulations(
      new NextRequest(`http://localhost/api/simulations?launchId=${launch.id}`),
    );
    expect((await byLaunch.json()).total).toBe(2);

    const runningOnly = await listSimulations(
      new NextRequest(`http://localhost/api/simulations?variantId=${variantA.id}&status=running`),
    );
    expect((await runningOnly.json()).total).toBe(1);
  });

  it("simulation detail supports include flags and surfaces failed run error", async () => {
    const launch = upsertLaunch({ name: "Fail", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "x" });
    const contact = createContact({ name: "Fail", platform: "x", platformUserId: "fail-1" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 10, outcome: "impression" },
    ]);
    completeSimulationRun(run.id, { status: "failed", error: "engine timeout" });

    const missing = await getSimulation(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing-run" }),
    });
    expect(missing.status).toBe(404);

    const failed = await getSimulation(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: run.id }),
    });
    const failedBody = await failed.json();
    expect(failedBody.status).toBe("failed");
    expect(failedBody.error).toBe("engine timeout");

    const withAgents = await getSimulation(
      new NextRequest(`http://localhost/api/simulations/${run.id}?includeAgents=true`),
      { params: Promise.resolve({ id: run.id }) },
    );
    const agentsBody = await withAgents.json();
    expect(agentsBody.agents).toHaveLength(1);

    const withTranscripts = await getSimulation(
      new NextRequest(
        `http://localhost/api/simulations/${run.id}?includeTranscripts=true`,
      ),
      { params: Promise.resolve({ id: run.id }) },
    );
    const transcriptBody = await withTranscripts.json();
    expect(transcriptBody.agents).toHaveLength(1);
    expect(transcriptBody.agents[0]).toHaveProperty("transcript", null);
  });

  it("transcript route returns 200 and 404 codes", async () => {
    const launch = upsertLaunch({ name: "Transcript", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "x" });
    const contact = createContact({ name: "Tr", platform: "x", platformUserId: "tr-api" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    const agentId = agents[0]!.id;

    const noRun = await getTranscript(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing-run", agentId }),
    });
    expect(noRun.status).toBe(404);
    expect((await noRun.json()).code).toBe("RUN_NOT_FOUND");

    const noAgent = await getTranscript(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: run.id, agentId: `missing-${nanoid()}` }),
    });
    expect((await noAgent.json()).code).toBe("AGENT_NOT_FOUND");

    const noTranscript = await getTranscript(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: run.id, agentId }),
    });
    expect(noTranscript.status).toBe(404);
    expect((await noTranscript.json()).code).toBe("TRANSCRIPT_NOT_FOUND");

    recordSimulationAgentResults(run.id, [
      {
        agentId,
        engagementScore: 40,
        outcome: "like",
        transcript: [{ role: "agent", text: "ok" }],
      },
    ]);

    const ok = await getTranscript(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: run.id, agentId }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).agentId).toBe(agentId);
  });

  it("gtm-context progressive nulls and full lineage", async () => {
    const missing = await getGtmContext(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing-content" }),
    });
    expect(missing.status).toBe(404);

    const itemOnly = createContentItem({
      title: "Draft post",
      body: "hello",
      contentType: "post",
      origin: "authored",
      direction: "outbound",
      status: "draft",
    });
    const noVariant = await getGtmContext(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: itemOnly.id }),
    });
    const noVariantBody = await noVariant.json();
    expect(noVariantBody.variant).toBeNull();
    expect(noVariantBody.latestRun).toBeNull();

    const launch = upsertLaunch({ name: "GTM", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "published copy" });
    const contact = createContact({ name: "GTM", platform: "x", platformUserId: "gtm-1" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    const metrics = { likes: 10 };
    const score = scoreEngagementMetrics({
      likes: 10,
      comments: 0,
      shares: 0,
      impressions: 0,
      clicks: 0,
      bookmarks: 0,
      quotes: 0,
      retweets: 0,
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: score,
      predictionConfidence: 0.8,
      predictedMetrics: metrics,
    });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: 1_700_000_000,
    });

    const withRun = await getGtmContext(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: published.contentItemId! }),
    });
    const withRunBody = await withRun.json();
    expect(withRunBody.variant.id).toBe(published.id);
    expect(withRunBody.launch.name).toBe("GTM");
    expect(withRunBody.latestRun.status).toBe("completed");
    expect(withRunBody.latestCalibration).toBeNull();
  });

  it("simulation detail includes calibration when requested", async () => {
    const PUBLISHED_AT = 1_700_000_000;
    const contact = createContact({ name: "Calib", platform: "x", platformUserId: "cal-api" });
    const launch = upsertLaunch({ name: "Calib API", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "copy" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    const metrics = { likes: 12 };
    const score = scoreEngagementMetrics({
      likes: 12,
      comments: 0,
      shares: 0,
      impressions: 0,
      clicks: 0,
      bookmarks: 0,
      quotes: 0,
      retweets: 0,
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: score,
      predictionConfidence: 0.7,
      predictedMetrics: metrics,
    });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: PUBLISHED_AT,
    });
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@brand",
        authType: "oauth",
      })
      .run();
    const postId = nanoid();
    db.insert(contentPosts)
      .values({
        id: postId,
        contentItemId: published.contentItemId!,
        platformAccountId,
        publishedAt: PUBLISHED_AT,
        status: "published",
      })
      .run();
    db.insert(engagementMetrics)
      .values({
        id: nanoid(),
        contentPostId: postId,
        snapshotAt: PUBLISHED_AT + 100,
        likes: 12,
        comments: 0,
        shares: 0,
        impressions: 0,
        clicks: 0,
        bookmarks: 0,
        quotes: 0,
        retweets: 0,
      })
      .run();

    calibrateSimulationRun(run.id, { observedUntil: PUBLISHED_AT + 1000 });

    const res = await getSimulation(
      new NextRequest(
        `http://localhost/api/simulations/${run.id}?includeCalibration=true`,
      ),
      { params: Promise.resolve({ id: run.id }) },
    );
    const body = await res.json();
    expect(body.latestCalibration).toMatchObject({
      simulationRunId: run.id,
      actualScore: expect.any(Number),
    });

    const gtm = await getGtmContext(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: published.contentItemId! }),
    });
    const gtmBody = await gtm.json();
    expect(gtmBody.latestRun.status).toBe("completed");
    expect(gtmBody.latestCalibration).toMatchObject({
      simulationRunId: run.id,
    });
  });

  it("gtm-context returns variant without completed run", async () => {
    const launch = upsertLaunch({ name: "No Run", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "only variant" });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: 1_700_000_000,
    });

    const res = await getGtmContext(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: published.contentItemId! }),
    });
    const body = await res.json();
    expect(body.variant.id).toBe(published.id);
    expect(body.latestRun).toBeNull();
    expect(body.latestCalibration).toBeNull();
  });

  it("GET routes return INTERNAL_ERROR envelope on unexpected failures", async () => {
    const launch = upsertLaunch({ name: "Error path", primaryPlatform: "x" });
    const spy = vi.spyOn(gtmSerializer, "serializeLaunch").mockImplementation(() => {
      throw new Error("serialization blew up");
    });

    const res = await getLaunch(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: launch.id }),
    });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Internal server error", code: "INTERNAL_ERROR" });

    spy.mockRestore();
  });
});
