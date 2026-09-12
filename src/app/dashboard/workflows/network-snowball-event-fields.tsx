"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { NetworkSnowballConfig } from "@/lib/workflows/network-snowball";

export function NetworkSnowballEventFields({
  value,
  onChange,
  disabled,
}: {
  value: NetworkSnowballConfig;
  onChange: (next: NetworkSnowballConfig) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <Label>Event source expansion</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Luma links are canonicalized and their public event, organizer, host, sponsor,
          venue, calendar, and related-event evidence is saved before profile discovery.
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
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div className="space-y-0.5">
          <Label htmlFor="snowball-participant-access">Use registered guest access</Label>
          <p className="text-xs text-muted-foreground">
            Read only visibly accessible guests from one named, already-running RealTimeX
            session. Signals never registers, joins a waitlist, or bypasses a gate.
          </p>
        </div>
        <Switch
          id="snowball-participant-access"
          checked={value.participantAccess.enabled}
          onCheckedChange={(enabled) =>
            onChange({
              ...value,
              participantAccess: { ...value.participantAccess, enabled },
            })
          }
          disabled={disabled}
        />
      </div>
      {value.participantAccess.enabled && (
        <div className="space-y-2">
          <Label htmlFor="snowball-event-session">Existing browser session name</Label>
          <Input
            id="snowball-event-session"
            placeholder="e.g. personal-browser"
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
          <p className="text-xs text-muted-foreground">
            Registration tokens in event URLs are discarded; access is derived from this
            session&apos;s visible signed-in identity and guest-list permission.
          </p>
        </div>
      )}
    </div>
  );
}
