import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHimalayaConfigAccounts, listHimalayaAccounts } from "@/lib/mail/himalaya";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

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

  it("ignores sub-table sections like accounts.work.backend", () => {
    const dir = mkdtempSync(join(tmpdir(), "himalaya-subtable-"));
    const configPath = join(dir, "config.toml");
    writeFileSync(
      configPath,
      `
[accounts.work]
email = "work@company.com"

[accounts.work.backend]
type = "imap"

[accounts.work.message.send]
`
    );

    expect(parseHimalayaConfigAccounts(configPath)).toEqual([
      { alias: "work", email: "work@company.com" },
    ]);
  });
});

describe("listHimalayaAccounts CLI parsing", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("does not treat default boolean as email", async () => {
    execFileMock.mockImplementation(((
      _cmd: string,
      _args: readonly string[] | null | undefined,
      _opts: unknown,
      cb?: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const callback = (typeof _opts === "function" ? _opts : cb)!;
      callback(
        null,
        JSON.stringify([
          { name: "work", default: true },
          { name: "personal", default: false },
        ]),
        ""
      );
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const dir = mkdtempSync(join(tmpdir(), "himalaya-cli-"));
    const configPath = join(dir, "config.toml");
    writeFileSync(
      configPath,
      `
[accounts.work]
email = "work@company.com"

[accounts.personal]
email = "me@gmail.com"
`
    );

    await expect(listHimalayaAccounts(configPath)).resolves.toEqual([
      { alias: "work", email: "work@company.com" },
      { alias: "personal", email: "me@gmail.com" },
    ]);
  });
});
