import { join } from "node:path";
import { dataDir } from "@/lib/db/client";
import {
  ensureStoreDirectory,
  resetStoreDirectory,
} from "@/lib/store/locked-json-store";

export function personalityStoreDir(): string {
  return ensureStoreDirectory(join(dataDir, "personality"));
}

export function resetPersonalityStore(): void {
  resetStoreDirectory(join(dataDir, "personality"));
}
