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

/** Cosine similarity against a stored vector buffer without allocating a full hits array first. */
export function cosineSimilarityWithQueryNormFromBuffer(
  query: Float32Array,
  candidate: Buffer,
  queryNorm: number,
): number {
  const dims = query.length;
  if (candidate.byteLength !== dims * 4) return Number.NaN;

  const values = new Float32Array(candidate.buffer, candidate.byteOffset, dims);
  let dot = 0;
  let normCandidate = 0;
  let i = 0;
  const limit = dims - (dims % 4);
  for (; i < limit; i += 4) {
    const q0 = query[i]!;
    const q1 = query[i + 1]!;
    const q2 = query[i + 2]!;
    const q3 = query[i + 3]!;
    const c0 = values[i]!;
    const c1 = values[i + 1]!;
    const c2 = values[i + 2]!;
    const c3 = values[i + 3]!;
    dot += q0 * c0 + q1 * c1 + q2 * c2 + q3 * c3;
    normCandidate += c0 * c0 + c1 * c1 + c2 * c2 + c3 * c3;
  }
  for (; i < dims; i++) {
    const qv = query[i]!;
    const cv = values[i]!;
    dot += qv * cv;
    normCandidate += cv * cv;
  }

  if (queryNorm === 0 || normCandidate === 0) return 0;
  return dot / (queryNorm * Math.sqrt(normCandidate));
}

export function pushSemanticTopK<T extends { score: number }>(top: T[], hit: T, k: number): void {
  if (top.length < k) {
    top.push(hit);
    if (top.length === k) {
      top.sort((a, b) => a.score - b.score);
    }
    return;
  }

  if (hit.score <= top[0]!.score) return;
  top[0] = hit;
  top.sort((a, b) => a.score - b.score);
}

export function finalizeSemanticTopK<T extends { score: number }>(top: T[]): T[] {
  return top.sort((a, b) => b.score - a.score);
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
