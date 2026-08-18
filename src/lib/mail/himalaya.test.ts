import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHimalayaConfigAccounts, listHimalayaAccounts, checkHimalayaAccount, buildEnvelopeListArgs } from "@/lib/mail/himalaya";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

function runExecFileCallback(
  args: unknown[],
  error: Error | null,
  stdout = "",
  stderr = ""
) {
  const callback = args.find((arg): arg is (error: Error | null, stdout: string, stderr: string) => void =>
    typeof arg === "function"
  );
  callback?.(error, stdout, stderr);
  return {} as ReturnType<typeof execFile>;
}

describe("buildEnvelopeListArgs", () => {
  it("uses -s for page size (not invalid -ps) and places -a on envelope list", () => {
    expect(buildEnvelopeListArgs("work", "INBOX", 2, 50)).toEqual([
      "envelope",
      "list",
      "-a",
      "work",
      "-f",
      "INBOX",
      "-p",
      "2",
      "-s",
      "50",
      "--output",
      "json",
    ]);
    expect(buildEnvelopeListArgs("work", "INBOX", 2, 50).join(" ")).not.toContain("-ps");
  });
});

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
    execFileMock.mockImplementation((...args) =>
      runExecFileCallback(
        args,
        null,
        JSON.stringify([
          { name: "work", default: true },
          { name: "personal", default: false },
        ])
      )
    );

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

describe("checkHimalayaAccount", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("uses account doctor with positional alias (Himalaya v1.2 contract)", async () => {
    execFileMock.mockImplementation((...args) => {
      const cliArgs = args[1] as string[];
      expect(cliArgs).toEqual(["-c", "/tmp/himalaya.toml", "account", "doctor", "work"]);
      return runExecFileCallback(args, null, "All checks passed for account work");
    });

    await expect(checkHimalayaAccount("work", "/tmp/himalaya.toml")).resolves.toEqual({
      ok: true,
      message: "All checks passed for account work",
    });
  });

  it("returns failure when doctor exits non-zero", async () => {
    execFileMock.mockImplementation((...args) => {
      const error = Object.assign(new Error("Command failed"), {
        stderr: "cannot find configuration for account work",
      });
      return runExecFileCallback(args, error, "", "cannot find configuration for account work");
    });

    await expect(checkHimalayaAccount("work", "/tmp/himalaya.toml")).resolves.toEqual({
      ok: false,
      message: expect.stringContaining("cannot find configuration for account work"),
    });
  });
});
