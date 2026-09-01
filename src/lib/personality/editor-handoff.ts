import { z } from "zod";
import type { PersonalityWorkspace } from "@/lib/personality/workspace";
import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";

export const PERSONALITY_EDITOR_CAPABILITY_KEY =
  "desktop.workspace-personality-editor" as const;
export const PERSONALITY_EDITOR_ENDPOINT =
  "/sdk/desktop/workspace-personality-editor" as const;
export const PERSONALITY_EDITOR_PERMISSIONS = [
  "desktop.runtime-sessions",
  "workspace.personality.write",
] as const;

const limitsSchema = z
  .object({
    maxTaskPromptChars: z.number().int().positive(),
    maxAttachmentCount: z.number().int().nonnegative(),
    maxAttachmentBytes: z.number().int().positive(),
    maxTotalAttachmentBytes: z.number().int().positive(),
  })
  .strict();

const capabilitySchema = z
  .object({
    version: z.number().int().positive(),
    endpoint: z.string(),
    permissions: z.array(z.string()),
    granted: z.boolean(),
    limits: limitsSchema,
  })
  .strict();

const capabilitiesResponseSchema = z
  .object({
    success: z.literal(true),
    capabilities: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const handoffResponseSchema = z
  .object({
    success: z.literal(true),
    accepted: z.literal(true),
    requestId: z.string(),
    replayed: z.boolean(),
    workspace: z
      .object({
        id: z.union([z.string(), z.number()]),
        slug: z.string(),
      })
      .strict(),
    sessionId: z.string().nullable(),
    limits: limitsSchema,
  })
  .passthrough();

export type PersonalityEditorLimits = z.infer<typeof limitsSchema>;

export type PersonalityEditorCapabilityState = {
  state: "available" | "not_granted" | "unsupported" | "unreachable";
  version: number | null;
  limits: PersonalityEditorLimits | null;
  reason?: string;
};

export type PersonalityEditorHandoffResult = z.infer<
  typeof handoffResponseSchema
>;

export class PersonalityEditorHandoffError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PersonalityEditorHandoffError";
  }
}

function unavailable(
  state: "unsupported" | "unreachable",
  reason: string,
  version: number | null = null,
): PersonalityEditorCapabilityState {
  return { state, version, limits: null, reason };
}

function validateCapability(raw: unknown): PersonalityEditorCapabilityState {
  const parsed = capabilitySchema.safeParse(raw);
  if (!parsed.success) return unavailable("unsupported", "invalid_contract");

  const capability = parsed.data;
  const compatible =
    capability.version >= 1 &&
    capability.endpoint === PERSONALITY_EDITOR_ENDPOINT &&
    PERSONALITY_EDITOR_PERMISSIONS.every((permission) =>
      capability.permissions.includes(permission),
    );
  if (!compatible) {
    return unavailable(
      "unsupported",
      "incompatible_contract",
      capability.version,
    );
  }

  return {
    state: capability.granted ? "available" : "not_granted",
    version: capability.version,
    limits: capability.limits,
    ...(!capability.granted ? { reason: "permission_not_granted" } : {}),
  };
}

export async function probePersonalityEditorCapability(
  options: { env?: EnvLike; fetchImpl?: typeof fetch } = {},
): Promise<PersonalityEditorCapabilityState> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    return unavailable("unreachable", "host_not_configured");
  }

  try {
    const response = await fetchImpl(`${apiBase}/sdk/capabilities`, {
      method: "GET",
      headers: { "x-app-id": appId },
    });
    if (!response.ok) {
      return unavailable("unreachable", `host_http_${response.status}`);
    }
    const body = capabilitiesResponseSchema.safeParse(await response.json());
    return body.success
      ? validateCapability(
          body.data.capabilities[PERSONALITY_EDITOR_CAPABILITY_KEY],
        )
      : unavailable("unreachable", "invalid_response");
  } catch {
    return unavailable("unreachable", "request_failed");
  }
}

function responseRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export async function openWorkspacePersonalityEditor(
  input: {
    requestId: string;
    workspace: PersonalityWorkspace;
    taskPrompt: string;
    attachmentPaths: string[];
  },
  options: { env?: EnvLike; fetchImpl?: typeof fetch } = {},
): Promise<PersonalityEditorHandoffResult> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    throw new PersonalityEditorHandoffError(
      "RealTimeX Personality editor is not configured.",
      "HOST_UNAVAILABLE",
      null,
    );
  }
  if (!input.workspace.id) {
    throw new PersonalityEditorHandoffError(
      "The bound RealTimeX workspace is missing its ID.",
      "WORKSPACE_UNAVAILABLE",
      null,
    );
  }

  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(`${apiBase}${PERSONALITY_EDITOR_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-id": appId,
      },
      body: JSON.stringify({
        requestId: input.requestId,
        workspaceId: input.workspace.id,
        workspaceSlug: input.workspace.slug,
        taskPrompt: input.taskPrompt,
        attachmentPaths: input.attachmentPaths,
      }),
    });
    body = await response.json().catch(() => null);
  } catch (error) {
    throw new PersonalityEditorHandoffError(
      error instanceof Error
        ? error.message
        : "RealTimeX Personality editor request failed.",
      "NETWORK_ERROR",
      null,
    );
  }

  if (!response.ok) {
    const record = responseRecord(body);
    const { error: _error, code: _code, ...details } = record;
    throw new PersonalityEditorHandoffError(
      typeof record.error === "string"
        ? record.error
        : `RealTimeX Personality editor failed (${response.status}).`,
      typeof record.code === "string" ? record.code : "HOST_ERROR",
      response.status,
      details,
    );
  }

  const parsed = handoffResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PersonalityEditorHandoffError(
      "RealTimeX returned an invalid Personality editor response.",
      "INVALID_RESPONSE",
      response.status,
    );
  }
  if (
    parsed.data.requestId !== input.requestId ||
    String(parsed.data.workspace.id) !== String(input.workspace.id) ||
    parsed.data.workspace.slug !== input.workspace.slug
  ) {
    throw new PersonalityEditorHandoffError(
      "RealTimeX acknowledged a different Personality editor request.",
      "WORKSPACE_MISMATCH",
      409,
    );
  }
  return parsed.data;
}
