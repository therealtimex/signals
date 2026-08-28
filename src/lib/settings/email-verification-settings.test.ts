import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSignalsConfig, updateSignalsConfig } from "@/lib/settings/signals-config";
import {
  resolveEmailVerificationSettings,
  updateEmailVerificationSettings,
} from "./email-verification-settings";

describe("email verification settings", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    updateSignalsConfig({ emailSmtpProbeEnabled: undefined, allowPredictedEmailInAutomation: undefined });
  });

  it("defaults both risky capabilities off and supports stored opt-in", () => {
    expect(resolveEmailVerificationSettings()).toMatchObject({
      smtpProbeEnabled: { effectiveValue: false },
      allowPredictedInAutomation: { effectiveValue: false },
    });
    updateEmailVerificationSettings({ smtpProbeEnabled: true });
    expect(readSignalsConfig().emailSmtpProbeEnabled).toBe(true);
  });

  it("environment values lock and override stored values", () => {
    vi.stubEnv("SIGNALS_EMAIL_SMTP_PROBE_ENABLED", "0");
    expect(resolveEmailVerificationSettings().smtpProbeEnabled).toMatchObject({
      effectiveValue: false,
      envLocked: true,
      source: "environment",
    });
  });
});
