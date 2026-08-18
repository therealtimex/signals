import { describe, expect, it } from "vitest";
import {
  resolveSignalsBaseUrlFromEnv,
  resolveSignalsBaseUrlFromRequest,
} from "@/lib/rtx/resolve-signals-base-url";

describe("resolveSignalsBaseUrlFromRequest", () => {
  it("uses the request origin when available", () => {
    const request = new Request("http://localhost:3000/api/workflows/templates/tpl/run", {
      method: "POST",
    });

    expect(resolveSignalsBaseUrlFromRequest(request)).toBe("http://localhost:3000");
  });

  it("prefers x-forwarded-host and x-forwarded-proto", () => {
    const request = new Request("http://internal/api/workflows/templates/tpl/run", {
      method: "POST",
      headers: {
        "x-forwarded-host": "localhost:3010",
        "x-forwarded-proto": "http",
      },
    });

    expect(resolveSignalsBaseUrlFromRequest(request)).toBe("http://localhost:3010");
  });

  it("strips trailing slashes from forwarded origins", () => {
    const request = new Request("http://internal/run", {
      headers: {
        "x-forwarded-host": "localhost:3000/",
        "x-forwarded-proto": "http",
      },
    });

    expect(resolveSignalsBaseUrlFromRequest(request)).toBe("http://localhost:3000");
  });
});

describe("resolveSignalsBaseUrlFromEnv", () => {
  it("prefers RTX_PORT over PORT", () => {
    expect(
      resolveSignalsBaseUrlFromEnv({ RTX_PORT: "3456", PORT: "3000" })
    ).toBe("http://127.0.0.1:3456");
  });

  it("defaults to port 3000 when env is unset", () => {
    expect(resolveSignalsBaseUrlFromEnv({})).toBe("http://127.0.0.1:3000");
  });
});
