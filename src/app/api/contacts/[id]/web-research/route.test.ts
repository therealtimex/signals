import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { createContact } from "@/lib/db/queries/contacts";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import {
  CONTACT_WEB_RESEARCH_TEMPLATE_NAME,
  seedTemplates,
} from "@/lib/db/seed-templates";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resetCoreTables } from "@/test/db";

vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  runTemplateViaRtx: vi.fn(async () => ({
    success: true,
    workflowRunId: "run-contact-web-1",
    threadPath: "Signals/Contact Web Research",
  })),
}));

const mockedRunTemplate = vi.mocked(runTemplateViaRtx);

describe("/api/contacts/[id]/web-research", () => {
  beforeEach(() => {
    resetCoreTables();
    mockedRunTemplate.mockClear();
  });

  it("returns 404 for an unknown contact", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/contacts/missing/web-research");
    expect((await GET(req, { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    expect(
      (await POST(new NextRequest(req.url, { method: "POST" }), {
        params: Promise.resolve({ id: "missing" }),
      })).status,
    ).toBe(404);
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });

  it("returns idle state before the first run", async () => {
    const contact = createContact({ name: "Idle Contact" });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
    );
    const response = await GET(req, { params: Promise.resolve({ id: contact.id }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "idle", workflowRunId: null });
  });

  it("dispatches the seeded template with the contact id", async () => {
    const contact = createContact({ name: "Sparse Contact" });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
      { method: "POST" },
    );
    const response = await POST(req, { params: Promise.resolve({ id: contact.id }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ workflowRunId: "run-contact-web-1" });
    expect(mockedRunTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ config: { contactId: contact.id } }),
    );
  });

  it("rejects duplicate dispatch while web research is running", async () => {
    const contact = createContact({ name: "Already Researching" });
    seedTemplates();
    const template = getSystemTemplateByName(CONTACT_WEB_RESEARCH_TEMPLATE_NAME)!;
    createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      config: JSON.stringify({ contactId: contact.id }),
      trigger: "template",
    });
    const req = new NextRequest(
      `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
      { method: "POST" },
    );
    const response = await POST(req, { params: Promise.resolve({ id: contact.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "ENRICHMENT_IN_PROGRESS" });
    expect(mockedRunTemplate).not.toHaveBeenCalled();
  });

  it("maps an unavailable authenticated target to an actionable 409", async () => {
    const contact = createContact({ name: "Needs Browser Login" });
    mockedRunTemplate.mockResolvedValueOnce({
      success: false,
      error: "LinkedIn is signed out. Open Settings → Platform connections.",
      errorCode: "research_target_unavailable",
      httpStatus: 409,
      workflowRunId: "run-target-failed",
      details: {
        reason: "LOGIN_REQUIRED",
        targetId: "target-linkedin",
        settingsPath: "/dashboard/settings?tab=platforms",
        settingsTab: "Platform connections",
      },
    });

    const response = await POST(
      new NextRequest(
        `http://127.0.0.1:3000/api/contacts/${contact.id}/web-research`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: contact.id }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESEARCH_TARGET_UNAVAILABLE",
      details: {
        reason: "LOGIN_REQUIRED",
        settingsPath: "/dashboard/settings?tab=platforms",
        workflowRunId: "run-target-failed",
      },
    });
  });
});
