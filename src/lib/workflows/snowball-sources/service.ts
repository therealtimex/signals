import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import type { EnvLike } from "@/lib/rtx/env";
import { describeGuestBoundary } from "@/lib/workflows/event-sources/boundary";
import {
  extractLumaCalendarFromHtml,
  extractLumaEventFromHtml,
  hasLumaCalendarPageMetadata,
} from "@/lib/workflows/event-sources/providers/luma";
import { ingestNetworkSnowballEventSource } from "@/lib/workflows/event-sources/service";
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
  canonicalUrl: string,
  events: EventSource[],
): PublicSnowballSourceEnvelope {
  const root = events.find((event) => event.canonicalUrl === canonicalUrl) ?? events[0];
  const title = root?.title ?? new URL(canonicalUrl).hostname;
  const facts: PublicSnowballSourceEnvelope["facts"] = [];
  if (root?.startsAt) facts.push({ label: "starts", value: root.startsAt });
  if (root?.location) facts.push({ label: "location", value: root.location });
  if (root) facts.push({ label: "guest access", value: describeGuestBoundary(root.guestBoundary) });
  for (const party of root?.parties ?? []) {
    if (facts.length >= 12) break;
    facts.push({ label: party.role.replaceAll("_", " "), value: party.name });
  }
  const links = [...new Map(
    (root?.parties ?? []).flatMap((party) => [party.url, ...(party.identityUrls ?? [])]
      .filter((url): url is string => Boolean(url))
      .map((url) => [url, { label: party.name, url }] as const)),
  ).values()].slice(0, 20);
  return {
    version: 1,
    canonicalUrl,
    title,
    provider: "luma",
    kind: "event",
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

export function removeServerOwnedSnowballSourceResult(result: Record<string, unknown>): void {
  delete result[SNOWBALL_SOURCE_RESULT_KEY];
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
}): Promise<SnowballSourcePreview> {
  const source = resolveSnowballSourceUrl(input.seedUrl);
  if (!source) throw new Error("Enter a public HTTPS source link without credentials or a custom port.");
  const transport = input.transport ?? fetchPublicSnowballSource;
  try {
    const response = await transport(source.canonicalUrl, {
      maxRedirects: 2,
      maxBytes: 512 * 1024,
      timeoutMs: 10_000,
    });
    let classifiedSource = source;
    if (source.provider === "luma") {
      if (hasLumaCalendarPageMetadata({ url: response.url, html: response.body })) {
        classifiedSource = refineSnowballSource(source, "calendar", "metadata", "high");
      } else {
        try {
          extractLumaEventFromHtml({ url: response.url, html: response.body });
          classifiedSource = refineSnowballSource(source, "event", "metadata", "high");
        } catch {
          try {
            extractLumaCalendarFromHtml({ url: response.url, html: response.body });
            classifiedSource = refineSnowballSource(source, "calendar", "metadata", "high");
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
  } catch {
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
  let preparation: SnowballSourcePreparation;
  if (initialSource.provider === "luma") {
    const ingestion = await ingestNetworkSnowballEventSource({
      runId: input.runId,
      ownerWorkspace: input.ownerWorkspace,
      seedUrl: initialSource.canonicalUrl,
      traversal: input.traversal,
      participantAccess: initialSource.capabilities.signedInRead
        ? input.participantAccess
        : { enabled: false, browserSessionName: input.participantAccess.browserSessionName },
      writeGraphEdges: input.writeGraphEdges,
      fetchImpl: input.fetchImpl,
      sleepImpl: input.sleepImpl,
      env: input.env,
      rootKind: initialSource.kind === "calendar" ? "calendar" : "event",
    });
    if (!ingestion) return null;
    const isCalendar = !ingestion.publicResult.events.some(
      (event) => event.canonicalUrl === ingestion.publicResult.canonicalSeedUrl,
    );
    const resolvedSource = isCalendar
      ? refineSnowballSource(initialSource, "calendar", "metadata", "high")
      : initialSource;
    const publicSource = lumaEnvelope(initialSource.canonicalUrl, ingestion.publicResult.events);
    publicSource.kind = resolvedSource.kind;
    preparation = {
      resolvedSource,
      accessPlan: sourceAccessPlan(resolvedSource, input.participantAccess.enabled),
      publicSource,
      contentItemIds: ingestion.publicResult.contentItemIds,
      errors: ingestion.publicResult.errors,
      partial: ingestion.publicResult.partial,
      ...(ingestion.eventReportCapability
        ? { eventReportCapability: ingestion.eventReportCapability }
        : {}),
    };
  } else {
    const transport = input.transport ?? fetchPublicSnowballSource;
    try {
      const response = await transport(initialSource.canonicalUrl);
      const extracted = extractPublicSnowballSource({
        source: initialSource,
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
  persistPreparation(input.runId, preparation);
  return preparation;
}
