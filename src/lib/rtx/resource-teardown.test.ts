import { describe, expect, it, vi } from "vitest";
import {
  formatAgentLaneTeardownNote,
  releaseAgentLaneResources,
  RESUMABLE_TERMINAL_RELEASE_REASON,
  scheduleTerminalSessionRelease,
  scheduleWorkflowTerminalSessionRelease,
  stopRunningRtxBrowserSessions,
  WORKFLOW_COMPLETED_TERMINAL_RELEASE_REASON,
} from "@/lib/rtx/resource-teardown";
import * as browserSessions from "@/lib/rtx/browser-sessions";
import * as runtimeSessions from "@/lib/rtx/runtime-sessions";

describe("stopRunningRtxBrowserSessions", () => {
  it("stops all running sessions when stopAllRunning is set", async () => {
    vi.spyOn(browserSessions, "listRtxBrowserSessions").mockResolvedValue([
      { sessionName: "network-snowball", running: true },
      { sessionName: "signals-publish", running: false },
      { sessionName: "signals-publish", runtime: { status: "running" } },
    ]);
    const stopSpy = vi
      .spyOn(browserSessions, "stopRtxBrowserSession")
      .mockResolvedValue({ success: true });

    await expect(
      stopRunningRtxBrowserSessions({ stopAllRunning: true }, { RTX_APP_ID: "app-1" })
    ).resolves.toEqual({
      stopped: ["network-snowball", "signals-publish"],
      failed: [],
    });

    expect(stopSpy).toHaveBeenCalledTimes(2);
  });

  it("stops only requested running sessions", async () => {
    vi.spyOn(browserSessions, "listRtxBrowserSessions").mockResolvedValue([
      { sessionName: "network-snowball", running: true },
      { sessionName: "signals-publish", running: true },
    ]);
    const stopSpy = vi
      .spyOn(browserSessions, "stopRtxBrowserSession")
      .mockResolvedValue({ success: true });

    await expect(
      stopRunningRtxBrowserSessions(
        { sessionNames: ["signals-publish"] },
        { RTX_APP_ID: "app-1" }
      )
    ).resolves.toEqual({
      stopped: ["signals-publish"],
      failed: [],
    });

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(stopSpy).toHaveBeenCalledWith("signals-publish", { RTX_APP_ID: "app-1" }, fetch);
  });
});

describe("releaseAgentLaneResources", () => {
  it("releases terminal and browser resources in parallel", async () => {
    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });
    const browserSpy = vi
      .spyOn(browserSessions, "listRtxBrowserSessions")
      .mockResolvedValue([{ sessionName: "network-snowball", running: true }]);
    vi.spyOn(browserSessions, "stopRtxBrowserSession").mockResolvedValue({ success: true });

    const result = await releaseAgentLaneResources({
      terminalSessionId: "cli-agent:session-1",
      stopAllRunningBrowserSessions: true,
    });

    expect(terminateSpy).toHaveBeenCalledWith("cli-agent:session-1", process.env, fetch);
    expect(browserSpy).toHaveBeenCalled();
    expect(result.terminal).toEqual({ success: true, terminated: true });
    expect(result.browser.stopped).toEqual(["network-snowball"]);
  });
});

describe("formatAgentLaneTeardownNote", () => {
  it("summarizes terminal and browser teardown", () => {
    expect(
      formatAgentLaneTeardownNote({
        terminal: { success: true, terminated: true },
        browser: { stopped: ["network-snowball"], failed: [] },
      })
    ).toContain("Terminal session released.");
    expect(
      formatAgentLaneTeardownNote({
        terminal: { success: true, terminated: true },
        browser: { stopped: ["network-snowball"], failed: [] },
      })
    ).toContain("Browser sessions stopped: network-snowball.");
  });
});

describe("scheduleTerminalSessionRelease", () => {
  it("waits for idle before terminating on the next tick", async () => {
    vi.useFakeTimers();
    const waitSpy = vi
      .spyOn(runtimeSessions, "waitForTerminalSessionIdle")
      .mockResolvedValue({ idle: true });
    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });

    const scheduled = scheduleTerminalSessionRelease("cli-agent:session-1");
    expect(scheduled).toEqual({ scheduled: true, sessionId: "cli-agent:session-1" });
    expect(terminateSpy).not.toHaveBeenCalled();

    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(waitSpy).toHaveBeenCalledWith("cli-agent:session-1", {
      env: process.env,
      fetchImpl: fetch,
      retryDelaysMs: expect.arrayContaining([250, 14_000]),
    });
    expect(terminateSpy).toHaveBeenCalledWith(
      "cli-agent:session-1",
      process.env,
      fetch,
      { reason: RESUMABLE_TERMINAL_RELEASE_REASON }
    );
    vi.useRealTimers();
  });

  it("skips terminate when the chat-linked turn is still busy", async () => {
    vi.useFakeTimers();
    vi.spyOn(runtimeSessions, "waitForTerminalSessionIdle").mockResolvedValue({
      idle: false,
      reason: "Chat-linked turn remained busy (capturing).",
    });
    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });

    scheduleTerminalSessionRelease("cli-agent:session-1");
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(terminateSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("uses extended idle wait and workflow_completed_resumable for workflow completion", async () => {
    vi.useFakeTimers();
    const waitSpy = vi
      .spyOn(runtimeSessions, "waitForTerminalSessionIdle")
      .mockResolvedValue({ idle: true });
    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });

    const scheduled = scheduleWorkflowTerminalSessionRelease("cli-agent:session-1");
    expect(scheduled).toEqual({ scheduled: true, sessionId: "cli-agent:session-1" });
    expect(scheduleWorkflowTerminalSessionRelease(null)).toEqual({
      scheduled: true,
      sessionId: null,
    });

    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(waitSpy).toHaveBeenCalledWith("cli-agent:session-1", {
      env: process.env,
      fetchImpl: fetch,
      retryDelaysMs: expect.arrayContaining([250, 14_000, 15_000, 90_000]),
    });
    expect(terminateSpy).toHaveBeenCalledWith(
      "cli-agent:session-1",
      process.env,
      fetch,
      { reason: WORKFLOW_COMPLETED_TERMINAL_RELEASE_REASON }
    );
    vi.useRealTimers();
  });
});
