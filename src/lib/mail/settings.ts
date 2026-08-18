import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface SignalsConfig {
  defaultMailAccountAlias?: string;
  anthropicApiKey?: string;
  authMethod?: "api_key";
  [key: string]: unknown;
}

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const configPath = join(dataDir, "config.json");

function readConfig(): SignalsConfig {
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf-8")) as SignalsConfig;
}

function writeConfig(config: SignalsConfig) {
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function getDefaultMailAccountAlias(): string | null {
  const config = readConfig();
  return config.defaultMailAccountAlias ?? null;
}

export function setDefaultMailAccountAlias(alias: string | null) {
  const config = readConfig();
  if (alias) {
    config.defaultMailAccountAlias = alias;
  } else {
    delete config.defaultMailAccountAlias;
  }
  writeConfig(config);
}
