import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/workflows/schedule/route";
import { DEDUPE_MERGE_JOB_TYPE } from "@/lib/contacts/dedupe/scheduled-merge";
import { RTX_SCHEDULING_REQUIRED_CODE } from "@/lib/scheduler/schedule-policy";

const getTemplateMock = vi.hoisted(() => vi.fn());
const createScheduledJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/queries/workflow-templates", () => ({
  getTemplate: getTemplateMock,
}));

vi.mock("@/lib/db/queries/scheduled-jobs", () => ({
  listScheduledJobs: vi.fn(() => []),
  createScheduledJob: createScheduledJobMock,
}));

function request(body: object) {
  return new NextRequest("http://127.0.0.1:3000/api/workflows/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/workflows/schedule", () => {
  beforeEach(() => {
    getTemplateMock.mockReset();
    createScheduledJobMock.mockReset();
    createScheduledJobMock.mockImplementation((job) => ({ id: "job-1", ...job }));
  });

  it("refuses agent templates — the host app owns recurring runs", async () => {
    getTemplateMock.mockReturnValue({
      id: "tpl-agent",
      templateType: "engagement",
      config: JSON.stringify({ maxContacts: 10 }),
    });

    const res = await POST(request({ templateId: "tpl-agent", cronExpression: "0 9 * * *" }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe(RTX_SCHEDULING_REQUIRED_CODE);
    // The pre-retirement route recorded these, so they only surfaced as a failed,
    // self-disabled row on first fire.
    expect(createScheduledJobMock).not.toHaveBeenCalled();
  });

  it("still schedules dedupe as an in-process maintenance sweep", async () => {
    getTemplateMock.mockReturnValue({
      id: "tpl-dedupe",
      templateType: "pruning",
      config: JSON.stringify({ tiers: [1, 2], minConfidence: 0.8, limit: 25 }),
    });

    const res = await POST(request({ templateId: "tpl-dedupe", cronExpression: "0 9 * * *" }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.jobType).toBe(DEDUPE_MERGE_JOB_TYPE);
    expect(JSON.parse(data.payload)).toMatchObject({ templateId: "tpl-dedupe" });
  });

  it("404s an unknown template instead of scheduling it", async () => {
    getTemplateMock.mockReturnValue(undefined);

    const res = await POST(request({ templateId: "missing", cronExpression: "0 9 * * *" }));

    expect(res.status).toBe(404);
    expect(createScheduledJobMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid cron before touching the template", async () => {
    const res = await POST(request({ templateId: "tpl-dedupe", cronExpression: "not a cron" }));

    expect(res.status).toBe(400);
    expect(getTemplateMock).not.toHaveBeenCalled();
  });
});
