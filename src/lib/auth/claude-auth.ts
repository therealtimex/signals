import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { encrypt, decrypt } from "./crypto";

interface SignalsConfig {
  anthropicApiKey?: string; // encrypted
  xClientId?: string;
  xClientSecret?: string; // encrypted
  linkedinClientId?: string;
  linkedinClientSecret?: string; // encrypted
  authMethod?: "api_key";
}

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const configPath = join(dataDir, "config.json");

function readConfig(): SignalsConfig {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
}

function writeConfig(config: SignalsConfig) {
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Save an Anthropic API key (encrypted at rest).
 */
export function saveApiKey(apiKey: string) {
  const config = readConfig();
  config.anthropicApiKey = encrypt(apiKey);
  config.authMethod = "api_key";
  writeConfig(config);
}

/**
 * Get the decrypted Anthropic API key, or null if not set.
 */
export function getApiKey(): string | null {
  // Check environment variable first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  const config = readConfig();
  if (!config.anthropicApiKey) return null;

  try {
    return decrypt(config.anthropicApiKey);
  } catch {
    return null;
  }
}

/**
 * Validate that an API key works by making a lightweight request.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    // 200 = valid key, 401 = invalid, anything else = network issue
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Get the current auth method.
 * Returns "env_var" when ANTHROPIC_API_KEY is set in process.env,
 * "api_key" when a key is stored in config, or "none".
 */
export function getAuthMethod(): "api_key" | "env_var" | "none" {
  if (process.env.ANTHROPIC_API_KEY) return "env_var";
  const config = readConfig();
  if (config.anthropicApiKey) return "api_key";
  return "none";
}

/**
 * Get auth source details including a masked key prefix.
 */
export function getAuthSource(): { method: "api_key" | "env_var" | "none"; keyPrefix: string | null } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      method: "env_var",
      keyPrefix: maskKey(process.env.ANTHROPIC_API_KEY),
    };
  }

  const config = readConfig();
  if (config.anthropicApiKey) {
    try {
      const key = decrypt(config.anthropicApiKey);
      return { method: "api_key", keyPrefix: maskKey(key) };
    } catch {
      return { method: "none", keyPrefix: null };
    }
  }

  return { method: "none", keyPrefix: null };
}

/**
 * Mask an API key, showing first 10 chars + "...****"
 */
function maskKey(key: string): string {
  if (key.length <= 10) return key.slice(0, 4) + "...****";
  return key.slice(0, 10) + "...****";
}

/**
 * Remove stored API key.
 */
export function clearApiKey() {
  const config = readConfig();
  delete config.anthropicApiKey;
  config.authMethod = undefined;
  writeConfig(config);
}
