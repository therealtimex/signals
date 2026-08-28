import { describe, expect, it } from "vitest";
import { normalizeOrgDomain } from "@/lib/orgs/domain";

describe("normalizeOrgDomain", () => {
  it.each([
    ["Acme.com", "acme.com"],
    ["https://www.Acme.com/about?x=1", "acme.com"],
    ["mail.acme.com", "mail.acme.com"],
    ["https://münich.example/path", "xn--mnich-kva.example"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeOrgDomain(input)).toEqual({ ok: true, domain: expected });
  });

  it.each([
    ["", "EMPTY"],
    ["acme", "NO_TLD"],
    ["10.0.0.1", "IP_ADDRESS"],
    ["[::1]", "IP_ADDRESS"],
    ["localhost", "LOCAL"],
    ["bad_domain.com", "INVALID_HOSTNAME"],
    ["https://acme.c", "INVALID_HOSTNAME"],
  ])("rejects %s as %s", (input, code) => {
    expect(normalizeOrgDomain(input)).toMatchObject({ ok: false, code });
  });
});
