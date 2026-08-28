import { Suspense } from "react";
import { SettingsPageClient } from "@/app/dashboard/settings/settings-page-client";
import { EmailVerificationSettingsProvider } from "@/app/dashboard/settings/email-verification-settings-context";
import { resolveEmailVerificationSettings } from "@/lib/settings/email-verification-settings";

export default function SettingsPage() {
  const emailVerificationSettings = resolveEmailVerificationSettings();
  return (
    <Suspense>
      <EmailVerificationSettingsProvider settings={emailVerificationSettings}>
        <SettingsPageClient />
      </EmailVerificationSettingsProvider>
    </Suspense>
  );
}
