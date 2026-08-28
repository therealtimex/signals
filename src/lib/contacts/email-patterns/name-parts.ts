const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "dame"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);
const SURNAME_PARTICLES = new Set([
  "van", "von", "der", "den", "de", "da", "del", "della", "di", "la", "le", "du",
  "dos", "das", "bin", "al", "el", "ter", "ten", "mac", "mc", "st",
]);

export type NamePartsResult =
  | {
      ok: true;
      first: string;
      last: string;
      firstIsInitial: boolean;
      ambiguous: string[];
      particlesJoined: boolean;
    }
  | { ok: false; reason: "single_token" | "non_latin" | "empty" };

function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/-/g, "")
    .replace(/[^a-z]/g, "");
}

export function deriveNameParts(input: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): NamePartsResult {
  if (input.firstName?.trim() && input.lastName?.trim()) {
    const first = normalizeToken(input.firstName);
    const last = normalizeToken(input.lastName);
    if (!first || !last) return { ok: false, reason: "non_latin" };
    return {
      ok: true,
      first,
      last,
      firstIsInitial: first.length === 1,
      ambiguous: [],
      particlesJoined: /\s/.test(input.lastName.trim()),
    };
  }

  const raw = input.name?.trim() ?? "";
  if (!raw) return { ok: false, reason: "empty" };
  const normalized = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (/[^\x00-\x7F]/.test(normalized)) return { ok: false, reason: "non_latin" };
  let tokens = normalized
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/(?<=\p{L})-(?=\p{L})/gu, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (HONORIFICS.has(tokens[0] ?? "")) tokens = tokens.slice(1);
  if (SUFFIXES.has(tokens.at(-1) ?? "")) tokens = tokens.slice(0, -1);
  if (tokens.length < 2) return { ok: false, reason: tokens.length ? "single_token" : "empty" };

  const first = tokens[0]!;
  let surnameStart = tokens.length - 1;
  while (surnameStart > 1 && SURNAME_PARTICLES.has(tokens[surnameStart - 1]!)) surnameStart--;
  const surnameTokens = tokens.slice(surnameStart);
  return {
    ok: true,
    first,
    last: surnameTokens.join(""),
    firstIsInitial: first.length === 1,
    ambiguous: tokens.slice(1, surnameStart),
    particlesJoined: surnameTokens.length > 1,
  };
}
