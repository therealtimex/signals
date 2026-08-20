// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackBanner } from "@/components/feedback-banner";

describe("FeedbackBanner", () => {
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
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("uses status semantics for advisory tones and alert semantics for danger", () => {
    const info = renderToStaticMarkup(createElement(FeedbackBanner, { tone: "info" }, "Synced"));
    const danger = renderToStaticMarkup(createElement(FeedbackBanner, { tone: "danger" }, "Failed"));

    expect(info).toContain('role="status"');
    expect(info).toContain("border-info/25");
    expect(danger).toContain('role="alert"');
    expect(danger).toContain("border-danger/25");
  });

  it("calls onDismiss from the labelled dismiss control", async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(createElement(FeedbackBanner, { onDismiss }, "Notice"));
    });

    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!;
    await act(async () => dismiss.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
