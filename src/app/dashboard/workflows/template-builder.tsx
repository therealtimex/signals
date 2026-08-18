"use client";

import { useEffect, useMemo, useState } from "react";
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
import { extractLimitsFromConfig } from "@/lib/workflows/template-config";
import { buildAgentWorkflowBrief, getTemplateToolsHint } from "@/lib/workflows/template-brief";
import type { WorkflowTemplate } from "@/lib/db/types";

interface Template {
  id: string;
  name: string;
  description: string | null;
  templateType: WorkflowTemplate["templateType"];
  platform: WorkflowTemplate["platform"];
  status: string;
  systemPrompt: string | null;
  targetPersona: string | null;
  config: string;
}

interface SystemTemplateOption {
  id: string;
  name: string;
  templateType: string;
}

interface TemplateBuilderProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editTemplate?: Template;
}

const TEMPLATE_TYPES = [
  { value: "prospecting", label: "Search" },
  { value: "enrichment", label: "Enrich" },
  { value: "pruning", label: "Prune" },
  { value: "content", label: "Content" },
  { value: "engagement", label: "Engage" },
  { value: "outreach", label: "Outreach" },
  { value: "nurture", label: "Nurture" },
];

const PLATFORMS = [
  { value: "none", label: "Any Platform" },
  { value: "x", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn" },
];

export function TemplateBuilder({ open, onClose, onSaved, editTemplate }: TemplateBuilderProps) {
  const isEdit = !!editTemplate;
  const [saving, setSaving] = useState(false);
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplateOption[]>([]);
  const [startFromTemplateId, setStartFromTemplateId] = useState<string>("none");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const initialLimits = editTemplate
    ? extractLimitsFromConfig(editTemplate.templateType, editTemplate.config)
    : {};

  const [name, setName] = useState(editTemplate?.name ?? "");
  const [description, setDescription] = useState(editTemplate?.description ?? "");
  const [templateType, setTemplateType] = useState<WorkflowTemplate["templateType"]>(
    editTemplate?.templateType ?? "prospecting"
  );
  const [platform, setPlatform] = useState<string>(editTemplate?.platform ?? "none");
  const [systemPrompt, setSystemPrompt] = useState(editTemplate?.systemPrompt ?? "");
  const [targetPersona, setTargetPersona] = useState(editTemplate?.targetPersona ?? "");
  const [maxResults, setMaxResults] = useState(String(initialLimits.maxResults ?? 20));
  const [maxContacts, setMaxContacts] = useState(String(initialLimits.maxContacts ?? 10));
  const [maxEnrichmentScore, setMaxEnrichmentScore] = useState(
    String(initialLimits.maxEnrichmentScore ?? 50)
  );
  const [companyName, setCompanyName] = useState(initialLimits.companyName ?? "");
  const [inactivityDays, setInactivityDays] = useState(String(initialLimits.inactivityDays ?? 365));
  const [topics, setTopics] = useState((initialLimits.topics ?? []).join(", "));
  const [tone, setTone] = useState(initialLimits.tone ?? "professional");
  const [maxEngagements, setMaxEngagements] = useState(String(initialLimits.maxEngagements ?? 10));
  const [configJson, setConfigJson] = useState(editTemplate?.config ?? "{}");

  useEffect(() => {
    if (!open || isEdit) return;
    fetch("/api/workflows/templates?isSystem=true&pageSize=50")
      .then((r) => r.json())
      .then((result) => setSystemTemplates(result.data ?? []))
      .catch(() => setSystemTemplates([]));
  }, [open, isEdit]);

  useEffect(() => {
    if (!startFromTemplateId || startFromTemplateId === "none" || isEdit) return;
    fetch(`/api/workflows/templates/${startFromTemplateId}`)
      .then((r) => r.json())
      .then((template: Template) => {
        setName(template.name);
        setDescription(template.description ?? "");
        setTemplateType(template.templateType);
        setPlatform(template.platform ?? "none");
        setSystemPrompt(template.systemPrompt ?? "");
        setTargetPersona(template.targetPersona ?? "");
        const limits = extractLimitsFromConfig(template.templateType, template.config);
        if (limits.maxResults !== undefined) setMaxResults(String(limits.maxResults));
        if (limits.maxContacts !== undefined) setMaxContacts(String(limits.maxContacts));
        if (limits.maxEnrichmentScore !== undefined) {
          setMaxEnrichmentScore(String(limits.maxEnrichmentScore));
        }
        if (limits.companyName) setCompanyName(limits.companyName);
        if (limits.inactivityDays !== undefined) setInactivityDays(String(limits.inactivityDays));
        if (limits.topics) setTopics(limits.topics.join(", "));
        if (limits.tone) setTone(limits.tone);
        if (limits.maxEngagements !== undefined) setMaxEngagements(String(limits.maxEngagements));
        setConfigJson(template.config);
      })
      .catch(() => undefined);
  }, [startFromTemplateId, isEdit]);

  const toolsHint = useMemo(() => getTemplateToolsHint(templateType).join(", "), [templateType]);

  const previewBrief = useMemo(() => {
    if (!name.trim()) return "";
    return buildAgentWorkflowBrief({
      template: {
        id: editTemplate?.id ?? "preview",
        name: name.trim(),
        description: description.trim() || null,
        templateType,
        platform: platform !== "none" ? (platform as WorkflowTemplate["platform"]) : null,
        systemPrompt: systemPrompt.trim() || null,
        targetPersona: targetPersona.trim() || null,
      },
      workflowRunId: "preview",
      config: {},
      signalsBaseUrl:
        typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    });
  }, [name, description, templateType, platform, systemPrompt, targetPersona, editTemplate?.id]);

  const buildLimitsPayload = () => {
    switch (templateType) {
      case "prospecting":
        return { maxResults: parseInt(maxResults, 10) || 20 };
      case "enrichment":
        return {
          maxContacts: parseInt(maxContacts, 10) || 10,
          maxEnrichmentScore: parseInt(maxEnrichmentScore, 10) || 50,
        };
      case "pruning":
        return {
          maxContacts: parseInt(maxContacts, 10) || 20,
          companyName: companyName.trim() || undefined,
          inactivityDays: parseInt(inactivityDays, 10) || 365,
        };
      case "content":
        return {
          topics: topics
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          tone: tone.trim() || undefined,
        };
      case "engagement":
      case "outreach":
        return { maxEngagements: parseInt(maxEngagements, 10) || 10 };
      default:
        return {};
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      templateType,
      platform: platform !== "none" ? platform : undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      targetPersona: targetPersona.trim() || undefined,
      limits: buildLimitsPayload(),
    };

    if (showAdvanced && configJson.trim()) {
      payload.config = configJson.trim();
    }

    if (!isEdit && startFromTemplateId !== "none") {
      payload.sourceTemplateId = startFromTemplateId;
    }

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
              ? "Update the brief your RealTimeX terminal agent will execute."
              : "Define a task brief for your RealTimeX terminal agent."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isEdit && systemTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Start from template</Label>
              <Select value={startFromTemplateId} onValueChange={setStartFromTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Blank agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Blank agent</SelectItem>
                  {systemTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Weekly founder search"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={templateType}
                onValueChange={(value) =>
                  setTemplateType(value as WorkflowTemplate["templateType"])
                }
              >
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

          <div className="space-y-1.5">
            <Label htmlFor="description">Goal</Label>
            <Textarea
              id="description"
              placeholder="Short one-liner describing what this agent should accomplish"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="systemPrompt">Instructions</Label>
            <Textarea
              id="systemPrompt"
              placeholder="Instructions for your RealTimeX agent (markdown supported)"
              rows={8}
              className="font-mono text-xs"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="targetPersona">Audience / scope</Label>
            <Input
              id="targetPersona"
              placeholder="e.g., Startup founders in AI/ML with 10K+ followers"
              value={targetPersona}
              onChange={(e) => setTargetPersona(e.target.value)}
            />
          </div>

          {templateType === "prospecting" && (
            <div className="space-y-1.5">
              <Label htmlFor="maxResults">Max results</Label>
              <Input
                id="maxResults"
                type="number"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
              />
            </div>
          )}

          {templateType === "enrichment" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="maxContacts">Max contacts</Label>
                <Input
                  id="maxContacts"
                  type="number"
                  value={maxContacts}
                  onChange={(e) => setMaxContacts(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxEnrichmentScore">Max enrichment score</Label>
                <Input
                  id="maxEnrichmentScore"
                  type="number"
                  value={maxEnrichmentScore}
                  onChange={(e) => setMaxEnrichmentScore(e.target.value)}
                />
              </div>
            </div>
          )}

          {templateType === "pruning" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inactivityDays">Inactivity days</Label>
                <Input
                  id="inactivityDays"
                  type="number"
                  value={inactivityDays}
                  onChange={(e) => setInactivityDays(e.target.value)}
                />
              </div>
            </div>
          )}

          {templateType === "content" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="topics">Topics</Label>
                <Input
                  id="topics"
                  placeholder="AI, fintech, developer tools"
                  value={topics}
                  onChange={(e) => setTopics(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tone">Tone</Label>
                <Input id="tone" value={tone} onChange={(e) => setTone(e.target.value)} />
              </div>
            </div>
          )}

          {(templateType === "engagement" || templateType === "outreach") && (
            <div className="space-y-1.5">
              <Label htmlFor="maxEngagements">Max engagements</Label>
              <Input
                id="maxEngagements"
                type="number"
                value={maxEngagements}
                onChange={(e) => setMaxEngagements(e.target.value)}
              />
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Tools</p>
            <p>Your RealTimeX agent should use: {toolsHint}</p>
          </div>

          <details className="space-y-2">
            <summary className="text-sm font-medium cursor-pointer">
              What the agent will see
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-[11px] whitespace-pre-wrap">
              {previewBrief || "Enter a name to preview the launch brief."}
            </pre>
          </details>

          <details
            className="space-y-2"
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          >
            <summary className="text-sm font-medium cursor-pointer">Advanced config (JSON)</summary>
            <Textarea
              rows={4}
              className="font-mono text-xs mt-2"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
            />
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
