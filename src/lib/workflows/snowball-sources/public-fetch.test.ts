import { describe, expect, it } from "vitest";
import {
  assertPublicSnowballSourceDestination,
  createPinnedSourceLookup,
  createPublicSnowballSourceTransport,
  fetchPublicSnowballSource,
  isPublicSourceAddress,
} from "@/lib/workflows/snowball-sources/public-fetch";

describe("public source network boundary", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "100.64.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.1",
    "192.0.0.1",
    "198.18.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("rejects private, reserved, link-local, and metadata address %s", (address) => {
    expect(isPublicSourceAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "192.0.66.220",
    "192.0.78.12",
    "2606:4700:4700::1111",
  ])(
    "accepts globally routable address %s",
    (address) => expect(isPublicSourceAddress(address)).toBe(true),
  );

  it("answers the Node pinned lookup contract for scalar and all-address requests", async () => {
    const lookup = createPinnedSourceLookup({ address: "192.0.66.220", family: 4 });
    const invoke = (all: boolean) => new Promise<{ address: unknown; family: number | undefined }>(
      (resolve, reject) => lookup("techcrunch.com", { all }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      }),
    );

    await expect(invoke(true)).resolves.toEqual({
      address: [{ address: "192.0.66.220", family: 4 }],
      family: undefined,
    });
    await expect(invoke(false)).resolves.toEqual({ address: "192.0.66.220", family: 4 });
  });

  it("rejects a hostname when DNS returns any non-public destination", async () => {
    await expect(assertPublicSnowballSourceDestination("https://private.example/path", {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    })).rejects.toThrow("source_address_not_public");
  });

  it.each([
    "https://localhost/secrets",
    "https://service.internal/secrets",
    "https://127.0.0.1/secrets",
    "https://169.254.169.254/latest/meta-data",
  ])("blocks unsafe hosts before an HTTP request: %s", async (url) => {
    await expect(fetchPublicSnowballSource(url)).rejects.toThrow(/not_public/);
  });

  it("applies the absolute deadline while DNS is still unresolved", async () => {
    const transport = createPublicSnowballSourceTransport({
      lookup: async () => new Promise(() => undefined),
    });
    await expect(transport("https://example.com", { timeoutMs: 5 }))
      .rejects.toThrow("source_request_timeout");
  });

  it("aborts a response that never completes even if it could keep trickling", async () => {
    let requestSignal: AbortSignal | undefined;
    const transport = createPublicSnowballSourceTransport({
      requestPinned: async (_url, limits) => {
        requestSignal = limits.signal;
        return new Promise(() => undefined);
      },
    });
    await expect(transport("https://example.com", { timeoutMs: 5 }))
      .rejects.toThrow("source_request_timeout");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("propagates caller cancellation through the active pinned request", async () => {
    let requestSignal: AbortSignal | undefined;
    const transport = createPublicSnowballSourceTransport({
      requestPinned: async (_url, limits) => {
        requestSignal = limits.signal;
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = transport("https://example.com", {
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    await Promise.resolve();
    controller.abort(new Error("preview_cancelled"));
    await expect(pending).rejects.toThrow("preview_cancelled");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("charges each redirect before issuing its request", async () => {
    const requests: string[] = [];
    let charged = 0;
    const transport = createPublicSnowballSourceTransport({
      requestPinned: async (url) => {
        requests.push(url);
        return {
          url,
          status: 302,
          contentType: "text/html",
          body: "",
          bytes: 0,
          location: `/redirect-${requests.length}`,
        };
      },
    });
    await expect(transport("https://example.com/start", {
      beforeRequest: () => {
        charged += 1;
        return charged <= 2;
      },
    })).rejects.toThrow("source_request_budget_exhausted");
    expect(charged).toBe(3);
    expect(requests).toHaveLength(2);
  });

  it("preserves the validated literal host and trailing slash across redirects", async () => {
    const requests: string[] = [];
    const transport = createPublicSnowballSourceTransport({
      requestPinned: async (url) => {
        requests.push(url);
        if (requests.length === 1) {
          return {
            url,
            status: 302,
            contentType: "text/html",
            body: "",
            bytes: 0,
            location: "https://www.example.com/path/?tk=redirect-secret",
          };
        }
        return {
          url,
          status: 200,
          contentType: "text/html",
          body: "ok",
          bytes: 2,
        };
      },
    });

    await expect(transport("https://example.com/start")).resolves.toMatchObject({
      url: "https://www.example.com/path/",
      body: "ok",
    });
    expect(requests).toEqual([
      "https://example.com/start",
      "https://www.example.com/path/",
    ]);
  });

  it("rejects an unsafe redirect before requesting its destination", async () => {
    const requests: string[] = [];
    const transport = createPublicSnowballSourceTransport({
      requestPinned: async (url) => {
        requests.push(url);
        return {
          url,
          status: 302,
          contentType: "text/html",
          body: "",
          bytes: 0,
          location: "http://127.0.0.1/private",
        };
      },
    });

    await expect(transport("https://example.com/start")).rejects.toThrow("unsafe_source_redirect");
    expect(requests).toEqual(["https://example.com/start"]);
  });
});
