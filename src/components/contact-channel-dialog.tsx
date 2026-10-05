"use client";

import { useId, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CHANNEL_LABEL_PRESETS,
  CONTACT_CHANNEL_TYPES,
  VERIFIABLE_CHANNEL_TYPES,
  channelDuplicateNoun,
  channelLabelText,
  channelTypeLabels,
  channelValuePlaceholder,
} from "@/lib/contact-channel-draft";
import { normalizeChannelValue, type ChannelType } from "@/lib/db/channel-types";
import type { ContactChannel } from "@/lib/db/types";

const NO_LABEL = "none";

function normalizedOrNull(channelType: string, value: string): string | null {
  try {
    return normalizeChannelValue(channelType as ChannelType, value);
  } catch {
    return null;
  }
}

interface ContactChannelDialogProps {
  contactId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being edited; absent in add mode. Remount (key) per open to reset the form. */
  channel?: ContactChannel | null;
  /** Types the contact already has a channel of, so the first of a type defaults to primary. */
  typesWithChannels: ReadonlySet<string>;
  onSaved: () => void;
  /** Where focus goes when the dialog closes; there is no trigger element to return to. */
  onCloseAutoFocus?: (event: Event) => void;
}

export function ContactChannelDialog({
  contactId,
  open,
  onOpenChange,
  channel = null,
  typesWithChannels,
  onSaved,
  onCloseAutoFocus,
}: ContactChannelDialogProps) {
  const fieldId = useId();
  const [channelType, setChannelType] = useState(channel?.channelType ?? "email");
  const [value, setValue] = useState(channel?.value ?? "");
  const [label, setLabel] = useState(() => channel?.label?.trim() || NO_LABEL);
  const [primaryChoice, setPrimaryChoice] = useState<boolean | null>(
    channel ? channel.isPrimary : null,
  );
  const [verifiedChoice, setVerifiedChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isPrimary = primaryChoice ?? !typesWithChannels.has(channelType);
  const valueChanged = channel
    ? normalizedOrNull(channelType, value) !== channel.valueNormalized
    : false;
  // A verification describes one address: a changed value starts unverified, as on the server.
  const verifiedBaseline = Boolean(channel?.isVerified) && !valueChanged;
  const isVerified = verifiedChoice ?? verifiedBaseline;
  // The UI offers no "unset primary": another row of the type takes the flag instead.
  const primaryLocked = Boolean(channel?.isPrimary);
  const showVerified = VERIFIABLE_CHANNEL_TYPES.includes(channelType);
  const typeLabel = channelTypeLabels[channelType] ?? channelType;
  const customLabel =
    label !== NO_LABEL && !(CHANNEL_LABEL_PRESETS as readonly string[]).includes(label)
      ? label
      : null;

  function requestBody(): Record<string, unknown> {
    const nextLabel = label === NO_LABEL ? null : label;
    if (!channel) {
      return {
        channelType,
        value,
        label: nextLabel,
        isPrimary,
        ...(showVerified ? { isVerified } : {}),
      };
    }
    // Send only what changed, so re-saving a probe-verified row keeps its provenance.
    const body: Record<string, unknown> = {};
    if (value.trim() !== channel.value) body.value = value;
    if (nextLabel !== (channel.label?.trim() || null)) body.label = nextLabel;
    if (isPrimary !== channel.isPrimary) body.isPrimary = isPrimary;
    if (showVerified && isVerified !== verifiedBaseline) body.isVerified = isVerified;
    return body;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = requestBody();
    if (channel && Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        channel
          ? `/api/contacts/${contactId}/channels/${channel.id}`
          : `/api/contacts/${contactId}/channels`,
        {
          method: channel ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const serverMessage =
          typeof payload === "object" && payload !== null && "error" in payload
            ? (payload as { error: unknown }).error
            : null;
        setError(
          res.status === 409
            ? `This contact already has that ${channelDuplicateNoun(channelType)}.`
            : typeof serverMessage === "string" && serverMessage
              ? serverMessage
              : "Could not save the channel. Try again.",
        );
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach Signals. Check that it is running and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{channel ? "Edit channel" : "Add channel"}</DialogTitle>
            <DialogDescription>
              {channel
                ? "Change the value, label, or flags. The type cannot change."
                : "An email address, phone number, or messaging handle for this contact."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {channel ? (
              <>
                <p className="text-sm leading-none font-medium">Type</p>
                <div>
                  <Badge variant="neutral">{typeLabel}</Badge>
                </div>
              </>
            ) : (
              <>
                <Label htmlFor={`${fieldId}-type`}>Type</Label>
                <Select value={channelType} onValueChange={setChannelType}>
                  <SelectTrigger id={`${fieldId}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_CHANNEL_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {channelTypeLabels[type] ?? type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-value`}>Value</Label>
            <Input
              id={`${fieldId}-value`}
              value={value}
              onChange={(event) => {
                const next = event.target.value;
                if (channel && normalizedOrNull(channelType, next) !== channel.valueNormalized) {
                  setVerifiedChoice(null);
                }
                setValue(next);
              }}
              placeholder={channelValuePlaceholder(channelType)}
              autoComplete="off"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-label`}>Label</Label>
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger id={`${fieldId}-label`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LABEL}>None</SelectItem>
                {CHANNEL_LABEL_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {channelLabelText(preset)}
                  </SelectItem>
                ))}
                {customLabel ? <SelectItem value={customLabel}>{customLabel}</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id={`${fieldId}-primary`}
                checked={isPrimary}
                disabled={primaryLocked}
                onCheckedChange={setPrimaryChoice}
              />
              <Label htmlFor={`${fieldId}-primary`}>Primary {typeLabel.toLowerCase()}</Label>
            </div>
            {primaryLocked ? (
              <p className="text-xs text-muted-foreground">
                To change the primary, set another {typeLabel.toLowerCase()} as primary.
              </p>
            ) : null}
            {showVerified ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={`${fieldId}-verified`}
                  checked={isVerified}
                  onCheckedChange={setVerifiedChoice}
                />
                <Label htmlFor={`${fieldId}-verified`}>Verified</Label>
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !value.trim()}>
              {saving ? "Saving…" : channel ? "Save" : "Add channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
