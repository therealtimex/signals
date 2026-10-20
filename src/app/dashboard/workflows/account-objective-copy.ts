/**
 * Copy and pure helpers for the run objective (#549, UX contract v2).
 *
 * Shared by the run dialog (`account-objective-fields.tsx`) and the run page
 * (`[id]/workflow-run-objective.tsx`) so the two surfaces use the same words. Every string here
 * is the contract's copy verbatim; change it there first.
 */

import type {
  AccountObjective,
  AccountObjectiveLimitation,
  AccountObjectiveSource,
  ObjectiveMention,
} from "@/lib/writing/account-objective";
import type {
  WorkflowRunProposalAsk,
  WorkflowRunProposalCustomerPain,
} from "@/lib/writing/workflow-run-proposals";
import { OBJECTIVE_BRIEF_TEMPLATE, parseObjectiveBrief } from "@/lib/writing/objective-brief";

/** Mirrors the server's mention grammar (`objective-brief.ts`), with positions for rendering. */
const MENTION_PATTERN =
  /(?<![A-Za-z0-9_@])@(IDENTITY|SOUL|VOICE|BRAND|PRODUCTS)\.md(?:#([a-z0-9][a-z0-9-]{1,62}))?(?![A-Za-z0-9_#])/g;

export const BRIEF_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RESERVED_BRIEF_NAMES = new Set(["preview", "mentions"]);

export function isValidBriefName(name: string): boolean {
  return BRIEF_NAME_PATTERN.test(name) && !RESERVED_BRIEF_NAMES.has(name);
}

export const BRIEF_NAME_FORMAT_ERROR =
  "Use 2 to 63 lowercase letters, numbers and dashes, starting with a letter or number.";
export const BRIEF_OUTCOME_ERROR =
  "Add an Outcome: a line under ## Outcome that says what you want to happen for these accounts.";
export const SAVED_BRIEF_OUTCOME_ERROR = "This saved brief has no Outcome. Edit a copy and add one.";

export function briefNameExistsError(name: string): string {
  return `A saved brief named ${name} already exists. Choose another name.`;
}

export const BRIEF_COUNTER_FROM = 13_000;
export const BRIEF_MAX_CHARS = 16_384;

export function briefCounter(length: number): string {
  return `${length.toLocaleString("en-US")} of 16,384 characters`;
}

export function briefNameHelp(name: string): string {
  return `Saved as objectives/${name.trim() || "<name>"}.md. Use lowercase letters, numbers and dashes.`;
}

/** `objectives/<name>.md` → `<name>`; anything else is returned as given. */
export function briefNameFromPath(path: string): string {
  const match = /^objectives\/(.+)\.md$/.exec(path);
  return match ? match[1] : path;
}

export function briefPath(name: string): string {
  return `objectives/${name}.md`;
}

export function formatBriefDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function proofPoints(count: number): string {
  return `${count} proof point${count === 1 ? "" : "s"}`;
}

/** What a view needs from either a stamped objective or a dialog preview. */
export type ObjectiveMentionsView = {
  mentions: Pick<ObjectiveMention, "raw" | "path" | "anchor" | "resolved" | "unresolvedReason">[];
};

export type ObjectiveLimitsView = ObjectiveMentionsView & {
  offering: Pick<NonNullable<AccountObjective["offering"]>, "name" | "proofPointCount"> | null;
  limitations: AccountObjectiveLimitation[];
};

export type MentionLabel = { raw: string; label: string; resolved: boolean };

/** A resolved product reads as its name, a resolved file as its file name, anything else as not found. */
export function mentionLabel(raw: string, view: ObjectiveMentionsView): MentionLabel {
  const mention = view.mentions.find((candidate) => candidate.raw === raw);
  if (mention?.resolved) {
    return { raw, label: mention.resolved.entry?.name ?? mention.path, resolved: true };
  }
  return { raw, label: `${raw} (not found)`, resolved: false };
}

export type MentionSegment = { kind: "text"; text: string } | ({ kind: "mention" } & MentionLabel);

/** Split text into plain runs and mention tokens, so a view can render tokens as names. */
export function splitMentions(text: string, view: ObjectiveMentionsView): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    segments.push({ kind: "mention", ...mentionLabel(match[0], view) });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Plain-text form with mentions as names, for one-line summaries. */
export function textWithMentionNames(text: string, view: ObjectiveMentionsView): string {
  return splitMentions(text, view)
    .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
    .join("");
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\\[\]*_`]/g, (char) => `\\${char}`);
}

export const MENTION_HREF_PREFIX = "#objective-mention-";

/**
 * Rewrite mention tokens into fragment links for react-markdown, which renders them through a
 * custom `a` component as names (hovering shows the raw token). Returns the rewritten markdown and
 * the labels indexed by the fragment number.
 */
export function markdownWithMentionLinks(
  text: string,
  view: ObjectiveMentionsView,
): { markdown: string; labels: MentionLabel[] } {
  const labels: MentionLabel[] = [];
  const markdown = splitMentions(text, view)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      labels.push(segment);
      return `[${escapeMarkdownLinkText(segment.label)}](${MENTION_HREF_PREFIX}${labels.length - 1})`;
    })
    .join("");
  return { markdown, labels };
}

/* ------------------------------------------------------------------------------------------------
 * Limitations (contract §4.3)
 * ---------------------------------------------------------------------------------------------- */

export const LIMITATION_SHORT: Record<AccountObjectiveLimitation, string> = {
  offering_missing: "no offering",
  offering_unresolved: "offering not found",
  offering_ambiguous: "more than one offering",
  offering_proof_missing: "no proof points",
  mention_unresolved: "file not found",
  fit_missing: "fit not stated",
  success_missing: "success not defined",
};

export function limitationsShort(limitations: AccountObjectiveLimitation[]): string {
  return limitations.map((code) => LIMITATION_SHORT[code]).join(" · ");
}

function isEntryMention(mention: { path: string; anchor: string | null }): boolean {
  return mention.path === "PRODUCTS.md" && Boolean(mention.anchor);
}

function isAre(count: number): string {
  return count === 1 ? "isn't" : "aren't";
}

export function limitationSentence(code: AccountObjectiveLimitation, view: ObjectiveLimitsView): string {
  switch (code) {
    case "offering_missing":
      return "No product from PRODUCTS.md is mentioned, so drafts ask discovery questions only and don't name or pitch an offering.";
    case "offering_unresolved": {
      const missing = view.mentions.filter((mention) => isEntryMention(mention) && !mention.resolved);
      const tokens = missing.map((mention) => mention.raw).join(", ");
      if (missing.some((mention) => mention.unresolvedReason === "file_absent")) {
        return `There's no PRODUCTS.md in the workspace, so ${tokens} can't be found. Drafts treat the offering as missing: discovery questions only.`;
      }
      return `${tokens} ${isAre(missing.length)} in PRODUCTS.md, so drafts treat the offering as missing: discovery questions only.`;
    }
    case "offering_ambiguous": {
      const names = view.mentions
        .filter(isEntryMention)
        .map((mention) => mention.resolved?.entry?.name ?? mention.raw)
        .join(", ");
      return `The brief mentions more than one product (${names}), so drafts don't name or pitch any of them.`;
    }
    case "offering_proof_missing":
      return `${view.offering?.name ?? "The offering"} has no proof points in PRODUCTS.md, so drafts make no claims about what it does or achieves.`;
    case "mention_unresolved": {
      const missing = view.mentions.filter((mention) => !isEntryMention(mention) && !mention.resolved);
      const them = missing.length === 1 ? "it" : "them";
      return `${missing.map((mention) => mention.raw).join(", ")} ${isAre(missing.length)} in the workspace, so the agent doesn't have ${them}.`;
    }
    case "fit_missing":
      return "The brief has no Fit, so drafts can test whether there's a fit but don't assume one.";
    case "success_missing":
      return "The brief has no Success, so success isn't defined for this run. The next step still applies.";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Run page (contract §2–§4)
 * ---------------------------------------------------------------------------------------------- */

export const OBJECTIVE_SOURCE_CAPTION: Record<AccountObjectiveSource, string> = {
  run_config: "Set when the run started",
  template_config: "From the template's default",
  default: "No objective was given",
};

export function briefSourceCaption(objective: Pick<AccountObjective, "brief">): string | null {
  if (!objective.brief) return null;
  return objective.brief.source.kind === "saved"
    ? `· Saved brief ${objective.brief.source.path}`
    : "· Brief written for this run";
}

export const RELATIONSHIP_ONLY_BODY = "Keep in touch. Drafts don't mention an offering, pricing or a pitch.";
export const RELATIONSHIP_DEFAULT_BODY =
  "This run started without an objective, so drafts only nurture the relationship and don't mention an offering. To work toward a business outcome, choose one when you start the next run.";

export const SOURCES_STALE_TITLE = "The objective's files changed after this run started";

export function sourcesStaleText(changedPaths: string[]): string {
  return `Changed: ${changedPaths.join(", ")}. This run keeps using the snapshot below.`;
}

/**
 * The stale alert's second paragraph (contract v2 addendum 1, B1): only the sentences whose
 * condition holds, in order. Approval and materialization are atomic today, so the first sentence
 * normally never shows.
 */
export function sourcesStaleFollowUp(input: { revoked: number; pendingReview: number }): string[] {
  const sentences: string[] = [];
  if (input.revoked >= 1) {
    sentences.push(input.revoked === 1
      ? "1 approval that wasn't materialized yet was revoked, so review that proposal again."
      : `${input.revoked} approvals that weren't materialized yet were revoked, so review those proposals again.`);
  }
  if (input.pendingReview >= 1) {
    sentences.push("Proposals awaiting review were drafted against this snapshot, and approving one uses it.");
  }
  sentences.push("To use the new text, start a new run.");
  return sentences;
}

export const SOURCES_UNAVAILABLE_CAPTION =
  "Couldn't check the workspace just now, so Signals can't tell whether the brief's files changed since the run started.";

/** Refresh announcement (addendum 1, B2): the revoke count only when something was revoked. */
export function sourcesChangedAnnouncement(revoked: number): string {
  const base = "The objective's files changed since this run started.";
  if (revoked < 1) return base;
  return `${base} ${revoked} approval${revoked === 1 ? " was" : "s were"} revoked.`;
}

export type RelationBadge = { label: string; variant: "success" | "info" | "warning" | "secondary" };

export function relationBadge(ask: Pick<WorkflowRunProposalAsk, "relation" | "testsUncertainty">): RelationBadge {
  switch (ask.relation) {
    case "advances":
      return { label: "Advances outcome", variant: "success" };
    case "tests":
      return { label: `Tests unknown ${ask.testsUncertainty ?? "?"}`, variant: "info" };
    case "defers":
      return { label: "Defers outcome", variant: "warning" };
    case "relationship_only":
      return { label: "Relationship only", variant: "secondary" };
  }
}

/** Contract §4.2. Claim ids are never shown. */
export function customerPainText(pain: WorkflowRunProposalCustomerPain): string {
  if (pain.status === "none_assumed") return "none assumed";
  if (pain.status === "asked") return `asked, not assumed — “${pain.text}”`;
  const first = pain.claims.find((claim) => claim.text);
  if (!first) {
    return `from ${pain.claims.length} cited source${pain.claims.length === 1 ? "" : "s"}`;
  }
  const others = pain.claims.length - 1;
  const from = first.sensitivity === "private" ? "from a private source" : "from a source";
  return `${from} — “${first.text}”${others > 0 ? ` and ${others} more` : ""}`;
}

export const OBJECTIVE_CHANGED_STATUS = "Revoked · objective changed";

/* ------------------------------------------------------------------------------------------------
 * Run dialog (contract §1)
 * ---------------------------------------------------------------------------------------------- */

export const KIND_HELP = "The agent attaches this to every draft. You see it on each proposal when you review.";
export const RELATIONSHIP_KIND_NOTE =
  "Every draft is marked Relationship only, and the agent won't bring up an offering.";
export const TEMPLATE_DEFAULT_NOTE =
  "Filled in from this template's default brief. Change anything to use your own for this run.";
export const TEMPLATE_CHANGED_NOTE = "Changed from the template's default. This run uses your version.";
export const PREVIEW_FAILED =
  "Couldn't check the brief right now. Signals checks it again when the run starts.";
export const PREVIEW_OUTCOME_MISSING = "Missing. Add a line under ## Outcome. It's required.";
export const NO_PRODUCTS_NOTE =
  "There's no PRODUCTS.md in the workspace yet, so products can't be mentioned.";
export const RUN_REFUSED_TITLE = "Signals didn't start the run";

export function mentionListAnnouncement(count: number): string {
  return `${count} files and products. Use the arrow keys, then Enter to insert.`;
}

/** Contract §1.5, keyed on `details.reason`. `null` for `outcome_missing` (a field error instead). */
export function refusalText(reason: string | undefined, details: { name?: unknown; path?: unknown }): string | null {
  const name = typeof details.name === "string"
    ? details.name
    : typeof details.path === "string"
      ? briefNameFromPath(details.path)
      : "";
  switch (reason) {
    case "outcome_missing":
      return null;
    case "workspace_unavailable":
      return "Signals can't reach its RealTimeX workspace, so it can't read or save the files this brief needs. Nothing was started. Try again in a moment, or remove the mentions to run with the brief alone.";
    case "saved_brief_not_found":
      return `The saved brief ${name} isn't in the workspace anymore. Nothing was started. Write a brief, or choose another saved one.`;
    case "saved_brief_unsafe":
      return `Signals can't safely read the saved brief ${name}. It must be a plain markdown file in objectives/. Nothing was started. Write a brief, or choose another saved one.`;
    case "too_large":
      return "The brief and the files it mentions are too long to attach. Nothing was started. Mention one product instead of all of PRODUCTS.md, or shorten the brief.";
    default:
      return "The objective couldn't be attached. Nothing was started. Check the brief and run again.";
  }
}

/** First five words of the Outcome, as a brief name (`""` when too short to be one). */
export function suggestBriefName(text: string): string {
  const outcome = parseObjectiveBrief(text).outcome ?? "";
  const words = outcome
    .replace(MENTION_PATTERN, (_raw, file: string, anchor?: string) => anchor ?? file)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 63)
    .replace(/-+$/, "");
  return isValidBriefName(words) ? words : "";
}

/* ------------------------------------------------------------------------------------------------
 * Dialog draft → run config
 * ---------------------------------------------------------------------------------------------- */

export type ObjectiveKind = "relationship_only" | "commercial";

export type ObjectiveDraft = {
  kind: ObjectiveKind | null;
  mode: "write" | "saved";
  /** The write-mode text; kept while switching kinds or modes. */
  text: string;
  /** Selected saved brief path (`objectives/<name>.md`) in saved mode. */
  savedPath: string | null;
  save: boolean;
  name: string;
};

export function emptyObjectiveDraft(): ObjectiveDraft {
  return { kind: null, mode: "write", text: OBJECTIVE_BRIEF_TEMPLATE, savedPath: null, save: false, name: "" };
}

/** The template's default objective (input shape) as a draft, or `null` when it has none. */
export function objectiveDraftFromTemplate(value: unknown): ObjectiveDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { kind?: unknown; brief?: unknown };
  if (record.kind === "relationship_only") return { ...emptyObjectiveDraft(), kind: "relationship_only" };
  if (record.kind !== "commercial" || !record.brief || typeof record.brief !== "object") return null;
  const brief = record.brief as { kind?: unknown; text?: unknown; path?: unknown };
  if (brief.kind === "inline" && typeof brief.text === "string") {
    return { ...emptyObjectiveDraft(), kind: "commercial", text: brief.text };
  }
  if (brief.kind === "saved" && typeof brief.path === "string") {
    return { ...emptyObjectiveDraft(), kind: "commercial", mode: "saved", savedPath: brief.path };
  }
  return null;
}

export function sameObjectiveDraft(left: ObjectiveDraft, right: ObjectiveDraft): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "commercial") return true;
  if (left.mode !== right.mode) return false;
  return left.mode === "write"
    ? left.text === right.text && left.save === right.save
    : left.savedPath === right.savedPath;
}

export type AccountObjectiveRunInput =
  | { kind: "relationship_only" }
  | { kind: "commercial"; brief: { kind: "inline"; text: string } | { kind: "saved"; path: string } };

/**
 * The `config.accountObjective` the dialog sends. An untouched template default is omitted so the
 * server records `template_config`.
 */
export function buildAccountObjectiveRunInput(
  draft: ObjectiveDraft,
  templateDefault: ObjectiveDraft | null,
): AccountObjectiveRunInput | undefined {
  if (!draft.kind) return undefined;
  if (templateDefault && sameObjectiveDraft(draft, templateDefault)) return undefined;
  if (draft.kind === "relationship_only") return { kind: "relationship_only" };
  if (draft.mode === "saved" && draft.savedPath) {
    return { kind: "commercial", brief: { kind: "saved", path: draft.savedPath } };
  }
  if (draft.save) return { kind: "commercial", brief: { kind: "saved", path: briefPath(draft.name.trim()) } };
  return { kind: "commercial", brief: { kind: "inline", text: draft.text } };
}

export type ObjectiveFieldErrors = {
  brief?: string;
  saved?: string;
  name?: string;
};

/** Contract §1.5 field validation; `savedOutcome` is the selected saved brief's parsed Outcome. */
export function validateObjectiveDraft(
  draft: ObjectiveDraft,
  savedOutcome: string | null | undefined,
): ObjectiveFieldErrors {
  if (draft.kind !== "commercial") return {};
  if (draft.mode === "saved") {
    return savedOutcome === null ? { saved: SAVED_BRIEF_OUTCOME_ERROR } : {};
  }
  if (!parseObjectiveBrief(draft.text).outcome) return { brief: BRIEF_OUTCOME_ERROR };
  if (draft.save && !isValidBriefName(draft.name.trim())) return { name: BRIEF_NAME_FORMAT_ERROR };
  return {};
}

/** "Objective attached: …" after a launch (contract §1.5). */
export function launchedObjectiveLine(input: {
  kind: ObjectiveKind;
  outcome: string | null;
  view: ObjectiveMentionsView;
  savedNow: string | null;
  fromSaved: string | null;
}): string {
  if (input.kind === "relationship_only") return "Objective attached: Relationship only";
  const outcome = input.outcome ? textWithMentionNames(input.outcome, input.view) : "";
  const suffix = input.savedNow
    ? ` · brief saved as ${input.savedNow}`
    : input.fromSaved
      ? ` · from ${input.fromSaved}`
      : "";
  return `Objective attached: Business outcome — ${outcome}${suffix}`;
}
