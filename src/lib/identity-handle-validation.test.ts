import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORMS } from "@/lib/db/platforms";
import {
  checkIdentityValue,
  IDENTITY_PLATFORM_HOSTS,
  PLACEHOLDER_HANDLES,
  type IdentityValueField,
} from "./identity-handle-validation";

// signals-pp-cli enforces the same checks before it sends a row (#569). Its cases are the
// contract: they run in Go (TestCheckIdentityValueSharedCases) and here.
const GO_DIR = path.resolve(process.cwd(), "tools/signals-pp-cli/transcendence");

type SharedCase = {
  platform: string;
  field: IdentityValueField;
  value: string;
  allowUnusualHandle?: boolean;
  rule: string;
};

function sharedCases(): SharedCase[] {
  const source = readFileSync(path.join(GO_DIR, "handle_cases_test.go"), "utf8");
  const block = /\/\/ BEGIN SHARED HANDLE CASES\nconst sharedHandleCases = `([\s\S]*?)`\n/.exec(source);
  if (!block) throw new Error("shared handle cases not found in handle_cases_test.go");
  return JSON.parse(block[1]) as SharedCase[];
}

function goStringList(source: string, name: string): string[] {
  const block = new RegExp(`var ${name} = \\[\\]string\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!block) throw new Error(`${name} not found`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("identity handle validation (#569)", () => {
  const cases = sharedCases();

  it("parses the shared cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  it.each(cases.map((c) => [`${c.platform} ${c.field} ${JSON.stringify(c.value)}${c.allowUnusualHandle ? " (allowUnusualHandle)" : ""} → ${c.rule || "ok"}`, c] as const))(
    "%s",
    (_label, c) => {
      const violation = checkIdentityValue(c.platform, c.field, c.value, {
        allowUnusualHandle: c.allowUnusualHandle,
      });
      expect(violation?.rule ?? "").toBe(c.rule);
      if (violation) {
        expect(violation.heuristic).toBe(c.rule === "too_short" || c.rule === "placeholder");
      }
    },
  );

  it("the Go copy has the same placeholder list and platform hosts", () => {
    const source = readFileSync(path.join(GO_DIR, "import_handles.go"), "utf8");
    expect(goStringList(source, "placeholderHandles")).toEqual([...PLACEHOLDER_HANDLES]);
    for (const platform of PLATFORMS) {
      const line = new RegExp(`"${platform}":\\s*\\{([^}]*)\\}`).exec(source);
      expect(line, platform).not.toBeNull();
      const hosts = [...line![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      expect(hosts, platform).toEqual([...IDENTITY_PLATFORM_HOSTS[platform]]);
    }
  });

  it("names the platform, field, value and rule, and offers the opt-out only for heuristics", () => {
    const shortX = checkIdentityValue("x", "platformUserId", "in")!;
    expect(shortX.message).toBe(
      'X platformUserId "in" was rejected (rule: too_short): 2 characters or fewer is almost always a placeholder or a fragment of a pasted URL. If this really is the account, retry with allowUnusualHandle: true.',
    );
    const foreign = checkIdentityValue("x", "platformHandle", "linkedin.com/in/trung-le-rta")!;
    expect(foreign.message).toContain("is a LinkedIn URL, not an account on X; put it on a LinkedIn identity");
    expect(foreign.message).not.toContain("allowUnusualHandle");
    const sameSiteUrl = checkIdentityValue("x", "platformUserId", "https://x.com/trung_rta")!;
    expect(sameSiteUrl.message).toContain('pass the bare handle "trung_rta", not the profile URL');
  });
});
