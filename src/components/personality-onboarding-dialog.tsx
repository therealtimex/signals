"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ArrowUpRight,
  Building2,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { SignalsMascot } from "@/components/signals-mascot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  OPEN_PERSONALITY_ONBOARDING_EVENT,
  PERSONALITY_ONBOARDING_ACCEPT,
  PERSONALITY_ONBOARDING_MAX_BRIEF_CHARS,
  PERSONALITY_ONBOARDING_MAX_FILE_BYTES,
  PERSONALITY_ONBOARDING_MAX_FILES,
  PERSONALITY_ONBOARDING_MAX_TOTAL_BYTES,
  PERSONALITY_ONBOARDING_SENT_EVENT,
  type PersonalityOnboardingState,
} from "@/lib/personality/onboarding-contract";

type SubmissionState = "idle" | "sending" | "error";

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signals-personality-${random}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(body: unknown, fallback: string): string {
  return body && typeof body === "object" && "error" in body &&
      typeof body.error === "string"
    ? body.error
    : fallback;
}

function mergeOnboardingFiles(
  current: File[],
  incoming: File[],
): { files: File[]; error: string | null } {
  const next = [...current];
  let nextError: string | null = null;
  for (const file of incoming) {
    if (next.length >= PERSONALITY_ONBOARDING_MAX_FILES) break;
    if (file.size > PERSONALITY_ONBOARDING_MAX_FILE_BYTES) {
      nextError = `${file.name} is larger than 10 MB.`;
      continue;
    }
    const duplicate = next.some(
      (candidate) =>
        candidate.name === file.name &&
        candidate.size === file.size &&
        candidate.lastModified === file.lastModified,
    );
    if (!duplicate) next.push(file);
  }
  const total = next.reduce((sum, file) => sum + file.size, 0);
  if (total > PERSONALITY_ONBOARDING_MAX_TOTAL_BYTES) {
    return {
      files: current,
      error: "Attachments must total 25 MB or less.",
    };
  }
  return { files: next, error: nextError };
}

export function PersonalityOnboardingDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const [state, setState] = useState<PersonalityOnboardingState | null>(null);
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const resetRequestAfterError = useCallback(() => {
    if (submission !== "error") return;
    requestIdRef.current = newRequestId();
    setSubmission("idle");
    setError(null);
  }, [submission]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      resetRequestAfterError();
      const merged = mergeOnboardingFiles(files, incoming);
      setFiles(merged.files);
      setError(merged.error);
    },
    [files, resetRequestAfterError],
  );

  useEffect(() => {
    if (requestIdRef.current === null) requestIdRef.current = newRequestId();
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/personality/onboarding")
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) return null;
        return body as PersonalityOnboardingState;
      })
      .then((nextState) => {
        if (!active || !nextState) return;
        setState(nextState);
        const dismissedKey = `signals:personality-onboarding:dismissed:${nextState.workspace.id ?? nextState.workspace.slug}`;
        if (
          nextState.shouldOnboard &&
          nextState.editor.state === "available" &&
          sessionStorage.getItem(dismissedKey) !== "1"
        ) {
          setOpen(true);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_PERSONALITY_ONBOARDING_EVENT, handleOpen);
    return () =>
      window.removeEventListener(OPEN_PERSONALITY_ONBOARDING_EVENT, handleOpen);
  }, []);

  function rememberDismissal() {
    if (!state) return;
    const key = `signals:personality-onboarding:dismissed:${state.workspace.id ?? state.workspace.slug}`;
    sessionStorage.setItem(key, "1");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && submission !== "sending") rememberDismissal();
    setOpen(nextOpen);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  async function handleSubmit() {
    if (!brief.trim() && files.length === 0) {
      setError("Add a short introduction, a link, or at least one file.");
      return;
    }
    setSubmission("sending");
    setError(null);
    const currentRequestId = requestIdRef.current ?? newRequestId();
    requestIdRef.current = currentRequestId;
    const formData = new FormData();
    formData.set("requestId", currentRequestId);
    formData.set("brief", brief);
    for (const file of files) formData.append("files", file);

    try {
      const response = await fetch("/api/personality/onboarding", {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(
          errorMessage(body, "Could not open the RealTimeX Personality editor."),
        );
      }
      rememberDismissal();
      setOpen(false);
      setSubmission("idle");
      requestIdRef.current = newRequestId();
      setBrief("");
      setFiles([]);
      setDragActive(false);
      window.dispatchEvent(
        new CustomEvent(PERSONALITY_ONBOARDING_SENT_EVENT, { detail: body }),
      );
    } catch (submitError) {
      setSubmission("error");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not open the RealTimeX Personality editor.",
      );
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const editorUnavailable = state && state.editor.state !== "available";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl" showCloseButton>
        <div className="border-b bg-gradient-to-br from-primary/10 via-background to-chart-2/10 px-6 pb-5 pt-6">
          <DialogHeader className="pr-8">
            <div className="mb-1 flex items-center gap-3">
              <div className="rounded-2xl border bg-background/80 p-2 shadow-sm">
                <SignalsMascot mood="curious" size={42} />
              </div>
              <div>
                <Badge variant="info" className="mb-2">
                  <Sparkles /> Personality setup
                </Badge>
                <DialogTitle className="text-heading-2">
                  Help your agents sound like you
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="max-w-xl text-sm leading-6">
              Share what you do, who you represent, what you sell, and how you
              communicate. Signals will hand this context to an agent in your
              exact RealTimeX workspace.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <UserRound className="h-3.5 w-3.5" /> Who you are
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <Building2 className="h-3.5 w-3.5" /> Your company
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <FileText className="h-3.5 w-3.5" /> Products and services
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <Link2 className="h-3.5 w-3.5" /> Links and examples
            </span>
          </div>

          <div className="rounded-xl border bg-muted/20 p-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <label htmlFor="personality-onboarding-brief" className="sr-only">
              Describe yourself and your work
            </label>
            <Textarea
              id="personality-onboarding-brief"
              value={brief}
              maxLength={PERSONALITY_ONBOARDING_MAX_BRIEF_CHARS}
              disabled={submission === "sending"}
              onChange={(event) => {
                resetRequestAfterError();
                setBrief(event.target.value);
              }}
              placeholder="I’m… I work at… We help… Our customers are… I want my writing to feel…\n\nPaste websites, profiles, product pages, or examples here too."
              className="min-h-40 resize-y border-0 bg-transparent p-1 text-sm leading-6 shadow-none focus-visible:ring-0"
            />

            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                {files.map((file, index) => (
                  <span
                    key={`${file.name}:${file.size}:${file.lastModified}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="max-w-48 truncate">{file.name}</span>
                    <span className="text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      disabled={submission === "sending"}
                      onClick={() => {
                        resetRequestAfterError();
                        setFiles((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        );
                      }}
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (submission !== "sending") setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground ${
                dragActive ? "text-primary" : ""
              }`}
            >
              <button
                type="button"
                disabled={
                  submission === "sending" ||
                  files.length >= PERSONALITY_ONBOARDING_MAX_FILES
                }
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-md px-1 py-1 hover:text-foreground disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4" />
                Attach or drop files
              </button>
              <span>
                {files.length}/{PERSONALITY_ONBOARDING_MAX_FILES} files · {formatBytes(totalBytes)}
              </span>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept={PERSONALITY_ONBOARDING_ACCEPT.join(",")}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
          </div>

          {state?.workspace && (
            <p className="text-xs text-muted-foreground">
              Destination: <strong className="font-medium text-foreground">
                {state.workspace.displayName}
              </strong>{" "}
              in RealTimeX. Signals cannot choose or write to another workspace.
            </p>
          )}

          {editorUnavailable && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              The RealTimeX Personality editor handoff is {state.editor.state.replace("_", " ")}.
              Check the Local App permissions, then try again.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
          <p className="text-left text-xs text-muted-foreground">
            Your RealTimeX agent reviews the material before changing files.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={submission === "sending"}
              onClick={() => handleOpenChange(false)}
            >
              Not now
            </Button>
            <Button
              type="button"
              disabled={submission === "sending" || Boolean(editorUnavailable)}
              onClick={handleSubmit}
            >
              {submission === "sending" ? (
                <>
                  <Loader2 className="animate-spin" /> Opening RealTimeX…
                </>
              ) : (
                <>
                  Send to Personality Editor <ArrowUpRight />
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
