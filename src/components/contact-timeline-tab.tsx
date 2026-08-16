"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { INTERACTION_TYPES } from "@/lib/db/interaction-types";
import type { ContactTimelineItem } from "@/lib/db/queries/contact-timeline";

type ContactTimelineTabProps = {
  contactId: string;
};

export function ContactTimelineTab({ contactId }: ContactTimelineTabProps) {
  const [items, setItems] = useState<ContactTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<string>("note");
  const [summary, setSummary] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/timeline`);
      if (!res.ok) {
        setError("Failed to load timeline");
        return;
      }
      const body = (await res.json()) as { items: ContactTimelineItem[] };
      setItems(body.items);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("context", "attachment");
      const res = await fetch("/api/media", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Upload failed");
      }
      const asset = (await res.json()) as { id: string };
      setAttachmentIds((current) => [...current, asset.id]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interactionType,
          summary: summary.trim() || undefined,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          scope: "local_only",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to log interaction");
      }
      setSummary("");
      setAttachmentIds([]);
      await loadTimeline();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to log interaction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Log interaction</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="interaction-type">Type</Label>
              <Select value={interactionType} onValueChange={setInteractionType}>
                <SelectTrigger id="interaction-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {INTERACTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interaction-summary">Summary</Label>
              <Textarea
                id="interaction-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What happened?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interaction-attachment">Attachment</Label>
              <Input
                id="interaction-attachment"
                type="file"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                  event.target.value = "";
                }}
              />
              {attachmentIds.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {attachmentIds.length} file(s) attached
                </p>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={saving || uploading}>
              {saving ? "Saving..." : "Log interaction"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading timeline...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            items.map((item) => (
              <div key={`${item.kind}:${item.id}`} className="border-b pb-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium capitalize">{item.eventType.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.occurredAt * 1000).toLocaleString()}
                  </p>
                </div>
                {item.summary && <p className="text-sm mt-1">{item.summary}</p>}
                {item.attachments.length > 0 && (
                  <ul className="mt-2 text-sm text-muted-foreground">
                    {item.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a href={attachment.url} className="text-primary hover:underline">
                          {attachment.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
