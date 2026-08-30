import type { z } from "zod";
import { personalityStatementsInputSchema } from "@/lib/personality/contracts";
import { upsertPersonalityStatements } from "@/lib/personality/statements";

export const upsertPersonalityStatementsSchema = personalityStatementsInputSchema;

export async function handleUpsertPersonalityStatements(
  input: z.infer<typeof upsertPersonalityStatementsSchema>,
) {
  return upsertPersonalityStatements(input);
}
