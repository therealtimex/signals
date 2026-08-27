// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PersonaGenerationModeCard } from "@/app/dashboard/settings/persona-generation-mode-card";

describe("PersonaGenerationModeCard", () => {
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

  it("selects the env-forced mode when stored and env disagree", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            storedMode: "terminal_agent",
            requestedMode: "structured_workflow",
            effectiveMode: "structured_workflow",
            source: "env",
            embedded: true,
            options: [
              { value: "terminal_agent", available: false, unavailableReason: "backend_unavailable" },
              { value: "structured_workflow", available: true },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await act(async () => {
      root.render(createElement(PersonaGenerationModeCard));
      await Promise.resolve();
    });

    const structuredInput = container.querySelector(
      "#persona-mode-structured_workflow",
    ) as HTMLInputElement | null;
    const terminalInput = container.querySelector(
      "#persona-mode-terminal_agent",
    ) as HTMLInputElement | null;

    expect(structuredInput?.getAttribute("data-state")).toBe("checked");
    expect(terminalInput?.getAttribute("data-state")).not.toBe("checked");
  });
});
