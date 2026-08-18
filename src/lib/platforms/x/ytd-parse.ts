/**
 * Parsers for X (Twitter) data archive `data/*.js` files.
 *
 * Archive data files are not plain JSON — each one assigns a JSON array to a
 * YTD ("Your Twitter Data") window global:
 *
 *   window.YTD.tweets.part0 = [ { "tweet": { ... } }, ... ]
 *
 * Multi-part exports split large slices across `part0`, `part1`, … files.
 */

const YTD_PREFIX_RE = /^\uFEFF?\s*window\.YTD\.([A-Za-z0-9_]+)\.part(\d+)\s*=\s*/;

/**
 * Strip the `window.YTD.<slice>.part<N> =` prefix and parse the JSON array.
 * Throws with a user-facing message when the file is not a YTD data file.
 */
export function parseYtdArray(text: string): unknown[] {
  const match = YTD_PREFIX_RE.exec(text);
  if (!match) {
    throw new Error("Not an X archive data file (missing window.YTD prefix)");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(match[0].length));
  } catch {
    throw new Error("Invalid JSON in X archive data file");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("X archive data file did not contain a JSON array");
  }

  return parsed;
}

const LEGACY_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// e.g. "Wed Oct 10 20:19:24 +0000 2018" — the legacy format used by tweets.js
const LEGACY_DATE_RE =
  /^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\d{4})$/;

/**
 * Convert an archive timestamp to ISO 8601. Archive tweets use the legacy
 * "Wed Oct 10 20:19:24 +0000 2018" format; account.js uses ISO already.
 * Returns null when the value can't be parsed.
 */
export function archiveDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;

  const legacy = LEGACY_DATE_RE.exec(value);
  if (legacy) {
    const [, mon, day, time, offset, year] = legacy;
    const month = LEGACY_MONTHS[mon];
    if (!month) return null;
    const iso = `${year}-${month}-${day.padStart(2, "0")}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`;
    const ms = Date.parse(iso);
    return isNaN(ms) ? null : new Date(ms).toISOString();
  }

  const ms = Date.parse(value);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}
