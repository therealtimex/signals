import { z } from "zod";
import {
  SOCIAL_PERSONALITY_FILES,
  type HostCapabilityRef,
} from "@/lib/personality/contracts";
import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";

export const PERSONALITY_CAPABILITY_KEY = "workspace.personality.transactions" as const;
export const PERSONALITY_PERMISSION = "workspace.personality.write" as const;
export const PERSONALITY_SCHEMA_VERSION = 1 as const;
export const PERSONALITY_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const PERSONALITY_CAPABILITY_CACHE_MS = 30_000;

const EXPECTED_PATHS = [...SOCIAL_PERSONALITY_FILES, "AGENTS.md"] as const;
const capabilitySchema = z.object({
  version: z.number().int().positive(),
  schemaVersions: z.array(z.number().int().positive()),
  permission: z.string(),
  granted: z.boolean(),
  fileHash: z.string(),
  maxFiles: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
  allowlist: z.object({
    pattern: z.string().min(1),
    excluded: z.array(z.string()),
  }).strict(),
}).strict();

const capabilitiesResponseSchema = z.object({
  success: z.literal(true),
  apiVersion: z.number().int().positive(),
  capabilities: z.record(z.string(), z.unknown()),
}).passthrough();

export type PersonalityCapabilityState = {
  state: "available" | "not_granted" | "unsupported" | "unreachable";
  version: number | null;
  ref: HostCapabilityRef | null;
  maxFiles: number | null;
  maxFileBytes: number | null;
  maxTotalBytes: number;
  reason?: string;
};

type CacheEntry = { expiresAt: number; value: PersonalityCapabilityState };
const cache = new Map<string, CacheEntry>();

function unavailable(
  state: "unsupported" | "unreachable",
  reason: string,
  version: number | null = null,
): PersonalityCapabilityState {
  return {
    state,
    version,
    ref: null,
    maxFiles: null,
    maxFileBytes: null,
    maxTotalBytes: PERSONALITY_MAX_TOTAL_BYTES,
    reason,
  };
}

function validateContract(raw: unknown): PersonalityCapabilityState {
  const parsed = capabilitySchema.safeParse(raw);
  if (!parsed.success) return unavailable("unsupported", "invalid_contract");
  const capability = parsed.data;
  let allowlist: RegExp;
  try {
    allowlist = new RegExp(capability.allowlist.pattern);
  } catch {
    return unavailable("unsupported", "invalid_allowlist", capability.version);
  }
  const excluded = new Set(capability.allowlist.excluded.map((path) => path.toLowerCase()));
  const compatible = capability.version >= 1
    && capability.schemaVersions.includes(PERSONALITY_SCHEMA_VERSION)
    && capability.permission === PERSONALITY_PERMISSION
    && capability.fileHash === "sha256-hex"
    && capability.maxFiles >= EXPECTED_PATHS.length
    && capability.maxFileBytes > 0
    && EXPECTED_PATHS.every((path) => allowlist.test(path) && !excluded.has(path.toLowerCase()));
  if (!compatible) return unavailable("unsupported", "incompatible_contract", capability.version);
  const ref: HostCapabilityRef = {
    key: PERSONALITY_CAPABILITY_KEY,
    version: capability.version,
    schemaVersion: PERSONALITY_SCHEMA_VERSION,
    fileHash: "sha256-hex",
  };
  return {
    state: capability.granted ? "available" : "not_granted",
    version: capability.version,
    ref,
    maxFiles: capability.maxFiles,
    maxFileBytes: capability.maxFileBytes,
    maxTotalBytes: PERSONALITY_MAX_TOTAL_BYTES,
    ...(!capability.granted ? { reason: "permission_not_granted" } : {}),
  };
}

export async function probeHostCapabilities(
  options: {
    env?: EnvLike;
    fetchImpl?: typeof fetch;
    uncached?: boolean;
    now?: () => number;
  } = {},
): Promise<PersonalityCapabilityState> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) return unavailable("unreachable", "host_not_configured");
  const cacheKey = `${apiBase}\n${appId}`;
  const cached = cache.get(cacheKey);
  if (!options.uncached && cached && cached.expiresAt > now()) return cached.value;

  let value: PersonalityCapabilityState;
  try {
    const response = await fetchImpl(`${apiBase}/sdk/capabilities`, {
      method: "GET",
      headers: { "x-app-id": appId },
    });
    if (!response.ok) {
      value = unavailable("unreachable", `host_http_${response.status}`);
    } else {
      const body = capabilitiesResponseSchema.safeParse(await response.json());
      value = body.success
        ? validateContract(body.data.capabilities[PERSONALITY_CAPABILITY_KEY])
        : unavailable("unreachable", "invalid_response");
    }
  } catch {
    value = unavailable("unreachable", "request_failed");
  }
  if (!options.uncached) {
    cache.set(cacheKey, { expiresAt: now() + PERSONALITY_CAPABILITY_CACHE_MS, value });
  }
  return value;
}

export function clearHostCapabilityCache(): void {
  cache.clear();
}
