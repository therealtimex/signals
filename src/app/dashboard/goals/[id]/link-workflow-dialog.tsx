"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WorkflowTemplateOption {
  id: string;
  name: string;
  templateType: string;
}

interface LinkWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goalId: string;
  existingTemplateIds: string[];
  onSuccess: () => void;
}

export function LinkWorkflowDialog({
  open,
  onOpenChange,
  goalId,
  existingTemplateIds,
  onSuccess,
}: LinkWorkflowDialogProps) {
  const [templates, setTemplates] = useState<WorkflowTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [contribution, setContribution] = useState<"primary" | "supporting">("primary");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/workflows/templates?status=active&pageSize=100")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((data) => {
        const available = (data.data ?? data.templates ?? []).filter(
          (t: WorkflowTemplateOption) => !existingTemplateIds.includes(t.id)
        );
        setTemplates(available);
        setSelectedTemplateId(available[0]?.id ?? "");
      })
      .catch(() => {});
  }, [open, existingTemplateIds]);

  async function handleLink() {
    if (!selectedTemplateId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/goals/${goalId}/link-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId, contribution }),
      });
      if (res.ok) {
        onOpenChange(false);
        onSuccess();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Workflow Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Workflow Template</Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No available templates to link. All active templates are already linked.
              </p>
            ) : (
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.templateType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Contribution Level</Label>
            <Select value={contribution} onValueChange={(v) => setContribution(v as "primary" | "supporting")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="supporting">Supporting</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={saving || !selectedTemplateId}
          >
            {saving ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
