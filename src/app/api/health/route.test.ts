import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { resetRtxBootstrapState } from "@/lib/rtx/bootstrap";

describe("GET /api/health instance block (ADR-541-5)", () => {
  beforeEach(() => {
    // Standalone: the probe must not reach a RealTimeX host from a unit test.
    vi.stubEnv("RTX_APP_ID", "");
    resetRtxBootstrapState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRtxBootstrapState();
  });

  it("reports a Dev app: dev, effects denied, scheduler off, its resolved data dir", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    vi.stubEnv("SIGNALS_SCHEDULER_ENABLED", "0");
    vi.stubEnv("SIGNALS_DATA_DIR", "/private/tmp/signals-dev-health/slot-a/");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", app: "signals", rtx: { mode: "standalone" } });
    expect(body.instance).toEqual({
      kind: "dev",
      externalEffects: "denied",
      scheduler: "disabled",
      dataDir: "/private/tmp/signals-dev-health/slot-a",
    });
  });

  it("reports the canonical instance with the scheduler on by default", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "");
    vi.stubEnv("SIGNALS_DATA_DIR", "relative-data");
    vi.stubEnv("SIGNALS_SCHEDULER_ENABLED", undefined);

    const body = await (await GET()).json();

    expect(body.instance).toEqual({
      kind: "canonical",
      externalEffects: "allowed",
      scheduler: "enabled",
      dataDir: resolve("relative-data"),
    });
  });

  it("reports a dev instance as never scheduling, even when its scheduler pin says otherwise", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    vi.stubEnv("SIGNALS_SCHEDULER_ENABLED", "true");

    const body = await (await GET()).json();

    expect(body.instance).toMatchObject({ kind: "dev", externalEffects: "denied", scheduler: "disabled" });
  });
});
