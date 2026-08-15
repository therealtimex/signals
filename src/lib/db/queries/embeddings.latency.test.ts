import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { semanticSearch } from "@/lib/db/queries/embeddings";
import { float32ToBuffer } from "@/lib/embeddings/vector-utils";
import { db, sqlite } from "@/lib/db/client";
import { contacts, embeddings } from "@/lib/db/schema";

function vectorWith(value: number, dims = 4): Float32Array {
  const vector = new Float32Array(dims);
  vector[0] = value;
  return vector;
}

describe("embeddings latency tripwire", () => {
  it(
    "semanticSearch scans 20k x 1536 vectors under 250 ms (Amendment C)",
    () => {
      const model = "bench:latency";
      const dims = 1536;
      const query = vectorWith(1, dims);
      const base = vectorWith(0.5, dims);

      db.transaction(() => {
        for (let i = 0; i < 20_000; i++) {
          const nodeId = `bench-${i}`;
          db.insert(contacts)
            .values({
              id: nodeId,
              name: `Bench ${i}`,
            })
            .run();
          db.insert(embeddings)
            .values({
              id: nanoid(),
              nodeType: "contact",
              nodeId,
              kind: "profile",
              model,
              dims,
              vector: float32ToBuffer(base),
              contentHash: `bench-${i}`,
              scope: "shared",
            })
            .run();
        }
      });

      sqlite.exec("ANALYZE embeddings");
      sqlite.exec("ANALYZE contacts");

      semanticSearch({
        kind: "profile",
        model,
        queryVector: query,
        k: 10,
      });

      const start = performance.now();
      const hits = semanticSearch({
        kind: "profile",
        model,
        queryVector: query,
        k: 10,
      });
      const elapsed = performance.now() - start;

      expect(hits.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(250);
    },
    30_000,
  );
});
