// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RtxRuntimeCard } from "@/app/dashboard/settings/rtx-runtime-card";

describe("RtxRuntimeCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders granted and denied permission badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            bootstrap: {
              mode: "embedded",
              permissions: {
                granted: ["llm.chat"],
                denied: ["llm.embed"],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await act(async () => {
      root.render(createElement(RtxRuntimeCard));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Granted");
    expect(container.textContent).toContain("Denied");
    expect(container.textContent).toContain("Unknown");
  });
});
