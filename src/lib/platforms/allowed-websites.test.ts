import { beforeEach, describe, expect, it } from "vitest";
import { addConnectionOrigin } from "@/lib/db/queries/browser-connection-origins";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { ExternalEffectDeniedError } from "@/lib/instance/guard";
import {
  applyConnectionAllowedOrigins,
  buildAllowedOriginsView,
  readAllowedOriginsRuntime,
} from "@/lib/platforms/allowed-websites";
import { resetCoreTables } from "@/test/db";
import { fakeRtxBrowserSessions } from "@/test/fake-rtx-browser-sessions";

const RTX_ENV = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" };
const DEFAULTS = [
  "https://x.com",
  "https://www.linkedin.com",
  "https://lnkd.in",
  "https://www.facebook.com",
];

function fakeRtx(options: { createFails?: boolean; createIgnored?: boolean; listFails?: boolean } = {}) {
  return fakeRtxBrowserSessions({
    createFails: options.createFails ? "The RealTimeX Browser registry is busy." : undefined,
    createIgnored: options.createIgnored,
    listFails: options.listFails,
  });
}

describe("allowed websites: apply and verify", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("re-declares the full list without a url, then reads it back as applied", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "settings" });
    const rtx = fakeRtx();

    const result = await applyConnectionAllowedOrigins("signals-publish", RTX_ENV, rtx.fetchImpl);

    expect(result).toEqual({
      applied: true,
      effective: [...DEFAULTS, "https://example.org"],
      runtime: {
        reachable: true,
        allowedOrigins: [...DEFAULTS, "https://example.org"],
        applied: true,
      },
    });
    expect(rtx.calls.map((call) => call.path)).toEqual([
      "/cli/create-browser-session",
      "/cli/list-browser-sessions",
    ]);
    expect(rtx.calls[0].body).toEqual({
      sessionName: "signals-publish",
      guardrails: {
        mode: "unrestricted",
        allowedOrigins: [...DEFAULTS, "https://example.org"],
        blockedOrigins: [],
      },
    });
    // The fields Signals never sends survive the update (live capture: primaryOrigin x.com).
    const held = rtx.sessions.find((entry) => entry.sessionName === "signals-publish")!.guardrails!;
    expect(held.primaryOrigin).toBe("https://x.com");
    expect(held.allowNewTab).toBe(true);
    expect(held.allowCloseTab).toBe(true);
  });

  it("only touches the connection's own session", async () => {
    const dedicated = ensureBrowserConnection({ sessionName: "signals-network-snowball-luma", kind: "dedicated" });
    addConnectionOrigin({ connectionId: dedicated.id, origin: "https://www.eventbrite.com", source: "recovery" });
    const rtx = fakeRtx();

    await applyConnectionAllowedOrigins("signals-network-snowball-luma", RTX_ENV, rtx.fetchImpl);

    const publish = rtx.sessions.find((entry) => entry.sessionName === "signals-publish")!;
    expect(publish.guardrails!.allowedOrigins).toEqual([
      "https://x.com",
      "https://www.linkedin.com",
      "https://www.facebook.com",
    ]);
  });

  it("reports not applied with RealTimeX's error when the update is refused", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "settings" });
    const rtx = fakeRtx({ createFails: true });

    const result = await applyConnectionAllowedOrigins("signals-publish", RTX_ENV, rtx.fetchImpl);

    expect(result.applied).toBe(false);
    expect(result.error).toBe("The RealTimeX Browser registry is busy.");
    expect(result.runtime).toEqual({
      reachable: true,
      allowedOrigins: ["https://x.com", "https://www.linkedin.com", "https://www.facebook.com"],
      applied: false,
    });
  });

  it("reports not applied when RealTimeX accepts the call but holds a different list", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "settings" });

    const result = await applyConnectionAllowedOrigins(
      "signals-publish",
      RTX_ENV,
      fakeRtx({ createIgnored: true }).fetchImpl,
    );

    expect(result.applied).toBe(false);
    expect(result.runtime?.applied).toBe(false);
    expect(result.error).toMatch(/didn't report the updated list/);
  });

  it("reports RealTimeX unreachable when the read-back fails", async () => {
    const result = await applyConnectionAllowedOrigins(
      "signals-publish",
      RTX_ENV,
      fakeRtx({ listFails: true }).fetchImpl,
    );

    expect(result.applied).toBe(false);
    expect(result.runtime).toEqual({
      reachable: false,
      allowedOrigins: null,
      applied: null,
      error: "fetch failed",
    });
  });

  it("does nothing and reports no runtime when Signals runs without RealTimeX", async () => {
    const rtx = fakeRtx();

    const result = await applyConnectionAllowedOrigins("signals-publish", {}, rtx.fetchImpl);

    expect(result).toEqual({ applied: false, effective: DEFAULTS, runtime: null });
    expect(rtx.calls).toEqual([]);
  });

  it("refuses to change signals-publish on a Dev instance", async () => {
    const rtx = fakeRtx();

    await expect(
      applyConnectionAllowedOrigins(
        "signals-publish",
        { ...RTX_ENV, SIGNALS_INSTANCE: "dev" },
        rtx.fetchImpl,
      ),
    ).rejects.toBeInstanceOf(ExternalEffectDeniedError);
    expect(rtx.calls).toEqual([]);
  });
});

describe("allowed websites: runtime view", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("treats a removal RealTimeX still holds as not applied", async () => {
    const rtx = fakeRtx();
    const publish = rtx.sessions.find((entry) => entry.sessionName === "signals-publish")!;
    publish.guardrails = { ...publish.guardrails, allowedOrigins: [...DEFAULTS, "https://removed.example"] };

    await expect(
      readAllowedOriginsRuntime("signals-publish", DEFAULTS, RTX_ENV, rtx.fetchImpl),
    ).resolves.toEqual({
      reachable: true,
      allowedOrigins: [...DEFAULTS, "https://removed.example"],
      applied: false,
    });
  });

  it("reports no list for a session RealTimeX doesn't have yet", async () => {
    await expect(
      readAllowedOriginsRuntime("brand-new", DEFAULTS, RTX_ENV, fakeRtx().fetchImpl),
    ).resolves.toEqual({ reachable: true, allowedOrigins: null, applied: null });
  });

  it("builds the Settings view from defaults, the user's rows and RealTimeX", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    addConnectionOrigin({ connectionId: connection.id, origin: "https://example.org", source: "recovery" });

    const view = await buildAllowedOriginsView(connection, RTX_ENV, fakeRtx().fetchImpl);

    expect(view).toMatchObject({
      connectionId: connection.id,
      sessionName: "signals-publish",
      defaults: DEFAULTS,
      custom: [{ origin: "https://example.org", source: "recovery", addedAt: expect.any(Number) }],
      effective: [...DEFAULTS, "https://example.org"],
      runtime: {
        reachable: true,
        allowedOrigins: ["https://x.com", "https://www.linkedin.com", "https://www.facebook.com"],
        applied: false,
      },
    });
  });
});
