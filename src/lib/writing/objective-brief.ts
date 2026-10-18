/**
 * Objective brief parsing (#549, spec §18.3).
 *
 * An Objective brief is operator-written markdown with a small headings convention. Signals parses
 * only five headings (Outcome, Fit, Unknowns, Next step, Success) and the `@` mentions of workspace
 * resources; everything else is kept verbatim for the agent and never interpreted. Parsing is
 * pure, so the dialog preview, dispatch normalization and tests share one implementation.
 */

/** Brief text bound (characters). Matches the dialog's `maxLength`. */
export const OBJECTIVE_BRIEF_MAX_CHARS = 16_384;
/** Parsed scalar fields are cut to this many characters for cards and projections. */
export const OBJECTIVE_BRIEF_FIELD_MAX_CHARS = 500;
export const OBJECTIVE_BRIEF_UNKNOWNS_MAX = 12;
export const OBJECTIVE_BRIEF_UNKNOWN_MAX_CHARS = 300;

/**
 * Workspace files a brief may mention. Closed: no arbitrary paths, and no other brief, so a brief
 * can never pull in recipient data or recurse.
 */
export const OBJECTIVE_MENTION_FILES = [
  "IDENTITY.md",
  "SOUL.md",
  "VOICE.md",
  "BRAND.md",
  "PRODUCTS.md",
] as const;
export type ObjectiveMentionFile = (typeof OBJECTIVE_MENTION_FILES)[number];

export const OBJECTIVE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

const MENTION_PATTERN =
  /(?<![A-Za-z0-9_@])@(IDENTITY|SOUL|VOICE|BRAND|PRODUCTS)\.md(?:#([a-z0-9][a-z0-9-]{1,62}))?(?![A-Za-z0-9_#])/g;

export type ObjectiveBriefParsed = {
  outcome: string | null;
  fit: string | null;
  unknowns: string[];
  nextStep: string | null;
  success: string | null;
};

export type ObjectiveBriefMentionToken = {
  /** The token exactly as written, e.g. `@PRODUCTS.md#realtimex-desktop`. */
  raw: string;
  path: ObjectiveMentionFile;
  anchor: string | null;
};

type HeadingKey = "outcome" | "fit" | "unknowns" | "nextStep" | "success";

const HEADINGS: Record<string, HeadingKey> = {
  outcome: "outcome",
  fit: "fit",
  unknowns: "unknowns",
  "next step": "nextStep",
  success: "success",
};

function headingKey(text: string): HeadingKey | null {
  const normalized = text
    .trim()
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
  return HEADINGS[normalized] ?? null;
}

function cut(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function firstParagraph(lines: string[]): string | null {
  const paragraphs: string[][] = [[]];
  let fence: string | null = null;
  for (const line of lines) {
    // A fenced block is never a parsed value, and it ends the paragraph before it.
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch || fence !== null) {
      if (fenceMatch) fence = fence === null ? fenceMatch[1][0] : fenceMatch[1][0] === fence ? null : fence;
      if (paragraphs[paragraphs.length - 1].length) paragraphs.push([]);
      continue;
    }
    if (line.trim() === "") {
      if (paragraphs[paragraphs.length - 1].length) paragraphs.push([]);
      continue;
    }
    paragraphs[paragraphs.length - 1].push(line.trim());
  }
  const first = paragraphs.find((paragraph) => paragraph.some((line) => line !== "" && !/^[-*+]$/.test(line)));
  if (!first) return null;
  const text = first.join(" ").replace(/\s+/g, " ").trim();
  return text ? cut(text, OBJECTIVE_BRIEF_FIELD_MAX_CHARS) : null;
}

const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d+[.)])(?:\s+(.*))?$/;

function listItems(lines: string[]): string[] | null {
  const items: string[] = [];
  let sawList = false;
  let current: string[] | null = null;
  const flush = () => {
    if (current) {
      const text = current.join(" ").replace(/\s+/g, " ").trim();
      if (text) items.push(cut(text, OBJECTIVE_BRIEF_UNKNOWN_MAX_CHARS));
    }
    current = null;
  };
  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    if (match) {
      sawList = true;
      flush();
      current = [match[1] ?? ""];
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (current && /^\s+\S/.test(line)) {
      // A continuation line of the current item.
      current.push(line.trim());
      continue;
    }
    flush();
  }
  flush();
  return sawList ? items.slice(0, OBJECTIVE_BRIEF_UNKNOWNS_MAX) : null;
}

/**
 * Split a brief into heading sections, ignoring headings inside fenced code blocks.
 *
 * Headings match case-insensitively at levels 1–3 and in any order; a section runs to the next
 * heading of any level. The first occurrence of a heading wins.
 */
function sections(text: string): Map<HeadingKey, string[]> {
  const result = new Map<HeadingKey, string[]>();
  let active: string[] | null = null;
  let fence: string | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      active?.push(line);
      continue;
    }
    if (fence === null) {
      const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const key = heading[1].length <= 3 ? headingKey(heading[2]) : null;
        if (key && !result.has(key)) {
          active = [];
          result.set(key, active);
        } else {
          active = null;
        }
        continue;
      }
    }
    active?.push(line);
  }
  return result;
}

export function parseObjectiveBrief(text: string): ObjectiveBriefParsed {
  const found = sections(text);
  const scalar = (key: HeadingKey) => {
    const lines = found.get(key);
    return lines ? firstParagraph(lines) : null;
  };
  const unknownLines = found.get("unknowns");
  let unknowns: string[] = [];
  if (unknownLines) {
    const items = listItems(unknownLines);
    if (items) unknowns = items;
    else {
      const prose = firstParagraph(unknownLines);
      unknowns = prose ? [cut(prose, OBJECTIVE_BRIEF_UNKNOWN_MAX_CHARS)] : [];
    }
  }
  return {
    outcome: scalar("outcome"),
    fit: scalar("fit"),
    unknowns,
    nextStep: scalar("nextStep"),
    success: scalar("success"),
  };
}

/**
 * Mention tokens in order of first appearance, deduplicated by token.
 *
 * `#<slug>` is part of the grammar for every file so that a mistaken `@BRAND.md#voice` is reported
 * as an unresolved mention rather than silently widened to the whole file.
 */
export function extractObjectiveMentions(text: string): ObjectiveBriefMentionToken[] {
  const seen = new Set<string>();
  const mentions: ObjectiveBriefMentionToken[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    mentions.push({
      raw,
      path: `${match[1]}.md` as ObjectiveMentionFile,
      anchor: match[2] ?? null,
    });
  }
  return mentions;
}

/** The skeleton the run dialog prefills. Exported so the dialog and tests agree on it. */
export const OBJECTIVE_BRIEF_TEMPLATE = [
  "## Outcome",
  "",
  "",
  "## Fit",
  "",
  "",
  "## Unknowns",
  "",
  "- ",
  "",
  "## Next step",
  "",
  "",
  "## Success",
  "",
].join("\n");
