import { NextResponse } from "next/server";
import { externalEffectsDenied, type InstanceEnv } from "@/lib/instance/instance";

/** Effects a Signals Dev instance refuses (ADR-541-5 chokepoint table). */
export const EXTERNAL_EFFECTS = [
  "publish.dispatch",
  "publish.x-api",
  "engage.x-api",
  "publish.browser",
  "browser-session.publish",
  "oauth.connect",
  "email.smtp-probe",
] as const;

export type ExternalEffect = (typeof EXTERNAL_EFFECTS)[number];

export const DEV_INSTANCE_GUARD = "DEV_INSTANCE_GUARD" as const;

export class ExternalEffectDeniedError extends Error {
  readonly code = DEV_INSTANCE_GUARD;

  constructor(readonly effect: ExternalEffect) {
    super(
      `This Signals instance is a Dev app (SIGNALS_INSTANCE=dev) and refuses the external effect ` +
        `"${effect}". Dev apps cannot publish, engage, connect accounts, or probe mail servers; ` +
        `use the canonical Signals app for real effects.`,
    );
    this.name = "ExternalEffectDeniedError";
  }
}

/**
 * Throw when this instance may not perform `effect`. Call it as the first statement of every
 * chokepoint. The process environment always counts: an injected `env` can add the dev identity
 * (tests do), never remove it, so a dev instance can never allow an external effect.
 */
export function assertExternalEffectAllowed(
  effect: ExternalEffect,
  env: InstanceEnv = process.env,
): void {
  if (externalEffectsDenied(env) || externalEffectsDenied(process.env)) {
    throw new ExternalEffectDeniedError(effect);
  }
}

export type ExternalEffectDeniedBody = {
  success: false;
  code: typeof DEV_INSTANCE_GUARD;
  effect: ExternalEffect;
  error: string;
};

export function externalEffectDeniedResponse(
  error: ExternalEffectDeniedError,
): NextResponse<ExternalEffectDeniedBody> {
  return NextResponse.json(
    { success: false, code: DEV_INSTANCE_GUARD, effect: error.effect, error: error.message },
    { status: 403 },
  );
}

/** Route-handler form: the 403 response when `effect` is denied, otherwise `null`. */
export function denyExternalEffect(
  effect: ExternalEffect,
  env: InstanceEnv = process.env,
): NextResponse<ExternalEffectDeniedBody> | null {
  try {
    assertExternalEffectAllowed(effect, env);
    return null;
  } catch (error) {
    if (error instanceof ExternalEffectDeniedError) return externalEffectDeniedResponse(error);
    throw error;
  }
}
