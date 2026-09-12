"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import type { NetworkSnowballConfig } from "@/lib/workflows/network-snowball";
import { networkSnowballSignedInAccessDescription } from "@/lib/workflows/network-snowball-signed-in-access";

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
  const browserSessionName =
    value.participantAccess.browserSessionName.trim() || RTX_PUBLISH_SESSION_NAME;
  const usesSignalsPublish = browserSessionName === RTX_PUBLISH_SESSION_NAME;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <Label>Event source expansion</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Recognized event links are canonicalized and their public event, organizer, host,
          sponsor, venue, calendar, and related-event evidence is saved before profile discovery.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="snowball-event-depth">Adjacent-event depth</Label>
          <Input
            id="snowball-event-depth"
            type="number"
            min={0}
            max={2}
            value={value.eventTraversal.adjacentEventDepth}
            onChange={(event) =>
              onChange({
                ...value,
                eventTraversal: {
                  ...value.eventTraversal,
                  adjacentEventDepth: Number(event.target.value),
                },
              })
            }
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
            onChange={(event) =>
              onChange({
                ...value,
                eventTraversal: {
                  ...value.eventTraversal,
                  maxEvents: Number(event.target.value),
                },
              })
            }
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="snowball-participant-access"
            className="mt-0.5"
            checked={value.participantAccess.enabled}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                participantAccess: {
                  enabled: checked === true,
                  browserSessionName,
                },
              })
            }
            aria-describedby="snowball-participant-access-description"
            disabled={disabled}
          />
          <div className="space-y-0.5">
            <Label htmlFor="snowball-participant-access" className="cursor-pointer">
              Use signed-in browser access
            </Label>
            <p
              id="snowball-participant-access-description"
              className="text-xs text-muted-foreground"
            >
              {networkSnowballSignedInAccessDescription(value.seedValue)}
            </p>
          </div>
        </div>

        <div className="ml-7 space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Browser session</p>
              <p className="truncate text-sm font-medium">
                {usesSignalsPublish ? "Signals Publish" : "Selected session"}{" — "}
                <code className="text-xs font-normal text-muted-foreground">
                  {browserSessionName}
                </code>
              </p>
            </div>
            {!editingSession && (
              <Button
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
              <Label htmlFor="snowball-event-session" className="text-xs">
                Browser session name
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="snowball-event-session"
                  placeholder={RTX_PUBLISH_SESSION_NAME}
                  value={value.participantAccess.browserSessionName}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      participantAccess: {
                        ...value.participantAccess,
                        browserSessionName: event.target.value,
                      },
                    })
                  }
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
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
            Sign-in, visible identity, and access will be verified at launch. Public extraction
            continues if signed-in enrichment is unavailable.
          </p>
          <p className="text-xs text-muted-foreground">
            Read-only. Signals won&apos;t register, RSVP, join a waitlist, follow, message, or
            change anything on the source site.
          </p>
        </div>
      </div>
    </div>
  );
}
