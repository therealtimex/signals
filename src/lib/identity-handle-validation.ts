/**
 * Per-platform checks on the account values an agent writes onto a contact identity (#569).
 *
 * Every rule lives here, and signals-pp-cli mirrors it in
 * `tools/signals-pp-cli/transcendence/import_handles.go`. The cases both sides must agree on
 * are in that package's `handle_cases_test.go`, and `identity-handle-validation.test.ts` runs them
 * against this module too, so the two implementations can't drift.
 *
 * There are two kinds of rule:
 *
 * - **Hard rules** reject what is provably wrong, and nothing opts out of them.
 *   - `foreign_url`: the value is a URL on another platform's host, e.g. `linkedin.com/in/…` in an
 *     X field. The check applies to every field and every platform.
 *   - `syntax`: the value breaks the platform's account syntax. Only platforms whose syntax is
 *     well defined and stable have one (see STRICT_HANDLE_SYNTAX). Elsewhere (LinkedIn vanity
 *     names, Substack and Bluesky custom domains, phone numbers) only the other rules apply.
 * - **Heuristic rules** catch what is almost always junk but can be a real account. `x`, `hi`
 *   and `v` are valid X handles. They are skipped with `allowUnusualHandle: true`.
 *   - `too_short`: two characters or fewer, unless all digits (numeric account IDs such as X's
 *     `12`).
 *   - `placeholder`: a short list of words people type into a profile field instead of an
 *     account (PLACEHOLDER_HANDLES).
 *
 * The checks apply to values a write introduces. An identity already stored keeps working: it
 * can be read, updated in place and removed even if its values would fail today.
 */
import type { Platform } from "@/lib/db/platforms";

export type IdentityValueField = "platformUserId" | "platformHandle" | "platformUrl";
export type IdentityValueRule = "foreign_url" | "syntax" | "too_short" | "placeholder";

export type IdentityValueViolation = {
  platform: string;
  field: IdentityValueField;
  value: string;
  rule: IdentityValueRule;
  /** True for rules `allowUnusualHandle: true` skips. */
  heuristic: boolean;
  message: string;
};

/** Hosts a profile URL on each platform can use. A URL on one of these is that platform's. */
export const IDENTITY_PLATFORM_HOSTS: Record<Platform, readonly string[]> = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com", "lnkd.in"],
  gmail: ["mail.google.com"],
  substack: ["substack.com"],
  instagram: ["instagram.com", "instagr.am"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  threads: ["threads.net", "threads.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  bluesky: ["bsky.app"],
  telegram: ["t.me", "telegram.me"],
  whatsapp: ["wa.me", "whatsapp.com"],
};

type HandleSyntax = {
  /** A handle, and a platformUserId given as a handle. */
  handle: RegExp;
  /** A platformUserId may also be a numeric account ID. */
  numericId?: RegExp;
  rule: string;
};

/** Platforms whose account syntax is fixed and documented. */
export const STRICT_HANDLE_SYNTAX: Partial<Record<Platform, HandleSyntax>> = {
  x: {
    handle: /^[A-Za-z0-9_]{1,15}$/,
    numericId: /^[0-9]{1,20}$/,
    rule: "X handles are 1–15 letters, digits or underscores (or a numeric account ID)",
  },
  instagram: {
    handle: /^[A-Za-z0-9._]{1,30}$/,
    rule: "Instagram usernames are 1–30 letters, digits, periods or underscores",
  },
  threads: {
    handle: /^[A-Za-z0-9._]{1,30}$/,
    rule: "Threads usernames are 1–30 letters, digits, periods or underscores",
  },
  tiktok: {
    handle: /^[A-Za-z0-9._]{1,24}$/,
    numericId: /^[0-9]{1,20}$/,
    rule: "TikTok usernames are 1–24 letters, digits, periods or underscores (or a numeric account ID)",
  },
};

/** Values of this length or shorter are `too_short` unless all digits. */
export const SHORT_HANDLE_MAX_LENGTH = 2;

/**
 * Words people type into a profile field instead of an account, compared case-insensitively
 * after trimming and dropping a leading `@`. Keep this list short. Each entry has to be junk
 * far more often than a real account, because it rejects (overridably) on every platform.
 * Values of two characters or fewer are already `too_short`, so they aren't listed.
 */
export const PLACEHOLDER_HANDLES: readonly string[] = [
  "none",
  "null",
  "nil",
  "n/a",
  "nope",
  "unknown",
  "notwitter",
  "nolinkedin",
  "noinstagram",
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
];

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  bluesky: "Bluesky",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

// A URL: a scheme, or a host followed by a path. A bare domain is not one, because Bluesky
// handles and Substack custom domains are bare domains.
const URL_SHAPE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::[0-9]+)?([/?#].*)?$/i;

type ParsedUrl = { host: string; path: string };

function parseUrlShape(value: string): ParsedUrl | null {
  const match = URL_SHAPE.exec(value);
  if (!match) return null;
  const [, scheme, host, rest] = match;
  if (!scheme && !rest) return null;
  return { host: host.toLowerCase(), path: rest ?? "" };
}

function hostPlatform(host: string): Platform | null {
  for (const [platform, hosts] of Object.entries(IDENTITY_PLATFORM_HOSTS) as Array<
    [Platform, readonly string[]]
  >) {
    if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return platform;
    }
  }
  return null;
}

/** The value the checks see: trimmed, with any leading `@` dropped. */
export function normalizeIdentityValueForCheck(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

/**
 * Check one value. Returns null when it passes. Empty values pass: requiring a value is the
 * schema's job.
 */
export function checkIdentityValue(
  platform: string,
  field: IdentityValueField,
  raw: string,
  options: { allowUnusualHandle?: boolean } = {},
): IdentityValueViolation | null {
  const value = normalizeIdentityValueForCheck(raw);
  if (!value) return null;
  const label = platformLabel(platform);
  const violation = (rule: IdentityValueRule, heuristic: boolean, why: string): IdentityValueViolation => ({
    platform,
    field,
    value: raw,
    rule,
    heuristic,
    message:
      `${label} ${field} ${JSON.stringify(raw)} was rejected (rule: ${rule}): ${why}` +
      (heuristic
        ? ". If this really is the account, retry with allowUnusualHandle: true."
        : "."),
  });

  const url = parseUrlShape(value);
  const urlPlatform = url ? hostPlatform(url.host) : null;
  if (urlPlatform && urlPlatform !== platform) {
    return violation(
      "foreign_url",
      false,
      `it is a ${platformLabel(urlPlatform)} URL, not an account on ${label}; put it on a ${platformLabel(urlPlatform)} identity`,
    );
  }
  if (field === "platformUrl") return null;

  const syntax = STRICT_HANDLE_SYNTAX[platform as Platform];
  if (syntax) {
    const valid =
      syntax.handle.test(value) ||
      (field === "platformUserId" && syntax.numericId !== undefined && syntax.numericId.test(value));
    if (!valid) {
      const segment = url && urlPlatform === platform
        ? url.path.split(/[/?#]/).find((part) => part.length > 0)?.replace(/^@+/, "")
        : undefined;
      const hint = segment && syntax.handle.test(segment)
        ? `; pass the bare handle ${JSON.stringify(segment)}, not the profile URL`
        : "";
      return violation("syntax", false, `${syntax.rule}${hint}`);
    }
  }

  if (options.allowUnusualHandle) return null;
  if ([...value].length <= SHORT_HANDLE_MAX_LENGTH && !/^[0-9]+$/.test(value)) {
    return violation(
      "too_short",
      true,
      `${SHORT_HANDLE_MAX_LENGTH} characters or fewer is almost always a placeholder or a fragment of a pasted URL`,
    );
  }
  if (PLACEHOLDER_HANDLES.includes(value.toLowerCase())) {
    return violation("placeholder", true, "it reads as a placeholder, not an account");
  }
  return null;
}
