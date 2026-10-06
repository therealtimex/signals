/**
 * Instance identity (ADR-541-5, #541).
 *
 * A Signals Dev app runs with `SIGNALS_INSTANCE=dev` pinned by the launcher. Everything else —
 * unset, empty, any other value — is the canonical instance. There is deliberately no override
 * variable: a dev instance can never allow external effects.
 */

export type InstanceKind = "dev" | "canonical";

export type InstanceEnv = Readonly<Record<string, string | undefined>>;

export function getInstanceKind(env: InstanceEnv = process.env): InstanceKind {
  return env.SIGNALS_INSTANCE === "dev" ? "dev" : "canonical";
}

export function externalEffectsDenied(env: InstanceEnv = process.env): boolean {
  return getInstanceKind(env) === "dev";
}
