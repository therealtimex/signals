import {
  brandRenderedBrandInput,
  brandRenderedIdentityInput,
  brandRenderedVoiceInput,
  personalityStatementsSchema,
  type PersonalitySources,
} from "@/lib/personality/contracts";
import { renderPersonalityBlocks } from "@/lib/personality/render";
import { buildSourceSnapshot, computeSourceHash } from "@/lib/personality/snapshot";

const input = JSON.parse(process.argv[2]) as {
  sources: {
    identity: unknown;
    brand: unknown | null;
    voice: unknown | null;
    statements: unknown | null;
  };
  revisions: { self: number; org?: number };
};

const sources: PersonalitySources = {
  identity: brandRenderedIdentityInput(input.sources.identity),
  brand: input.sources.brand ? brandRenderedBrandInput(input.sources.brand) : null,
  voice: input.sources.voice ? brandRenderedVoiceInput(input.sources.voice) : null,
  statements: input.sources.statements
    ? personalityStatementsSchema.parse(input.sources.statements)
    : null,
};
const snapshot = buildSourceSnapshot(sources, input.revisions);
process.stdout.write(JSON.stringify({
  sourceHash: computeSourceHash(snapshot),
  blocks: renderPersonalityBlocks(sources),
}));
