import { readSignalsConfig, updateSignalsConfig } from "@/lib/settings/signals-config";

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function resolveFlag(storedValue: boolean | undefined, envName: string) {
  const environment = envBoolean(envName);
  return {
    storedValue: storedValue ?? false,
    effectiveValue: environment ?? storedValue ?? false,
    source: environment === undefined ? (storedValue === undefined ? "default" : "config") : "environment",
    envLocked: environment !== undefined,
  } as const;
}

export function resolveEmailVerificationSettings() {
  const config = readSignalsConfig();
  return {
    smtpProbeEnabled: resolveFlag(config.emailSmtpProbeEnabled, "SIGNALS_EMAIL_SMTP_PROBE_ENABLED"),
    allowPredictedInAutomation: resolveFlag(
      config.allowPredictedEmailInAutomation,
      "SIGNALS_ALLOW_PREDICTED_EMAIL_AUTOMATION",
    ),
  };
}

export function updateEmailVerificationSettings(input: {
  smtpProbeEnabled?: boolean;
  allowPredictedInAutomation?: boolean;
}) {
  const current = resolveEmailVerificationSettings();
  updateSignalsConfig({
    ...(input.smtpProbeEnabled !== undefined && !current.smtpProbeEnabled.envLocked
      ? { emailSmtpProbeEnabled: input.smtpProbeEnabled }
      : {}),
    ...(input.allowPredictedInAutomation !== undefined && !current.allowPredictedInAutomation.envLocked
      ? { allowPredictedEmailInAutomation: input.allowPredictedInAutomation }
      : {}),
  });
  return resolveEmailVerificationSettings();
}
