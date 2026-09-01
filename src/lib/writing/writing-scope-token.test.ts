import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/writing/hash";
import {
  WRITING_SCOPE_TOKEN_CONFIG_KEY,
  mintWritingScopeToken,
  parseWritingScopeToken,
  writingScopeTokenMatches,
} from "@/lib/writing/writing-scope-token";

describe("writing scope token", () => {
  it("stores only a hash, under a key the brief never prints", () => {
    const { token, tokenHash } = mintWritingScopeToken("run_1");
    expect(tokenHash).toBe(sha256(token));
    expect(tokenHash).not.toContain(token.split(".")[1]);
    // `stripInternalConfigKeys` drops `_`-prefixed keys from the agent's runtime config block.
    expect(WRITING_SCOPE_TOKEN_CONFIG_KEY.startsWith("_")).toBe(true);
  });

  it("is unguessable and unique per mint", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintWritingScopeToken("run_1").token),
    );
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token.split(".")[1].length).toBeGreaterThanOrEqual(32);
  });

  it("carries its own run id so verification is a direct lookup", () => {
    const { token } = mintWritingScopeToken("run_abc");
    expect(parseWritingScopeToken(token)).toEqual({ workflowRunId: "run_abc", token });
    // Run ids may contain dots; the secret is the last segment.
    const dotted = mintWritingScopeToken("run.with.dots");
    expect(parseWritingScopeToken(dotted.token)?.workflowRunId).toBe("run.with.dots");
  });

  it("rejects malformed tokens instead of half-parsing them", () => {
    for (const value of [undefined, null, 42, "", "no-separator", ".leading", "trailing."]) {
      expect(parseWritingScopeToken(value)).toBeNull();
    }
  });

  it("matches only the exact token, and never an absent or wrong hash", () => {
    const mine = mintWritingScopeToken("run_1");
    const theirs = mintWritingScopeToken("run_2");

    expect(writingScopeTokenMatches(mine.token, mine.tokenHash)).toBe(true);
    expect(writingScopeTokenMatches(theirs.token, mine.tokenHash)).toBe(false);
    expect(writingScopeTokenMatches(`${mine.token}x`, mine.tokenHash)).toBe(false);
    for (const stored of [undefined, null, "", 0, {}]) {
      expect(writingScopeTokenMatches(mine.token, stored)).toBe(false);
    }
  });
});
