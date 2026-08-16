import type { EmbeddingKind } from "@/lib/db/embedding-kinds";
import {
  assembleEmbedText,
  getLatestEmbedding,
  upsertEmbedding,
} from "@/lib/db/queries/embeddings";
import type { GraphNodeType } from "@/lib/db/types";
import { truncateEmbedText } from "@/lib/embeddings/vector-utils";
import { resolveEmbeddingSourceScope } from "@/lib/embeddings/source-scope";
import type { EnvLike } from "@/lib/rtx/env";
import { rtxEmbed, sha256EmbedText, type RtxEmbedFailure } from "@/lib/rtx/llm";

export type EmbedNodeResult =
  | {
      embedded: true;
      skipped: false;
      model: string;
      dims: number;
      contentHash: string;
    }
  | {
      embedded: false;
      skipped: true;
      model: string | null;
      contentHash: string;
    };

export class EmbeddingUnavailableError extends Error {
  readonly code: RtxEmbedFailure["code"];

  constructor(code: RtxEmbedFailure["code"], message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
    this.code = code;
  }
}

export async function embedNodeIfStale(
  nodeType: GraphNodeType,
  nodeId: string,
  kind: EmbeddingKind,
  opts?: { force?: boolean; fetchImpl?: typeof fetch; env?: EnvLike },
): Promise<EmbedNodeResult> {
  const rawText = assembleEmbedText(nodeType, nodeId, kind);
  const text = truncateEmbedText(rawText);
  const contentHash = sha256EmbedText(text);

  if (!opts?.force) {
    const latest = getLatestEmbedding(nodeType, nodeId, kind);
    if (latest?.contentHash === contentHash) {
      return {
        embedded: false,
        skipped: true,
        model: latest.model,
        contentHash,
      };
    }
  }

  const embedResult = await rtxEmbed([text], opts?.fetchImpl, opts?.env ?? process.env);
  if (!embedResult.success) {
    throw new EmbeddingUnavailableError(embedResult.code, embedResult.error);
  }

  const vector = embedResult.embeddings[0];
  if (!vector) {
    throw new EmbeddingUnavailableError("EMBED_ERROR", "RealtimeX returned no embedding vector.");
  }

  const sourceScope = resolveEmbeddingSourceScope(nodeType, nodeId, kind);

  upsertEmbedding({
    nodeType,
    nodeId,
    kind,
    model: embedResult.qualifiedModel,
    vector,
    contentHash,
    dims: embedResult.dimensions,
    scope: sourceScope,
    force: opts?.force,
  });

  return {
    embedded: true,
    skipped: false,
    model: embedResult.qualifiedModel,
    dims: embedResult.dimensions,
    contentHash,
  };
}
