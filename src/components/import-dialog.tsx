"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, FileUp, Loader2, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Per-platform configuration for the reusable import modal shell.
 * LinkedIn Connections is the first platform; Gmail Takeout / X archive
 * imports can reuse this shell with their own endpoints and help copy.
 */
export interface ImportDialogConfig {
  title: string;
  description: string;
  /** Accepted extensions for the file input, e.g. ".csv,.zip" */
  accept: string;
  /** Inline help shown on the pick step (where to get the export). */
  help: React.ReactNode;
  /** Parse-only inspection endpoint — must not write to the database. */
  previewEndpoint: string;
  /** Import endpoint that records the workflow run. */
  importEndpoint: string;
  /** Idempotency note shown on the inspection step. */
  reimportNote: string;
}

export interface ImportPreview {
  source: "csv" | "zip";
  fileName: string;
  fileSize: number;
  totalRows: number;
  /** Optional per-slice breakdown lines (e.g. X archive follower/following/tweet counts). */
  details?: string[];
  /** X archive: merged follower/following contact count. */
  uniqueContactCount?: number;
  tweetCount?: number;
}

export interface ImportSuccess {
  added: number;
  updated: number;
  skipped: number;
  source: "csv" | "zip" | null;
  fileName: string;
  workflowRunId: string | null;
  /** X archive: per-phase breakdown from the import route. */
  contactsAdded?: number;
  contactsUpdated?: number;
  postsAdded?: number;
  uniqueContactCount?: number;
  handlesUpdated?: number;
}

type Phase = "pick" | "previewing" | "ready" | "importing";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ImportDialogProps {
  config: ImportDialogConfig;
  open: boolean;
  onClose: () => void;
  onSuccess: (result: ImportSuccess) => void;
}

export function ImportDialog({ config, open, onClose, onSuccess }: ImportDialogProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("pick");
    setFile(null);
    setPreview(null);
    setError(null);
    setDragActive(false);
  }, []);

  const handleClose = useCallback(() => {
    if (phase === "importing") return;
    reset();
    onClose();
  }, [phase, reset, onClose]);

  const inspectFile = useCallback(
    async (selected: File) => {
      setFile(selected);
      setError(null);
      setPreview(null);
      setPhase("previewing");

      try {
        const formData = new FormData();
        formData.append("file", selected);
        const res = await fetch(config.previewEndpoint, { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok || !data.preview) {
          setError(data.error || "Could not inspect file");
          setPhase("pick");
          return;
        }

        setPreview({
          ...data.preview,
          tweetCount: data.preview.tweetCount,
          uniqueContactCount: data.preview.uniqueContactCount,
        });
        setPhase("ready");
      } catch {
        setError("Could not inspect file");
        setPhase("pick");
      }
    },
    [config.previewEndpoint]
  );

  const runImport = useCallback(async () => {
    if (!file) return;
    setError(null);
    setPhase("importing");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(config.importEndpoint, { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        setPhase("ready");
        return;
      }

      const result: ImportSuccess = {
        added: data.result?.added ?? 0,
        updated: data.result?.updated ?? 0,
        skipped: data.result?.skipped ?? 0,
        source: data.source ?? null,
        fileName: file.name,
        workflowRunId: data.workflowRunId ?? null,
        contactsAdded: data.contacts?.added,
        contactsUpdated: data.contacts?.updated,
        postsAdded: data.posts?.added,
        uniqueContactCount: data.uniqueContactCount,
        handlesUpdated: data.handleBackfill?.updated,
      };
      reset();
      onSuccess(result);
    } catch {
      setError("Import failed");
      setPhase("ready");
    }
  }, [file, config.importEndpoint, reset, onSuccess]);

  const busy = phase === "previewing" || phase === "importing";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept={config.accept}
          className="hidden"
          data-testid="import-dialog-file-input"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) inspectFile(selected);
            e.target.value = "";
          }}
        />

        {(phase === "pick" || phase === "previewing") && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={phase === "previewing"}
              className={cn(
                "w-full rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors",
                dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                phase === "previewing" && "opacity-60"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) inspectFile(dropped);
              }}
            >
              {phase === "previewing" ? (
                <span className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Inspecting {file?.name}…
                </span>
              ) : (
                <span className="flex flex-col items-center gap-1.5">
                  <FileUp className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Drop your export here or click to browse</span>
                  <span className="text-xs text-muted-foreground">Accepts {config.accept}</span>
                </span>
              )}
            </button>

            <div className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
              {config.help}
            </div>
          </div>
        )}

        {(phase === "ready" || phase === "importing") && preview && (
          <div className="space-y-3" data-testid="import-dialog-inspection">
            <div className="rounded-lg border p-3 text-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium break-all">{preview.fileName}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {preview.source.toUpperCase()}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{formatFileSize(preview.fileSize)}</p>
                {preview.details?.length ? (
                  preview.details.map((line) => (
                    <p key={line} className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      {line}
                    </p>
                  ))
                ) : preview.source === "zip" ? (
                  <p className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    Connections.csv found in archive
                  </p>
                ) : null}
                <p>
                  {preview.uniqueContactCount != null && preview.tweetCount != null ? (
                    <>
                      <span className="font-medium text-foreground">{preview.uniqueContactCount}</span>{" "}
                      {preview.uniqueContactCount === 1 ? "contact" : "contacts"} ·{" "}
                      <span className="font-medium text-foreground">{preview.tweetCount}</span>{" "}
                      {preview.tweetCount === 1 ? "tweet" : "tweets"} ready to import
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-foreground">{preview.totalRows}</span>{" "}
                      {preview.totalRows === 1 ? "row" : "rows"} ready to import
                    </>
                  )}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{config.reimportNote}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={phase === "importing"}
              onClick={reset}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Choose a different file
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="import-dialog-error">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={phase === "importing"} onClick={handleClose}>
            Cancel
          </Button>
          {(phase === "ready" || phase === "importing") && (
            <Button disabled={busy} onClick={runImport} data-testid="import-dialog-run">
              {phase === "importing" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {phase === "importing" ? "Importing…" : "Run import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
