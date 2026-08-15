"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VARIANT_TYPES } from "@/lib/db/variant-types";
import type { LaunchVariantSummary } from "@/lib/db/queries/launches";

const DIALOG_STATUSES = ["draft", "selected", "rejected"] as const;

interface VariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  launchId: string;
  editVariant?: LaunchVariantSummary;
}

export function VariantDialog({
  open,
  onOpenChange,
  onSuccess,
  launchId,
  editVariant,
}: VariantDialogProps) {
  const [label, setLabel] = useState("");
  const [variantType, setVariantType] = useState<string>("post");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSimulatedCurrent = editVariant?.status === "simulated";

  useEffect(() => {
    if (editVariant) {
      setLabel(editVariant.label ?? "");
      setVariantType(editVariant.variantType);
      setBody("");
      setStatus(editVariant.status);
    } else {
      setLabel("");
      setVariantType("post");
      setBody("");
      setStatus("draft");
    }
    setError(null);
  }, [editVariant, open]);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        label: label.trim() ? label.trim() : null,
        variantType,
      };
      if (body.trim()) {
        payload.body = body.trim();
      } else if (!editVariant) {
        payload.body = null;
      }
      if (!editVariant || !isSimulatedCurrent || status !== "simulated") {
        payload.status = DIALOG_STATUSES.includes(status as (typeof DIALOG_STATUSES)[number])
          ? status
          : isSimulatedCurrent
            ? undefined
            : status;
      }
      if (payload.status === undefined) {
        delete payload.status;
      }

      const url = editVariant
        ? `/api/variants/${editVariant.id}`
        : `/api/launches/${launchId}/variants`;
      const method = editVariant ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onOpenChange(false);
        onSuccess();
        return;
      }

      const response = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(response?.error ?? "Failed to save variant");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editVariant ? "Edit Variant" : "Add Variant"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variant-label">Label</Label>
            <Input
              id="variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="A"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={variantType} onValueChange={setVariantType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VARIANT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSimulatedCurrent && (
                    <SelectItem value="simulated" disabled>
                      simulated
                    </SelectItem>
                  )}
                  {DIALOG_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="variant-body">Body</Label>
            <Textarea
              id="variant-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={editVariant ? "Leave blank to keep existing copy" : "Variant copy"}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : editVariant ? "Update" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
