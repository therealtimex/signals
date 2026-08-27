import { describe, expect, it } from "vitest";
import { resolvePersonaModeCardSelection } from "@/app/dashboard/settings/persona-generation-mode-selection";
import type { PersonaModeResolution } from "@/lib/settings/persona-generation-mode";

function resolution(partial: Partial<PersonaModeResolution>): PersonaModeResolution {
  return {
    storedMode: null,
    requestedMode: "structured_workflow",
    effectiveMode: "structured_workflow",
    source: "default",
    embedded: false,
    options: [
      { value: "terminal_agent", available: false, unavailableReason: "standalone" },
      { value: "structured_workflow", available: true },
    ],
    ...partial,
  };
}

describe("resolvePersonaModeCardSelection", () => {
  it("uses requestedMode when env override is active", () => {
    expect(
      resolvePersonaModeCardSelection(
        resolution({
          storedMode: "terminal_agent",
          requestedMode: "structured_workflow",
          source: "env",
        }),
      ),
    ).toBe("structured_workflow");
  });

  it("prefers storedMode for stored-but-unavailable fallback", () => {
    expect(
      resolvePersonaModeCardSelection(
        resolution({
          storedMode: "terminal_agent",
          requestedMode: "terminal_agent",
          effectiveMode: "structured_workflow",
          source: "config",
        }),
      ),
    ).toBe("terminal_agent");
  });
});
