import { describe, expect, it, vi } from "vitest";
import { navigateSettingsTab, parseSettingsTab, settingsTabHref } from "@/app/dashboard/settings/settings-tabs";

describe("settings-tabs", () => {
  it("parses valid tabs and falls back to platforms", () => {
    expect(parseSettingsTab("platforms")).toBe("platforms");
    expect(parseSettingsTab("agents")).toBe("agents");
    expect(parseSettingsTab("invalid")).toBe("platforms");
    expect(parseSettingsTab(null)).toBe("platforms");
  });

  it("builds tab hrefs", () => {
    expect(settingsTabHref("platforms")).toBe("/dashboard/settings?tab=platforms");
    expect(settingsTabHref("agents")).toBe("/dashboard/settings?tab=agents");
  });

  it("navigates with router.replace and scroll disabled", () => {
    const replace = vi.fn();
    navigateSettingsTab(replace, "agents");
    expect(replace).toHaveBeenCalledWith("/dashboard/settings?tab=agents", { scroll: false });
  });
});
