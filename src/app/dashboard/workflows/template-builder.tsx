"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Loader2 } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string | null;
  templateType: string;
  platform: string | null;
  status: string;
  systemPrompt: string | null;
  targetPersona: string | null;
  estimatedCost: number;
  config: string;
}

interface TemplateBuilderProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editTemplate?: Template;
}

const TEMPLATE_TYPES = [
  { value: "prospecting", label: "Prospecting (Search)" },
  { value: "enrichment", label: "Enrichment" },
  { value: "pruning", label: "Pruning" },
  { value: "content", label: "Content" },
  { value: "engagement", label: "Engagement" },
  { value: "outreach", label: "Outreach" },
  { value: "nurture", label: "Nurture" },
];

const PLATFORMS = [
  { value: "none", label: "Any Platform" },
  { value: "x", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn" },
];

function parseConfig(config: string): Record<string, unknown> {
  try {
    return JSON.parse(config);
  } catch {
    return {};
  }
}

export function TemplateBuilder({ open, onClose, onSaved, editTemplate }: TemplateBuilderProps) {
  const isEdit = !!editTemplate;
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState(editTemplate?.name ?? "");
  const [description, setDescription] = useState(editTemplate?.description ?? "");
  const [templateType, setTemplateType] = useState(editTemplate?.templateType ?? "prospecting");
  const [platform, setPlatform] = useState(editTemplate?.platform ?? "none");
  const [systemPrompt, setSystemPrompt] = useState(editTemplate?.systemPrompt ?? "");
  const [targetPersona, setTargetPersona] = useState(editTemplate?.targetPersona ?? "");
  const [estimatedCost, setEstimatedCost] = useState(String(editTemplate?.estimatedCost ?? "0.20"));
  const [configJson, setConfigJson] = useState(
    editTemplate?.config ? JSON.stringify(parseConfig(editTemplate.config), null, 2) : "{}"
  );

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      templateType,
      platform: platform !== "none" ? platform : undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      targetPersona: targetPersona.trim() || undefined,
      estimatedCost: parseFloat(estimatedCost) || 0,
      config: configJson.trim() || "{}",
    };

    try {
      const url = isEdit
        ? `/api/workflows/templates/${editTemplate.id}`
        : "/api/workflows/templates";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Agent" : "Create Agent"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modify your custom agent configuration."
              : "Build a custom AI agent for your workflows."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My Custom Template"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What does this template do?"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Type + Platform row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Template Type</Label>
              <Select value={templateType} onValueChange={setTemplateType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Target Persona */}
          <div className="space-y-1.5">
            <Label htmlFor="targetPersona">Target Persona</Label>
            <Input
              id="targetPersona"
              placeholder="e.g., Startup founders in AI/ML with 10K+ followers"
              value={targetPersona}
              onChange={(e) => setTargetPersona(e.target.value)}
            />
          </div>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              placeholder="Instructions for the AI agent..."
              rows={8}
              className="font-mono text-xs"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>

          {/* Cost + Config row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="estimatedCost">Estimated Cost (USD)</Label>
              <Input
                id="estimatedCost"
                type="number"
                step="0.01"
                min="0"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
              />
            </div>
          </div>

          {/* Config JSON */}
          <div className="space-y-1.5">
            <Label htmlFor="config">Config (JSON)</Label>
            <Textarea
              id="config"
              rows={4}
              className="font-mono text-xs"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              placeholder='{"maxResults": 20, "targetDomains": ["x.com"]}'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
