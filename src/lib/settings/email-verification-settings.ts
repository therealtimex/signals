import { readSignalsConfig, updateSignalsConfig } from "@/lib/settings/signals-config";

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === "1" || value.toLowerCase() === "true";
}

function resolveFlag(storedValue: boolean | undefined, envName: string, defaultValue = false) {
  const environment = envBoolean(envName);
  return {
    storedValue: storedValue ?? defaultValue,
    effectiveValue: environment ?? storedValue ?? defaultValue,
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
    reinferAfterVerify: resolveFlag(
      config.emailReinferAfterVerify,
      "SIGNALS_EMAIL_REINFER_AFTER_VERIFY",
      true,
    ),
  };
}

export type EmailVerificationSettings = ReturnType<typeof resolveEmailVerificationSettings>;

export function updateEmailVerificationSettings(input: {
  smtpProbeEnabled?: boolean;
  allowPredictedInAutomation?: boolean;
  reinferAfterVerify?: boolean;
}) {
  const current = resolveEmailVerificationSettings();
  updateSignalsConfig({
    ...(input.smtpProbeEnabled !== undefined && !current.smtpProbeEnabled.envLocked
      ? { emailSmtpProbeEnabled: input.smtpProbeEnabled }
      : {}),
    ...(input.allowPredictedInAutomation !== undefined && !current.allowPredictedInAutomation.envLocked
      ? { allowPredictedEmailInAutomation: input.allowPredictedInAutomation }
      : {}),
    ...(input.reinferAfterVerify !== undefined && !current.reinferAfterVerify.envLocked
      ? { emailReinferAfterVerify: input.reinferAfterVerify }
      : {}),
  });
  return resolveEmailVerificationSettings();
}
