/**
 * Transforms raw workflow error strings into user-friendly messages.
 * Raw errors are preserved for debugging via `title` hover tooltips.
 *
 * Pattern ordering matters: prefix-anchored patterns (^Failed, ^Sync) come
 * before unanchored content patterns (Rate limited, No credentials) so that
 * composite messages like "Failed to enrich @user: Rate limited..." match
 * the outer wrapper first, with the inner message formatted recursively.
 */

export interface FormattedError {
  title: string;
  detail?: string;
  category: string;
}

function formatRetryDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (seconds >= 60) {
    const mins = Math.round(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

type PatternMatcher = {
  pattern: RegExp;
  category: string;
  format: (match: RegExpMatchArray) => FormattedError;
};

const PATTERNS: PatternMatcher[] = [
  // ── Prefix-anchored patterns (composite messages) ─────────────────

  {
    pattern: /^AGENT_ORCHESTRATION_UNAVAILABLE:/,
    category: "agent_orchestration",
    format: () => ({
      title: "Agent orchestration moved to RealTimeX",
      detail: "Run agents via terminal agents and /api/agent-tools (see docs/rtx-agent-orchestration.md).",
      category: "agent_orchestration",
    }),
  },

  // 1. Batch limit (enrichment) — "Batch limit reached after 15 profiles..."
  {
    pattern: /^Batch limit reached after (\d+)/,
    category: "batch_limit",
    format: (m) => ({
      title: `Batch limit reached (${m[1]} profiles processed)`,
      category: "batch_limit",
    }),
  },

  // 2. Batch limit (scraper) — "Batch limit of 15 profiles reached..."
  {
    pattern: /^Batch limit of (\d+) profiles reached/,
    category: "batch_limit",
    format: (m) => ({
      title: `Batch limit reached (${m[1]} profile max)`,
      category: "batch_limit",
    }),
  },

  // 3. Per-item @handle — "Failed to process @user: ..." or "Failed to enrich @user: ..."
  {
    pattern: /^Failed to (?:process|enrich) @(\S+): (.+)/,
    category: "item_error",
    format: (m) => {
      const inner = formatWorkflowError(m[2]);
      return {
        title: `Failed to process @${m[1]}`,
        detail: inner.title,
        category: "item_error",
      };
    },
  },

  // 4. Per-item with email context — "Failed to sync metadata for Name (email): ..."
  {
    pattern: /^Failed to sync metadata for ([^(]+)\([^)]+\): (.+)/,
    category: "item_error",
    format: (m) => {
      const inner = formatWorkflowError(m[2]);
      return {
        title: `Failed to sync metadata for ${m[1].trim()}`,
        detail: inner.title,
        category: "item_error",
      };
    },
  },

  // 5. Per-item tweet/mention — "Failed to process tweet 123: ..." (before generic name)
  {
    pattern: /^Failed to process (tweet|mention) (\S+): (.+)/,
    category: "item_error",
    format: (m) => {
      const inner = formatWorkflowError(m[3]);
      return {
        title: `Failed to process ${m[1]}`,
        detail: inner.title,
        category: "item_error",
      };
    },
  },

  // 6. Per-item name — "Failed to process Name: ..." (catch-all for Failed to process)
  {
    pattern: /^Failed to process ([^:]+): (.+)/,
    category: "item_error",
    format: (m) => {
      const inner = formatWorkflowError(m[2]);
      return {
        title: `Failed to process ${m[1].trim()}`,
        detail: inner.title,
        category: "item_error",
      };
    },
  },

  // 7. Sync wrapper — "Tweet sync failed: ..." / "Mention sync failed: ..." / etc.
  {
    pattern: /^(Tweet sync|Mention sync|Sync|Metadata sync|Profile enrichment) failed: (.+)/,
    category: "sync_error",
    format: (m) => {
      const inner = formatWorkflowError(m[2]);
      return {
        title: `${m[1]} encountered an error`,
        detail: inner.title,
        category: "sync_error",
      };
    },
  },

  // ── Unanchored content patterns (standalone or inner messages) ────

  // 8. Rate limit — "Rate limited on /users/:id/tweets?... Retry after 899s"
  {
    pattern: /Rate limited on .+\. Retry after (\d+)s/,
    category: "rate_limit",
    format: (m) => ({
      title: `Rate limited — try again in ${formatRetryDuration(parseInt(m[1], 10))}`,
      category: "rate_limit",
    }),
  },

  // 9. X API tier restriction
  {
    pattern: /requires a higher X API tier/,
    category: "tier",
    format: () => ({
      title: "X API tier too low for this feature",
      category: "tier",
    }),
  },

  // 10. Challenge/CAPTCHA detection
  {
    pattern: /Challenge\/CAPTCHA|challenge detection/i,
    category: "challenge",
    format: () => ({
      title: "CAPTCHA or verification detected",
      category: "challenge",
    }),
  },

  // 11. Browser session expired
  {
    pattern: /browser session is invalid or expired/,
    category: "session",
    format: () => ({
      title: "Browser session expired — re-authenticate in Settings",
      category: "session",
    }),
  },

  // 12. No credentials
  {
    pattern: /No credentials found/,
    category: "credentials",
    format: () => ({
      title: "Account not connected",
      category: "credentials",
    }),
  },

  // 13. Network errors
  {
    pattern: /fetch failed|ECONNREFUSED|ETIMEDOUT|timeout/i,
    category: "network",
    format: () => ({
      title: "Network error — check your connection",
      category: "network",
    }),
  },
];

/**
 * Converts a raw error string into a user-friendly message.
 * First matching pattern wins. Unknown errors are truncated to 80 chars.
 */
export function formatWorkflowError(raw: string): FormattedError {
  for (const { pattern, format } of PATTERNS) {
    const match = raw.match(pattern);
    if (match) return format(match);
  }

  // Fallback: truncate to 80 chars
  return {
    title: raw.length > 80 ? raw.slice(0, 77) + "..." : raw,
    category: "unknown",
  };
}
