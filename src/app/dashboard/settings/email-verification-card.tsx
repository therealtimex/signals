"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useInitialEmailVerificationSettings } from "@/app/dashboard/settings/email-verification-settings-context";

import type { EmailVerificationSettings } from "@/lib/settings/email-verification-settings";

export function EmailVerificationCard() {
  const initialSettings = useInitialEmailVerificationSettings();
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);

  async function update(patch: Record<string, boolean>) {
    setError(null);
    const response = await fetch("/api/settings/email-verification", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Could not save this setting.");
      return;
    }
    setSettings(await response.json() as EmailVerificationSettings);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MailCheck className="size-4 text-primary" />Email verification</CardTitle>
        <CardDescription>Control optional probing and the safety boundary for predicted business emails.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div><Label htmlFor="smtp-probe">SMTP recipient probing</Label><p className="mt-1 text-xs text-muted-foreground">Off by default. Syntax and domain evidence remain available without recipient probing.</p></div>
          <Switch id="smtp-probe" checked={settings.smtpProbeEnabled.effectiveValue} disabled={settings.smtpProbeEnabled.envLocked} onCheckedChange={(value) => update({ smtpProbeEnabled: value })} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><Label htmlFor="predicted-automation">Allow predicted emails in automation</Label><p className="mt-1 text-xs text-muted-foreground">Keep disabled unless a workflow explicitly accepts unverified recipients.</p></div>
          <Switch id="predicted-automation" checked={settings.allowPredictedInAutomation.effectiveValue} disabled={settings.allowPredictedInAutomation.envLocked} onCheckedChange={(value) => update({ allowPredictedInAutomation: value })} />
        </div>
        {settings.smtpProbeEnabled.envLocked || settings.allowPredictedInAutomation.envLocked ? <p className="text-xs text-muted-foreground">Environment-managed settings are read-only here.</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
