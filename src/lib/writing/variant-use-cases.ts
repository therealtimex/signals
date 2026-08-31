import { AgentToolError } from "@/lib/agent-tools/types";
import {
  getVariantById,
  isWritingVariant,
  upsertPersonalityBoundWritingVariant,
  upsertVariant,
  type UpsertVariantInput,
} from "@/lib/db/queries/variants";
import {
  variantGenerationSchema,
  variantWritingInputSchema,
  variantWritingSchema,
} from "@/lib/writing/contracts";
import {
  isPersonalityAwareWritingSkillVersion,
} from "@/lib/writing/personality-lineage";
import {
  stampAuditPersonality,
  stampVariantPersonality,
  withPersonalityWritingGuard,
  type PersonalityGuardDependencies,
} from "@/lib/writing/personality-guard";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function upsertVariantUseCase(
  input: UpsertVariantInput,
  dependencies: PersonalityGuardDependencies = {},
) {
  const existing = input.id ? getVariantById(input.id) : undefined;
  const writingMutation = input.generationMetadata?.kind === "signals-writing"
    || isWritingVariant(existing);
  if (!writingMutation) return upsertVariant(input);

  const generation = variantGenerationSchema.safeParse(
    input.generationMetadata ?? object(existing?.generationMetadata),
  );
  const writingInput = variantWritingInputSchema.safeParse(object(input.metadata).writing);
  const existingWriting = variantWritingSchema.safeParse(object(existing?.metadata).writing);
  if (!generation.success || !writingInput.success) return upsertVariant(input);

  const aware = isPersonalityAwareWritingSkillVersion(generation.data.skill.version);
  const selector = writingInput.data.personality;
  const previouslyBound = existingWriting.success && Boolean(existingWriting.data.personality);
  if (!aware && !selector && !previouslyBound) return upsertVariant(input);

  return withPersonalityWritingGuard((guard, tx) => {
    if (!selector) {
      if (previouslyBound || (aware && guard.binding)) {
        throw new AgentToolError(
          "VALIDATION_ERROR",
          "The active Personality binding is required for this writing mutation",
          { reason: "personality_binding_required" },
        );
      }
      if (writingInput.data.targetId || writingInput.data.audit) {
        throw new AgentToolError(
          "VALIDATION_ERROR",
          "An unbound workspace may create only a targetless unaudited writing draft",
          { reason: "personality_binding_required" },
        );
      }
      return upsertVariant(input, tx);
    }
    const snapshot = stampVariantPersonality({
      guard,
      bindingId: selector.bindingId,
      targetId: writingInput.data.targetId,
      requireCompatibleTarget: Boolean(writingInput.data.audit),
    });
    return upsertPersonalityBoundWritingVariant(input, {
      snapshot,
      auditPersonality: writingInput.data.audit
        ? stampAuditPersonality(snapshot, guard)
        : null,
    }, tx);
  }, dependencies);
}
