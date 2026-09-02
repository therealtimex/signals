const routeFor = (runId) => `/dashboard/workflows/${runId}`;

async function proposalPayload(api, runId) {
  const response = await api(`/api/workflows/${runId}/proposals`);
  if (!response.ok) throw new Error(`proposal API returned ${response.status}`);
  return response.body;
}

function proposalById(payload, variantId) {
  const proposal = payload.proposals.find((candidate) => candidate.variantId === variantId);
  if (!proposal?.valid) throw new Error(`valid proposal ${variantId} was not returned`);
  return proposal;
}

function recipientLabel(recipient) {
  if (!recipient) return "No recipient";
  const primary = recipient.name ?? recipient.handle ?? "Contact";
  return recipient.handle
    ? `${primary} · @${recipient.handle.replace(/^@/, "")}`
    : primary;
}

function surfaceLabel(surface) {
  const [platform, kind] = surface.split("/");
  const platformLabel = platform === "x"
    ? "X"
    : `${platform.slice(0, 1).toUpperCase()}${platform.slice(1)}`;
  const kindLabel = kind === "direct_message" ? "DM" : kind;
  return `${platformLabel} ${kindLabel}`;
}

function capabilityLabel(capability) {
  if (capability === "draft_only") return "Draft only";
  if (capability === "export_only") return "Export only";
  if (capability === "beta") return "Beta";
  if (capability === "direct") return "Direct";
  return "Unsupported";
}

function proposalCard(page, variantId) {
  return page.locator(
    `[data-testid="workflow-proposal-card"][data-variant-id="${variantId}"]`,
  );
}

async function forbiddenUi(locator) {
  return {
    publishedCopyCount: await locator.getByText(/Published/i).count(),
    sendPublishActionCount: await locator.getByRole("button", { name: /send|publish/i }).count(),
  };
}

async function waitForPending(page, expected) {
  await page.waitForFunction((pending) =>
    document.querySelector('[data-testid="workflow-run-status"]')
      ?.getAttribute("data-pending-review") === String(pending), expected);
  return Number(await page.getByTestId("workflow-run-status").getAttribute("data-pending-review"));
}

async function listingUiRow(page, proposal) {
  const card = proposalCard(page, proposal.variantId);
  const expectedRecipient = recipientLabel(proposal.recipient);
  const recipient = proposal.recipient
    ? card.getByRole("link", { name: expectedRecipient, exact: true })
    : card.getByText("No recipient", { exact: true });
  return {
    id: proposal.variantId,
    recipientText: (await recipient.innerText()).trim(),
    recipientHref: proposal.recipient ? await recipient.getAttribute("href") : null,
    surfaceText: (await card.getByText(surfaceLabel(proposal.surface), { exact: true }).innerText()).trim(),
    capabilityText: (await card.getByText(capabilityLabel(proposal.capability.publish), { exact: true }).innerText()).trim(),
    statusText: (await card.getByTestId("proposal-status").innerText()).trim(),
    auditText: (await card.getByText(/^Audit:/).innerText()).replace(/\s+/g, " ").trim(),
    body: (await card.getByTestId("proposal-body").innerText()).replace(/\r\n/g, "\n"),
    variantHref: await card.getByRole("link", { name: "Open variant" }).getAttribute("href"),
  };
}

function listingDataRow(proposal) {
  return {
    id: proposal.variantId,
    recipientText: recipientLabel(proposal.recipient),
    recipientHref: proposal.recipient?.href ?? null,
    surfaceText: surfaceLabel(proposal.surface),
    capabilityText: capabilityLabel(proposal.capability.publish),
    statusText: "Awaiting review",
    auditText: `Audit: ${proposal.audit?.verdict ?? "not run"}`,
    body: proposal.body,
    variantHref: proposal.href,
  };
}

async function decidedCardUi(page, card) {
  return {
    status: (await card.getByTestId("proposal-status").innerText()).trim(),
    decisionActionCount: await card.getByRole("button", {
      name: /^(Approve & materialize|Request revision|Reject)$/,
    }).count(),
    ...await forbiddenUi(card),
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
  const section = page.getByTestId("workflow-run-proposals");
  const cards = section.locator('[data-testid="workflow-proposal-card"]');
  const uiIds = await cards.evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute("data-variant-id"))
    .filter(Boolean));
  const uiRows = [];
  const dataRows = [];
  for (const variantId of fixture.variantIds) {
    const proposal = proposalById(proposals, variantId);
    uiRows.push(await listingUiRow(page, proposal));
    dataRows.push(listingDataRow(proposal));
  }
  await capture("workflow-run-proposals");
  record("proposals-listed", {
    ui: {
      count: await cards.count(),
      ids: uiIds,
      rows: uiRows,
      ...await forbiddenUi(section),
    },
    data: {
      fixtureIds: fixture.variantIds,
      apiIds: proposals.proposals.map((proposal) => proposal.variantId),
      rows: dataRows,
    },
  });

  const [approvedId, rejectedId, revisionId] = fixture.variantIds;
  const approvedCard = proposalCard(page, approvedId);
  await approvedCard.getByRole("button", { name: "Approve & materialize" }).click();
  await approvedCard.getByText("Materialized · export only").waitFor();
  const afterApproval = await proposalPayload(api, runId);
  const approved = proposalById(afterApproval, approvedId);
  const content = await api(`/api/content/${approved.materializedContentItemId}`);
  const approvedUi = {
    ...await decidedCardUi(page, approvedCard),
    contentHref: await approvedCard.getByRole("link", { name: "Open content" }).getAttribute("href"),
    pending: await waitForPending(page, 2),
  };
  await capture("workflow-run-proposal-materialized");
  record("approve-materializes", {
    ui: approvedUi,
    data: {
      contentItemId: approved.materializedContentItemId,
      contentExists: content.ok,
      contentResponseId: content.body?.item?.id ?? null,
      approvalBy: approved.approval.by,
      evidenceKind: approved.approval.evidenceKind,
      pending: afterApproval.summary.pendingReview,
      expectedPending: 2,
    },
  });

  const rejectionNote = "Not appropriate for this relationship yet.";
  const rejectedCard = proposalCard(page, rejectedId);
  await rejectedCard.getByRole("button", { name: "Reject" }).click();
  await rejectedCard.getByRole("textbox", { name: "Rejection note" }).fill(rejectionNote);
  await rejectedCard.getByRole("button", { name: "Confirm rejection" }).click();
  await rejectedCard.getByText("Rejected", { exact: true }).waitFor();
  const afterReject = await proposalPayload(api, runId);
  const rejected = proposalById(afterReject, rejectedId);
  const rejectedPending = await waitForPending(page, 1);
  await capture("workflow-run-proposal-rejected");
  record("reject-persists", {
    ui: {
      ...await decidedCardUi(page, rejectedCard),
      pending: rejectedPending,
      note: rejectionNote,
    },
    data: {
      variantStatus: rejected.variantStatus,
      approvalState: rejected.approval.state,
      approvalBy: rejected.approval.by,
      evidenceKind: rejected.approval.evidenceKind,
      note: rejected.approval.note,
      pending: afterReject.summary.pendingReview,
      expectedPending: 1,
    },
  });

  const revisionNote = "Make this more specific to the recent product launch.";
  const revisionCard = proposalCard(page, revisionId);
  await revisionCard.getByRole("button", { name: "Request revision" }).click();
  await revisionCard.getByRole("textbox", { name: "Revision note" }).fill(revisionNote);
  const revisionResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/variants/${revisionId}/request-revision`));
  await revisionCard.getByRole("button", { name: "Send revision request" }).click();
  const revisionBody = await (await revisionResponse).json();
  await revisionCard.getByText("Revision requested", { exact: true }).waitFor();
  const afterRevision = await proposalPayload(api, runId);
  const revision = proposalById(afterRevision, revisionId);
  const revisionPending = await waitForPending(page, 1);
  await capture("workflow-run-proposal-revision");
  record("revise-requests", {
    ui: {
      ...await decidedCardUi(page, revisionCard),
      note: revisionNote,
      noteText: (await revisionCard.getByText(`Revision note: ${revisionNote}`, { exact: true }).innerText()).trim(),
      pending: revisionPending,
    },
    data: {
      note: revision.revisionRequest.note,
      evidenceKind: revision.revisionRequest.evidenceKind,
      approvalState: revision.approval.state,
      threadPath: revisionBody.thread?.threadPath,
      pending: afterRevision.summary.pendingReview,
      expectedPending: 1,
    },
  });

  await page.goto(`${ctx.origin}/dashboard/launches/${fixture.launchId}`, { waitUntil: "networkidle" });
  const launchCards = page.locator("[data-variant-id]");
  const launchVariantIds = await launchCards.evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute("data-variant-id"))
    .filter(Boolean));
  await capture("launch-proposal-roundtrip");
  record("launch-roundtrip", {
    ui: { count: await launchCards.count(), ids: launchVariantIds },
    data: { fixtureIds: fixture.variantIds, apiIds: proposals.proposals.map((proposal) => proposal.variantId) },
  });

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
  const storedApproved = proposalById(afterIdempotent, approvedId);
  const storedContent = await api(`/api/content/${storedApproved.materializedContentItemId}`);
  record("thread-approval-idempotent", {
    data: {
      created: idempotent.body?.result?.created,
      evidenceKind: storedApproved.approval.evidenceKind,
      originalContentItemId: approved.materializedContentItemId,
      contentItemId: storedApproved.materializedContentItemId,
      contentExists: storedContent.ok,
    },
  });
}
