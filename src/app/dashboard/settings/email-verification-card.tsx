"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Flag = { storedValue: boolean; effectiveValue: boolean; source: string; envLocked: boolean };
type Settings = { smtpProbeEnabled: Flag; allowPredictedInAutomation: Flag };

export function EmailVerificationCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/email-verification")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load settings");
        return response.json() as Promise<Settings>;
      })
      .then(setSettings)
      .catch(() => setError("Could not load email verification settings."));
  }, []);

  async function update(patch: Record<string, boolean>) {
    setError(null);
    const response = await fetch("/api/settings/email-verification", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Could not save this setting.");
    else setSettings(body as Settings);
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
          <Switch id="smtp-probe" checked={settings?.smtpProbeEnabled.effectiveValue ?? false} disabled={!settings || settings.smtpProbeEnabled.envLocked} onCheckedChange={(value) => update({ smtpProbeEnabled: value })} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><Label htmlFor="predicted-automation">Allow predicted emails in automation</Label><p className="mt-1 text-xs text-muted-foreground">Keep disabled unless a workflow explicitly accepts unverified recipients.</p></div>
          <Switch id="predicted-automation" checked={settings?.allowPredictedInAutomation.effectiveValue ?? false} disabled={!settings || settings.allowPredictedInAutomation.envLocked} onCheckedChange={(value) => update({ allowPredictedInAutomation: value })} />
        </div>
        {settings?.smtpProbeEnabled.envLocked || settings?.allowPredictedInAutomation.envLocked ? <p className="text-xs text-muted-foreground">Environment-managed settings are read-only here.</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
