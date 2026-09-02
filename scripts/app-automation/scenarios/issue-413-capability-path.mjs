async function getTemplate(api, fixture) {
  if (fixture?.templateId) return (await api(`/api/workflows/templates/${fixture.templateId}`)).body;
  const response = await api("/api/workflows/templates?templateType=nurture&pageSize=100");
  return response.body.data.find((template) => template.name === "Contact Relationship Nurture");
}

function object(value) {
  if (typeof value === "string") {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function surfaceLabel(surface) {
  const [platform, kind] = surface.split("/");
  const platformLabel = platform === "x"
    ? "X"
    : platform === "linkedin"
      ? "LinkedIn"
    : `${platform.slice(0, 1).toUpperCase()}${platform.slice(1)}`;
  return `${platformLabel} ${kind === "direct_message" ? "DM" : kind}`;
}

function gateSurfaceRow(surface) {
  const approval = surface.reason === "explicit_floor"
    ? "always explicit"
    : surface.approval === "explicit"
      ? "approval required"
      : "operator choice";
  return `${surfaceLabel(surface.surface)} Draft only · ${approval}`;
}

export function templateGateSurfaceRows(config) {
  const writingIntent = object(config).writingIntent;
  const surfaces = object(writingIntent).surfaces;
  if (!Array.isArray(surfaces)) return [];
  return surfaces.map((surface) => gateSurfaceRow({
    surface: String(surface),
    approval: "explicit",
    reason: String(surface).endsWith("/direct_message")
      ? "explicit_floor"
      : "assist_only_mandate",
  }));
}

function proposalCard(page, variantId) {
  return page.locator(
    `[data-testid="workflow-proposal-card"][data-variant-id="${variantId}"]`,
  );
}

export default async function run(ctx) {
  const { page, api, fixture, capture, record } = ctx;
  const template = await getTemplate(api, fixture);
  if (!template || !fixture?.targetId || !fixture?.workflowRunId || !fixture?.launchId) {
    const error = new Error("fixture_precondition_unmet: nurture template, run, launch, and active represented target are required");
    error.code = "fixture_precondition_unmet";
    throw error;
  }

  const [runResponse, launchResponse] = await Promise.all([
    api(`/api/workflows/${fixture.workflowRunId}`),
    api(`/api/launches/${fixture.launchId}`),
  ]);
  const runConfig = object(runResponse.body.config);
  const launchMetadata = object(launchResponse.body.metadata);

  await page.goto(`${ctx.origin}/dashboard/workflows`, { waitUntil: "networkidle" });
  const card = page.locator("[data-testid=workflow-template-card]").filter({ hasText: template.name });
  await card.getByRole("button", { name: "Run" }).click();
  const gate = page.getByTestId("nurture-approval-gate");
  await gate.waitFor();
  const toggle = gate.getByRole("switch");
  const config = object(template.config);
  const surfaceRows = await gate.locator("[data-testid=nurture-approval-surface]")
    .evaluateAll((nodes) => nodes.map((node) => Array.from(node.children)
      .map((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")));
  await capture("nurture-approval-gate");
  record("activation-gate-locked", {
    ui: {
      mode: await gate.getAttribute("data-mode"),
      reason: await gate.getAttribute("data-reason"),
      checked: await toggle.isChecked(),
      disabled: await toggle.isDisabled(),
      surfaceRows,
      lockedCopy: (await gate.innerText()).replace(/\s+/g, " ").trim(),
      operatorChoiceCopyCount: await gate.getByText(/operator choice/i).count(),
      autonomyActionCount: await gate.getByRole("button", { name: /send|publish|enable autonomous publishing/i }).count(),
    },
    data: {
      requireApproval: config.requireApproval,
      surfaceRows: templateGateSurfaceRows(config),
    },
  });

  const before = await api(`/api/workflows?templateId=${template.id}&pageSize=100`);
  const rejected = await api(`/api/workflows/templates/${template.id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        contactNurture: false,
        writingIntent: null,
        requireApproval: false,
        targetId: fixture.targetId,
      },
    }),
  });
  const after = await api(`/api/workflows?templateId=${template.id}&pageSize=100`);
  record("run-config-rejects-off", {
    data: {
      status: rejected.status,
      errorCode: rejected.body.errorCode,
      beforeCount: before.body.total,
      afterCount: after.body.total,
    },
  });

  record("composition-pinned", {
    data: {
      runMandate: runConfig.writingIntent.mandate,
      runPolicy: runConfig.writingIntent.approvalPolicy,
      gateMode: runConfig.approvalGate.mode,
      launchMandate: launchMetadata.writing.composition.mandate,
    },
  });

  await page.goto(`${ctx.origin}/dashboard/workflows/${fixture.workflowRunId}`, { waitUntil: "networkidle" });
  const proposalResponse = await api(`/api/workflows/${fixture.workflowRunId}/proposals`);
  const section = page.getByTestId("workflow-run-proposals");
  await section.waitFor();
  const cards = section.locator('[data-testid="workflow-proposal-card"]');
  const uiIds = await cards.evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute("data-variant-id"))
    .filter(Boolean));
  await capture("nurture-draft-only-proposals");
  record("variants-draft-only", {
    ui: {
      cardCount: await cards.count(),
      ids: uiIds,
      draftOnlyCount: await section.getByText("Draft only", { exact: true }).count(),
      awaitingReviewCount: await section.getByText("Awaiting review", { exact: true }).count(),
      sendPublishActionCount: await section.getByRole("button", { name: /send|publish/i }).count(),
      publishedCopyCount: await section.getByText(/Published/i).count(),
    },
    data: {
      total: proposalResponse.body.proposals.length,
      fixtureIds: fixture.variantIds,
      apiIds: proposalResponse.body.proposals.map((proposal) => proposal.variantId),
      allDraftOnly: proposalResponse.body.proposals.every((proposal) => proposal.capability.publish === "draft_only"),
      allExplicit: proposalResponse.body.proposals.every((proposal) => proposal.approval.policy === "explicit"),
      allAssistOnly: proposalResponse.body.proposals.every((proposal) => proposal.mandate === "assist_only"),
    },
  });

  const proposal = proposalResponse.body.proposals.find((candidate) =>
    candidate.valid && fixture.variantIds.includes(candidate.variantId));
  if (!proposal) throw new Error("fixture proposal was not returned");
  const cardAfter = proposalCard(page, proposal.variantId);
  const materializeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/variants/${proposal.variantId}/materialize`));
  await cardAfter.getByRole("button", { name: "Approve & materialize" }).click();
  const materializedResponse = await materializeResponse;
  const materialized = await materializedResponse.json();
  await cardAfter.getByText("Materialized · export only").waitFor();
  const [content, send, jobs] = await Promise.all([
    api(`/api/content/${materialized.contentItemId}`),
    api("/api/content/send-to-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentItemId: materialized.contentItemId, platforms: ["x"], text: proposal.body }),
    }),
    api(`/api/content/publish-jobs?contentItemId=${materialized.contentItemId}`),
  ]);
  await capture("nurture-export-only");
  record("materialized-is-export-only", {
    ui: {
      status: (await cardAfter.getByTestId("proposal-status").innerText()).trim(),
      publishedCopyCount: await cardAfter.getByText(/Published/i).count(),
      sendPublishActionCount: await cardAfter.getByRole("button", { name: /send|publish/i }).count(),
    },
    data: {
      contentItemId: materialized.contentItemId,
      contentExists: content.ok,
      contentResponseId: content.body?.item?.id ?? null,
      nextAction: materialized.nextAction,
      sendStatus: send.status,
      sendSuccess: send.body?.success,
      sendErrorCode: send.body?.errorCode,
      publishJobs: jobs.body.jobs.length,
    },
  });
}
