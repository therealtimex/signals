"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NetworkSnowballConfig } from "@/lib/workflows/network-snowball";
import type { SnowballSourcePreview } from "@/lib/workflows/snowball-sources/types";
import { resolveSnowballSourceUrl, sourceAccessPlan } from "@/lib/workflows/snowball-sources/url";

type PreviewState =
  | { status: "idle"; preview: null }
  | { status: "loading"; preview: SnowballSourcePreview }
  | { status: "ready"; preview: SnowballSourcePreview }
  | { status: "error"; preview: null; message: string };

type SourceSession = {
  sessionName: string;
  running: true;
  sourceIdentity: null;
  identityVerification: "checked_at_launch";
};

type CrmTargetDisclosure = {
  platform: "x" | "linkedin";
  sessionName: string;
  identity: string;
  verification: "previously_verified" | "unverified";
  lastVerifiedAt: number | null;
};

type LaunchContextState =
  | { status: "idle"; sessions: SourceSession[]; crmTarget: null }
  | { status: "loading"; sessions: SourceSession[]; crmTarget: null }
  | { status: "ready"; sessions: SourceSession[]; crmTarget: CrmTargetDisclosure | null }
  | { status: "error"; sessions: SourceSession[]; crmTarget: null; message: string };

export type SnowballSourceLaunchReadiness = {
  ready: boolean;
  reason: "ready" | "source_required" | "preview_pending" | "invalid_source" | "sessions_pending" | "session_required" | "session_missing";
  sourceValue: string;
};

function provisionalPreview(seedValue: string, signedInRequested: boolean): SnowballSourcePreview | null {
  const resolvedSource = resolveSnowballSourceUrl(seedValue);
  return resolvedSource
    ? {
        resolvedSource,
        accessPlan: sourceAccessPlan(resolvedSource, signedInRequested),
        publicSource: null,
        errors: [],
      }
    : null;
}

function label(value: string): string {
  return value === "x" ? "X" : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Shared source resolver and Luma-only event access controls used by both launch surfaces. */
export function NetworkSnowballEventFields({
  value,
  onChange,
  disabled,
  onLaunchReadinessChange,
}: {
  value: NetworkSnowballConfig;
  onChange: (next: NetworkSnowballConfig) => void;
  disabled?: boolean;
  onLaunchReadinessChange?: (readiness: SnowballSourceLaunchReadiness) => void;
}) {
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle", preview: null });
  const [launchContext, setLaunchContext] = useState<LaunchContextState>({
    status: "idle",
    sessions: [],
    crmTarget: null,
  });
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const browserSessionName = value.participantAccess.browserSessionName.trim();
  const provisional = useMemo(
    () => provisionalPreview(value.seedValue, value.participantAccess.enabled),
    [value.seedValue, value.participantAccess.enabled],
  );
  const preview = previewState.preview ?? provisional;
  const source = preview?.resolvedSource;
  const eventControls = source?.provider === "luma"
    && (source.kind === "event" || source.kind === "calendar");
  const signedInSupported = source?.capabilities.signedInRead === true;

  useEffect(() => {
    latestValueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    const provisionalResult = provisionalPreview(value.seedValue, false);
    if (!value.seedValue.trim()) {
      setPreviewState({ status: "idle", preview: null });
      return;
    }
    if (!provisionalResult) {
      setPreviewState({
        status: "error",
        preview: null,
        message: "Enter a public HTTPS link without credentials or a custom port.",
      });
      return;
    }
    const controller = new AbortController();
    setPreviewState({ status: "loading", preview: provisionalResult });
    const timeout = window.setTimeout(() => {
      fetch("/api/workflows/network-snowball/source-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: provisionalResult.resolvedSource.canonicalUrl,
          signedInRequested: false,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = await response.json() as {
            preview?: SnowballSourcePreview;
            error?: string;
          };
          if (!response.ok || !body.preview) throw new Error(body.error || "Preview unavailable");
          return body.preview;
        })
        .then((nextPreview) => {
          setPreviewState({ status: "ready", preview: nextPreview });
          const latest = latestValueRef.current;
          if (latest.participantAccess.enabled && !nextPreview.resolvedSource.capabilities.signedInRead) {
            onChangeRef.current({
              ...latest,
              participantAccess: { ...latest.participantAccess, enabled: false },
            });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setPreviewState({ status: "ready", preview: provisionalResult });
        });
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [value.seedValue]);

  useEffect(() => {
    if (!signedInSupported || !value.participantAccess.enabled) {
      setLaunchContext({ status: "idle", sessions: [], crmTarget: null });
      return;
    }
    const controller = new AbortController();
    setLaunchContext({ status: "loading", sessions: [], crmTarget: null });
    fetch(
      `/api/workflows/network-snowball/source-sessions?targetPlatform=${encodeURIComponent(value.targetPlatform)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json() as {
          sessions?: SourceSession[];
          crmTarget?: CrmTargetDisclosure | null;
          error?: string;
        };
        if (!response.ok || !Array.isArray(body.sessions)) {
          throw new Error(body.error || "Browser sessions are unavailable");
        }
        return body;
      })
      .then((body) => setLaunchContext({
        status: "ready",
        sessions: body.sessions ?? [],
        crmTarget: body.crmTarget ?? null,
      }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLaunchContext({
          status: "error",
          sessions: [],
          crmTarget: null,
          message: error instanceof Error ? error.message : "Browser sessions are unavailable",
        });
      });
    return () => controller.abort();
  }, [signedInSupported, value.participantAccess.enabled, value.targetPlatform]);

  useEffect(() => {
    let readiness: SnowballSourceLaunchReadiness;
    const sourceValue = value.seedValue.trim();
    if (!sourceValue) readiness = { ready: false, reason: "source_required", sourceValue };
    else if (previewState.status === "loading" || previewState.status === "idle") {
      readiness = { ready: false, reason: "preview_pending", sourceValue };
    } else if (previewState.status === "error") {
      readiness = { ready: false, reason: "invalid_source", sourceValue };
    } else if (signedInSupported && value.participantAccess.enabled) {
      if (launchContext.status === "idle" || launchContext.status === "loading") {
        readiness = { ready: false, reason: "sessions_pending", sourceValue };
      } else if (!browserSessionName) {
        readiness = { ready: false, reason: "session_required", sourceValue };
      } else if (
        launchContext.status === "error"
        || !launchContext.sessions.some((session) => session.sessionName === browserSessionName)
      ) {
        readiness = { ready: false, reason: "session_missing", sourceValue };
      } else {
        readiness = { ready: true, reason: "ready", sourceValue };
      }
    } else {
      readiness = { ready: true, reason: "ready", sourceValue };
    }
    onLaunchReadinessChange?.(readiness);
  }, [
    browserSessionName,
    launchContext,
    onLaunchReadinessChange,
    previewState.status,
    signedInSupported,
    value.participantAccess.enabled,
    value.seedValue,
  ]);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <Label>Source resolution</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Signals safely reads one public page and uses explicit evidence to classify event,
          organization, article, post, or profile sources. It never follows the page recursively.
        </p>
      </div>

      {previewState.status === "error" ? (
        <p className="text-xs text-destructive" role="alert">{previewState.message}</p>
      ) : source ? (
        <div className="rounded-md border bg-muted/20 p-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border bg-background px-2 py-0.5 font-medium">
              {label(source.provider)}
            </span>
            <span className="rounded-full border bg-background px-2 py-0.5 font-medium">
              {label(source.kind)}
            </span>
            <span className="text-xs text-muted-foreground">
              {previewState.status === "loading"
                ? "Checking public evidence…"
                : preview?.publicSource
                  ? "Public evidence ready"
                  : "Public preview unavailable"}
            </span>
          </div>
          <p className="mt-2 break-all text-xs text-muted-foreground">{source.canonicalUrl}</p>
          {preview?.publicSource?.title && (
            <p className="mt-1 text-sm font-medium">{preview.publicSource.title}</p>
          )}
          {preview?.errors[0] && (
            <p className="mt-1 text-xs text-muted-foreground">{preview.errors[0]}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Paste a source link to see how it will be used.</p>
      )}

      {eventControls && (
        <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="snowball-event-depth">Adjacent-event depth</Label>
            <Input
              id="snowball-event-depth"
              type="number"
              min={0}
              max={2}
              value={value.eventTraversal.adjacentEventDepth}
              onChange={(event) => onChange({
                ...value,
                eventTraversal: {
                  ...value.eventTraversal,
                  adjacentEventDepth: Number(event.target.value),
                },
              })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="snowball-max-events">Maximum events</Label>
            <Input
              id="snowball-max-events"
              type="number"
              min={1}
              max={12}
              value={value.eventTraversal.maxEvents}
              onChange={(event) => onChange({
                ...value,
                eventTraversal: {
                  ...value.eventTraversal,
                  maxEvents: Number(event.target.value),
                },
              })}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        {signedInSupported ? (
          <div className="flex items-start gap-3">
            <Checkbox
              id="snowball-participant-access"
              className="mt-0.5"
              checked={value.participantAccess.enabled}
              onCheckedChange={(checked) => onChange({
                ...value,
                participantAccess: { enabled: checked === true, browserSessionName },
              })}
              aria-describedby="snowball-participant-access-description"
              disabled={disabled}
            />
            <div className="space-y-0.5">
              <Label htmlFor="snowball-participant-access" className="cursor-pointer">
                Use registered guest access
              </Label>
              <p id="snowball-participant-access-description" className="text-xs text-muted-foreground">
                Include visible registered guests and organizers. Read-only; identity and access
                are checked again at launch.
              </p>
            </div>
          </div>
        ) : source ? (
          <div>
            <p className="text-sm font-medium">Public-only source</p>
            <p className="text-xs text-muted-foreground">
              Signed-in source reading is not supported for {label(source.provider)} {label(source.kind).toLowerCase()} links.
            </p>
          </div>
        ) : null}

        {signedInSupported && value.participantAccess.enabled && (
          <div className="ml-7 space-y-2 rounded-md border bg-muted/20 p-3">
            <Label htmlFor="snowball-event-session">Existing browser session</Label>
            <Select
              value={launchContext.sessions.some((session) => session.sessionName === browserSessionName)
                ? browserSessionName
                : ""}
              onValueChange={(sessionName) => onChange({
                ...value,
                participantAccess: {
                  ...value.participantAccess,
                  browserSessionName: sessionName,
                },
              })}
              disabled={disabled || launchContext.status !== "ready"}
            >
              <SelectTrigger id="snowball-event-session">
                <SelectValue placeholder={
                  launchContext.status === "loading"
                    ? "Loading running sessions…"
                    : "Select a running session"
                } />
              </SelectTrigger>
              <SelectContent>
                {launchContext.sessions.map((session) => (
                  <SelectItem key={session.sessionName} value={session.sessionName}>
                    {session.sessionName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {launchContext.status === "error" && (
              <p className="text-xs text-destructive" role="alert">{launchContext.message}</p>
            )}
            {launchContext.status === "ready" && launchContext.sessions.length === 0 && (
              <p className="text-xs text-destructive">No running browser sessions are available.</p>
            )}
            {launchContext.status === "ready"
              && browserSessionName
              && !launchContext.sessions.some((session) => session.sessionName === browserSessionName) && (
                <p className="text-xs text-destructive">
                  The previously selected session is no longer running. Select an existing session.
                </p>
              )}
            <div className="space-y-1 border-t pt-2 text-xs">
              <p className="font-medium">Source identity verification</p>
              <p className="text-muted-foreground">
                Not checked yet. Signals will visibly verify the Luma identity and access in this
                exact session at launch.
              </p>
            </div>
            <div className="space-y-1 border-t pt-2 text-xs">
              <p className="font-medium">CRM write identity (separate)</p>
              {launchContext.status === "ready" && launchContext.crmTarget ? (
                <p className="text-muted-foreground">
                  {label(launchContext.crmTarget.platform)} identity{" "}
                  <span className="font-medium text-foreground">{launchContext.crmTarget.identity}</span>
                  {" · session "}<code>{launchContext.crmTarget.sessionName}</code>
                  {" · "}{launchContext.crmTarget.verification === "previously_verified"
                    ? "previously verified; checked again at launch"
                    : "not yet verified; checked at launch"}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No active {value.targetPlatform === "x" ? "X" : "LinkedIn"} CRM identity is configured;
                  source access does not authorize profile writes.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only the selected existing session can be used for this run. A missing or changed
              session blocks launch until you select another running session.
            </p>
            <p className="text-xs text-muted-foreground">
              Signals won&apos;t register, RSVP, join a waitlist, follow, message, or change anything.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
