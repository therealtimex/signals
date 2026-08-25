import { resolveRtxApiBase, stripTrailingSlash, type EnvLike } from "@/lib/rtx/env";

export const SIGNALS_ORCHESTRATOR_WEBHOOK_SLUG = "signals-orchestrator";

/**
 * RealTimeX CLI bases end with `/cli`; webhook ingress is served from the parent server origin.
 */
export function resolveRtxServerOrigin(env: EnvLike = process.env): string | null {
  const apiBase = resolveRtxApiBase(env);
  if (!apiBase) return null;

  if (apiBase.endsWith("/cli")) {
    return stripTrailingSlash(apiBase.slice(0, -"/cli".length));
  }

  return apiBase;
}

export function buildSignalsOrchestratorWebhookIngressUrl(
  env: EnvLike = process.env
): string | null {
  const origin = resolveRtxServerOrigin(env);
  if (!origin) return null;

  const slug =
    env.SIGNALS_ORCHESTRATOR_WEBHOOK_SLUG?.trim() || SIGNALS_ORCHESTRATOR_WEBHOOK_SLUG;

  return `${origin}/api/v1/webhook-ingress/inbound/${encodeURIComponent(slug)}`;
}

/**
 * Resolve the outbound workflow webhook destination.
 * Explicit env overrides win; otherwise agentic routing uses the active RTX ingress URL.
 */
export function resolveOutboundWorkflowWebhookUrl(
  env: EnvLike = process.env,
  options?: { agenticRouter?: boolean }
): string | undefined {
  const explicit =
    env.REALTIMEX_WEBHOOK_URL?.trim() || env.SIGNALS_WEBHOOK_URL?.trim();
  if (explicit) return explicit;

  if (!options?.agenticRouter) return undefined;

  return buildSignalsOrchestratorWebhookIngressUrl(env) ?? undefined;
}
