import { getInstanceKind } from "@/lib/instance/instance";

/**
 * On unless SIGNALS_SCHEDULER_ENABLED says otherwise ("1"/"true" keep it on).
 * The standalone Local App runtime sets it to "0" (scripts/standalone-entry.mjs):
 * RealTimeX owns scheduling there (#478, #7). Signals Dev apps pin it to "0" (#541), and a dev
 * instance never schedules even without that pin: a snapshot carries the owner's real jobs.
 *
 * Kept free of DB imports so `/api/health` can report it without opening SQLite.
 */
export function isSchedulerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (getInstanceKind(env) === "dev") return false;
  const value = env.SIGNALS_SCHEDULER_ENABLED;
  if (value === undefined) return true;
  return value === "1" || value.toLowerCase() === "true";
}
