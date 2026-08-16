"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Plus, Trash2 } from "lucide-react";
import {
  CONTACT_CHANNEL_TYPES,
  channelTypeLabels,
  draftFromContactChannel,
  emptyDraftChannel,
  type DraftContactChannel,
} from "@/lib/contact-channel-draft";
import type { ContactChannel } from "@/lib/db/types";

type Row = DraftContactChannel & { rowId: string };

interface ContactChannelsInputProps {
  defaultChannels?: ContactChannel[];
  onChange: (channels: DraftContactChannel[]) => void;
}

export function ContactChannelsInput({
  defaultChannels = [],
  onChange,
}: ContactChannelsInputProps) {
  const nextRowId = useRef(defaultChannels.length);
  const [rows, setRows] = useState<Row[]>(() =>
    defaultChannels.map((channel, index) => ({
      ...draftFromContactChannel(channel),
      rowId: `channel-row-${index}`,
    })),
  );

  function sync(next: Row[]) {
    setRows(next);
    onChange(next.map(({ rowId: _rowId, ...channel }) => channel));
  }

  function updateRow(rowId: string, patch: Partial<DraftContactChannel>) {
    sync(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const rowId = `channel-row-${nextRowId.current++}`;
    sync([...rows, { ...emptyDraftChannel(), rowId }]);
  }

  function removeRow(rowId: string) {
    sync(rows.filter((row) => row.rowId !== rowId));
  }

  function setPrimary(rowId: string, channelType: string) {
    sync(
      rows.map((row) => ({
        ...row,
        isPrimary:
          row.channelType === channelType
            ? row.rowId === rowId
            : row.isPrimary,
      })),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Channels</Label>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-2 h-4 w-4" />
          Add Channel
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Optional — add email, phone, or messenger handles.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.rowId} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Channel {index + 1}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeRow(row.rowId)}
                  aria-label={`Remove channel ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor={`${row.rowId}-type`}>Type</Label>
                  <Select
                    value={row.channelType}
                    onValueChange={(value) => updateRow(row.rowId, { channelType: value })}
                  >
                    <SelectTrigger id={`${row.rowId}-type`}>
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
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${row.rowId}-value`}>Value</Label>
                  <Input
                    id={`${row.rowId}-value`}
                    value={row.value}
                    onChange={(e) => updateRow(row.rowId, { value: e.target.value })}
                    placeholder={row.channelType === "email" ? "email@example.com" : "+1 555 0000"}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`${row.rowId}-primary`}
                    checked={Boolean(row.isPrimary)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setPrimary(row.rowId, row.channelType);
                      } else {
                        updateRow(row.rowId, { isPrimary: false });
                      }
                    }}
                  />
                  <Label htmlFor={`${row.rowId}-primary`}>Primary</Label>
                </div>
                {row.channelType === "email" ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`${row.rowId}-verified`}
                      checked={Boolean(row.isVerified)}
                      onCheckedChange={(checked) =>
                        updateRow(row.rowId, { isVerified: checked })
                      }
                    />
                    <Label htmlFor={`${row.rowId}-verified`}>Verified</Label>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
