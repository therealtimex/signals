import { describe, expect, it } from "vitest";
import { parseSettingsTab, settingsTabHref } from "@/app/dashboard/settings/settings-tabs";

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
});
