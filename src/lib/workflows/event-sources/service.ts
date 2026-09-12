import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { getOrgByDomain } from "@/lib/db/queries/orgs";
import { observeAuthorizedLumaParticipants, EventBrowserError } from "@/lib/rtx/event-browser";
import type { EnvLike } from "@/lib/rtx/env";
import {
  mintEventAccessMaterial,
  persistAuthorizedEventObservations,
} from "@/lib/workflows/event-sources/access";
import { EVENT_PROVIDER_RUNTIME_POLICY } from "@/lib/workflows/event-sources/policy";
import {
  createLumaPublicEvidence,
  extractLumaCalendarFromHtml,
  extractLumaEventFromHtml,
} from "@/lib/workflows/event-sources/providers/luma";
import { upsertPublicEventSource } from "@/lib/workflows/event-sources/repository";
import { attachNetworkSnowballHop0Org } from "@/lib/workflows/network-snowball-hop0";
import type {
  EventParticipantAccessConfig,
  EventSource,
  EventTraversalPolicy,
  GuestBoundary,
} from "@/lib/workflows/event-sources/types";
import { canonicalizeLumaUrl, lumaEventKey } from "@/lib/workflows/event-sources/urls";

export const EVENT_SOURCE_RESULT_KEY = "eventSource";
export const EVENT_SOURCE_RUNTIME_RESULT_KEY = "eventSourceRuntime";

export type PublicEventSourceResult = {
  version: 1;
  provider: "luma";
  canonicalSeedUrl: string;
  rootEventKey: string;
  events: EventSource[];
  contentItemIds: string[];
  guestBoundary: GuestBoundary;
  partial: boolean;
  errors: string[];
  traversal: {
    requestsUsed: number;
    visitedUrls: number;
    truncated: boolean;
    stopReason: "complete" | "max_events" | "calendar_limit" | "request_budget" | "time_budget";
  };
};

export type EventSourceIngestionResult = {
  publicResult: PublicEventSourceResult;
  eventReportCapability?: {
    token: string;
    expiresAt: number;
    participantCount: number;
  };
};

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 30_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30_000);
  }
  return 1_000 * (attempt + 1);
}

async function readBoundedHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > EVENT_PROVIDER_RUNTIME_POLICY.maxHtmlBytes
  ) {
    throw new Error("response_too_large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > EVENT_PROVIDER_RUNTIME_POLICY.maxHtmlBytes) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function fetchPublicHtml(input: {
  url: string;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  beforeRequest: () => Promise<boolean>;
}): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = input.url;
  let redirectCount = 0;
  let transientAttempt = 0;
  while (true) {
    if (!(await input.beforeRequest())) throw new Error("request_budget_exhausted");
    let response: Response;
    try {
      response = await input.fetchImpl(currentUrl, {
        headers: { accept: "text/html,application/xhtml+xml" },
        credentials: "omit",
        redirect: "manual",
        signal: AbortSignal.timeout(EVENT_PROVIDER_RUNTIME_POLICY.navigationTimeoutMs),
      });
    } catch {
      if (transientAttempt === EVENT_PROVIDER_RUNTIME_POLICY.maxTransientRetries) {
        throw new Error("public_fetch_failed");
      }
      await input.sleepImpl(1_000 * (transientAttempt + 1));
      transientAttempt += 1;
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      let redirected: string | null = null;
      try {
        redirected = location
          ? canonicalizeLumaUrl(new URL(location, currentUrl).toString())
          : null;
      } catch {
        redirected = null;
      }
      redirectCount += 1;
      if (!redirected || redirectCount > 5) throw new Error("unsafe_redirect");
      currentUrl = redirected;
      transientAttempt = 0;
      continue;
    }
    if (response.ok) return { html: await readBoundedHtml(response), finalUrl: currentUrl };
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || transientAttempt === EVENT_PROVIDER_RUNTIME_POLICY.maxTransientRetries) {
      throw new Error(response.status === 429 ? "rate_limited" : "public_fetch_failed");
    }
    await input.sleepImpl(retryDelay(response, transientAttempt));
    transientAttempt += 1;
  }
}

function storePublicResult(runId: string, publicResult: PublicEventSourceResult): void {
  const run = getWorkflowRun(runId);
  if (!run) return;
  const current = parseObject(run.result);
  delete current[EVENT_SOURCE_RUNTIME_RESULT_KEY];
  updateWorkflowRun(runId, {
    result: JSON.stringify({
      ...current,
      [EVENT_SOURCE_RESULT_KEY]: publicResult,
    }),
  });
}

function storeRequestCheckpoint(input: {
  runId: string;
  canonicalSeedUrl: string;
  requestsUsed: number;
}): void {
  const run = getWorkflowRun(input.runId);
  if (!run) return;
  updateWorkflowRun(input.runId, {
    result: JSON.stringify({
      ...parseObject(run.result),
      [EVENT_SOURCE_RUNTIME_RESULT_KEY]: {
        version: 1,
        provider: "luma",
        canonicalSeedUrl: input.canonicalSeedUrl,
        requestsUsed: input.requestsUsed,
      },
    }),
  });
}

export function removeServerOwnedEventResult(result: Record<string, unknown>): void {
  delete result[EVENT_SOURCE_RESULT_KEY];
  delete result[EVENT_SOURCE_RUNTIME_RESULT_KEY];
}

export async function ingestNetworkSnowballEventSource(input: {
  runId: string;
  ownerWorkspace: string;
  seedUrl: string;
  traversal: EventTraversalPolicy;
  participantAccess: EventParticipantAccessConfig;
  writeGraphEdges?: boolean;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  env?: EnvLike;
}): Promise<EventSourceIngestionResult | null> {
  const canonicalSeedUrl = canonicalizeLumaUrl(input.seedUrl);
  let rootEventKey = lumaEventKey(input.seedUrl);
  if (!canonicalSeedUrl || !rootEventKey) return null;

  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepImpl = input.sleepImpl ?? wait;
  const startedAt = Date.now();
  const eventsPerCalendar = input.traversal.eventsPerCalendar;
  const storedResult = parseObject(getWorkflowRun(input.runId)?.result);
  const candidatePrevious = storedResult[EVENT_SOURCE_RESULT_KEY];
  const previous = candidatePrevious && typeof candidatePrevious === "object" && !Array.isArray(candidatePrevious)
    && (candidatePrevious as Partial<PublicEventSourceResult>).version === 1
    && (candidatePrevious as Partial<PublicEventSourceResult>).provider === "luma"
    && (candidatePrevious as Partial<PublicEventSourceResult>).canonicalSeedUrl === canonicalSeedUrl
    ? candidatePrevious as PublicEventSourceResult
    : null;
  const candidateCheckpoint = storedResult[EVENT_SOURCE_RUNTIME_RESULT_KEY];
  const checkpoint = candidateCheckpoint && typeof candidateCheckpoint === "object" && !Array.isArray(candidateCheckpoint)
    && (candidateCheckpoint as Record<string, unknown>).canonicalSeedUrl === canonicalSeedUrl
    ? candidateCheckpoint as Record<string, unknown>
    : null;
  if (previous?.rootEventKey) rootEventKey = previous.rootEventKey;
  const events: EventSource[] = previous?.events ? [...previous.events] : [];
  const contentItemIds: string[] = previous?.contentItemIds ? [...previous.contentItemIds] : [];
  const errors: string[] = [];
  const visited = new Set(events.map((event) => event.canonicalUrl));
  const previousRoot = events.find((event) => event.key === previous?.rootEventKey)
    ?? events.find((event) => event.canonicalUrl === canonicalSeedUrl);
  type QueueItem = {
    kind: "event" | "calendar";
    url: string;
    depth: number;
    listedOnCalendar?: string;
  };
  const queue: QueueItem[] = events.length === 0
    ? [{ kind: "event", url: canonicalSeedUrl, depth: 0 }]
    : [
        ...(previousRoot?.relatedEventUrls ?? []).map(
          (url): QueueItem => ({ kind: "event", url, depth: 1 }),
        ),
        ...(previousRoot?.calendarUrls ?? []).map(
          (url): QueueItem => ({ kind: "calendar", url, depth: 0 }),
        ),
      ];
  const visitedCalendarPages = new Set<string>();
  let calendarTruncated = false;
  let requestCount = Math.max(
    previous?.traversal?.requestsUsed ?? 0,
    typeof checkpoint?.requestsUsed === "number" ? checkpoint.requestsUsed : 0,
  );
  let lastRequestAt = 0;
  const consumeProviderRequest = async (): Promise<boolean> => {
    if (requestCount >= input.traversal.maxProviderRequests) return false;
    const sinceLast = Date.now() - lastRequestAt;
    if (lastRequestAt && sinceLast < EVENT_PROVIDER_RUNTIME_POLICY.minRequestIntervalMs) {
      await sleepImpl(EVENT_PROVIDER_RUNTIME_POLICY.minRequestIntervalMs - sinceLast);
    }
    requestCount += 1;
    lastRequestAt = Date.now();
    storeRequestCheckpoint({
      runId: input.runId,
      canonicalSeedUrl,
      requestsUsed: requestCount,
    });
    return true;
  };

  while (
    queue.length > 0 &&
    events.length < input.traversal.maxEvents &&
    requestCount < input.traversal.maxProviderRequests &&
    Date.now() - startedAt < EVENT_PROVIDER_RUNTIME_POLICY.maxPhaseMs
  ) {
    const next = queue.shift()!;
    const visitedForKind = next.kind === "calendar" ? visitedCalendarPages : visited;
    if (visitedForKind.has(next.url)) continue;
    if (next.kind === "calendar" && visitedCalendarPages.size >= input.traversal.maxCalendarPages) {
      calendarTruncated = true;
      continue;
    }
    visitedForKind.add(next.url);
    try {
      const fetched = await fetchPublicHtml({
        url: next.url,
        fetchImpl,
        sleepImpl,
        beforeRequest: consumeProviderRequest,
      });
      if (next.kind === "calendar") {
        const calendar = extractLumaCalendarFromHtml({ url: fetched.finalUrl, html: fetched.html });
        if (calendar.eventUrls.length > eventsPerCalendar) {
          calendarTruncated = true;
        }
        for (const eventUrl of calendar.eventUrls.slice(0, eventsPerCalendar)) {
          const existingEvent = events.find((event) => event.canonicalUrl === eventUrl);
          if (existingEvent) {
            if (!existingEvent.evidence.some(
              (entry) =>
                entry.observedRole === "listed_on_calendar" &&
                entry.sourceUrl === calendar.canonicalUrl,
            )) {
              existingEvent.evidence.push(createLumaPublicEvidence(
                calendar.canonicalUrl,
                Math.floor(Date.now() / 1000),
                "listed_on_calendar",
                eventUrl,
                eventUrl,
                existingEvent.key,
              ));
              upsertPublicEventSource(existingEvent, { writeGraphEdges: input.writeGraphEdges });
            }
            continue;
          }
          queue.push({
            kind: "event",
            url: eventUrl,
            depth: next.depth + 1,
            listedOnCalendar: calendar.canonicalUrl,
          });
        }
        if (calendar.nextPageUrl && visitedCalendarPages.size < input.traversal.maxCalendarPages) {
          queue.push({ kind: "calendar", url: calendar.nextPageUrl, depth: next.depth });
        } else if (calendar.nextPageUrl) {
          calendarTruncated = true;
        }
        continue;
      }
      const event = extractLumaEventFromHtml({ url: fetched.finalUrl, html: fetched.html });
      if (next.listedOnCalendar) {
        event.evidence.push(createLumaPublicEvidence(
          next.listedOnCalendar,
          event.observedAt,
          "listed_on_calendar",
          event.canonicalUrl,
          event.canonicalUrl,
          event.key,
        ));
      }
      if (next.depth === 0) rootEventKey = event.key;
      events.push(event);
      contentItemIds.push(upsertPublicEventSource(event, { writeGraphEdges: input.writeGraphEdges }));
      if (next.depth < input.traversal.adjacentEventDepth) {
        for (const relatedUrl of event.relatedEventUrls.slice(0, eventsPerCalendar)) {
          if (!visited.has(relatedUrl)) {
            queue.push({ kind: "event", url: relatedUrl, depth: next.depth + 1 });
          }
        }
        for (const calendarUrl of event.calendarUrls ?? []) {
          if (!visitedCalendarPages.has(calendarUrl)) {
            queue.push({ kind: "calendar", url: calendarUrl, depth: next.depth });
          }
        }
      }
    } catch (error) {
      const code = error instanceof Error && error.message === "rate_limited"
        ? "rate_limited"
        : error instanceof Error && error.message === "request_budget_exhausted"
          ? "request_budget"
          : error instanceof Error && error.message === "unsafe_redirect"
            ? "unsafe_redirect"
            : error instanceof Error && [
                "event_title_missing",
                "event_metadata_missing",
                "calendar_metadata_missing",
                "response_too_large",
              ].includes(error.message)
              ? "parse_failed"
              : "public_fetch_failed";
      errors.push(code);
    }
  }

  const root = events.find((event) => event.key === rootEventKey);
  let guestBoundary: GuestBoundary = root?.guestBoundary ?? {
    state: "unavailable",
    reason: errors.includes("rate_limited") ? "rate_limited" : "parse_failed",
  };
  let eventReportCapability: EventSourceIngestionResult["eventReportCapability"];

  if (input.participantAccess.enabled && input.participantAccess.browserSessionName) {
    const material = mintEventAccessMaterial();
    try {
      const authorized = await observeAuthorizedLumaParticipants({
        runId: input.runId,
        ownerWorkspace: input.ownerWorkspace,
        grantId: material.grantId,
        sessionName: input.participantAccess.browserSessionName,
        url: canonicalSeedUrl,
        maxParticipants: input.traversal.maxParticipantObservations,
        maxGuestPages: input.traversal.maxGuestPages,
        maxProfileVisits: input.traversal.maxProfileVisits,
        beforeProviderRequest: consumeProviderRequest,
        env: input.env,
        fetchImpl,
      });
      persistAuthorizedEventObservations({
        material,
        runId: input.runId,
        ownerWorkspace: input.ownerWorkspace,
        connectionId: authorized.connectionId,
        sessionName: authorized.sessionName,
        viewerIdentity: authorized.viewerIdentity,
        eventKey: rootEventKey,
        participants: authorized.participants,
      });
      guestBoundary = { state: "authorized", reason: null };
      eventReportCapability = {
        token: material.capability,
        expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        participantCount: authorized.participants.length,
      };
    } catch (error) {
      const reason = error instanceof EventBrowserError ? error.reason : "parse_failed";
      const gatedReasons = new Set(["login_required", "registration_required", "waitlisted", "permission_missing"]);
      guestBoundary = {
        state: gatedReasons.has(reason) ? "gated" : "unavailable",
        reason,
      };
    }
  } else if (root?.guestBoundary.state === "gated") {
    guestBoundary = { state: "not_requested", reason: "public_only" };
  }

  if (root) {
    root.guestBoundary = guestBoundary;
    upsertPublicEventSource(root, { writeGraphEdges: input.writeGraphEdges });
    if (input.writeGraphEdges) {
      for (const organizer of root.parties) {
        if (organizer.role !== "organized_by" || organizer.entityType !== "organization" || !organizer.url) {
          continue;
        }
        try {
          const org = getOrgByDomain(new URL(organizer.url).hostname.replace(/^www\./, ""));
          if (org) {
            attachNetworkSnowballHop0Org(input.runId, org.id, "organized_by");
            break;
          }
        } catch {
          // Invalid party URLs are already excluded by the provider adapter.
        }
      }
    }
  }
  const timeBudgetExhausted = Date.now() - startedAt >= EVENT_PROVIDER_RUNTIME_POLICY.maxPhaseMs;
  const stopReason = timeBudgetExhausted
    ? "time_budget"
    : errors.includes("request_budget") ||
        guestBoundary.reason === "rate_limited" ||
        (requestCount >= input.traversal.maxProviderRequests && queue.length > 0)
      ? "request_budget"
      : events.length >= input.traversal.maxEvents && queue.length > 0
        ? "max_events"
        : calendarTruncated
          ? "calendar_limit"
        : "complete";
  const publicResult: PublicEventSourceResult = {
    version: 1,
    provider: "luma",
    canonicalSeedUrl,
    rootEventKey,
    events,
    contentItemIds,
    guestBoundary,
    partial:
      errors.length > 0 ||
      events.length === 0 ||
      stopReason !== "complete" ||
      (input.participantAccess.enabled && guestBoundary.state !== "authorized"),
    errors: [...new Set(errors)],
    traversal: {
      requestsUsed: requestCount,
      visitedUrls: visited.size + visitedCalendarPages.size,
      truncated: stopReason !== "complete",
      stopReason,
    },
  };
  storePublicResult(input.runId, publicResult);
  return { publicResult, ...(eventReportCapability ? { eventReportCapability } : {}) };
}
