"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Play } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string | null;
  templateType: string;
  systemPrompt: string | null;
  targetPersona: string | null;
  config: string;
}

interface ActivateDialogProps {
  template: Template;
  open: boolean;
  onClose: () => void;
}

export function ActivateDialog({ template, open, onClose }: ActivateDialogProps) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadPath, setThreadPath] = useState<string | null>(null);

  const [systemPrompt, setSystemPrompt] = useState(template.systemPrompt ?? "");
  const templateConfig = JSON.parse(template.config || "{}");

  const [maxResults, setMaxResults] = useState(String(templateConfig.maxResults ?? 20));
  const [maxContacts, setMaxContacts] = useState(String(templateConfig.maxContacts ?? 10));
  const [maxEnrichmentScore, setMaxEnrichmentScore] = useState(
    String(templateConfig.maxEnrichmentScore ?? 50)
  );
  const [companyName, setCompanyName] = useState(String(templateConfig.companyName ?? ""));
  const [inactivityDays, setInactivityDays] = useState(
    String(templateConfig.inactivityDays ?? 365)
  );
  const [topics, setTopics] = useState((templateConfig.topics as string[] ?? []).join(", "));
  const [tone, setTone] = useState(String(templateConfig.tone ?? "professional"));
  const [maxEngagements, setMaxEngagements] = useState(
    String(templateConfig.maxEngagements ?? templateConfig.maxReplies ?? 10)
  );

  async function handleRun() {
    setRunning(true);
    setError(null);
    setThreadPath(null);

    try {
      const config: Record<string, unknown> = {};

      if (template.templateType === "prospecting") {
        config.maxResults = parseInt(maxResults, 10) || 20;
      }
      if (template.templateType === "enrichment") {
        config.maxContacts = parseInt(maxContacts, 10) || 10;
        config.maxEnrichmentScore = parseInt(maxEnrichmentScore, 10) || 50;
      }
      if (template.templateType === "pruning") {
        config.maxContacts = parseInt(maxContacts, 10) || 20;
        config.companyName = companyName || undefined;
        config.inactivityDays = parseInt(inactivityDays, 10) || 365;
      }
      if (template.templateType === "content") {
        const topicsList = topics.split(",").map((t) => t.trim()).filter(Boolean);
        if (topicsList.length > 0) config.topics = topicsList;
        if (tone) config.tone = tone;
      }
      if (template.templateType === "engagement" || template.templateType === "outreach") {
        const maxEng = parseInt(maxEngagements, 10);
        if (maxEng > 0) {
          config.maxEngagements = maxEng;
          config.maxReplies = maxEng;
        }
      }

      const res = await fetch(`/api/workflows/templates/${template.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          systemPrompt: systemPrompt !== template.systemPrompt ? systemPrompt : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.toString() || "Failed to start agent");
        return;
      }

      if (data.threadPath) {
        setThreadPath(data.threadPath);
      }
    } catch {
      setError("Failed to start agent");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {template.targetPersona && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Audience / scope</p>
              <p className="text-sm">{template.targetPersona}</p>
            </div>
          )}

          {threadPath && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
              Agent launched in RealTimeX.{" "}
              <span className="font-mono text-xs">{threadPath}</span>
            </div>
          )}

          {!threadPath && (
            <>
              {template.templateType === "prospecting" && (
                <div className="space-y-2">
                  <Label htmlFor="max-results">Max Results</Label>
                  <Input
                    id="max-results"
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(e.target.value)}
                  />
                </div>
              )}

              {template.templateType === "enrichment" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="max-contacts">Max Contacts</Label>
                    <Input
                      id="max-contacts"
                      type="number"
                      value={maxContacts}
                      onChange={(e) => setMaxContacts(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-score">Max Enrichment Score</Label>
                    <Input
                      id="max-score"
                      type="number"
                      value={maxEnrichmentScore}
                      onChange={(e) => setMaxEnrichmentScore(e.target.value)}
                    />
                  </div>
                </>
              )}

              {template.templateType === "pruning" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="company-name">Company Name</Label>
                    <Input
                      id="company-name"
                      placeholder="e.g., Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inactivity-days">Inactivity Days</Label>
                    <Input
                      id="inactivity-days"
                      type="number"
                      value={inactivityDays}
                      onChange={(e) => setInactivityDays(e.target.value)}
                    />
                  </div>
                </>
              )}

              {template.templateType === "content" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="topics">Topics / Industries</Label>
                    <Input
                      id="topics"
                      placeholder="AI, fintech, developer tools"
                      value={topics}
                      onChange={(e) => setTopics(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tone">Tone</Label>
                    <Input
                      id="tone"
                      placeholder="professional"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                    />
                  </div>
                </>
              )}

              {(template.templateType === "engagement" || template.templateType === "outreach") && (
                <div className="space-y-2">
                  <Label htmlFor="max-engagements">Max Engagements</Label>
                  <Input
                    id="max-engagements"
                    type="number"
                    value={maxEngagements}
                    onChange={(e) => setMaxEngagements(e.target.value)}
                  />
                </div>
              )}

              <Separator />

              <details className="space-y-2">
                <summary className="text-sm font-medium cursor-pointer">
                  Instructions (Advanced)
                </summary>
                <div className="pt-2">
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={8}
                    className="text-xs font-mono"
                  />
                </div>
              </details>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={running}>
              {threadPath ? "Close" : "Cancel"}
            </Button>
            {!threadPath && (
              <Button onClick={handleRun} disabled={running}>
                {running ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {running ? "Launching..." : "Run Agent"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
