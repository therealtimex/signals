import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getRtxAppId,
  getPreferredPort,
  isRtxEmbedded,
  resolveRtxApiBase,
  stripTrailingSlash,
} from "@/lib/rtx/env";

describe("rtx env", () => {
  it("detects embedded mode from RTX_APP_ID", () => {
    expect(isRtxEmbedded({ RTX_APP_ID: "app-123" })).toBe(true);
    expect(isRtxEmbedded({})).toBe(false);
  });

  it("resolves API base from SERVER_URL", () => {
    expect(
      resolveRtxApiBase({ SERVER_URL: "http://127.0.0.1:3001/" })
    ).toBe("http://127.0.0.1:3001");
  });

  it("falls back to localhost server port when embedded without explicit base", () => {
    expect(
      resolveRtxApiBase({ RTX_APP_ID: "app-1", SERVER_PORT: "4242" })
    ).toBe("http://127.0.0.1:4242");
  });

  it("returns null in standalone mode without server env", () => {
    expect(resolveRtxApiBase({})).toBeNull();
  });

  it("prefers RTX_PORT over PORT", () => {
    expect(getPreferredPort(3000, { RTX_PORT: "3456", PORT: "3000" })).toBe(3456);
  });

  it("strips trailing slashes", () => {
    expect(stripTrailingSlash("http://localhost:3001///")).toBe("http://localhost:3001");
  });

  it("reads app id", () => {
    expect(getRtxAppId({ RTX_APP_ID: "  uuid  " })).toBe("uuid");
  });
});
