import type { Launch, SimulationRun, Variant } from "@/lib/db/types";

/** Mirrors `launches.status` in schema.ts. */
export const LAUNCH_STATUSES = [
  "draft",
  "generating",
  "simulating",
  "ready",
  "live",
  "completed",
  "archived",
] as const satisfies readonly Launch["status"][];

/** Variant statuses writable via REST (excludes published). */
export const VARIANT_WRITE_STATUSES = [
  "draft",
  "simulated",
  "selected",
  "rejected",
] as const satisfies readonly Variant["status"][];

/** All variant statuses including published (for PUT rejection). */
export const VARIANT_STATUSES = [
  ...VARIANT_WRITE_STATUSES,
  "published",
] as const satisfies readonly Variant["status"][];

/** Mirrors `simulation_runs.status` in schema.ts. */
export const SIMULATION_RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly SimulationRun["status"][];
