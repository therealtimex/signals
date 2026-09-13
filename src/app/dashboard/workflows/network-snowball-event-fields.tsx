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
  | { status: "idle"; canonicalUrl: null; inputValue: string; generation: number; preview: null }
  | { status: "loading"; canonicalUrl: string; inputValue: string; generation: number; preview: SnowballSourcePreview }
  | { status: "ready"; canonicalUrl: string; inputValue: string; generation: number; preview: SnowballSourcePreview }
  | { status: "error"; canonicalUrl: null; inputValue: string; generation: number; preview: null; message: string };

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

type SourceSessionState =
  | { status: "idle"; requestKey: null; sessions: SourceSession[] }
  | { status: "loading"; requestKey: string; sessions: SourceSession[] }
  | { status: "ready"; requestKey: string; sessions: SourceSession[] }
  | { status: "error"; requestKey: string; sessions: SourceSession[]; message: string };

type CrmTargetState =
  | { status: "idle"; targetPlatform: null; crmTarget: null }
  | { status: "loading"; targetPlatform: NetworkSnowballConfig["targetPlatform"]; crmTarget: null }
  | { status: "ready"; targetPlatform: NetworkSnowballConfig["targetPlatform"]; crmTarget: CrmTargetDisclosure | null }
  | { status: "error"; targetPlatform: NetworkSnowballConfig["targetPlatform"]; crmTarget: null; message: string };

export type SnowballSourceLaunchReadiness = {
  ready: boolean;
  reason: "ready" | "source_required" | "preview_pending" | "invalid_source" | "crm_target_pending" | "crm_target_unavailable" | "sessions_pending" | "session_required" | "session_missing";
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
  if (value === "x") return "X";
  if (value === "linkedin") return "LinkedIn";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "idle",
    canonicalUrl: null,
    inputValue: "",
    generation: 0,
    preview: null,
  });
  const [sourceSessionState, setSourceSessionState] = useState<SourceSessionState>({
    status: "idle",
    requestKey: null,
    sessions: [],
  });
  const [crmTargetState, setCrmTargetState] = useState<CrmTargetState>({
    status: "idle",
    targetPlatform: null,
    crmTarget: null,
  });
  const previewGenerationRef = useRef(0);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const sourceValue = value.seedValue.trim();
  const browserSessionName = value.participantAccess.browserSessionName.trim();
  const provisional = useMemo(
    () => provisionalPreview(value.seedValue, value.participantAccess.enabled),
    [value.seedValue, value.participantAccess.enabled],
  );
  const canonicalSourceUrl = provisional?.resolvedSource.canonicalUrl ?? null;
  const previewStateMatchesSource = previewState.inputValue === sourceValue
    && previewState.canonicalUrl === canonicalSourceUrl;
  const currentPreviewState: PreviewState = previewStateMatchesSource
    ? previewState
    : !sourceValue
      ? { status: "idle", canonicalUrl: null, inputValue: sourceValue, generation: 0, preview: null }
      : provisional && canonicalSourceUrl
        ? {
            status: "loading",
            canonicalUrl: canonicalSourceUrl,
            inputValue: sourceValue,
            generation: 0,
            preview: provisional,
          }
        : {
            status: "error",
            canonicalUrl: null,
            inputValue: sourceValue,
            generation: 0,
            preview: null,
            message: "Enter a public HTTPS link without credentials or a custom port.",
          };
  const preview = currentPreviewState.preview ?? provisional;
  const source = preview?.resolvedSource;
  const eventControls = source?.provider === "luma"
    && (source.kind === "event" || source.kind === "calendar");
  const signedInSupported = source?.capabilities.signedInRead === true;
  const sourceSessionRequestKey = signedInSupported && value.participantAccess.enabled
    ? `${canonicalSourceUrl ?? "unknown"}\n${value.targetPlatform}\n${browserSessionName}`
    : null;
  const currentSourceSessionState = useMemo<SourceSessionState>(() => sourceSessionRequestKey
    && sourceSessionState.requestKey === sourceSessionRequestKey
      ? sourceSessionState
      : sourceSessionRequestKey
        ? { status: "loading", requestKey: sourceSessionRequestKey, sessions: [] }
        : { status: "idle", requestKey: null, sessions: [] }, [sourceSessionRequestKey, sourceSessionState]);
  const currentCrmTargetState = useMemo<CrmTargetState>(
    () => crmTargetState.targetPlatform === value.targetPlatform
      ? crmTargetState
      : { status: "loading", targetPlatform: value.targetPlatform, crmTarget: null },
    [crmTargetState, value.targetPlatform],
  );

  useEffect(() => {
    latestValueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    const provisionalResult = provisionalPreview(value.seedValue, false);
    const inputValue = value.seedValue.trim();
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    if (!inputValue) {
      setPreviewState({ status: "idle", canonicalUrl: null, inputValue, generation, preview: null });
      return;
    }
    if (!provisionalResult) {
      setPreviewState({
        status: "error",
        canonicalUrl: null,
        inputValue,
        generation,
        preview: null,
        message: "Enter a public HTTPS link without credentials or a custom port.",
      });
      return;
    }
    const canonicalUrl = provisionalResult.resolvedSource.canonicalUrl;
    const controller = new AbortController();
    setPreviewState({
      status: "loading",
      canonicalUrl,
      inputValue,
      generation,
      preview: provisionalResult,
    });
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
          if (controller.signal.aborted || previewGenerationRef.current !== generation) return;
          setPreviewState((current) => current.generation === generation
            && current.canonicalUrl === canonicalUrl
            && current.inputValue === inputValue
              ? { status: "ready", canonicalUrl, inputValue, generation, preview: nextPreview }
              : current);
          const latest = latestValueRef.current;
          const latestCanonicalUrl = resolveSnowballSourceUrl(latest.seedValue)?.canonicalUrl;
          if (
            latestCanonicalUrl === canonicalUrl
            && latest.seedValue.trim() === inputValue
            && latest.participantAccess.enabled
            && !nextPreview.resolvedSource.capabilities.signedInRead
          ) {
            onChangeRef.current({
              ...latest,
              participantAccess: { ...latest.participantAccess, enabled: false },
            });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (controller.signal.aborted || previewGenerationRef.current !== generation) return;
          setPreviewState((current) => current.generation === generation
            && current.canonicalUrl === canonicalUrl
            && current.inputValue === inputValue
              ? { status: "ready", canonicalUrl, inputValue, generation, preview: provisionalResult }
              : current);
        });
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [value.seedValue]);

  useEffect(() => {
    const targetPlatform = value.targetPlatform;
    const controller = new AbortController();
    setCrmTargetState({ status: "loading", targetPlatform, crmTarget: null });
    fetch(
      `/api/workflows/network-snowball/source-sessions?targetPlatform=${encodeURIComponent(targetPlatform)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json() as {
          crmTarget?: CrmTargetDisclosure | null;
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "CRM write identity is unavailable");
        return body;
      })
      .then((body) => setCrmTargetState((current) => current.targetPlatform === targetPlatform
        ? { status: "ready", targetPlatform, crmTarget: body.crmTarget ?? null }
        : current))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCrmTargetState((current) => current.targetPlatform === targetPlatform
          ? {
              status: "error",
              targetPlatform,
              crmTarget: null,
              message: error instanceof Error ? error.message : "CRM write identity is unavailable",
            }
          : current);
      });
    return () => controller.abort();
  }, [value.targetPlatform]);

  useEffect(() => {
    if (!sourceSessionRequestKey) {
      setSourceSessionState({ status: "idle", requestKey: null, sessions: [] });
      return;
    }
    const controller = new AbortController();
    setSourceSessionState({ status: "loading", requestKey: sourceSessionRequestKey, sessions: [] });
    fetch(
      `/api/workflows/network-snowball/source-sessions?targetPlatform=${encodeURIComponent(value.targetPlatform)}&includeSourceSessions=true`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json() as {
          sessions?: SourceSession[];
          error?: string;
        };
        if (!response.ok || !Array.isArray(body.sessions)) {
          throw new Error(body.error || "Browser sessions are unavailable");
        }
        return body;
      })
      .then((body) => setSourceSessionState((current) => current.requestKey === sourceSessionRequestKey
        ? { status: "ready", requestKey: sourceSessionRequestKey, sessions: body.sessions ?? [] }
        : current))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSourceSessionState((current) => current.requestKey === sourceSessionRequestKey
          ? {
              status: "error",
              requestKey: sourceSessionRequestKey,
              sessions: [],
              message: error instanceof Error ? error.message : "Browser sessions are unavailable",
            }
          : current);
      });
    return () => controller.abort();
  }, [sourceSessionRequestKey, value.targetPlatform]);

  useEffect(() => {
    let readiness: SnowballSourceLaunchReadiness;
    if (!sourceValue) readiness = { ready: false, reason: "source_required", sourceValue };
    else if (currentPreviewState.status === "loading" || currentPreviewState.status === "idle") {
      readiness = { ready: false, reason: "preview_pending", sourceValue };
    } else if (currentPreviewState.status === "error") {
      readiness = { ready: false, reason: "invalid_source", sourceValue };
    } else if (currentCrmTargetState.status === "idle" || currentCrmTargetState.status === "loading") {
      readiness = { ready: false, reason: "crm_target_pending", sourceValue };
    } else if (currentCrmTargetState.status === "error") {
      readiness = { ready: false, reason: "crm_target_unavailable", sourceValue };
    } else if (signedInSupported && value.participantAccess.enabled) {
      if (currentSourceSessionState.status === "idle" || currentSourceSessionState.status === "loading") {
        readiness = { ready: false, reason: "sessions_pending", sourceValue };
      } else if (!browserSessionName) {
        readiness = { ready: false, reason: "session_required", sourceValue };
      } else if (
        currentSourceSessionState.status === "error"
        || !currentSourceSessionState.sessions.some((session) => session.sessionName === browserSessionName)
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
    currentCrmTargetState,
    currentPreviewState.status,
    currentSourceSessionState,
    onLaunchReadinessChange,
    signedInSupported,
    sourceValue,
    value.participantAccess.enabled,
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

      {currentPreviewState.status === "error" ? (
        <p className="text-xs text-destructive" role="alert">{currentPreviewState.message}</p>
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
              {currentPreviewState.status === "loading"
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
              value={currentSourceSessionState.sessions.some((session) => session.sessionName === browserSessionName)
                ? browserSessionName
                : ""}
              onValueChange={(sessionName) => onChange({
                ...value,
                participantAccess: {
                  enabled: false,
                  browserSessionName: sessionName,
                },
              })}
              disabled={disabled || currentSourceSessionState.status !== "ready"}
            >
              <SelectTrigger id="snowball-event-session">
                <SelectValue placeholder={
                  currentSourceSessionState.status === "loading"
                    ? "Loading running sessions…"
                    : "Select a running session"
                } />
              </SelectTrigger>
              <SelectContent>
                {currentSourceSessionState.sessions.map((session) => (
                  <SelectItem key={session.sessionName} value={session.sessionName}>
                    {session.sessionName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentSourceSessionState.status === "error" && (
              <p className="text-xs text-destructive" role="alert">{currentSourceSessionState.message}</p>
            )}
            {currentSourceSessionState.status === "ready" && currentSourceSessionState.sessions.length === 0 && (
              <p className="text-xs text-destructive">No running browser sessions are available.</p>
            )}
            {currentSourceSessionState.status === "ready"
              && browserSessionName
              && !currentSourceSessionState.sessions.some((session) => session.sessionName === browserSessionName) && (
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
            <p className="text-xs text-muted-foreground">
              Only the selected existing session can be used for this run. A missing or changed
              session blocks launch until you select another running session.
            </p>
            <p className="text-xs text-muted-foreground">
              Signals won&apos;t register, RSVP, join a waitlist, follow, message, or change anything.
            </p>
          </div>
        )}

        <div className="space-y-1 rounded-md border bg-muted/20 p-3 text-xs">
          <p className="font-medium">CRM write identity (separate)</p>
          {currentCrmTargetState.status === "idle" || currentCrmTargetState.status === "loading" ? (
            <p className="text-muted-foreground">Checking configured write identity…</p>
          ) : currentCrmTargetState.status === "error" ? (
            <p className="text-destructive" role="alert">{currentCrmTargetState.message}</p>
          ) : currentCrmTargetState.crmTarget ? (
            <p className="text-muted-foreground">
              {label(currentCrmTargetState.crmTarget.platform)} identity{" "}
              <span className="font-medium text-foreground">{currentCrmTargetState.crmTarget.identity}</span>
              {" · session "}<code>{currentCrmTargetState.crmTarget.sessionName}</code>
              {" · "}{currentCrmTargetState.crmTarget.verification === "previously_verified"
                ? "previously verified; checked again at launch"
                : "not yet verified; checked at launch"}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No active {value.targetPlatform === "x" ? "X" : "LinkedIn"} CRM identity is configured.
            </p>
          )}
          <p className="text-muted-foreground">
            Source access does not authorize profile writes.
          </p>
        </div>
      </div>
    </div>
  );
}
