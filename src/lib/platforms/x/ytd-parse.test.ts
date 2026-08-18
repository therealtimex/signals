import { describe, expect, it } from "vitest";
import { archiveDateToIso, parseYtdArray } from "@/lib/platforms/x/ytd-parse";

describe("parseYtdArray", () => {
  it("strips the window.YTD wrapper and parses the array", () => {
    const rows = parseYtdArray(
      'window.YTD.follower.part0 = [ { "follower": { "accountId": "1" } } ]'
    );
    expect(rows).toEqual([{ follower: { accountId: "1" } }]);
  });

  it("handles multi-part indices, BOM, and leading whitespace", () => {
    const rows = parseYtdArray("\uFEFF\n  window.YTD.tweets.part12 = [1, 2]");
    expect(rows).toEqual([1, 2]);
  });

  it("rejects files without the YTD prefix", () => {
    expect(() => parseYtdArray('[{"follower":{}}]')).toThrow(/window\.YTD/);
  });

  it("rejects invalid JSON after the prefix", () => {
    expect(() => parseYtdArray("window.YTD.tweets.part0 = [ oops")).toThrow(
      /Invalid JSON/
    );
  });

  it("rejects non-array payloads", () => {
    expect(() => parseYtdArray('window.YTD.account.part0 = {"a":1}')).toThrow(
      /JSON array/
    );
  });
});

describe("archiveDateToIso", () => {
  it("converts the legacy tweet date format", () => {
    expect(archiveDateToIso("Wed Oct 10 20:19:24 +0000 2018")).toBe(
      "2018-10-10T20:19:24.000Z"
    );
  });

  it("applies non-UTC offsets", () => {
    expect(archiveDateToIso("Mon Jan 06 08:00:00 +0700 2020")).toBe(
      "2020-01-06T01:00:00.000Z"
    );
  });

  it("passes through ISO dates (account.js)", () => {
    expect(archiveDateToIso("2019-03-01T10:30:00.000Z")).toBe(
      "2019-03-01T10:30:00.000Z"
    );
  });

  it("returns null for empty or unparseable values", () => {
    expect(archiveDateToIso(null)).toBeNull();
    expect(archiveDateToIso("")).toBeNull();
    expect(archiveDateToIso("Xxx Foo 99 99:99:99 +0000 20")).toBeNull();
  });
});
