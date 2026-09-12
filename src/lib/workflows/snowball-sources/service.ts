import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import type { EnvLike } from "@/lib/rtx/env";
import { describeGuestBoundary } from "@/lib/workflows/event-sources/boundary";
import {
  extractLumaCalendarFromHtml,
  extractLumaEventFromHtml,
  hasLumaCalendarPageMetadata,
} from "@/lib/workflows/event-sources/providers/luma";
import {
  ingestNetworkSnowballEventSource,
  type PublicEventSourceResult,
} from "@/lib/workflows/event-sources/service";
import type {
  EventParticipantAccessConfig,
  EventSource,
  EventTraversalPolicy,
} from "@/lib/workflows/event-sources/types";
import { extractPublicSnowballSource } from "@/lib/workflows/snowball-sources/extract";
import {
  fetchPublicSnowballSource,
  type PublicSourceTransport,
} from "@/lib/workflows/snowball-sources/public-fetch";
import { upsertPublicSnowballSource } from "@/lib/workflows/snowball-sources/repository";
import type {
  PublicSnowballSourceEnvelope,
  SnowballSourcePreparation,
  SnowballSourcePreview,
} from "@/lib/workflows/snowball-sources/types";
import {
  refineSnowballSource,
  resolveSnowballSourceUrl,
  sourceAccessPlan,
} from "@/lib/workflows/snowball-sources/url";

export const SNOWBALL_SOURCE_RESULT_KEY = "source";
export const SNOWBALL_SOURCE_RUNTIME_RESULT_KEY = "sourceRuntime";
export const SNOWBALL_RESOLVED_SOURCE_CONFIG_KEY = "_resolvedSnowballSource";
export const SNOWBALL_SOURCE_ACCESS_CONFIG_KEY = "_snowballSourceAccess";

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function lumaEnvelope(
  resolvedRoot: NonNullable<PublicEventSourceResult["resolvedRoot"]>,
  events: EventSource[],
): PublicSnowballSourceEnvelope {
  const root = resolvedRoot.kind === "event"
    ? events.find((event) => event.canonicalUrl === resolvedRoot.canonicalUrl) ?? events[0]
    : undefined;
  const title = resolvedRoot.title || root?.title || new URL(resolvedRoot.canonicalUrl).hostname;
  const facts: PublicSnowballSourceEnvelope["facts"] = [];
  if (resolvedRoot.kind === "calendar") {
    facts.push({ label: "listed events", value: String(events.length) });
  }
  if (root?.startsAt) facts.push({ label: "starts", value: root.startsAt });
  if (root?.location) facts.push({ label: "location", value: root.location });
  if (root) facts.push({ label: "guest access", value: describeGuestBoundary(root.guestBoundary) });
  for (const party of root?.parties ?? []) {
    if (facts.length >= 12) break;
    facts.push({ label: party.role.replaceAll("_", " "), value: party.name });
  }
  const links = [...new Map(
    [
      ...(resolvedRoot.kind === "calendar"
        ? events.map((event) => ({ label: event.title, url: event.canonicalUrl }))
        : []),
      ...(root?.parties ?? []).flatMap((party) => [party.url, ...(party.identityUrls ?? [])]
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ label: party.name, url }))),
    ].map((link) => [link.url, link] as const),
  ).values()].slice(0, 20);
  return {
    version: 1,
    canonicalUrl: resolvedRoot.canonicalUrl,
    title,
    provider: "luma",
    kind: resolvedRoot.kind,
    observedAt: root?.observedAt ?? Math.floor(Date.now() / 1000),
    extractor: "signals:luma-event-source:v1",
    scope: "public",
    facts,
    links,
  };
}

function persistPreparation(runId: string, preparation: SnowballSourcePreparation): void {
  const run = getWorkflowRun(runId);
  if (!run) return;
  const storedPreparation = { ...preparation };
  // The report capability is returned only to the launch caller. It is not public source evidence
  // and must never enter the run result, terminal brief, or completion merge surface.
  delete storedPreparation.eventReportCapability;
  updateWorkflowRun(runId, {
    result: JSON.stringify({
      ...parseObject(run.result),
      [SNOWBALL_SOURCE_RESULT_KEY]: storedPreparation,
    }),
  });
}

function sourceRequestCount(runId: string, canonicalSeedUrl: string): number {
  const stored = parseObject(getWorkflowRun(runId)?.result);
  const checkpoint = stored[SNOWBALL_SOURCE_RUNTIME_RESULT_KEY];
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return 0;
  const record = checkpoint as Record<string, unknown>;
  return record.canonicalSeedUrl === canonicalSeedUrl && typeof record.requestsUsed === "number"
    ? Math.max(0, Math.floor(record.requestsUsed))
    : 0;
}

function createDurableSourceRequestBudget(input: {
  runId: string;
  canonicalSeedUrl: string;
  maxRequests: number;
}) {
  let requestsUsed = sourceRequestCount(input.runId, input.canonicalSeedUrl);
  const consume = (requestUrl: string): boolean => {
    if (requestsUsed >= input.maxRequests) return false;
    requestsUsed += 1;
    const run = getWorkflowRun(input.runId);
    if (run) {
      updateWorkflowRun(input.runId, {
        result: JSON.stringify({
          ...parseObject(run.result),
          [SNOWBALL_SOURCE_RUNTIME_RESULT_KEY]: {
            version: 1,
            canonicalSeedUrl: input.canonicalSeedUrl,
            requestsUsed,
            lastRequestUrl: resolveSnowballSourceUrl(requestUrl)?.canonicalUrl
              ?? input.canonicalSeedUrl,
          },
        }),
      });
    }
    return true;
  };
  return { consume };
}

export function removeServerOwnedSnowballSourceResult(result: Record<string, unknown>): void {
  delete result[SNOWBALL_SOURCE_RESULT_KEY];
  delete result[SNOWBALL_SOURCE_RUNTIME_RESULT_KEY];
}

export function removeCallerOwnedSnowballSourceDescriptors(config: Record<string, unknown>): void {
  delete config.resolvedSource;
  delete config.sourceAccessPlan;
  delete config[SNOWBALL_RESOLVED_SOURCE_CONFIG_KEY];
  delete config[SNOWBALL_SOURCE_ACCESS_CONFIG_KEY];
}

export async function previewSnowballSource(input: {
  seedUrl: string;
  signedInRequested?: boolean;
  transport?: PublicSourceTransport;
  signal?: AbortSignal;
}): Promise<SnowballSourcePreview> {
  const source = resolveSnowballSourceUrl(input.seedUrl);
  if (!source) throw new Error("Enter a public HTTPS source link without credentials or a custom port.");
  const transport = input.transport ?? fetchPublicSnowballSource;
  try {
    const response = await transport(source.canonicalUrl, {
      maxRedirects: 2,
      maxBytes: 512 * 1024,
      timeoutMs: 10_000,
      signal: input.signal,
    });
    const finalSource = resolveSnowballSourceUrl(response.url) ?? source;
    let classifiedSource = finalSource;
    if (finalSource.provider === "luma") {
      if (hasLumaCalendarPageMetadata({ url: response.url, html: response.body })) {
        classifiedSource = refineSnowballSource(finalSource, "calendar", "metadata", "high");
      } else {
        try {
          extractLumaEventFromHtml({ url: response.url, html: response.body });
          classifiedSource = refineSnowballSource(finalSource, "event", "metadata", "high");
        } catch {
          try {
            extractLumaCalendarFromHtml({ url: response.url, html: response.body });
            classifiedSource = refineSnowballSource(finalSource, "calendar", "metadata", "high");
          } catch {
            // Keep the conservative URL classification; launch retries with the full adapter.
          }
        }
      }
    }
    const extracted = extractPublicSnowballSource({
      source: classifiedSource,
      finalUrl: response.url,
      html: response.body,
    });
    return {
      resolvedSource: extracted.resolvedSource,
      accessPlan: sourceAccessPlan(extracted.resolvedSource, input.signedInRequested === true),
      publicSource: extracted.envelope,
      errors: [],
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    // Classification still gives the operator an actionable public-only preview. The launch path
    // records the bounded read failure separately instead of making UI preview availability a gate.
    return {
      resolvedSource: source,
      accessPlan: sourceAccessPlan(source, input.signedInRequested === true),
      publicSource: null,
      errors: ["Public preview is unavailable; Signals will retry safely at launch."],
    };
  }
}

export async function prepareNetworkSnowballSource(input: {
  runId: string;
  ownerWorkspace: string;
  seedUrl: string;
  traversal: EventTraversalPolicy;
  participantAccess: EventParticipantAccessConfig;
  writeGraphEdges?: boolean;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  transport?: PublicSourceTransport;
  env?: EnvLike;
}): Promise<SnowballSourcePreparation | null> {
  const initialSource = resolveSnowballSourceUrl(input.seedUrl);
  if (!initialSource) return null;
  const prepareLuma = async (
    source: NonNullable<ReturnType<typeof resolveSnowballSourceUrl>>,
    options: {
      allowSignedIn: boolean;
      traversal: EventTraversalPolicy;
      beforeProviderRequest?: (url: string) => boolean | Promise<boolean>;
    },
  ): Promise<SnowballSourcePreparation | null> => {
    const ingestion = await ingestNetworkSnowballEventSource({
      runId: input.runId,
      ownerWorkspace: input.ownerWorkspace,
      seedUrl: source.canonicalUrl,
      traversal: options.traversal,
      participantAccess: options.allowSignedIn && source.capabilities.signedInRead
        ? input.participantAccess
        : { enabled: false, browserSessionName: input.participantAccess.browserSessionName },
      writeGraphEdges: input.writeGraphEdges,
      fetchImpl: input.fetchImpl,
      sleepImpl: input.sleepImpl,
      env: input.env,
      rootKind: source.kind === "calendar" ? "calendar" : "event",
      beforeProviderRequest: options.beforeProviderRequest,
    });
    if (!ingestion) return null;
    const rootEvent = ingestion.publicResult.events.find(
      (event) => event.key === ingestion.publicResult.rootEventKey,
    );
    const resolvedRoot = ingestion.publicResult.resolvedRoot ?? {
      canonicalUrl: rootEvent?.canonicalUrl ?? source.canonicalUrl,
      kind: source.kind === "calendar" ? "calendar" as const : "event" as const,
      title: rootEvent?.title ?? new URL(source.canonicalUrl).hostname,
    };
    const rootSource = resolveSnowballSourceUrl(resolvedRoot.canonicalUrl) ?? source;
    const resolvedSource = refineSnowballSource(
      rootSource,
      resolvedRoot.kind,
      "metadata",
      "high",
    );
    let accessPlan = sourceAccessPlan(
      resolvedSource,
      options.allowSignedIn && input.participantAccess.enabled,
    );
    if (
      input.participantAccess.enabled
      && !options.allowSignedIn
      && resolvedSource.capabilities.signedInRead
    ) {
      accessPlan = {
        ...accessPlan,
        signedInRequested: true,
        reason: "The source redirected to a signed-in capable provider. Renew consent for the resolved link to use registered access.",
      };
    }
    return {
      resolvedSource,
      accessPlan,
      publicSource: lumaEnvelope(resolvedRoot, ingestion.publicResult.events),
      contentItemIds: ingestion.publicResult.contentItemIds,
      errors: ingestion.publicResult.errors,
      partial: ingestion.publicResult.partial,
      lumaContext: {
        canonicalSeedUrl: ingestion.publicResult.canonicalSeedUrl,
        resolvedRoot,
        events: ingestion.publicResult.events,
      },
      ...(ingestion.eventReportCapability
        ? { eventReportCapability: ingestion.eventReportCapability }
        : {}),
    };
  };

  let preparation: SnowballSourcePreparation | null;
  if (initialSource.provider === "luma") {
    preparation = await prepareLuma(initialSource, {
      allowSignedIn: initialSource.kind === "event",
      traversal: input.traversal,
    });
  } else {
    const transport = input.transport ?? fetchPublicSnowballSource;
    const budget = createDurableSourceRequestBudget({
      runId: input.runId,
      canonicalSeedUrl: initialSource.canonicalUrl,
      maxRequests: input.traversal.maxProviderRequests,
    });
    try {
      const response = await transport(initialSource.canonicalUrl, {
        beforeRequest: budget.consume,
      });
      const finalSource = resolveSnowballSourceUrl(response.url) ?? initialSource;
      if (finalSource.provider === "luma") {
        preparation = await prepareLuma(finalSource, {
          allowSignedIn: false,
          traversal: input.traversal,
          beforeProviderRequest: budget.consume,
        });
      } else {
        const extracted = extractPublicSnowballSource({
          source: finalSource,
          finalUrl: response.url,
          html: response.body,
        });
        preparation = {
          resolvedSource: extracted.resolvedSource,
          accessPlan: sourceAccessPlan(extracted.resolvedSource, input.participantAccess.enabled),
          publicSource: extracted.envelope,
          contentItemIds: [upsertPublicSnowballSource(extracted.envelope)],
          errors: [],
          partial: false,
        };
      }
    } catch {
      preparation = {
        resolvedSource: initialSource,
        accessPlan: sourceAccessPlan(initialSource, input.participantAccess.enabled),
        publicSource: null,
        contentItemIds: [],
        errors: ["The public source could not be read within the safe request boundary."],
        partial: true,
      };
    }
  }
  if (!preparation) return null;
  persistPreparation(input.runId, preparation);
  return preparation;
}
