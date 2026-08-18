import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHimalayaConfigAccounts } from "@/lib/mail/himalaya";

describe("parseHimalayaConfigAccounts", () => {
  it("parses account aliases and emails from config.toml", () => {
    const dir = mkdtempSync(join(tmpdir(), "himalaya-test-"));
    const configPath = join(dir, "config.toml");
    writeFileSync(
      configPath,
      `
[accounts.work]
email = "work@company.com"
default = true

[accounts.personal]
email = "me@gmail.com"
`
    );

    const accounts = parseHimalayaConfigAccounts(configPath);
    expect(accounts).toEqual([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);
  });

  it("returns empty list when config is missing", () => {
    expect(parseHimalayaConfigAccounts("/tmp/does-not-exist-himalaya.toml")).toEqual([]);
  });
});
