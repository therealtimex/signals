import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { createOrg } from "@/lib/db/queries/orgs";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  runTemplateViaRtx: vi.fn(async () => ({
    success: true,
    workflowRunId: "run-enrich-1",
    threadPath: "Signals/Company Profile Enrichment",
  })),
}));

const mockedRunTemplate = vi.mocked(runTemplateViaRtx);

describe("POST /api/orgs/[id]/enrich", () => {
  beforeEach(() => {
    resetCoreTables();
    mockedRunTemplate.mockClear();
  });

  it("returns 404 for an unknown company", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/orgs/missing/enrich", {
      method: "POST",
    });
    const response = await POST(req, { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });

  it("dispatches the seeded enrichment template with the company id", async () => {
    const org = createOrg({ name: "Enrichment Co" });
    const req = new NextRequest(`http://127.0.0.1:3000/api/orgs/${org.id}/enrich`, {
      method: "POST",
    });
    const response = await POST(req, { params: Promise.resolve({ id: org.id }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ workflowRunId: "run-enrich-1" });
    expect(mockedRunTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ config: { orgId: org.id } }),
    );
  });

  it("rejects a duplicate dispatch while enrichment is running", async () => {
    const org = createOrg({ name: "Already Enriching" });
    seedTemplates();
    const template = getSystemTemplateByName(COMPANY_PROFILE_ENRICHMENT_TEMPLATE_NAME)!;
    createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      config: JSON.stringify({ orgId: org.id }),
      trigger: "template",
    });

    const req = new NextRequest(`http://127.0.0.1:3000/api/orgs/${org.id}/enrich`, {
      method: "POST",
    });
    const response = await POST(req, { params: Promise.resolve({ id: org.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ENRICHMENT_IN_PROGRESS" });
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });
});
