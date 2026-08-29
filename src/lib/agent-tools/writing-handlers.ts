import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";
import { approvalEvidenceSchema } from "@/lib/writing/contracts";
import { materializeVariant } from "@/lib/writing/materialize";
import {
  approveVoiceProfile,
  getVoiceProfile,
  listVoiceProfiles,
  upsertVoiceProfile,
} from "@/lib/writing/voice-profile-store";
import { revokeVariantApproval } from "@/lib/writing/variant-writing";

export const listVoiceProfilesSchema = z.object({
  status: z.enum(["draft", "approved", "superseded", "rejected"]).optional(),
});

export const getVoiceProfileSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export const upsertVoiceProfileSchema = z.object({
  profile: z.record(z.unknown()),
});

export const approveVoiceProfileSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  evidence: approvalEvidenceSchema,
});

export const materializeVariantSchema = z.object({
  variantId: z.string().min(1),
  approval: z.object({
    by: z.literal("user"),
    evidence: approvalEvidenceSchema,
    note: z.string().optional(),
  }).passthrough().optional(),
});

export const revokeVariantApprovalSchema = z.object({
  variantId: z.string().min(1),
  reason: z.enum(["user", "voice_superseded"]),
  note: z.string().optional(),
});

export async function handleListVoiceProfiles(input: z.infer<typeof listVoiceProfilesSchema>) {
  const profiles = listVoiceProfiles(input.status);
  return { profiles, total: profiles.length };
}

export async function handleGetVoiceProfile(input: z.infer<typeof getVoiceProfileSchema>) {
  return getVoiceProfile(input.id, input.version);
}

export async function handleUpsertVoiceProfile(input: z.infer<typeof upsertVoiceProfileSchema>) {
  return upsertVoiceProfile(input.profile);
}

export async function handleApproveVoiceProfile(input: z.infer<typeof approveVoiceProfileSchema>) {
  return { profile: await approveVoiceProfile(input) };
}

export async function handleMaterializeVariant(input: z.infer<typeof materializeVariantSchema>) {
  return materializeVariant(input);
}

export async function handleRevokeVariantApproval(input: z.infer<typeof revokeVariantApprovalSchema>) {
  const approval = revokeVariantApproval(input.variantId, input.reason, input.note);
  if (approval.state !== "revoked") throw new AgentToolError("EXECUTION_ERROR", "Approval revocation did not persist");
  return { variantId: input.variantId, approval };
}
