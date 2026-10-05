"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ContactChannelDialog } from "@/components/contact-channel-dialog";
import { channelHref, isExternalChannelHref } from "@/lib/contact-channel-link";
import {
  CONTACT_CHANNEL_TYPES,
  channelLabelText,
  channelTypeLabels,
} from "@/lib/contact-channel-draft";
import type { ContactChannel } from "@/lib/db/types";

interface ContactChannelsSectionProps {
  contactId: string;
  channels: ContactChannel[];
}

type DialogState = { key: number; channel: ContactChannel | null; open: boolean };

/** A focus target: the Add channel button, or one row's Edit button by channel id. */
type FocusTarget = { kind: "add" } | { kind: "edit"; channelId: string };

const TYPE_ORDER: readonly string[] = CONTACT_CHANNEL_TYPES;

/** Grouped by type in registry order, primary first, then oldest first: stable across refreshes. */
function sortChannels(channels: ContactChannel[]): ContactChannel[] {
  return [...channels].sort((a, b) => {
    const byType = TYPE_ORDER.indexOf(a.channelType) - TYPE_ORDER.indexOf(b.channelType);
    if (byType !== 0) return byType;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

function ChannelValue({ channel }: { channel: ContactChannel }) {
  const href = channelHref(channel);
  if (!href) {
    return <span className="min-w-0 text-sm font-medium break-all">{channel.value}</span>;
  }
  const external = isExternalChannelHref(href);
  return (
    <a
      href={href}
      className="min-w-0 text-sm font-medium break-all text-primary hover:underline"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {channel.value}
    </a>
  );
}

export function ContactChannelsSection({ contactId, channels }: ContactChannelsSectionProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const dialogReturnTarget = useRef<FocusTarget>({ kind: "add" });
  // Re-applied after the refresh lands: a refresh can unmount the focused control or move its row.
  const pendingFocus = useRef<FocusTarget | null>(null);
  const rows = sortChannels(channels);
  const typesWithChannels = new Set(channels.map((channel) => channel.channelType));

  function focusTarget(target: FocusTarget) {
    const element =
      target.kind === "edit" ? editButtons.current.get(target.channelId) : addButtonRef.current;
    (element ?? addButtonRef.current)?.focus();
  }

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    // Only recover focus that the refresh lost; never pull it back from where the user moved it.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const element =
      target.kind === "edit" ? editButtons.current.get(target.channelId) : addButtonRef.current;
    (element ?? addButtonRef.current)?.focus();
  }, [channels]);

  function openDialog(channel: ContactChannel | null) {
    setActionError(null);
    dialogReturnTarget.current = channel ? { kind: "edit", channelId: channel.id } : { kind: "add" };
    setDialog((current) => ({ key: (current?.key ?? 0) + 1, channel, open: true }));
  }

  function closeDialog() {
    setDialog((current) => (current ? { ...current, open: false } : current));
  }

  /** After removing a row, the next row's Edit button, else the previous row's, else Add channel. */
  function focusTargetAfterRemoving(channel: ContactChannel): FocusTarget {
    const index = rows.findIndex((row) => row.id === channel.id);
    const neighbour = rows[index + 1] ?? rows[index - 1];
    return neighbour ? { kind: "edit", channelId: neighbour.id } : { kind: "add" };
  }

  async function mutate(
    channel: ContactChannel,
    init: RequestInit,
    failure: string,
    afterSuccess: FocusTarget,
  ) {
    if (busyId) return;
    setBusyId(channel.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/channels/${channel.id}`, init);
      if (!res.ok) {
        setActionError(failure);
        return;
      }
      focusTarget(afterSuccess);
      pendingFocus.current = afterSuccess;
      router.refresh();
    } catch {
      setActionError(failure);
    } finally {
      setBusyId(null);
    }
  }

  function setPrimary(channel: ContactChannel) {
    void mutate(
      channel,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      },
      `Could not make ${channel.value} primary. Try again.`,
      // The button disappears once the row is primary; keep the user on that row.
      { kind: "edit", channelId: channel.id },
    );
  }

  function remove(channel: ContactChannel) {
    void mutate(
      channel,
      { method: "DELETE" },
      `Could not remove ${channel.value}. Try again.`,
      focusTargetAfterRemoving(channel),
    );
  }

  return (
    <section aria-labelledby={`${contactId}-channels-heading`} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${contactId}-channels-heading`} className="text-lg font-semibold">
            Channels
          </h3>
          <p className="text-sm text-muted-foreground">How you reach them: email, phone, messaging.</p>
        </div>
        <Button ref={addButtonRef} size="sm" variant="outline" onClick={() => openDialog(null)}>
          <Plus className="mr-2 h-4 w-4" />
          Add channel
        </Button>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-sm text-muted-foreground">
              No email, phone or messaging channel yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {rows.map((channel) => {
              const labelText = channelLabelText(channel.label);
              // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
              const busy = busyId === channel.id;
              return (
                <li
                  key={channel.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="neutral">
                      {channelTypeLabels[channel.channelType] ?? channel.channelType}
                    </Badge>
                    <ChannelValue channel={channel} />
                    {labelText ? <Badge variant="secondary">{labelText}</Badge> : null}
                    {channel.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                    {channel.isVerified ? (
                      <Badge variant="outline">
                        <BadgeCheck aria-hidden="true" />
                        Verified
                      </Badge>
                    ) : null}
                    {channel.scope === "local_only" ? (
                      <Badge variant="neutral">Local only</Badge>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                    {channel.isPrimary ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-disabled={busy}
                        onClick={() => setPrimary(channel)}
                      >
                        Set as primary
                      </Button>
                    )}
                    <Button
                      ref={(element) => {
                        if (element) editButtons.current.set(channel.id, element);
                        else editButtons.current.delete(channel.id);
                      }}
                      variant="ghost"
                      size="icon"
                      aria-disabled={busy}
                      onClick={() => {
                        if (!busy) openDialog(channel);
                      }}
                      aria-label={`Edit ${channel.value}`}
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-disabled={busy}
                      onClick={() => remove(channel)}
                      aria-label={`Remove ${channel.value}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {dialog ? (
        <ContactChannelDialog
          key={dialog.key}
          contactId={contactId}
          open={dialog.open}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusTarget(dialogReturnTarget.current);
          }}
          channel={dialog.channel}
          typesWithChannels={typesWithChannels}
          onSaved={() => {
            pendingFocus.current = dialogReturnTarget.current;
            closeDialog();
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
