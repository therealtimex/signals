import { describe, expect, it, vi } from "vitest";
import { createBrowserSessionClient } from "@/lib/browser/rtx-publish/create-browser-session-client";

vi.mock("@/lib/browser/rtx-publish/browser-session-client", () => ({
  createBrowserSessionApiClient: vi.fn(() => ({ kind: "http" })),
}));

describe("createBrowserSessionClient", () => {
  it("uses embedded Local App HTTP client with x-app-id", () => {
    const client = createBrowserSessionClient({
      RTX_APP_ID: "signals",
      SERVER_URL: "http://127.0.0.1:3001",
    });
    expect(client).toEqual({ kind: "http" });
  });
});
