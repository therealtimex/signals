import { nanoid } from "nanoid";

export const WRITING_ID_PREFIXES = [
  "spn",
  "clm",
  "src",
  "aud",
  "vp",
  "vs",
  "prp",
  "wint",
  "pb",
  "pm",
] as const;
export type WritingIdPrefix = (typeof WRITING_ID_PREFIXES)[number];

export function newWritingId(prefix: WritingIdPrefix): string {
  return `${prefix}_${nanoid()}`;
}

export function isWritingId(prefix: WritingIdPrefix, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_-]{6,}$`).test(value);
}

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SURFACE = "[a-z0-9]+(?:_[a-z0-9]+)*";

export function parseRuleId(value: string): string | null {
  return new RegExp(`^(?:core/(?:hard|claim|voice|heuristic|aesthetic)/${SLUG}|[a-z]+/${SURFACE}/(?:hard|claim|voice|heuristic|aesthetic)/${SLUG})$`).test(value)
    ? value
    : null;
}

export function parseFormulaId(value: string): string | null {
  return new RegExp(`^(?:core/${SLUG}|[a-z]+/${SURFACE}/${SLUG})@[1-9][0-9]*$`).test(value)
    ? value
    : null;
}

export function parseOverlayId(value: string): { platform: string; version: number } | null {
  const match = /^overlay:([a-z]+)@([1-9][0-9]*)$/.exec(value);
  return match ? { platform: match[1], version: Number(match[2]) } : null;
}
