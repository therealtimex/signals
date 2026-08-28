"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EmailVerificationSettings } from "@/lib/settings/email-verification-settings";

const DEFAULT_EMAIL_VERIFICATION_SETTINGS: EmailVerificationSettings = {
  smtpProbeEnabled: {
    storedValue: false,
    effectiveValue: false,
    source: "default",
    envLocked: false,
  },
  allowPredictedInAutomation: {
    storedValue: false,
    effectiveValue: false,
    source: "default",
    envLocked: false,
  },
};

const EmailVerificationSettingsContext = createContext<EmailVerificationSettings>(
  DEFAULT_EMAIL_VERIFICATION_SETTINGS,
);

export function EmailVerificationSettingsProvider({
  children,
  settings,
}: {
  children: ReactNode;
  settings: EmailVerificationSettings;
}) {
  return (
    <EmailVerificationSettingsContext value={settings}>
      {children}
    </EmailVerificationSettingsContext>
  );
}

export function useInitialEmailVerificationSettings(): EmailVerificationSettings {
  return useContext(EmailVerificationSettingsContext);
}
