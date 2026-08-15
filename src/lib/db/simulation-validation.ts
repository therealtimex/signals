/** Validation helpers for Wind Tunnel simulation numeric contracts. */

export const ENGAGEMENT_METRIC_KEYS = [
  "likes",
  "comments",
  "shares",
  "impressions",
  "clicks",
  "bookmarks",
  "quotes",
  "retweets",
] as const;

export type EngagementMetricKey = (typeof ENGAGEMENT_METRIC_KEYS)[number];

export class SimulationValidationError extends Error {
  readonly code = "SIMULATION_VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "SimulationValidationError";
  }
}

export function assertEngagementScore(
  value: number,
  field = "engagementScore",
): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new SimulationValidationError(
      `${field} must be a number between 0 and 100`,
    );
  }
  return value;
}

export function assertPredictionScore(value: number): number {
  return assertEngagementScore(value, "predictedScore");
}

export function assertPredictionConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new SimulationValidationError(
      "predictionConfidence must be a number between 0 and 1",
    );
  }
  return value;
}

export function normalizePredictedMetrics(
  metrics: Record<string, unknown> | undefined,
): Record<string, number> {
  if (!metrics) return {};
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (!(ENGAGEMENT_METRIC_KEYS as readonly string[]).includes(key)) {
      throw new SimulationValidationError(
        `predictedMetrics key '${key}' is invalid — use engagement_metrics column names (${ENGAGEMENT_METRIC_KEYS.join(", ")})`,
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new SimulationValidationError(
        `predictedMetrics.${key} must be a non-negative number`,
      );
    }
    normalized[key] = value;
  }
  return normalized;
}

export function parsePredictedActions(
  value: string | null | undefined,
): Record<string, unknown>[] | Record<string, unknown> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return [];
  } catch {
    return [];
  }
}
