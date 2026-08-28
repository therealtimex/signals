import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SignalsConfig = {
  defaultMailAccountAlias?: string;
  anthropicApiKey?: string;
  authMethod?: "api_key";
  personaGenerationMode?: "structured_workflow" | "terminal_agent";
  emailSmtpProbeEnabled?: boolean;
  allowPredictedEmailInAutomation?: boolean;
  [key: string]: unknown;
};

function resolveConfigPath(): string {
  const dataDir =
    process.env.SIGNALS_DATA_DIR?.replace(/^~/, homedir()) ?? join(homedir(), ".signals");
  return join(dataDir, "config.json");
}

export function readSignalsConfig(): SignalsConfig {
  const configPath = resolveConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as SignalsConfig;
}

export function updateSignalsConfig(patch: Partial<SignalsConfig>): SignalsConfig {
  const configPath = resolveConfigPath();
  const next = { ...readSignalsConfig(), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
