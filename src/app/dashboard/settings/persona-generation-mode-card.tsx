"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type {
  PersonaGenerationMode,
  PersonaModeResolution,
  PersonaModeUnavailableReason,
} from "@/lib/settings/persona-generation-mode";
import { resolvePersonaModeCardSelection } from "@/app/dashboard/settings/persona-generation-mode-selection";

const MODE_COPY: Record<
  PersonaGenerationMode,
  { title: string; description: string }
> = {
  terminal_agent: {
    title: "Terminal agent",
    description:
      "Signals builds a per-contact evidence brief and dispatches a stateless job to your RealTimeX terminal agent. Runs in the background; you can open the thread.",
  },
  structured_workflow: {
    title: "Structured workflow",
    description:
      "Signals calls RealTimeX llm.chat directly with a schema-validated prompt. Runs synchronously while you wait.",
  },
};

function unavailableCopy(reason: PersonaModeUnavailableReason): string {
  if (reason === "standalone") {
    return "Not available in standalone mode — requires the RealTimeX Local App.";
  }
  return "Not available in this build.";
}

export function PersonaGenerationModeCard() {
  const [resolution, setResolution] = useState<PersonaModeResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/persona-generation");
      if (!response.ok) {
        setError("Failed to load persona generation mode.");
        return;
      }
      setResolution((await response.json()) as PersonaModeResolution);
      setError(null);
    } catch {
      setError("Failed to load persona generation mode.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleChange(nextMode: PersonaGenerationMode) {
    if (!resolution || resolution.source === "env" || saving) return;
    const previous = resolution;
    setResolution({ ...resolution, requestedMode: nextMode, storedMode: nextMode });
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch("/api/settings/persona-generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const body = (await response.json()) as PersonaModeResolution & { error?: string };
      if (!response.ok) {
        setResolution(previous);
        setError(body.error ?? "Failed to save persona generation mode.");
        return;
      }
      setResolution(body);
      setSavedMessage("Saved");
    } catch {
      setResolution(previous);
      setError("Failed to save persona generation mode.");
    } finally {
      setSaving(false);
    }
  }

  const selected = resolution ? resolvePersonaModeCardSelection(resolution) : "structured_workflow";
  const envLocked = resolution?.source === "env";
  const usingFallback =
    resolution != null &&
    resolution.requestedMode === "terminal_agent" &&
    resolution.effectiveMode === "structured_workflow";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Persona generation mode</CardTitle>
        <CardDescription>
          Choose how Signals synthesizes contact personas across every trigger.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && resolution && (
          <>
            {envLocked && (
              <p className="text-sm text-muted-foreground">
                Set by <code className="rounded bg-muted px-1 py-0.5">SIGNALS_PERSONA_GENERATION_MODE</code>{" "}
                in the environment.
              </p>
            )}
            {usingFallback && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Using: Structured workflow</Badge>
                <span className="text-sm text-muted-foreground">
                  Terminal agent is selected but unavailable; structured workflow is used instead.
                </span>
              </div>
            )}
            <RadioGroup
              value={selected}
              onValueChange={(value) => void handleChange(value as PersonaGenerationMode)}
              disabled={envLocked || saving}
              aria-label="Persona generation mode"
            >
              {resolution.options.map((option) => {
                const copy = MODE_COPY[option.value];
                const inputId = `persona-mode-${option.value}`;
                return (
                  <div
                    key={option.value}
                    className="flex items-start gap-3 rounded-lg border p-4"
                  >
                    <RadioGroupItem
                      value={option.value}
                      id={inputId}
                      disabled={!option.available || envLocked || saving}
                      className="mt-1"
                    />
                    <div className="space-y-1">
                      <Label htmlFor={inputId} className="text-sm font-medium">
                        {copy.title}
                      </Label>
                      <p className="text-sm text-muted-foreground">{copy.description}</p>
                      {!option.available && option.unavailableReason && (
                        <p className="text-sm text-muted-foreground">
                          {unavailableCopy(option.unavailableReason)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
            <p className="text-sm text-muted-foreground">
              Applies to every persona trigger: Explore card,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">generate_persona</code> tool,
              pipelines, and scheduled refresh.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {savedMessage}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
