import { describe, expect, it } from "vitest";
import {
  buildSnowballSeedScoutDeployConfig,
  buildSnowballSeedScoutTemplateConfig,
  formatHeartbeatInterval,
  isSnowballSeedScoutTemplateConfig,
  readSnowballSeedScoutConfig,
  SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME,
} from "@/lib/workflows/snowball-seed-scout";

describe("snowball-seed-scout config", () => {
  it("detects scout template marker", () => {
    expect(isSnowballSeedScoutTemplateConfig(buildSnowballSeedScoutTemplateConfig())).toBe(
      true,
    );
  });

  it("clamps salt range and platforms", () => {
    const config = readSnowballSeedScoutConfig({
      ...buildSnowballSeedScoutTemplateConfig(),
      platforms: ["x", "unknown", "linkedin"],
      saltMinMinutes: 30,
      saltMaxMinutes: 10,
    });

    expect(config.platforms).toEqual(["x", "linkedin"]);
    expect(config.saltMinMinutes).toBe(10);
    expect(config.saltMaxMinutes).toBe(30);
  });

  it("builds deploy config with heartbeat execution kind", () => {
    const deploy = buildSnowballSeedScoutDeployConfig(
      readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig()),
    );
    expect(deploy.snowballSeedScout).toEqual({
      version: 1,
      executionKind: "heartbeat_shell",
    });
    expect(deploy.maxLinksPerRun).toBe(5);
  });

  it("formats heartbeat interval hours", () => {
    expect(formatHeartbeatInterval(4)).toBe("4h");
    expect(SNOWBALL_SEED_SCOUT_HEARTBEAT_TASK_NAME).toBe("snowball-seed-scout");
  });
});
