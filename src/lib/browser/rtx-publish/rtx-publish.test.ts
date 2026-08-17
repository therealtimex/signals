import { describe, expect, it } from "vitest";
import {
  parseBrowserSessions,
  parseSessionPort,
} from "@/lib/browser/rtx-publish/pp-cli";
import { resolveCdpPortOverride } from "@/lib/browser/rtx-publish/resolve-session";
import { isXContentUrl, isShellOrDevtoolsUrl } from "@/lib/browser/rtx-publish/connect";

describe("pp-cli parsers", () => {
  it("parseBrowserSessions maps session records", () => {
    const sessions = parseBrowserSessions({
      results: {
        sessions: [
          { sessionName: "signals-publish", remoteDebugPort: 9333, running: true },
          { sessionName: "broken", port: "nope" },
        ],
      },
    });
    expect(sessions).toEqual([
      {
        sessionName: "signals-publish",
        remoteDebugPort: 9333,
        running: true,
        status: undefined,
        tabs: [],
      },
    ]);
  });

  it("parseSessionPort reads nested shapes", () => {
    expect(parseSessionPort({ results: { remoteDebugPort: 9222 } })).toBe(9222);
    expect(parseSessionPort({ results: { session: { port: 9223 } } })).toBe(9223);
    expect(parseSessionPort({ results: {} })).toBeNull();
  });
});

describe("resolveCdpPortOverride", () => {
  it("parses SIGNALS_RTX_CDP_PORT", () => {
    expect(resolveCdpPortOverride({ SIGNALS_RTX_CDP_PORT: "9333" })).toBe(9333);
    expect(resolveCdpPortOverride({ SIGNALS_RTX_CDP_PORT: "0" })).toBeNull();
    expect(resolveCdpPortOverride({})).toBeNull();
  });
});

describe("connect URL filters", () => {
  it("accepts x.com https tabs", () => {
    expect(isXContentUrl("https://x.com/home")).toBe(true);
    expect(isXContentUrl("https://twitter.com/home")).toBe(true);
  });

  it("rejects shell and non-https targets", () => {
    expect(isXContentUrl("devtools://devtools/bundled/inspector.html")).toBe(false);
    expect(isXContentUrl("https://x.com/cli-browser/index.html")).toBe(false);
    expect(isShellOrDevtoolsUrl("file:///cli-browser/index.html")).toBe(true);
  });
});
