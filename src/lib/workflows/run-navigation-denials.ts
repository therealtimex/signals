import { normalizeAllowedOrigin } from "@/lib/browser/allowed-origins";
import {
  GUARDRAIL_ORIGIN_NOT_ALLOWED,
  parseNavigationDenial,
  RTX_NAVIGATION_BLOCKED,
  type RunNavigationDenial,
} from "@/lib/browser/navigation-blocked";
import {
  getBrowserConnectionById,
  getBrowserConnectionBySessionName,
  resolveTargetById,
} from "@/lib/db/queries/platform-targets";
import type { BrowserConnection } from "@/lib/db/types";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import { getContactWebResearchTargetFromRunConfig } from "@/lib/workflows/contact-web-research-target";
import { getNetworkSnowballTargetFromRunConfig } from "@/lib/workflows/network-snowball-target";

type RunLike = {
  config: string | null;
  errors: string | null;
  steps: { error: string | null; url: string | null }[];
};

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseErrorList(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function activeConnection(connection: BrowserConnection | undefined): BrowserConnection | null {
  return connection && connection.status === "active" ? connection : null;
}

function connectionForSession(sessionName: string): BrowserConnection | null {
  return activeConnection(getBrowserConnectionBySessionName(sessionName));
}

/**
 * The browser session a run's denial happened in, and its connection (ADR-547-15). The server
 * resolves it so the run page never guesses:
 *
 * 1. the session named inside an `RTX_NAVIGATION_BLOCKED:<json>` error;
 * 2. the session Signals prepared and bound to the run (`_snowballBrowserTarget`,
 *    `researchTarget`), which the run's agent is told to use and no other;
 * 3. a configured `browserSessionName` (top level or `participantAccess`) that isn't the default;
 * 4. a configured `targetId`, through its platform target's connection;
 * 5. a configured `browserSessionName` that is the default.
 *
 * A session without an active `browser_connections` row resolves to `connection: null`.
 */
export function resolveDenialSession(
  denialSessionName: string | null,
  configJson: string | null,
): { sessionName: string | null; connection: BrowserConnection | null } {
  if (denialSessionName) {
    return { sessionName: denialSessionName, connection: connectionForSession(denialSessionName) };
  }

  const prepared =
    getNetworkSnowballTargetFromRunConfig(configJson) ??
    getContactWebResearchTargetFromRunConfig(configJson);
  if (prepared) {
    return { sessionName: prepared.sessionName, connection: connectionForSession(prepared.sessionName) };
  }

  const config = parseObject(configJson);
  const participantAccess =
    config.participantAccess && typeof config.participantAccess === "object"
      ? (config.participantAccess as Record<string, unknown>)
      : {};
  const configured = text(config.browserSessionName) ?? text(participantAccess.browserSessionName);
  if (configured && configured !== RTX_PUBLISH_SESSION_NAME) {
    return { sessionName: configured, connection: connectionForSession(configured) };
  }

  const targetId = text(config.targetId);
  const target = targetId ? resolveTargetById(targetId) : undefined;
  const targetConnection = target ? activeConnection(getBrowserConnectionById(target.connectionId)) : null;
  if (targetConnection) {
    return { sessionName: targetConnection.sessionName, connection: targetConnection };
  }

  if (configured) {
    return { sessionName: configured, connection: connectionForSession(configured) };
  }
  return { sessionName: null, connection: null };
}

/**
 * Every distinct website a run was refused, from `run.errors` and step errors, with the
 * connection it can be allowed for. Recoverable only for `guardrail-origin-not-allowed` in a
 * session Signals manages; the run page shows its callout from these alone.
 */
export function resolveRunNavigationDenials(run: RunLike): RunNavigationDenial[] {
  const sources: { raw: string; stepUrl: string | null }[] = [
    ...parseErrorList(run.errors).map((raw) => ({ raw, stepUrl: null })),
    ...run.steps
      .filter((step): step is { error: string; url: string | null } => Boolean(step.error))
      .map((step) => ({ raw: step.error, stepUrl: step.url })),
  ];

  const denials = new Map<string, RunNavigationDenial>();
  for (const { raw, stepUrl } of sources) {
    const parsed = parseNavigationDenial(raw);
    if (!parsed) continue;

    const { sessionName, connection } = resolveDenialSession(parsed.sessionName, run.config);
    const stepOrigin = stepUrl ? normalizeAllowedOrigin(stepUrl) : null;
    const requestedUrl =
      parsed.requestedUrl ??
      (stepOrigin?.ok && stepOrigin.origin === parsed.deniedOrigin ? stepUrl : null);
    const key = `${connection?.id ?? sessionName ?? ""}|${parsed.deniedOrigin}`;

    const existing = denials.get(key);
    if (existing) {
      if (!existing.sources.includes(raw)) existing.sources.push(raw);
      existing.requestedUrl ??= requestedUrl;
      continue;
    }

    const recoverable = parsed.reason === GUARDRAIL_ORIGIN_NOT_ALLOWED && connection !== null;
    denials.set(key, {
      code: RTX_NAVIGATION_BLOCKED,
      reason: parsed.reason,
      action: parsed.action,
      sessionName: connection?.sessionName ?? sessionName,
      connectionId: connection?.id ?? null,
      deniedOrigin: parsed.deniedOrigin,
      requestedUrl,
      recoverable,
      recovery:
        recoverable && connection
          ? { kind: "allow_origin", connectionId: connection.id, origin: parsed.deniedOrigin }
          : null,
      sources: [raw],
    });
  }
  return [...denials.values()];
}
