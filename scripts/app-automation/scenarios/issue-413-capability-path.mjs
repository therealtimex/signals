async function getTemplate(api, fixture) {
  if (fixture?.templateId) return (await api(`/api/workflows/templates/${fixture.templateId}`)).body;
  const response = await api("/api/workflows/templates?templateType=nurture&pageSize=100");
  return response.body.data.find((template) => template.name === "Contact Relationship Nurture");
}

export default async function run(ctx) {
  const { page, api, fixture, capture, record } = ctx;
  const template = await getTemplate(api, fixture);
  if (!template || !fixture?.targetId) {
    const error = new Error("fixture_precondition_unmet: nurture template and active represented target are required");
    error.code = "fixture_precondition_unmet";
    throw error;
  }
  await page.goto(`${ctx.origin}/dashboard/workflows`, { waitUntil: "networkidle" });
  const card = page.locator("[data-testid=workflow-template-card]").filter({ hasText: template.name });
  await card.getByRole("button", { name: "Run" }).click();
  const gate = page.getByTestId("nurture-approval-gate");
  await gate.waitFor();
  const toggle = gate.getByRole("switch");
  const config = typeof template.config === "string" ? JSON.parse(template.config) : template.config;
  await capture("nurture-approval-gate");
  record("activation-gate-locked", {
    ui: {
      mode: await gate.getAttribute("data-mode"),
      reason: await gate.getAttribute("data-reason"),
      checked: await toggle.isChecked(),
      disabled: await toggle.isDisabled(),
      rows: await gate.locator("[data-testid=nurture-approval-surface]").count(),
      alwaysExplicit: (await gate.innerText()).includes("always explicit"),
    },
    data: { requireApproval: config.requireApproval },
  });

  const before = await api(`/api/workflows?templateId=${template.id}&pageSize=100`);
  const rejected = await api(`/api/workflows/templates/${template.id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: { requireApproval: false, targetId: fixture.targetId } }),
  });
  const after = await api(`/api/workflows?templateId=${template.id}&pageSize=100`);
  record("run-config-rejects-off", {
    data: { status: rejected.status, errorCode: rejected.body.errorCode, beforeCount: before.body.total, afterCount: after.body.total },
  });

  const runResponse = await api(`/api/workflows/${fixture.workflowRunId}`);
  const launchResponse = await api(`/api/launches/${fixture.launchId}`);
  record("composition-pinned", {
    data: {
      runMandate: runResponse.body.config.writingIntent.mandate,
      runPolicy: runResponse.body.config.writingIntent.approvalPolicy,
      gateMode: runResponse.body.config.approvalGate.mode,
      launchMandate: launchResponse.body.metadata.writing.composition.mandate,
    },
  });

  await page.goto(`${ctx.origin}/dashboard/workflows/${fixture.workflowRunId}`, { waitUntil: "networkidle" });
  const proposalResponse = await api(`/api/workflows/${fixture.workflowRunId}/proposals`);
  const section = page.getByTestId("workflow-run-proposals");
  await section.waitFor();
  const draftOnlyCount = await section.getByText("Draft only", { exact: true }).count();
  const hasSendOrPublish = await section.getByRole("button", { name: /^(Send|Publish)$/ }).count() > 0;
  await capture("nurture-draft-only-proposals");
  record("variants-draft-only", {
    ui: { draftOnlyCount, hasSendOrPublish },
    data: {
      total: proposalResponse.body.proposals.length,
      allDraftOnly: proposalResponse.body.proposals.every((proposal) => proposal.capability.publish === "draft_only"),
      allExplicit: proposalResponse.body.proposals.every((proposal) => proposal.approval.policy === "explicit"),
      allAssistOnly: proposalResponse.body.proposals.every((proposal) => proposal.mandate === "assist_only"),
    },
  });

  const proposal = proposalResponse.body.proposals[0];
  const cardAfter = page.locator(`[data-variant-id="${proposal.variantId}"]`);
  const materializeResponse = page.waitForResponse((response) => response.url().endsWith(`/api/variants/${proposal.variantId}/materialize`));
  await cardAfter.getByRole("button", { name: "Approve & materialize" }).click();
  const materialized = await (await materializeResponse).json();
  await cardAfter.getByText("Materialized · export only").waitFor();
  const send = await api("/api/content/send-to-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentItemId: materialized.contentItemId, platforms: ["x"], text: proposal.body }),
  });
  const jobs = await api(`/api/content/publish-jobs?contentItemId=${materialized.contentItemId}`);
  await capture("nurture-export-only");
  record("materialized-is-export-only", {
    ui: { status: (await cardAfter.getByTestId("proposal-status").innerText()).trim() },
    data: {
      nextAction: materialized.nextAction,
      sendRefused: !send.ok,
      publishJobs: jobs.body.jobs.length,
    },
  });
}
