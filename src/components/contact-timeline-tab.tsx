"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  StickyNote,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActivityMarkdown } from "@/components/activity-markdown";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatAttachmentError,
  formatInteractionType,
  formatTimelineOccurredAt,
  INTERACTION_TYPE_GROUP_LABELS,
  isImageMime,
  isPdfAttachment,
} from "@/lib/contact-detail-format";
import { INTERACTION_TYPE_GROUPS } from "@/lib/db/interaction-types";
import type { ContactTimelineItem } from "@/lib/db/queries/contact-timeline";
import type { MediaAttachmentDTO } from "@/lib/serializers/media-attachment";
import { cn } from "@/lib/utils";

type ContactTimelineTabProps = {
  contactId: string;
};

type PendingAttachment = {
  id: string;
  filename: string;
};

const COMPOSER_GROUPS = ["manual", "communication", "social", "passive"] as const;

export function filesFromDataTransfer(
  dataTransfer: { files?: ArrayLike<File> | File[] } | null | undefined,
): File[] {
  if (!dataTransfer?.files) return [];
  return Array.from(dataTransfer.files as ArrayLike<File>);
}

function getDataTransfer(event: React.DragEvent) {
  return event.dataTransfer ?? (event.nativeEvent as DragEvent | undefined)?.dataTransfer;
}

export function ContactTimelineTab({ contactId }: ContactTimelineTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const [items, setItems] = useState<ContactTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interactionType, setInteractionType] = useState<string>("note");
  const [summary, setSummary] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<MediaAttachmentDTO | null>(null);

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

  async function handleUploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.name);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("context", "attachment");
        const res = await fetch("/api/media", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Upload failed");
        }
        const asset = (await res.json()) as { id: string; filename?: string };
        setAttachments((current) => [
          ...current,
          { id: asset.id, filename: asset.filename || file.name },
        ]);
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setError(formatAttachmentError(message));
    } finally {
      setUploading(false);
    }
  }

  function isFileDrag(event: React.DragEvent) {
    const types = getDataTransfer(event)?.types;
    return Boolean(types && Array.from(types).includes("Files"));
  }

  function onComposerDragEnter(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCount.current += 1;
    setDragOver(true);
  }

  function onComposerDragOver(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const transfer = getDataTransfer(event);
    if (transfer) transfer.dropEffect = "copy";
  }

  function onComposerDragLeave(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDragOver(false);
  }

  function onComposerDrop(event: React.DragEvent) {
    event.preventDefault();
    dragCount.current = 0;
    setDragOver(false);
    const files = filesFromDataTransfer(getDataTransfer(event));
    if (files.length > 0) void handleUploadFiles(files);
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
          attachmentIds: attachments.length > 0 ? attachments.map((item) => item.id) : undefined,
          scope: "local_only",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to log interaction");
      }
      setSummary("");
      setAttachments([]);
      await loadTimeline();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to log interaction");
    } finally {
      setSaving(false);
    }
  }

  const hasTimeline = !loading && items.length > 0;

  return (
    <Card className="gap-0 py-0">
      <form className={hasTimeline ? "border-b" : undefined} onSubmit={handleSubmit}>
        <div className="p-3">
          <div
            data-composer=""
            aria-label="Activity composer. Drop files to attach."
            onDragEnter={onComposerDragEnter}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            onDrop={onComposerDrop}
            className={cn(
              "relative rounded-lg border focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
              dragOver && "border-primary ring-primary/50 ring-[3px]",
            )}
          >
            <Textarea
              id="interaction-summary"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What happened?"
              className="min-h-20 max-h-40 field-sizing-content resize-none border-0 py-2.5 shadow-none focus-visible:ring-0"
            />
            {error ? (
              <p className="px-3 pb-1.5 text-sm text-destructive">{error}</p>
            ) : null}
            {dragOver ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">
                Drop to attach
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1.5">
              <Select value={interactionType} onValueChange={setInteractionType}>
                <SelectTrigger
                  id="interaction-type"
                  size="sm"
                  className="w-auto border-0 shadow-none"
                  aria-label="Interaction type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPOSER_GROUPS.map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{INTERACTION_TYPE_GROUP_LABELS[group]}</SelectLabel>
                      {INTERACTION_TYPE_GROUPS[group].map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatInteractionType(type)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <input
                ref={fileInputRef}
                id="interaction-attachment"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp,image/heic,.jpg,.jpeg,.png,.gif,.webp,.heic,.pdf,.docx,.pptx,.xlsx,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg"
                disabled={uploading}
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files && event.target.files.length > 0) {
                    void handleUploadFiles(event.target.files);
                  }
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploading}
                aria-label="Attach"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
                Attach
              </Button>
              {attachments.length > 0 ? (
                <ul className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <AttachmentChip
                        filename={attachment.filename}
                        onRemove={() =>
                          setAttachments((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              <Button type="submit" size="sm" disabled={saving || uploading}>
                {saving ? "Saving…" : "Log"}
              </Button>
            </div>
          </div>
        </div>
      </form>

      {loading ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul data-timeline="" className="px-4 py-1">
          {items.map((item, index) => {
            const typeLabel = formatInteractionType(item.eventType);
            const Icon = iconForEventType(item.eventType);
            const last = index === items.length - 1;
            return (
              <li key={`${item.kind}:${item.id}`} className="flex gap-3">
                <div className="flex w-7 shrink-0 flex-col items-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {last ? null : <span className="mt-1 w-px flex-1 bg-border" />}
                </div>
                <div className={last ? "min-w-0 flex-1 pb-3 pt-0.5" : "min-w-0 flex-1 pb-4 pt-0.5"}>
                  {item.summary ? (
                    <ActivityMarkdown content={item.summary} />
                  ) : (
                    <p className="text-sm font-medium">{typeLabel}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.summary ? `${typeLabel} · ` : null}
                    {formatTimelineOccurredAt(item.occurredAt)}
                  </p>
                  {item.attachments.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap items-start gap-2">
                      {item.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <TimelineAttachment
                            attachment={attachment}
                            onPreview={() => setPreview(attachment)}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview ? (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-8">{preview.filename}</DialogTitle>
              <DialogDescription>
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Open original
                </a>
              </DialogDescription>
            </DialogHeader>
            {isImageMime(preview.mimeType) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.filename}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            ) : isPdfAttachment(preview.mimeType, preview.filename) ? (
              <iframe
                src={preview.url}
                title={preview.filename}
                className="h-[70vh] w-full rounded-md border"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Preview isn't available for this file type.
              </p>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

function iconForEventType(type: string) {
  switch (type) {
    case "meeting":
      return Calendar;
    case "call":
      return Phone;
    case "email":
    case "reply":
      return Mail;
    case "message":
    case "dm":
      return MessageSquare;
    case "note":
      return StickyNote;
    case "intro":
      return Users;
    default:
      return FileText;
  }
}

function TimelineAttachment({
  attachment,
  onPreview,
}: {
  attachment: MediaAttachmentDTO;
  onPreview: () => void;
}) {
  if (isImageMime(attachment.mimeType)) {
    return (
      <button
        type="button"
        onClick={onPreview}
        className="block overflow-hidden rounded-md border"
        aria-label={`Preview ${attachment.filename}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt="" className="h-16 w-16 object-cover" />
      </button>
    );
  }
  return (
    <button type="button" onClick={onPreview} aria-label={`Preview ${attachment.filename}`}>
      <AttachmentChip filename={attachment.filename} />
    </button>
  );
}

function AttachmentChip({
  filename,
  href,
  onRemove,
}: {
  filename: string;
  href?: string;
  onRemove?: () => void;
}) {
  const label = <span className="max-w-[12rem] truncate">{filename}</span>;
  return (
    <Badge variant="secondary" className="gap-1 pr-1 font-normal">
      {href ? (
        <a href={href} className="hover:underline">
          {label}
        </a>
      ) : (
        label
      )}
      {onRemove ? (
        <button
          type="button"
          className="rounded-full p-0.5 hover:bg-muted"
          aria-label={`Remove ${filename}`}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </Badge>
  );
}
