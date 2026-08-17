import { describe, expect, it } from "vitest";
import {
  fetchCdpJsonPageTargets,
  isInspectableCdpPageTarget,
} from "@/lib/browser/rtx-publish/cdp-json-list";

describe("cdp-json-list", () => {
  it("filters shell and devtools targets", () => {
    expect(
      isInspectableCdpPageTarget({
        id: "1",
        type: "page",
        url: "https://x.com/home",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1",
      })
    ).toBe(true);

    expect(
      isInspectableCdpPageTarget({
        id: "2",
        type: "page",
        url: "file:///cli-browser/index.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/2",
      })
    ).toBe(false);

    expect(
      isInspectableCdpPageTarget({
        id: "3",
        type: "page",
        url: "devtools://devtools/bundled/inspector.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/3",
      })
    ).toBe(false);
  });

  it("fetches and normalizes /json/list targets", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("http://127.0.0.1:9444/json/list");
      return new Response(
        JSON.stringify([
          {
            id: "a",
            type: "page",
            title: "Home / X",
            url: "https://x.com/home",
            webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/page/a",
          },
          {
            id: "b",
            type: "page",
            title: "RealTimeX Browser",
            url: "file:///Users/me/cli-browser/index.html",
            webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/page/b",
          },
        ]),
        { status: 200 }
      );
    };

    await expect(fetchCdpJsonPageTargets(9444, fetchImpl)).resolves.toEqual([
      {
        id: "a",
        title: "Home / X",
        url: "https://x.com/home",
        webSocketDebuggerUrl: "ws://127.0.0.1:9444/devtools/page/a",
      },
    ]);
  });
});
