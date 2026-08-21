import { describe, expect, it } from "vitest";
import {
  identityClaimKey,
  isRoleAccountEmail,
  nameSimilarity,
  normalizePersonName,
  orgNameKey,
  personNameKey,
} from "./normalize";

describe("normalizePersonName", () => {
  it("folds case, diacritics, and punctuation", () => {
    expect(normalizePersonName("Demis Hassabis")).toBe("demis hassabis");
    expect(normalizePersonName("José  Álvarez")).toBe("jose alvarez");
    expect(normalizePersonName("O'Neill, Sam")).toBe("o neill sam");
  });

  it("drops leading honorifics and trailing suffixes", () => {
    expect(normalizePersonName("Dr. Jim Fan")).toBe("jim fan");
    expect(normalizePersonName("Sam Altman Jr.")).toBe("sam altman");
    expect(normalizePersonName("Jane Doe PhD")).toBe("jane doe");
  });

  it("keeps a suffix-like single token that is the whole name", () => {
    expect(normalizePersonName("Md")).toBe("md");
  });

  it("returns empty for blank input", () => {
    expect(normalizePersonName(null)).toBe("");
    expect(normalizePersonName("   ")).toBe("");
  });
});

describe("personNameKey", () => {
  it("is order-insensitive", () => {
    expect(personNameKey("Linxi Fan")).toBe(personNameKey("Fan Linxi"));
  });

  it("separates genuinely different names", () => {
    expect(personNameKey("Jim Fan")).not.toBe(personNameKey("Jim Chen"));
  });
});

describe("orgNameKey", () => {
  it("collapses whitespace and case", () => {
    expect(orgNameKey("  Google   DeepMind ")).toBe("google deepmind");
    expect(orgNameKey("NVIDIA")).toBe(orgNameKey("nvidia"));
  });

  it("strips corporate suffixes and punctuation", () => {
    expect(orgNameKey("Safe Superintelligence Inc. (SSI)")).toBe("safe superintelligence ssi");
    expect(orgNameKey("Safe Superintelligence (SSI)")).toBe("safe superintelligence ssi");
    expect(orgNameKey("Safe Superintelligence Inc. (SSI)")).toBe(
      orgNameKey("Safe Superintelligence (SSI)"),
    );
    expect(orgNameKey("OpenAI, Inc.")).toBe(orgNameKey("OpenAI"));
    expect(orgNameKey("Microsoft Corporation")).toBe(orgNameKey("Microsoft Corp."));
    expect(orgNameKey("Google LLC")).toBe(orgNameKey("Google"));
    expect(orgNameKey("DeepMind Technologies Ltd.")).toBe(
      orgNameKey("DeepMind Technologies Limited"),
    );
  });

  it("preserves single-token corporate names", () => {
    expect(orgNameKey("LLC")).toBe("llc");
    expect(orgNameKey("Company")).toBe("company");
  });

  it("returns empty for missing names", () => {
    expect(orgNameKey(undefined)).toBe("");
  });
});

describe("identityClaimKey", () => {
  it("matches the unique index tuple, case-folded", () => {
    expect(identityClaimKey("x", "12345")).toBe("x:12345");
    expect(identityClaimKey("linkedin", " ABC ")).toBe("linkedin:abc");
  });
});

describe("nameSimilarity", () => {
  it("scores an exact normalized match as 1", () => {
    expect(nameSimilarity("Sam Altman", "sam  altman")).toBe(1);
  });

  it("does not punish an extra middle name", () => {
    // "Jim Fan" vs "Jim Linxi Fan" is the #209 example; overlap coefficient
    // keeps it at 1 where Jaccard would drop it to 0.67 and miss the Tier 2 floor.
    expect(nameSimilarity("Jim Fan", "Jim Linxi Fan")).toBe(1);
  });

  it("scores partial overlap below the Tier 2 floor", () => {
    expect(nameSimilarity("Sam Altman", "Sam Bankman Fried")).toBeCloseTo(0.5, 5);
  });

  it("scores disjoint names as 0", () => {
    expect(nameSimilarity("Sam Altman", "Demis Hassabis")).toBe(0);
    expect(nameSimilarity("", "Demis Hassabis")).toBe(0);
  });
});

describe("isRoleAccountEmail", () => {
  it("recognises shared mailboxes", () => {
    expect(isRoleAccountEmail("info@acme.com")).toBe(true);
    expect(isRoleAccountEmail("SALES@Acme.com")).toBe(true);
    expect(isRoleAccountEmail("no-reply@acme.com")).toBe(true);
  });

  it("sees through plus-addressing", () => {
    expect(isRoleAccountEmail("info+crm@acme.com")).toBe(true);
  });

  it("leaves personal addresses alone", () => {
    expect(isRoleAccountEmail("sam@openai.com")).toBe(false);
    expect(isRoleAccountEmail("demis.hassabis@deepmind.com")).toBe(false);
  });

  it("handles empty input", () => {
    expect(isRoleAccountEmail(null)).toBe(false);
    expect(isRoleAccountEmail("")).toBe(false);
  });
});
