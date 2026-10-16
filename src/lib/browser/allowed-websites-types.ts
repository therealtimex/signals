/**
 * Wire shapes of `/api/browser-connections/[id]/allowed-origins` (#547, ADR-547-6). Type-only, so
 * the Settings card and the run page can import them without pulling in server modules.
 */
import type { AllowedOriginErrorCode } from "@/lib/browser/allowed-origins";

/**
 * What RealTimeX holds for the connection's session. `null` when Signals runs standalone.
 * `allowedOrigins` and `applied` are `null` when RealTimeX is unreachable or has no such session.
 */
export type AllowedOriginsRuntime = {
  reachable: boolean;
  allowedOrigins: string[] | null;
  applied: boolean | null;
  error?: string;
};

export type CustomAllowedOrigin = {
  origin: string;
  source: "settings" | "recovery";
  /** Unix seconds. */
  addedAt: number;
};

export type AllowedOriginsView = {
  connectionId: string;
  sessionName: string;
  defaults: string[];
  custom: CustomAllowedOrigin[];
  effective: string[];
  runtime: AllowedOriginsRuntime | null;
};

export type AllowedOriginsChange = {
  applied: boolean;
  effective: string[];
  runtime: AllowedOriginsRuntime | null;
  error?: string;
};

export type AddAllowedOriginResult = AllowedOriginsChange & {
  origin: string;
  status: "already_default" | "already_added" | "added";
  persisted: true;
};

export type RemoveAllowedOriginResult = AllowedOriginsChange & {
  origin: string;
  removed: boolean;
};

export type AllowedOriginsErrorBody = {
  code: AllowedOriginErrorCode | "default_origin" | "not_found";
  error: string;
};
