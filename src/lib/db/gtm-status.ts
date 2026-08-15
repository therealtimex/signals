/** Canonical GTM status registries — widen enums here; schema and REST import from this module. */

export const LAUNCH_STATUSES = [
  "draft",
  "generating",
  "simulating",
  "ready",
  "live",
  "completed",
  "archived",
] as const;

export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const LAUNCH_STATUS_ENUM = LAUNCH_STATUSES as unknown as [
  LaunchStatus,
  ...LaunchStatus[],
];

export const VARIANT_STATUSES = [
  "draft",
  "simulated",
  "selected",
  "published",
  "rejected",
] as const;

export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const VARIANT_STATUS_ENUM = VARIANT_STATUSES as unknown as [
  VariantStatus,
  ...VariantStatus[],
];

/** Variant statuses writable via REST (excludes published). */
export const VARIANT_WRITE_STATUSES = [
  "draft",
  "simulated",
  "selected",
  "rejected",
] as const;

type AssertVariantWriteSubset =
  Exclude<VariantStatus, (typeof VARIANT_WRITE_STATUSES)[number]> extends "published"
    ? "published" extends Exclude<VariantStatus, (typeof VARIANT_WRITE_STATUSES)[number]>
      ? true
      : never
    : never;

const _assertVariantWriteSubset: AssertVariantWriteSubset = true;
void _assertVariantWriteSubset;

export const SIMULATION_RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number];

export const SIMULATION_RUN_STATUS_ENUM = SIMULATION_RUN_STATUSES as unknown as [
  SimulationRunStatus,
  ...SimulationRunStatus[],
];
