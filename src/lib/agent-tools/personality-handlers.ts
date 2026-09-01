import { z } from "zod";
import {
  approvePersonalityProjection,
  retryPersonalityProjection,
} from "@/lib/personality/use-cases";
import { personalityStatementsInputSchema } from "@/lib/personality/contracts";
import {
  proposePersonalityProjection,
  proposePersonalityRollback,
  proposePersonalityUnbind,
  rejectPersonalityProposal,
} from "@/lib/personality/proposal";
import { upsertPersonalityStatements } from "@/lib/personality/statements";
import { getPersonalityBindingView } from "@/lib/personality/status";

export const upsertPersonalityStatementsSchema = personalityStatementsInputSchema;

export async function handleUpsertPersonalityStatements(
  input: z.infer<typeof upsertPersonalityStatementsSchema>,
) {
  return upsertPersonalityStatements(input);
}

const personalityIdSchema = (prefix: "prp" | "pb") =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,}$`));
const threadEvidenceSchema = z.object({
  kind: z.literal("thread_message"),
  workspaceSlug: z.string().min(1),
  threadSlug: z.string().min(1),
  note: z.string().optional(),
}).strict();

export const getPersonalityBindingSchema = z.object({}).strict();
export const proposePersonalityProjectionSchema = z.object({
  voiceProfileId: z.string().regex(/^vp_[A-Za-z0-9_-]{6,}$/).optional(),
}).strict();
export const approvePersonalityProjectionSchema = z.object({
  proposalId: personalityIdSchema("prp"),
  evidence: threadEvidenceSchema,
}).strict();
export const rejectPersonalityProjectionSchema = z.object({
  proposalId: personalityIdSchema("prp"),
  evidence: threadEvidenceSchema,
  note: z.string().max(4_096).optional(),
}).strict();
export const retryPersonalityProjectionSchema = z.object({
  proposalId: personalityIdSchema("prp"),
}).strict();
export const rollbackPersonalityProjectionSchema = z.object({
  bindingId: personalityIdSchema("pb"),
}).strict();
export const unbindPersonalityProjectionSchema = z.object({}).strict();

export async function handleGetPersonalityBinding() {
  return getPersonalityBindingView();
}

export async function handleProposePersonalityProjection(
  input: z.infer<typeof proposePersonalityProjectionSchema>,
) {
  return proposePersonalityProjection({ ...input, origin: { kind: "tool" } });
}

export async function handleApprovePersonalityProjection(
  input: z.infer<typeof approvePersonalityProjectionSchema>,
) {
  return approvePersonalityProjection(input);
}

export async function handleRejectPersonalityProjection(
  input: z.infer<typeof rejectPersonalityProjectionSchema>,
) {
  return rejectPersonalityProposal(input);
}

export async function handleRetryPersonalityProjection(
  input: z.infer<typeof retryPersonalityProjectionSchema>,
) {
  return retryPersonalityProjection(input.proposalId);
}

export async function handleRollbackPersonalityProjection(
  input: z.infer<typeof rollbackPersonalityProjectionSchema>,
) {
  return proposePersonalityRollback(input.bindingId);
}

export async function handleUnbindPersonalityProjection() {
  return proposePersonalityUnbind();
}
