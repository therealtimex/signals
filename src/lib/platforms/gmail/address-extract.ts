export type ParsedMailAddress = {
  email: string;
  displayName: string | null;
};

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;
  return trimmed;
}

/** Parse a single RFC-like address string ("Name <email@example.com>"). */
export function parseMailAddress(value: string): ParsedMailAddress | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angle = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (angle) {
    const email = normalizeEmail(angle[2] ?? "");
    if (!email) return null;
    const displayName = angle[1]?.replace(/^"|"$/g, "").trim() || null;
    return { email, displayName: displayName || null };
  }

  const email = normalizeEmail(trimmed);
  if (!email) return null;
  return { email, displayName: null };
}

function collectAddrs(value: unknown, out: ParsedMailAddress[]): void {
  if (!value) return;

  if (typeof value === "string") {
    const parsed = parseMailAddress(value);
    if (parsed) out.push(parsed);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAddrs(item, out);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const addrs = record.addrs ?? record.addresses ?? record.addr;
    if (Array.isArray(addrs)) {
      for (const addr of addrs) {
        if (typeof addr === "string") {
          const parsed = parseMailAddress(addr);
          if (parsed) {
            const name =
              typeof record.name === "string" && record.name.trim()
                ? record.name.trim()
                : parsed.displayName;
            out.push({ email: parsed.email, displayName: name });
          }
        }
      }
      return;
    }

    if (typeof record.email === "string") {
      const parsed = parseMailAddress(record.email);
      if (parsed) {
        const name =
          typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : parsed.displayName;
        out.push({ email: parsed.email, displayName: name });
      }
    }
  }
}

/** Extract unique addresses from Himalaya envelope header fields. */
export function extractEnvelopeAddresses(envelope: Record<string, unknown>): ParsedMailAddress[] {
  const collected: ParsedMailAddress[] = [];
  for (const key of ["from", "to", "cc", "bcc", "reply_to", "reply-to"]) {
    collectAddrs(envelope[key], collected);
  }

  const byEmail = new Map<string, ParsedMailAddress>();
  for (const addr of collected) {
    const existing = byEmail.get(addr.email);
    if (!existing) {
      byEmail.set(addr.email, addr);
      continue;
    }
    if (!existing.displayName && addr.displayName) {
      byEmail.set(addr.email, addr);
    }
  }

  return [...byEmail.values()];
}

export function parseEnvelopeTimestamp(envelope: Record<string, unknown>): number | null {
  const raw =
    envelope.date ??
    envelope.received_at ??
    envelope.receivedAt ??
    envelope.internal_date ??
    envelope.internalDate;

  if (typeof raw === "number") {
    return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : raw;
  }

  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return null;
}
