import type { EventTraversalPolicy } from "@/lib/workflows/event-sources/types";

const BOUNDS = {
  adjacentEventDepth: { fallback: 1, min: 0, max: 2 },
  eventsPerCalendar: { fallback: 3, min: 0, max: 5 },
  maxEvents: { fallback: 6, min: 1, max: 12 },
  maxCalendarPages: { fallback: 2, min: 1, max: 4 },
  maxGuestPages: { fallback: 2, min: 1, max: 5 },
  maxParticipantObservations: { fallback: 30, min: 1, max: 100 },
  maxProfileVisits: { fallback: 20, min: 0, max: 60 },
  maxProviderRequests: { fallback: 40, min: 1, max: 100 },
} as const;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function readEventTraversalPolicy(value: unknown): EventTraversalPolicy {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return Object.fromEntries(
    Object.entries(BOUNDS).map(([key, bounds]) => [
      key,
      bounded(raw[key], bounds.fallback, bounds.min, bounds.max),
    ]),
  ) as unknown as EventTraversalPolicy;
}

export const DEFAULT_EVENT_TRAVERSAL_POLICY = readEventTraversalPolicy({});

export const EVENT_PROVIDER_RUNTIME_POLICY = {
  minRequestIntervalMs: 1_000,
  concurrency: 1,
  maxTransientRetries: 2,
  maxPhaseMs: 10 * 60_000,
  navigationTimeoutMs: 30_000,
  maxHtmlBytes: 2 * 1024 * 1024,
} as const;
