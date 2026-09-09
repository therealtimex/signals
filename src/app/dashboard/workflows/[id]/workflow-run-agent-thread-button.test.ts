// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowRunAgentThreadButton } from "./workflow-run-agent-thread-button";

const available = {
  state: "available" as const,
  threadPath: "/workspace/signals/t/network-snowball",
};

describe("WorkflowRunAgentThreadButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders a disabled connecting pill while server resolution is pending", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowRunAgentThreadButton, {
        runId: "run-1",
        runStatus: "running",
        agentThread: { state: "connecting", threadPath: null },
      }),
    );

    expect(html).toContain("Connecting…");
    expect(html).toContain("disabled");
  });

  it("uses distinct running and completed labels and hides missing threads", () => {
    const running = renderToStaticMarkup(
      createElement(WorkflowRunAgentThreadButton, {
        runId: "run-1",
        runStatus: "running",
        agentThread: available,
      }),
    );
    const completed = renderToStaticMarkup(
      createElement(WorkflowRunAgentThreadButton, {
        runId: "run-1",
        runStatus: "completed",
        agentThread: available,
      }),
    );
    const missing = renderToStaticMarkup(
      createElement(WorkflowRunAgentThreadButton, {
        runId: "run-1",
        runStatus: "completed",
        agentThread: { state: "none", threadPath: null },
      }),
    );
    const compact = renderToStaticMarkup(
      createElement(WorkflowRunAgentThreadButton, {
        runId: "run-1",
        runStatus: "completed",
        agentThread: available,
        compact: true,
      }),
    );

    expect(running).toContain("Agent thread");
    expect(running).toContain('title="/workspace/signals/t/network-snowball"');
    expect(completed).toContain("View agent thread");
    expect(compact).toContain("Open thread");
    expect(compact).not.toContain("View agent thread");
    expect(missing).toBe("");
  });

  it("asks the run-scoped server endpoint to open the exact thread", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, threadPath: available.threadPath }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(WorkflowRunAgentThreadButton, {
          runId: "run-1",
          runStatus: "running",
          agentThread: available,
        }),
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/workflows/runs/run-1/open-thread", {
      method: "POST",
    });
  });

  it("surfaces a host navigation failure without losing the control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: "RealTimeX is unavailable" }), {
          status: 200,
        }),
      ),
    );

    await act(async () => {
      root.render(
        createElement(WorkflowRunAgentThreadButton, {
          runId: "run-1",
          runStatus: "completed",
          agentThread: available,
        }),
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "RealTimeX is unavailable",
    );
    expect(container.textContent).toContain("View agent thread");
  });
});
