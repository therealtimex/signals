"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import type { NetworkSnowballConfig } from "@/lib/workflows/network-snowball";
import type { SnowballSourcePreview } from "@/lib/workflows/snowball-sources/types";
import { resolveSnowballSourceUrl, sourceAccessPlan } from "@/lib/workflows/snowball-sources/url";

type PreviewState =
  | { status: "idle"; preview: null }
  | { status: "loading"; preview: SnowballSourcePreview }
  | { status: "ready"; preview: SnowballSourcePreview }
  | { status: "error"; preview: null; message: string };

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
}: {
  value: NetworkSnowballConfig;
  onChange: (next: NetworkSnowballConfig) => void;
  disabled?: boolean;
}) {
  const [editingSession, setEditingSession] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle", preview: null });
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToChangeRef = useRef(false);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const browserSessionName =
    value.participantAccess.browserSessionName.trim() || RTX_PUBLISH_SESSION_NAME;
  const usesSignalsPublish = browserSessionName === RTX_PUBLISH_SESSION_NAME;
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
    if (editingSession) sessionInputRef.current?.focus();
    else if (returnFocusToChangeRef.current) {
      returnFocusToChangeRef.current = false;
      changeButtonRef.current?.focus();
    }
  }, [editingSession]);

  useEffect(() => {
    const provisionalResult = provisionalPreview(value.seedValue, value.participantAccess.enabled);
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
          signedInRequested: value.participantAccess.enabled,
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
  }, [value.seedValue, value.participantAccess.enabled]);

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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Browser session used for source access</p>
                <p className="break-words text-sm font-medium">
                  {usesSignalsPublish ? "Signals Publish" : "Selected session"}{" — "}
                  <code className="break-all text-xs font-normal text-muted-foreground">
                    {browserSessionName}
                  </code>
                </p>
              </div>
              {!editingSession && (
                <Button
                  ref={changeButtonRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditingSession(true)}
                  disabled={disabled}
                >
                  Change
                </Button>
              )}
            </div>
            {editingSession && (
              <div className="space-y-2">
                <Label htmlFor="snowball-event-session" className="text-xs">Browser session name</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    ref={sessionInputRef}
                    id="snowball-event-session"
                    placeholder={RTX_PUBLISH_SESSION_NAME}
                    value={value.participantAccess.browserSessionName}
                    onChange={(event) => onChange({
                      ...value,
                      participantAccess: {
                        ...value.participantAccess,
                        browserSessionName: event.target.value,
                      },
                    })}
                    disabled={disabled}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      returnFocusToChangeRef.current = true;
                      onChange({
                        ...value,
                        participantAccess: {
                          ...value.participantAccess,
                          browserSessionName: RTX_PUBLISH_SESSION_NAME,
                        },
                      });
                      setEditingSession(false);
                    }}
                    disabled={disabled}
                  >
                    Use Signals Publish
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              This exact session will be used. Signals verifies its visible identity and source
              access at launch; this does not change the separate identity used for CRM writes.
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
