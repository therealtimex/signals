const routeFor = (runId) => `/dashboard/workflows/${runId}`;

async function proposalPayload(api, runId) {
  const response = await api(`/api/workflows/${runId}/proposals`);
  if (!response.ok) throw new Error(`proposal API returned ${response.status}`);
  return response.body;
}

async function cardState(page, variantId) {
  const card = page.locator(`[data-testid="workflow-proposal-card"][data-variant-id="${variantId}"]`);
  return {
    status: (await card.getByTestId("proposal-status").innerText()).trim(),
    contentHref: await card.getByRole("link", { name: "Open content" }).getAttribute("href").catch(() => null),
  };
}

export default async function run(ctx) {
  const { page, api, fixture, capture, record } = ctx;
  if (!fixture?.workflowRunId || !fixture?.variantIds?.length) {
    const error = new Error("fixture_precondition_unmet: nurture-proposals did not return run and variant ids");
    error.code = "fixture_precondition_unmet";
    throw error;
  }
  const runId = fixture.workflowRunId;
  await page.goto(`${ctx.origin}${routeFor(runId)}`, { waitUntil: "networkidle" });
  await page.getByTestId("workflow-run-status").waitFor();

  const runResponse = await api(`/api/workflows/${runId}`);
  const status = page.getByTestId("workflow-run-status");
  await capture("workflow-run-awaiting-review");
  record("run-header-awaiting-review", {
    ui: {
      text: (await status.innerText()).trim(),
      pending: Number(await status.getAttribute("data-pending-review")),
    },
    data: {
      pending: runResponse.body.proposalSummary.pendingReview,
      fixtureCount: fixture.variantIds.length,
    },
  });

  const proposals = await proposalPayload(api, runId);
  const uiRows = [];
  for (const proposal of proposals.proposals) {
    const card = page.locator(`[data-testid="workflow-proposal-card"][data-variant-id="${proposal.variantId}"]`);
    uiRows.push({
      id: proposal.variantId,
      body: (await card.getByTestId("proposal-body").innerText()).replace(/\r\n/g, "\n"),
      href: await card.getByRole("link", { name: "Open variant" }).getAttribute("href"),
    });
  }
  await capture("workflow-run-proposals");
  record("proposals-listed", {
    ui: uiRows,
    data: proposals.proposals.map((proposal) => ({ id: proposal.variantId, body: proposal.body, href: proposal.href })),
  });

  const [approvedId, rejectedId, revisionId] = fixture.variantIds;
  const approvedCard = page.locator(`[data-variant-id="${approvedId}"]`);
  await approvedCard.getByRole("button", { name: "Approve & materialize" }).click();
  await approvedCard.getByText("Materialized · export only").waitFor();
  const afterApproval = await proposalPayload(api, runId);
  const approved = afterApproval.proposals.find((proposal) => proposal.variantId === approvedId);
  const approvedUi = await cardState(page, approvedId);
  await capture("workflow-run-proposal-materialized");
  record("approve-materializes", {
    ui: approvedUi,
    data: {
      contentItemId: approved.materializedContentItemId,
      approvalBy: approved.approval.by,
      evidenceKind: approved.approval.evidenceKind,
    },
  });

  const rejectionNote = "Not appropriate for this relationship yet.";
  const rejectedCard = page.locator(`[data-variant-id="${rejectedId}"]`);
  await rejectedCard.getByRole("button", { name: "Reject" }).click();
  await rejectedCard.getByRole("textbox", { name: "Rejection note" }).fill(rejectionNote);
  await rejectedCard.getByRole("button", { name: "Confirm rejection" }).click();
  await rejectedCard.getByText("Rejected", { exact: true }).waitFor();
  const afterReject = await proposalPayload(api, runId);
  const rejected = afterReject.proposals.find((proposal) => proposal.variantId === rejectedId);
  await capture("workflow-run-proposal-rejected");
  record("reject-persists", {
    ui: {
      status: (await rejectedCard.getByTestId("proposal-status").innerText()).trim(),
      pending: afterReject.summary.pendingReview,
      note: rejectionNote,
    },
    data: {
      variantStatus: rejected.variantStatus,
      approvalState: rejected.approval.state,
      note: rejected.approval.note,
    },
  });

  const revisionNote = "Make this more specific to the recent product launch.";
  const revisionCard = page.locator(`[data-variant-id="${revisionId}"]`);
  await revisionCard.getByRole("button", { name: "Request revision" }).click();
  await revisionCard.getByRole("textbox", { name: "Revision note" }).fill(revisionNote);
  const revisionResponse = page.waitForResponse((response) => response.url().endsWith(`/api/variants/${revisionId}/request-revision`));
  await revisionCard.getByRole("button", { name: "Send revision request" }).click();
  const revisionBody = await (await revisionResponse).json();
  await revisionCard.getByText("Revision requested", { exact: true }).waitFor();
  const afterRevision = await proposalPayload(api, runId);
  const revision = afterRevision.proposals.find((proposal) => proposal.variantId === revisionId);
  await capture("workflow-run-proposal-revision");
  record("revise-requests", {
    ui: { status: (await revisionCard.getByTestId("proposal-status").innerText()).trim(), note: revisionNote },
    data: {
      note: revision.revisionRequest.note,
      evidenceKind: revision.revisionRequest.evidenceKind,
      approvalState: revision.approval.state,
      threadPath: revisionBody.thread?.threadPath,
    },
  });

  await page.goto(`${ctx.origin}/dashboard/launches/${fixture.launchId}`, { waitUntil: "networkidle" });
  const launchVariantIds = await page.locator("[data-variant-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-variant-id")).filter(Boolean));
  await capture("launch-proposal-roundtrip");
  record("launch-roundtrip", { ui: launchVariantIds, data: fixture.variantIds });

  const idempotent = await api("/api/agent-tools/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tool: "materialize_variant",
      input: {
        variantId: approvedId,
        approval: { by: "user", evidence: { kind: "thread_message", workspaceSlug: "signals-issue-413-qa", threadSlug: "fixture", message: "approve fixture" } },
      },
    }),
  });
  const afterIdempotent = await proposalPayload(api, runId);
  const storedApproved = afterIdempotent.proposals.find((proposal) => proposal.variantId === approvedId);
  record("thread-approval-idempotent", {
    data: {
      created: idempotent.body?.result?.created,
      evidenceKind: storedApproved.approval.evidenceKind,
    },
  });
}
