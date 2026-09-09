import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/snowball-seed-scout/calendar-dispatch/route";

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rtx/snowball-calendar-dispatch", () => ({
  dispatchSnowballCalendarTask: dispatchMock,
}));

const validContext = {
  calendarEventUuid: "event-1",
  taskUuid: "70e9bcc5-348f-49ff-a12a-4d99d8bc7838",
  dispatchKind: "workflow.run",
  workflowTemplate: "Network Snowball",
  workflowRunConfig: {
    seedType: "event_url",
    seedValue: "https://www.linkedin.com/posts/acme-1",
  },
};

function request(body: object) {
  return new NextRequest("http://127.0.0.1:3010/api/snowball-seed-scout/calendar-dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/snowball-seed-scout/calendar-dispatch", () => {
  beforeEach(() => {
    dispatchMock.mockReset();
  });

  it("forwards validated Calendar context to the server-owned dispatcher", async () => {
    dispatchMock.mockResolvedValue({
      success: true,
      workflowRunId: "calendar-task-1",
      workflowStatus: "running",
      duplicate: false,
      calendarTaskAcknowledged: true,
      dispatcherTerminalSessionId: "cli-agent:dispatcher",
      dispatcherReleaseScheduled: true,
    });

    const response = await POST(request(validContext));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      workflowRunId: "calendar-task-1",
    });
    expect(dispatchMock).toHaveBeenCalledWith(
      validContext,
      "http://localhost:3010",
    );
  });

  it("rejects malformed or non-Snowball dispatch contexts", async () => {
    const response = await POST(request({
      ...validContext,
      workflowTemplate: "Contact Relationship Nurture",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "Invalid Snowball calendar dispatch context",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed server launch after acknowledgement and cleanup", async () => {
    dispatchMock.mockResolvedValue({
      success: false,
      workflowRunId: "calendar-task-1",
      workflowStatus: "failed",
      duplicate: false,
      calendarTaskAcknowledged: true,
      dispatcherTerminalSessionId: "cli-agent:dispatcher",
      dispatcherReleaseScheduled: true,
      error: "LinkedIn browser target unavailable",
    });

    const response = await POST(request(validContext));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "LinkedIn browser target unavailable",
    });
  });
});
