import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertExternalEffectAllowed,
  denyExternalEffect,
  DEV_INSTANCE_GUARD,
  EXTERNAL_EFFECTS,
  ExternalEffectDeniedError,
  externalEffectDeniedResponse,
} from "@/lib/instance/guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertExternalEffectAllowed", () => {
  it("names exactly the ADR-541-5 effects", () => {
    expect([...EXTERNAL_EFFECTS]).toEqual([
      "publish.dispatch",
      "publish.x-api",
      "engage.x-api",
      "publish.browser",
      "browser-session.publish",
      "oauth.connect",
      "email.smtp-probe",
    ]);
  });

  it.each(EXTERNAL_EFFECTS)("throws DEV_INSTANCE_GUARD for %s on a dev instance", (effect) => {
    let thrown: unknown;
    try {
      assertExternalEffectAllowed(effect, { SIGNALS_INSTANCE: "dev" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ExternalEffectDeniedError);
    expect(thrown).toMatchObject({ code: DEV_INSTANCE_GUARD, effect, name: "ExternalEffectDeniedError" });
    expect((thrown as Error).message).toContain(`"${effect}"`);
  });

  it("allows every effect on a canonical instance", () => {
    vi.stubEnv("SIGNALS_INSTANCE", "");
    for (const effect of EXTERNAL_EFFECTS) {
      expect(() => assertExternalEffectAllowed(effect, {})).not.toThrow();
    }
  });

  it("reads process.env when no env is given", () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    expect(() => assertExternalEffectAllowed("publish.x-api")).toThrow(ExternalEffectDeniedError);
    vi.stubEnv("SIGNALS_INSTANCE", "");
    expect(() => assertExternalEffectAllowed("publish.x-api")).not.toThrow();
  });

  it("never lets an injected env lift the process's dev identity", () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    expect(() =>
      assertExternalEffectAllowed("publish.dispatch", { SIGNALS_INSTANCE: "canonical" }),
    ).toThrow(ExternalEffectDeniedError);
  });
});

describe("externalEffectDeniedResponse", () => {
  it("is HTTP 403 with the ADR-541-5 body", async () => {
    const response = externalEffectDeniedResponse(new ExternalEffectDeniedError("oauth.connect"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect: "oauth.connect",
      error: expect.stringContaining("SIGNALS_INSTANCE=dev"),
    });
  });
});

describe("denyExternalEffect", () => {
  it("returns the 403 response on a dev instance", async () => {
    const response = denyExternalEffect("email.smtp-probe", { SIGNALS_INSTANCE: "dev" });
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
      effect: "email.smtp-probe",
    });
  });

  it("returns null on a canonical instance", () => {
    vi.stubEnv("SIGNALS_INSTANCE", "");
    expect(denyExternalEffect("email.smtp-probe", {})).toBeNull();
  });
});
