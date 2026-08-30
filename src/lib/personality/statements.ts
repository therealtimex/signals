import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  type PersonalityStatements,
  type PersonalityStatementsInput,
  personalityStatementsInputSchema,
  personalityStatementsSchema,
} from "@/lib/personality/contracts";
import { personalityStoreDir } from "@/lib/personality/store-paths";
import { atomicReplaceJson, withStoreLock } from "@/lib/store/locked-json-store";
import { sha256Canonical } from "@/lib/writing/hash";

function statementsPath(): string {
  return join(personalityStoreDir(), "statements.json");
}

export function readPersonalityStatements(): PersonalityStatements | null {
  const path = statementsPath();
  if (!existsSync(path)) return null;
  try {
    return personalityStatementsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new AgentToolError("STORE_CONFLICT", "Personality statements are invalid");
  }
}

export function emptyPersonalityStatements(): PersonalityStatements {
  return {
    schemaVersion: 1,
    values: [],
    boundaries: [],
    updatedAt: 0,
    hash: sha256Canonical({ values: [], boundaries: [] }),
  };
}

export async function upsertPersonalityStatements(
  value: PersonalityStatementsInput,
): Promise<PersonalityStatements> {
  const parsed = personalityStatementsInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentToolError(
      "VALIDATION_ERROR",
      "Invalid personality statements",
      parsed.error.flatten(),
    );
  }
  const dir = personalityStoreDir();
  return withStoreLock(dir, dir, () => {
    const document = personalityStatementsSchema.parse({
      schemaVersion: 1,
      ...parsed.data,
      updatedAt: Math.floor(Date.now() / 1_000),
      hash: sha256Canonical(parsed.data),
    });
    atomicReplaceJson(join(dir, "statements.json"), document);
    return document;
  }, { busyMessage: "Personality store is busy" });
}
