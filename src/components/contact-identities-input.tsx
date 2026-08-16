"use client";

import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import {
  CRM_IDENTITY_PLATFORMS,
  emptyDraftIdentity,
  platformLabels,
  type DraftContactIdentity,
} from "@/lib/contact-identity-draft";
import type { Platform } from "@/lib/db/platforms";

interface ContactIdentitiesInputProps {
  onChange: (identities: DraftContactIdentity[]) => void;
}

export function ContactIdentitiesInput({ onChange }: ContactIdentitiesInputProps) {
  const [rows, setRows] = useState<DraftContactIdentity[]>([]);

  function sync(next: DraftContactIdentity[]) {
    setRows(next);
    onChange(next);
  }

  function updateRow(index: number, patch: Partial<DraftContactIdentity>) {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...patch } : row,
    );
    sync(next);
  }

  function addRow() {
    sync([...rows, emptyDraftIdentity()]);
  }

  function removeRow(index: number) {
    sync(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function setPrimary(index: number) {
    sync(
      rows.map((row, rowIndex) => ({
        ...row,
        isPrimary: rowIndex === index,
      })),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Platform Identities</Label>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-2 h-4 w-4" />
          Add Identity
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Optional — link X, LinkedIn, Gmail, or Substack accounts.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Identity {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(index)}
                  aria-label={`Remove identity ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor={`identity-platform-${index}`}>Platform</Label>
                  <Select
                    value={row.platform}
                    onValueChange={(value) =>
                      updateRow(index, { platform: value as Platform })
                    }
                  >
                    <SelectTrigger id={`identity-platform-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CRM_IDENTITY_PLATFORMS.map((platform) => (
                        <SelectItem key={platform} value={platform}>
                          {platformLabels[platform] ?? platform}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`identity-user-id-${index}`}>User ID</Label>
                  <Input
                    id={`identity-user-id-${index}`}
                    value={row.platformUserId}
                    onChange={(event) =>
                      updateRow(index, { platformUserId: event.target.value })
                    }
                    placeholder="Platform user ID"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor={`identity-handle-${index}`}>Handle</Label>
                  <Input
                    id={`identity-handle-${index}`}
                    value={row.platformHandle}
                    onChange={(event) =>
                      updateRow(index, { platformHandle: event.target.value })
                    }
                    placeholder="@handle"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`identity-url-${index}`}>Profile URL</Label>
                  <Input
                    id={`identity-url-${index}`}
                    value={row.platformUrl}
                    onChange={(event) =>
                      updateRow(index, { platformUrl: event.target.value })
                    }
                    placeholder="https://..."
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="primary-identity"
                  checked={row.isPrimary}
                  onChange={() => setPrimary(index)}
                />
                Primary identity
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
