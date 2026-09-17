import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSignalsConfig, updateSignalsConfig } from "@/lib/settings/signals-config";
import {
  resolveEmailVerificationSettings,
  updateEmailVerificationSettings,
} from "./email-verification-settings";

describe("email verification settings", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    updateSignalsConfig({
      emailSmtpProbeEnabled: undefined,
      allowPredictedEmailInAutomation: undefined,
      emailReinferAfterVerify: undefined,
    });
  });

  it("defaults risky capabilities off, re-inference on, and supports stored values", () => {
    expect(resolveEmailVerificationSettings()).toMatchObject({
      smtpProbeEnabled: { effectiveValue: false },
      allowPredictedInAutomation: { effectiveValue: false },
      reinferAfterVerify: { effectiveValue: true, source: "default" },
    });
    updateEmailVerificationSettings({ smtpProbeEnabled: true, reinferAfterVerify: false });
    expect(readSignalsConfig().emailSmtpProbeEnabled).toBe(true);
    expect(readSignalsConfig().emailReinferAfterVerify).toBe(false);
  });

  it("environment values lock and override stored values", () => {
    vi.stubEnv("SIGNALS_EMAIL_SMTP_PROBE_ENABLED", "0");
    vi.stubEnv("SIGNALS_EMAIL_REINFER_AFTER_VERIFY", "0");
    expect(resolveEmailVerificationSettings().smtpProbeEnabled).toMatchObject({
      effectiveValue: false,
      envLocked: true,
      source: "environment",
    });
    expect(resolveEmailVerificationSettings().reinferAfterVerify).toMatchObject({
      effectiveValue: false,
      envLocked: true,
      source: "environment",
    });
  });
});
