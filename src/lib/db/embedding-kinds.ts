import type { GraphNodeType } from "@/lib/db/types";

export const EMBEDDING_KINDS = ["profile", "persona", "description", "body"] as const;

export type EmbeddingKind = (typeof EMBEDDING_KINDS)[number];

export const EMBEDDING_KIND_NODE_TYPES: Record<EmbeddingKind, readonly GraphNodeType[]> = {
  profile: ["contact", "org"],
  persona: ["contact"],
  description: ["niche", "launch"],
  body: ["content", "variant"],
};

/** v1 on-demand assembly supports these embedding kinds (includes persona synthesis). */
export const V1_EMBEDDING_KINDS: readonly EmbeddingKind[] = ["profile", "description", "body", "persona"];

export function assertEmbeddingKind(kind: string): asserts kind is EmbeddingKind {
  if (!(EMBEDDING_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `Invalid embedding kind "${kind}". Allowed: ${EMBEDDING_KINDS.join(", ")}`,
    );
  }
}

export function assertEmbeddingNodeType(kind: EmbeddingKind, nodeType: GraphNodeType): void {
  const allowed = EMBEDDING_KIND_NODE_TYPES[kind];
  if (!allowed.includes(nodeType)) {
    throw new Error(
      `Embedding kind "${kind}" does not apply to node type "${nodeType}". Allowed: ${allowed.join(", ")}`,
    );
  }
}

export function assertV1EmbeddingKind(kind: EmbeddingKind): void {
  if (!V1_EMBEDDING_KINDS.includes(kind)) {
    throw new Error(
      `Embedding kind "${kind}" is not supported in v1. Supported: ${V1_EMBEDDING_KINDS.join(", ")}`,
    );
  }
}
