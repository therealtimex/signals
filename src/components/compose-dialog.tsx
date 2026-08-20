"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { nanoid } from "nanoid";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PostInput } from "@/components/post-input";
import { FeedbackBanner } from "@/components/feedback-banner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Send } from "lucide-react";
import type { MediaThumbnailItem } from "@/components/media-thumbnail-grid";
import { validateMediaFile, validateMediaSet } from "@/lib/media/constraints";
import { sendToAgentErrorMessage } from "@/lib/publish/client-errors";
import type { PublishPlatformTarget } from "@/lib/publish/types";
import { cn } from "@/lib/utils";

type Platform = PublishPlatformTarget;

interface MediaAttachment extends MediaThumbnailItem {
  assetId?: string;
  fileSize: number;
}

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId?: string | null;
  onSuccess?: () => void;
  onSentToAgent?: (info: { jobId: string; threadPath: string | null }) => void;
}

const PLATFORM_OPTIONS: {
  id: Platform;
  label: string;
  maxChars: number;
  placeholder: string;
  beta?: boolean;
}[] = [
  { id: "x", label: "X", maxChars: 280, placeholder: "What's happening?" },
  {
    id: "linkedin",
    label: "LinkedIn",
    maxChars: 3000,
    placeholder: "What do you want to talk about?",
    beta: true,
  },
];

const STANDALONE_TOOLTIP = "Publishing requires the RealTimeX Local App";

function formatApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (Array.isArray(error)) {
    return error
      .map((entry) => {
        if (entry && typeof entry === "object" && "message" in entry) {
          return String((entry as { message: unknown }).message);
        }
        return String(entry);
      })
      .join("; ");
  }
  return fallback;
}

function parsePlatformTarget(value: string | null | undefined): Platform[] {
  if (!value) return ["x"];
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is Platform => p === "x" || p === "linkedin");
  return parts.length > 0 ? parts : ["x"];
}

export function ComposeDialog({
  open,
  onOpenChange,
  draftId,
  onSuccess,
  onSentToAgent,
}: ComposeDialogProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["x"]);
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  const blobUrlsRef = useRef<string[]>([]);

  const primaryPlatform = selectedPlatforms[0] ?? "x";
  const guidanceChars = Math.min(
    ...selectedPlatforms.map(
      (p) => PLATFORM_OPTIONS.find((o) => o.id === p)?.maxChars ?? 280
    )
  );

  useEffect(() => {
    if (!open) return;
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        setEmbedded(data?.rtx?.mode === "embedded" && Boolean(data?.rtx?.appId));
      })
      .catch(() => setEmbedded(false));
  }, [open]);

  const hydrateMedia = useCallback(async (contentItemId: string): Promise<MediaAttachment[]> => {
    try {
      const res = await fetch(`/api/media?contentItemId=${contentItemId}`);
      const data = await res.json();
      return (data.assets || []).map((a: { id: string; filename: string; mimeType: string; fileSize: number }) => ({
        id: a.id,
        previewUrl: `/api/media/${a.id}`,
        filename: a.filename,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        assetId: a.id,
        uploading: false,
      }));
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!draftId) {
      setBody("");
      setMedia([]);
      setSelectedPlatforms(["x"]);
      setError(null);
      return;
    }

    setLoadingDraft(true);
    setError(null);

    fetch(`/api/content/${draftId}`)
      .then((res) => res.json())
      .then(async (data) => {
        if (data.error) {
          setError(data.error);
          return;
        }

        const item = data.item;
        setSelectedPlatforms(parsePlatformTarget(item.platformTarget));
        const hydrated = await hydrateMedia(item.id);
        setBody(item.body || "");
        setMedia(hydrated);
      })
      .catch(() => setError("Failed to load draft"))
      .finally(() => setLoadingDraft(false));
  }, [draftId, open, hydrateMedia]);

  const togglePlatform = useCallback((platform: Platform) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platform)) {
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== platform);
      }
      return [...prev, platform];
    });
  }, []);

  const handleAddMedia = useCallback(
    (files: File[]) => {
      setError(null);

      for (const platform of selectedPlatforms) {
        for (const file of files) {
          const err = validateMediaFile(
            { name: file.name, type: file.type, size: file.size },
            platform
          );
          if (err) {
            setError(err);
            return;
          }
        }
      }

      const newMediaTypes = files.map((f) => ({ mimeType: f.type }));
      for (const platform of selectedPlatforms) {
        const setErr = validateMediaSet([...media, ...newMediaTypes], platform);
        if (setErr) {
          setError(setErr);
          return;
        }
      }

      const newAttachments: MediaAttachment[] = files.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(previewUrl);
        return {
          id: nanoid(),
          previewUrl,
          filename: file.name,
          mimeType: file.type,
          fileSize: file.size,
          uploading: true,
        };
      });

      setMedia((prev) => [...prev, ...newAttachments]);

      newAttachments.forEach((attachment, idx) => {
        const file = files[idx];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("platformTarget", selectedPlatforms.join(","));

        fetch("/api/media", { method: "POST", body: formData })
          .then((res) => res.json())
          .then((data) => {
            if (data.error) {
              setError(data.error);
              setMedia((prev) => prev.filter((m) => m.id !== attachment.id));
              return;
            }
            setMedia((prev) =>
              prev.map((m) =>
                m.id === attachment.id ? { ...m, uploading: false, assetId: data.id } : m
              )
            );
          })
          .catch(() => {
            setError(`Failed to upload ${file.name}`);
            setMedia((prev) => prev.filter((m) => m.id !== attachment.id));
          });
      });
    },
    [media, selectedPlatforms]
  );

  const handleRemoveMedia = useCallback((mediaId: string) => {
    const attachment = media.find((m) => m.id === mediaId);
    if (!attachment) return;

    URL.revokeObjectURL(attachment.previewUrl);
    blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== attachment.previewUrl);
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));

    if (attachment.assetId) {
      fetch(`/api/media/${attachment.assetId}`, { method: "DELETE" }).catch(() => {});
    }
  }, [media]);

  useEffect(() => {
    if (!open) {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    }
  }, [open]);

  const hasContent = body.trim().length > 0 || media.length > 0;
  const isUploading = media.some((m) => m.uploading);
  const canSaveDraft = hasContent && !sending && !saving && !isUploading;
  const canSend =
    hasContent &&
    selectedPlatforms.length > 0 &&
    embedded === true &&
    !sending &&
    !saving &&
    !isUploading;

  async function saveDraft(): Promise<string | null> {
    const mediaAssetIds = media.filter((m) => m.assetId).map((m) => m.assetId!);

    const res = await fetch("/api/content/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body,
        platforms: selectedPlatforms,
        draftId: draftId || undefined,
        mediaAssetIds: mediaAssetIds.length > 0 ? mediaAssetIds : undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(formatApiError(data, "Save failed"));
      return null;
    }

    return data.contentItemId ?? null;
  }

  async function handleSaveDraft() {
    if (!canSaveDraft) return;
    setSaving(true);
    setError(null);
    try {
      const id = await saveDraft();
      if (!id) return;
      onOpenChange(false);
      onSuccess?.();
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendToAgent() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    try {
      const contentItemId = await saveDraft();
      if (!contentItemId) return;

      const mediaAssetIds = media.filter((m) => m.assetId).map((m) => m.assetId!);

      const res = await fetch("/api/content/send-to-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentItemId,
          platforms: selectedPlatforms,
          text: body,
          mediaAssetIds: mediaAssetIds.length > 0 ? mediaAssetIds : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const message = sendToAgentErrorMessage(
          data.errorCode,
          formatApiError(data, "Failed to send to agent")
        );
        setError(message);
        return;
      }

      const threadPath =
        data.rtxWorkspaceSlug && data.rtxThreadSlug
          ? `/workspace/${data.rtxWorkspaceSlug}/t/${data.rtxThreadSlug}`
          : null;

      onOpenChange(false);
      onSentToAgent?.({ jobId: data.jobId, threadPath });
      onSuccess?.();
    } catch {
      setError("Failed to send to agent");
    } finally {
      setSending(false);
    }
  }

  const sendButton = (
    <Button onClick={handleSendToAgent} disabled={!canSend}>
      {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      <Send className="mr-1.5 h-3.5 w-3.5" />
      Send to agent
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose</DialogTitle>
          <DialogDescription>
            Draft in Signals — a RealTimeX agent publishes it per platform.
          </DialogDescription>
        </DialogHeader>

        {loadingDraft ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Platforms</span>
              {PLATFORM_OPTIONS.map((option) => {
                const selected = selectedPlatforms.includes(option.id);
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => togglePlatform(option.id)}
                  >
                    {option.label}
                    {option.beta && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                        beta
                      </Badge>
                    )}
                  </Button>
                );
              })}
            </div>

            <PostInput
              value={body}
              onChange={setBody}
              index={0}
              total={1}
              showNumber={false}
              maxChars={guidanceChars}
              placeholder={
                PLATFORM_OPTIONS.find((o) => o.id === primaryPlatform)?.placeholder ??
                "Write your post..."
              }
              autoFocus
              media={media}
              onAddMedia={handleAddMedia}
              onRemoveMedia={handleRemoveMedia}
              platform={primaryPlatform}
            />

            <p className="text-xs text-muted-foreground">
              Want a thread? Just say so in your post — the agent will split it per platform.
            </p>

            {error && (
              <FeedbackBanner tone="danger">{error}</FeedbackBanner>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending || saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleSaveDraft} disabled={!canSaveDraft}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Draft
          </Button>
          {embedded === false ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(!canSend && "cursor-not-allowed")}>{sendButton}</span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">{STANDALONE_TOOLTIP}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            sendButton
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
