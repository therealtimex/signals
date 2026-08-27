import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/settings/persona-generation/route";
import {
  PERSONA_GENERATION_MODE_ENV,
  resetPersonaGenerationModeForTests,
} from "@/lib/settings/persona-generation-mode";

describe("/api/settings/persona-generation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SIGNALS_DATA_DIR = mkdtempSync(join(tmpdir(), "signals-persona-route-"));
    delete process.env[PERSONA_GENERATION_MODE_ENV];
    delete process.env.RTX_APP_ID;
    resetPersonaGenerationModeForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("GET returns the current resolution", async () => {
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.effectiveMode).toBe("structured_workflow");
    expect(data.options).toHaveLength(2);
  });

  it("PUT persists structured workflow", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/persona-generation", {
        method: "PUT",
        body: JSON.stringify({ mode: "structured_workflow" }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.storedMode).toBe("structured_workflow");
  });

  it("PUT rejects unavailable terminal agent mode", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/persona-generation", {
        method: "PUT",
        body: JSON.stringify({ mode: "terminal_agent" }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("PERSONA_MODE_UNAVAILABLE");
    expect(data.unavailableReason).toBe("standalone");
  });

  it("exposes terminal agent mode when the embedded backend is registered", async () => {
    process.env.RTX_APP_ID = "signals-app";

    const res = await PUT(
      new NextRequest("http://localhost/api/settings/persona-generation", {
        method: "PUT",
        body: JSON.stringify({ mode: "terminal_agent" }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({
      storedMode: "terminal_agent",
      effectiveMode: "terminal_agent",
    });
  });

  it("PUT rejects updates when env override is set", async () => {
    process.env[PERSONA_GENERATION_MODE_ENV] = "structured_workflow";

    const res = await PUT(
      new NextRequest("http://localhost/api/settings/persona-generation", {
        method: "PUT",
        body: JSON.stringify({ mode: "structured_workflow" }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("PERSONA_MODE_ENV_LOCKED");
  });
});
