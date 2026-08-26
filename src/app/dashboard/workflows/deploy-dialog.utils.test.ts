import { describe, expect, it } from "vitest";
import {
  formatDeployedAt,
  isSnowballSeedScoutTemplate,
  parseDeployTemplateConfig,
} from "@/app/dashboard/workflows/deploy-dialog.utils";
import { buildSnowballSeedScoutTemplateConfig } from "@/lib/workflows/snowball-seed-scout";

describe("formatDeployedAt", () => {
  it("renders a fixed UTC string regardless of ambient timezone", () => {
    // toLocaleString() would differ between server and client render and trip a
    // hydration mismatch; this must be stable.
    const formatted = formatDeployedAt("2026-08-25T22:00:00.000Z");
    expect(formatted).toBe("2026-08-25 22:00 UTC");
  });

  it("returns empty for an unparseable timestamp", () => {
    expect(formatDeployedAt("not-a-date")).toBe("");
  });
});

describe("parseDeployTemplateConfig", () => {
  it("treats malformed config as empty rather than throwing", () => {
    expect(parseDeployTemplateConfig("{oops")).toEqual({});
    expect(parseDeployTemplateConfig("")).toEqual({});
  });
});

describe("isSnowballSeedScoutTemplate", () => {
  it("detects the scout template from its stored config", () => {
    const template = {
      id: "t1",
      name: "Snowball Seed Scout",
      description: null,
      config: JSON.stringify(buildSnowballSeedScoutTemplateConfig()),
    };
    expect(isSnowballSeedScoutTemplate(template)).toBe(true);
  });

  it("rejects an unrelated template", () => {
    const template = {
      id: "t2",
      name: "Other",
      description: null,
      config: JSON.stringify({ foo: true }),
    };
    expect(isSnowballSeedScoutTemplate(template)).toBe(false);
  });
});
