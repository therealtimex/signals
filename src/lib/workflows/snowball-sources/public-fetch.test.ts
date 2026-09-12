import { describe, expect, it } from "vitest";
import {
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

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts globally routable address %s",
    (address) => expect(isPublicSourceAddress(address)).toBe(true),
  );

  it.each([
    "https://localhost/secrets",
    "https://service.internal/secrets",
    "https://127.0.0.1/secrets",
    "https://169.254.169.254/latest/meta-data",
  ])("blocks unsafe hosts before an HTTP request: %s", async (url) => {
    await expect(fetchPublicSnowballSource(url)).rejects.toThrow(/not_public/);
  });
});
