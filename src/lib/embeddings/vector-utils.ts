export const MAX_EMBED_INPUTS = 100;
export const MAX_EMBED_CHARS = 8_000;

export function truncateEmbedText(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  return text.slice(0, MAX_EMBED_CHARS);
}

export function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToFloat32(buffer: Buffer): Float32Array {
  if (buffer.byteLength % 4 !== 0) {
    throw new Error("Embedding vector buffer length must be a multiple of 4 bytes");
  }
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Cosine similarity requires vectors of equal length");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function vectorL2Norm(vector: Float32Array): number {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i]!;
    norm += value * value;
  }
  return Math.sqrt(norm);
}

export function cosineSimilarityWithQueryNorm(
  query: Float32Array,
  candidate: Float32Array,
  queryNorm: number,
): number {
  if (query.length !== candidate.length) {
    throw new Error("Cosine similarity requires vectors of equal length");
  }

  let dot = 0;
  let normCandidate = 0;
  for (let i = 0; i < query.length; i++) {
    const qv = query[i]!;
    const cv = candidate[i]!;
    dot += qv * cv;
    normCandidate += cv * cv;
  }

  if (queryNorm === 0 || normCandidate === 0) return 0;
  return dot / (queryNorm * Math.sqrt(normCandidate));
}

export function topKSemanticHits<T extends { score: number }>(hits: T[], k: number): T[] {
  if (hits.length <= k) {
    return [...hits].sort((a, b) => b.score - a.score);
  }

  const top: T[] = [];
  for (const hit of hits) {
    if (top.length < k) {
      top.push(hit);
      if (top.length === k) {
        top.sort((a, b) => a.score - b.score);
      }
      continue;
    }

    if (hit.score <= top[0]!.score) continue;
    top[0] = hit;
    top.sort((a, b) => a.score - b.score);
  }

  return top.sort((a, b) => b.score - a.score);
}

export function qualifyEmbeddingModel(provider: string, model: string): string {
  return `${provider}:${model}`;
}
