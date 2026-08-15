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
import {
  VARIANT_DIALOG_STATUSES,
  buildVariantSavePayload,
  canSubmitVariantDialog,
} from "./variant-dialog-utils";

interface VariantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  launchId: string;
  editVariantId?: string | null;
}

type LoadedVariant = {
  label: string | null;
  variantType: string;
  body: string | null;
  status: string;
};

const EMPTY_FORM = {
  label: "",
  variantType: "post",
  body: "",
  status: "draft",
};

export function VariantDialog({
  open,
  onOpenChange,
  onSuccess,
  launchId,
  editVariantId,
}: VariantDialogProps) {
  const [label, setLabel] = useState(EMPTY_FORM.label);
  const [variantType, setVariantType] = useState<string>(EMPTY_FORM.variantType);
  const [body, setBody] = useState(EMPTY_FORM.body);
  const [status, setStatus] = useState<string>(EMPTY_FORM.status);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedEditVariantId, setLoadedEditVariantId] = useState<string | null>(null);

  const isSimulatedCurrent = status === "simulated";
  const canSubmit = canSubmitVariantDialog({
    editVariantId,
    loadedEditVariantId,
    loadError: error,
    loading,
  });
  const fieldsDisabled = loading || (Boolean(editVariantId) && !canSubmit);

  useEffect(() => {
    if (!open) return;

    if (!editVariantId) {
      setLabel(EMPTY_FORM.label);
      setVariantType(EMPTY_FORM.variantType);
      setBody(EMPTY_FORM.body);
      setStatus(EMPTY_FORM.status);
      setError(null);
      setLoading(false);
      setLoadedEditVariantId(null);
      return;
    }

    const variantId = editVariantId;
    let cancelled = false;
    async function loadVariant() {
      setLoading(true);
      setError(null);
      setLoadedEditVariantId(null);
      setLabel(EMPTY_FORM.label);
      setVariantType(EMPTY_FORM.variantType);
      setBody(EMPTY_FORM.body);
      setStatus(EMPTY_FORM.status);
      try {
        const res = await fetch(`/api/variants/${variantId}`);
        if (!res.ok) {
          if (!cancelled) {
            setError("Failed to load variant");
          }
          return;
        }
        const variant = (await res.json()) as LoadedVariant;
        if (cancelled) return;
        setLabel(variant.label ?? "");
        setVariantType(variant.variantType);
        setBody(variant.body ?? "");
        setStatus(variant.status);
        setLoadedEditVariantId(variantId);
      } catch {
        if (!cancelled) {
          setError("Failed to load variant");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadVariant();
    return () => {
      cancelled = true;
    };
  }, [editVariantId, open]);

  async function handleSubmit() {
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      const payload = buildVariantSavePayload({
        label,
        variantType,
        body,
        status,
        isEdit: Boolean(editVariantId),
        isSimulatedCurrent,
      });

      const url = editVariantId
        ? `/api/variants/${editVariantId}`
        : `/api/launches/${launchId}/variants`;
      const method = editVariantId ? "PUT" : "POST";
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
          <DialogTitle>{editVariantId ? "Edit Variant" : "Add Variant"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variant-label">Label</Label>
            <Input
              id="variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="A"
              disabled={fieldsDisabled}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={variantType}
                onValueChange={setVariantType}
                disabled={fieldsDisabled}
              >
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
              <Select value={status} onValueChange={setStatus} disabled={fieldsDisabled}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSimulatedCurrent && (
                    <SelectItem value="simulated" disabled>
                      simulated
                    </SelectItem>
                  )}
                  {VARIANT_DIALOG_STATUSES.map((value) => (
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
              placeholder="Variant copy"
              disabled={fieldsDisabled}
            />
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading variant…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !canSubmit}>
            {saving ? "Saving..." : editVariantId ? "Update" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
