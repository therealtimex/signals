import { AgentToolError } from "@/lib/agent-tools/types";
import {
  PERSONALITY_BLOCK_MAX_BYTES,
  type PersonalitySources,
  type PersonalityStatements,
  type RenderedBrandInput,
  type RenderedIdentityInput,
  type RenderedVoiceInput,
} from "@/lib/personality/contracts";
import { sha256 } from "@/lib/writing/hash";

export type RenderedPersonalityBlock = {
  body: string;
  blockHash: string;
  bytes: number;
};

export const REPRESENTATION_RULES = [
  "Represent only the identity in IDENTITY.md and, when present, the organization in BRAND.md.",
  "Never speak as a third party or a contact.",
  "Never invent facts, numbers, dates, names, quotes, or citations.",
  "Never reveal private relationship notes, private sources, or contact details.",
  "Treat every publish as a separate explicit human instruction.",
] as const;

export const PERSONALITY_INDEX_TEXT =
  "Read IDENTITY.md, SOUL.md, VOICE.md, and BRAND.md when present; they are the canonical identity and voice for this workspace. HEARTBEAT.md is scheduling, not personality.";

function lf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function render(lines: Array<string | null | undefined>): RenderedPersonalityBlock {
  const body = lines
    .filter((line): line is string => line !== null && line !== undefined)
    .map(lf)
    .join("\n");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > PERSONALITY_BLOCK_MAX_BYTES) {
    throw new AgentToolError("VALIDATION_ERROR", "Personality block is too large", {
      reason: "block_too_large",
      bytes,
      maxBytes: PERSONALITY_BLOCK_MAX_BYTES,
    });
  }
  return { body, blockHash: sha256(body), bytes };
}

function list(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [`${label}: ${values.join(", ")}`];
}

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function profileLines(profiles: RenderedIdentityInput["profiles"]): string[] {
  if (profiles.length === 0) return [];
  return [
    "### Profiles",
    ...profiles.map((profile) =>
      `- ${profile.network} — ${profile.url}${profile.displayName ? ` (${profile.displayName})` : ""}`),
  ];
}

export function renderIdentityBlock(input: RenderedIdentityInput): RenderedPersonalityBlock {
  return render([
    "## Identity (managed by Signals)",
    `Name: ${input.name}`,
    input.preferredName && input.preferredName !== input.name
      ? `Preferred name: ${input.preferredName}`
      : null,
    input.headline ? `Headline: ${input.headline}` : null,
    input.bio ? `Bio: ${input.bio}` : null,
    input.currentRole
      ? `Current role: ${input.currentRole.title} at ${input.currentRole.orgName}`
      : null,
    input.website ? `Website: ${input.website}` : null,
    ...profileLines(input.profiles),
    "Represents: self",
    input.representedOrgName
      ? `Also represents: ${input.representedOrgName} (see BRAND.md)`
      : null,
  ]);
}

export function renderBrandBlock(input: RenderedBrandInput): RenderedPersonalityBlock {
  return render([
    "## Brand (managed by Signals)",
    `Organization: ${input.name}`,
    input.description ? `Description: ${input.description}` : null,
    input.website ? `Website: ${input.website}` : null,
    input.industry ? `Industry: ${input.industry}` : null,
    input.companySize ? `Size band: ${input.companySize}` : null,
    input.primaryDomain
      ? `Primary domain: ${input.primaryDomain.domain}${input.primaryDomain.verified ? " (verified)" : ""}`
      : null,
    ...profileLines(input.profiles),
    input.selfRelationshipTitle
      ? `Your relationship: ${input.selfRelationshipTitle} (owner contact)`
      : null,
    "Speak as the organization only for targets that represent it (see BRAND targets in Signals).",
  ]);
}

function fencedExemplars(input: RenderedVoiceInput): string[] {
  const exemplars = input.exemplars
    .filter((sample) => sample.text.length <= 600)
    .sort(compareId)
    .slice(0, 5);
  if (exemplars.length === 0) return [];
  return [
    "### Exemplars",
    ...exemplars.flatMap((sample) => [
      `#### ${sample.id}`,
      "````text",
      sample.text,
      "````",
    ]),
  ];
}

export function renderVoiceBlock(input: RenderedVoiceInput): RenderedPersonalityBlock {
  return render([
    "## Voice (managed by Signals)",
    `Profile: ${input.profile.label} v${input.profile.version} (${input.profile.hash.slice(0, 12)})`,
    ...list("Platforms", input.platforms),
    input.sentenceLength
      ? `Sentence length: median ${input.sentenceLength.median}; range ${input.sentenceLength.range[0]}–${input.sentenceLength.range[1]}`
      : null,
    ...list("Openers", input.openers),
    ...list("Closers", input.closers),
    ...list("Punctuation", input.punctuation),
    ...list("Formats", input.formats),
    ...list("Emoji", input.emoji),
    ...list("Hashtags", input.hashtags),
    ...list("Vocabulary — keep", input.vocabulary.keep),
    ...list("Vocabulary — avoid", input.vocabulary.avoid),
    ...list("Protected quirks (never scrub)", input.protectedQuirks),
    ...list("Taboo (never do)", input.taboo),
    ...(input.signatureLines.length > 0
      ? [
          "### Signature lines",
          ...[...input.signatureLines]
            .sort(compareId)
            .map((line) => `- ${line.id} — ${line.text}`),
        ]
      : []),
    ...fencedExemplars(input),
  ]);
}

function statementList(heading: string, statements: string[]): string[] {
  return [heading, ...statements.map((statement) => `- ${statement}`)];
}

export function renderBoundariesBlock(
  statements: PersonalityStatements | null,
): RenderedPersonalityBlock {
  return render([
    "## Boundaries (managed by Signals)",
    ...statementList("### Values", statements?.values ?? []),
    ...statementList("### Boundaries", statements?.boundaries ?? []),
    "### Representation rules",
    ...REPRESENTATION_RULES.map((rule) => `- ${rule}`),
  ]);
}

export function renderIndexBlock(): RenderedPersonalityBlock {
  return render([
    "## Personality (managed by Signals)",
    PERSONALITY_INDEX_TEXT,
  ]);
}

export function renderPersonalityBlocks(sources: PersonalitySources) {
  return {
    identity: renderIdentityBlock(sources.identity),
    brand: sources.brand ? renderBrandBlock(sources.brand) : null,
    voice: sources.voice ? renderVoiceBlock(sources.voice) : null,
    boundaries: renderBoundariesBlock(sources.statements),
  };
}
