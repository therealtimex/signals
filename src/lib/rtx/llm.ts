import { createHash } from "node:crypto";
import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import {
  MAX_EMBED_CHARS,
  MAX_EMBED_INPUTS,
  qualifyEmbeddingModel,
  truncateEmbedText,
} from "@/lib/embeddings/vector-utils";

export type RtxEmbedErrorCode =
  | "RTX_NOT_CONFIGURED"
  | "PERMISSION_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "EMBED_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export type RtxEmbedSuccess = {
  success: true;
  embeddings: Float32Array[];
  provider: string;
  model: string;
  qualifiedModel: string;
  dimensions: number;
};

export type RtxEmbedFailure = {
  success: false;
  code: RtxEmbedErrorCode;
  error: string;
};

export type RtxEmbedResult = RtxEmbedSuccess | RtxEmbedFailure;

type RtxEmbedApiResponse = {
  success?: boolean;
  embeddings?: number[][];
  provider?: string;
  model?: string;
  dimensions?: number;
  code?: string;
  error?: string;
  errors?: string[];
};

function buildHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

function mapErrorCode(code: string | undefined, httpStatus: number): RtxEmbedErrorCode {
  if (code === "PERMISSION_REQUIRED") return "PERMISSION_REQUIRED";
  if (code === "PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (code === "EMBED_ERROR") return "EMBED_ERROR";
  if (code === "VALIDATION_ERROR" || code === "INVALID_MODEL") return "VALIDATION_ERROR";
  if (httpStatus === 403) return "PERMISSION_REQUIRED";
  return "UNKNOWN";
}

function actionableMessage(code: RtxEmbedErrorCode): string {
  switch (code) {
    case "RTX_NOT_CONFIGURED":
      return "Embeddings require Signals running as a RealtimeX Local App (set RTX_APP_ID and SERVER_URL).";
    case "PERMISSION_REQUIRED":
      return "Embedding permission not granted. Approve llm.embed for Signals in RealtimeX Settings → Local Apps.";
    case "PROVIDER_UNAVAILABLE":
      return "RealtimeX embedding provider is unavailable. Check RealtimeX LLM configuration and retry.";
    case "EMBED_ERROR":
      return "RealtimeX embedding request failed. Check input length and retry.";
    case "VALIDATION_ERROR":
      return "RealtimeX rejected the embedding request. Check input limits and retry.";
    default:
      return "RealtimeX embedding request failed.";
  }
}

function parseEmbeddings(raw: number[][] | undefined): Float32Array[] | null {
  if (!raw?.length) return null;
  return raw.map((values) => Float32Array.from(values));
}

/** Generate embeddings via RealtimeX SDK proxy (no provider API keys in Signals). */
export async function rtxEmbed(
  inputs: string[],
  fetchImpl: typeof fetch = fetch,
  env: EnvLike = process.env,
): Promise<RtxEmbedResult> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);

  if (!appId || !apiBase) {
    return {
      success: false,
      code: "RTX_NOT_CONFIGURED",
      error: actionableMessage("RTX_NOT_CONFIGURED"),
    };
  }

  if (inputs.length === 0) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "At least one input string is required for embedding.",
    };
  }

  if (inputs.length > MAX_EMBED_INPUTS) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: `Embedding batch exceeds ${MAX_EMBED_INPUTS} inputs.`,
    };
  }

  const payloadInputs = inputs.map((input) => truncateEmbedText(input));
  for (const input of payloadInputs) {
    if (input.length > MAX_EMBED_CHARS) {
      return {
        success: false,
        code: "VALIDATION_ERROR",
        error: `Embedding input exceeds ${MAX_EMBED_CHARS} characters.`,
      };
    }
  }

  try {
    const response = await fetchImpl(`${apiBase}/sdk/llm/embed`, {
      method: "POST",
      headers: buildHeaders(appId),
      body: JSON.stringify({ input: payloadInputs.length === 1 ? payloadInputs[0] : payloadInputs }),
    });

    const body = (await response.json()) as RtxEmbedApiResponse;
    if (!response.ok || body.success === false) {
      const code = mapErrorCode(body.code, response.status);
      const detail = body.error ?? body.errors?.join("; ");
      return {
        success: false,
        code,
        error: detail ? `${actionableMessage(code)} (${detail})` : actionableMessage(code),
      };
    }

    const embeddings = parseEmbeddings(body.embeddings);
    const provider = body.provider ?? "native";
    const model = body.model ?? "default";
    const dimensions = body.dimensions ?? embeddings?.[0]?.length ?? 0;

    if (!embeddings?.length || dimensions <= 0) {
      return {
        success: false,
        code: "EMBED_ERROR",
        error: actionableMessage("EMBED_ERROR"),
      };
    }

    for (const vector of embeddings) {
      if (vector.length !== dimensions) {
        return {
          success: false,
          code: "EMBED_ERROR",
          error: "RealtimeX returned embeddings with inconsistent dimensions.",
        };
      }
    }

    return {
      success: true,
      embeddings,
      provider,
      model,
      qualifiedModel: qualifyEmbeddingModel(provider, model),
      dimensions,
    };
  } catch (error) {
    return {
      success: false,
      code: "UNKNOWN",
      error: error instanceof Error ? error.message : actionableMessage("UNKNOWN"),
    };
  }
}

export function sha256EmbedText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
