import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

export type HimalayaDiscoveredAccount = {
  alias: string;
  email: string;
};

export type HimalayaCheckResult = {
  ok: boolean;
  message?: string;
};

type ExecHimalayaResult = {
  stdout: string;
  stderr: string;
};

function execHimalaya(
  args: string[],
  configPath: string,
  timeoutMs = 30_000
): Promise<ExecHimalayaResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "himalaya",
      ["-c", configPath, ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
        });
      }
    );
  });
}

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
    // Skip sub-tables like [accounts.work.backend] — only direct account sections.
    if (alias.includes(".")) continue;

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
function resolveAccountEmail(
  record: Record<string, unknown>,
  alias: string,
  emailByAlias: Map<string, string>
): string {
  const fromRecord =
    typeof record.email === "string" && record.email.trim() ? record.email.trim() : null;
  return fromRecord ?? emailByAlias.get(alias) ?? alias;
}

export async function listHimalayaAccounts(
  configPath = getHimalayaConfigPath()
): Promise<HimalayaDiscoveredAccount[]> {
  const configAccounts = parseHimalayaConfigAccounts(configPath);
  const emailByAlias = new Map(configAccounts.map((account) => [account.alias, account.email]));

  try {
    const { stdout } = await execHimalaya(["account", "list", "--output", "json"], configPath, 15_000);
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (Array.isArray(parsed)) {
      const accounts = parsed
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const record = row as Record<string, unknown>;
          const alias = String(record.name ?? record.alias ?? record.account ?? "").trim();
          if (!alias || alias.includes(".")) return null;
          return {
            alias,
            email: resolveAccountEmail(record, alias, emailByAlias),
          };
        })
        .filter((row): row is HimalayaDiscoveredAccount => row !== null);

      if (accounts.length > 0) return accounts;
    }
  } catch {
    // Fall through to config.toml parse when CLI is missing or JSON unsupported.
  }

  return configAccounts;
}

/** Validate a Himalaya account via `himalaya account doctor` (v1.2+). */
export async function checkHimalayaAccount(
  alias: string,
  configPath = getHimalayaConfigPath()
): Promise<HimalayaCheckResult> {
  try {
    const { stdout, stderr } = await execHimalaya(["account", "doctor", alias], configPath);
    const output = `${stdout}\n${stderr}`.trim();
    return { ok: true, message: output || undefined };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
    };
    const output = [execError.stdout, execError.stderr, execError.message]
      .filter((line): line is string => Boolean(line))
      .join("\n")
      .trim();

    if (/unrecognized subcommand/i.test(output)) {
      return {
        ok: false,
        message:
          "Installed Himalaya CLI does not support `account doctor`. Upgrade to Himalaya v1.2+ or configure mail in terminal.",
      };
    }

    return {
      ok: false,
      message: output || "Himalaya account doctor failed — is himalaya installed and configured?",
    };
  }
}
