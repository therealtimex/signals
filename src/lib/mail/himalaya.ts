import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type HimalayaDiscoveredAccount = {
  alias: string;
  email: string;
};

export type HimalayaCheckResult = {
  ok: boolean;
  message?: string;
};

/** Resolve Himalaya config path from env or default location. */
export function getHimalayaConfigPath(): string {
  const fromEnv =
    process.env.EMAIL_CONFIG_FILE ??
    process.env.HIMALAYA_CONFIG ??
    process.env.HIMALAYA_CONFIG_FILE;
  if (fromEnv) {
    return fromEnv.replace(/^~/, homedir());
  }
  return `${homedir()}/.config/himalaya/config.toml`;
}

/** Parse `[accounts.<alias>]` sections from Himalaya config.toml (no TOML dependency). */
export function parseHimalayaConfigAccounts(configPath: string): HimalayaDiscoveredAccount[] {
  if (!existsSync(configPath)) return [];

  const raw = readFileSync(configPath, "utf-8");
  const accounts: HimalayaDiscoveredAccount[] = [];
  const sectionRe = /^\[accounts\.([^\]]+)\]\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = sectionRe.exec(raw)) !== null) {
    const alias = match[1].trim();
    const start = match.index + match[0].length;
    const nextSection = raw.slice(start).search(/^\[/m);
    const block = nextSection === -1 ? raw.slice(start) : raw.slice(start, start + nextSection);

    const emailMatch =
      block.match(/^\s*email\s*=\s*"([^"]+)"/m) ??
      block.match(/^\s*email\s*=\s*'([^']+)'/m) ??
      block.match(/^\s*email\s*=\s*([^\s#]+)/m);

    const email = emailMatch?.[1]?.trim() ?? alias;
    accounts.push({ alias, email });
  }

  return accounts;
}

/** List accounts from Himalaya CLI JSON output, falling back to config parse. */
export async function listHimalayaAccounts(
  configPath = getHimalayaConfigPath()
): Promise<HimalayaDiscoveredAccount[]> {
  try {
    const { stdout } = await execFileAsync(
      "himalaya",
      ["-c", configPath, "account", "list", "--output", "json"],
      { timeout: 15_000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const record = row as Record<string, unknown>;
          const alias = String(record.name ?? record.alias ?? record.account ?? "").trim();
          const email = String(record.email ?? record.default ?? alias).trim();
          if (!alias) return null;
          return { alias, email };
        })
        .filter((row): row is HimalayaDiscoveredAccount => row !== null);
    }
  } catch {
    // Fall through to config.toml parse when CLI is missing or JSON unsupported.
  }

  return parseHimalayaConfigAccounts(configPath);
}

/** Validate a Himalaya account via `himalaya account check`. */
export async function checkHimalayaAccount(
  alias: string,
  configPath = getHimalayaConfigPath()
): Promise<HimalayaCheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "himalaya",
      ["-c", configPath, "account", "check", "-a", alias],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    const output = `${stdout}\n${stderr}`.trim();
    if (/error|failed|invalid/i.test(output)) {
      return { ok: false, message: output || "Account check failed" };
    }
    return { ok: true, message: output || undefined };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Himalaya account check failed — is himalaya installed and configured?";
    return { ok: false, message };
  }
}
