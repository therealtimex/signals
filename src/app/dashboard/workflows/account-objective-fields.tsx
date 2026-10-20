"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from "react";
import { AlertTriangle, CheckCircle2, CheckIcon, Pencil, Plus } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  BRIEF_COUNTER_FROM,
  BRIEF_MAX_CHARS,
  KIND_HELP,
  NO_PRODUCTS_NOTE,
  PREVIEW_FAILED,
  PREVIEW_OUTCOME_MISSING,
  RELATIONSHIP_KIND_NOTE,
  briefCounter,
  briefNameFromPath,
  briefNameHelp,
  formatBriefDate,
  limitationSentence,
  mentionListAnnouncement,
  proofPoints,
  suggestBriefName,
  textWithMentionNames,
  type ObjectiveDraft,
  type ObjectiveFieldErrors,
  type ObjectiveKind,
  type ObjectiveMentionsView,
} from "@/app/dashboard/workflows/account-objective-copy";
import { MentionText } from "@/app/dashboard/workflows/account-objective-display";
import { OBJECTIVE_BRIEF_TEMPLATE } from "@/lib/writing/objective-brief";
import type {
  ObjectiveBriefPreview,
  ObjectiveMentionTargets,
} from "@/lib/writing/account-objective";

export type SavedBriefOption = {
  name: string;
  path: string;
  outcome: string | null;
  updatedAt: number;
};

/**
 * Saved Objective briefs (`GET /api/objectives`), loaded once the operator chooses Business
 * outcome. A failed load leaves only "Write a new brief", which is also the empty state.
 */
export function useSavedObjectiveBriefs(enabled: boolean): SavedBriefOption[] {
  const [briefs, setBriefs] = useState<SavedBriefOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/objectives", { signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() as Promise<{ briefs?: SavedBriefOption[] }> : { briefs: [] }))
      .then((body) => setBriefs(Array.isArray(body.briefs) ? body.briefs : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);
  return briefs;
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  "BRAND.md": "Brand",
  "SOUL.md": "Boundaries",
  "IDENTITY.md": "Who you are",
  "VOICE.md": "Voice",
  "PRODUCTS.md": "Whole product catalog (not an offering)",
};

type MentionOption = { token: string; label: string; description: string };

function mentionOptions(targets: ObjectiveMentionTargets): MentionOption[] {
  return [
    ...targets.products.map((product) => ({
      token: product.token,
      label: product.name,
      description: `Product · ${product.token} · ${proofPoints(product.proofPointCount)}`,
    })),
    ...targets.files.map((file) => ({
      token: file.token,
      label: file.path,
      description: FILE_DESCRIPTIONS[file.path] ?? file.path,
    })),
  ];
}

/** Mention names for saved-brief outcomes in the select, resolved from the `@` list's targets. */
function targetsView(targets: ObjectiveMentionTargets | null): ObjectiveMentionsView {
  if (!targets) return { mentions: [] };
  return {
    mentions: [
      ...targets.products.map((product) => ({
        raw: product.token,
        path: "PRODUCTS.md" as const,
        anchor: product.slug,
        resolved: {
          fileHash: "",
          excerpt: "",
          excerptHash: "",
          entry: { slug: product.slug, name: product.name, oneLiner: product.oneLiner, proofPointCount: product.proofPointCount, sectionHash: "" },
        },
        unresolvedReason: null,
      })),
      ...targets.files.map((file) => ({
        raw: file.token,
        path: file.path,
        anchor: null,
        resolved: { fileHash: "", excerpt: "", excerptHash: "", entry: null },
        unresolvedReason: null,
      })),
    ],
  };
}

const TOKEN_BEFORE_CARET = /(^|[\s(])@([A-Za-z0-9.#-]*)$/;

type Picker = { start: number; query: string; active: number };
type PreviewResult = { text: string; data: ObjectiveBriefPreview | null };

const WRITE_VALUE = "__write";

interface AccountObjectiveFieldsProps {
  draft: ObjectiveDraft;
  onChange: (next: ObjectiveDraft) => void;
  errors: ObjectiveFieldErrors;
  savedBriefs: SavedBriefOption[];
  /** Template-default help under the kind cards; `null` when the template has no default. */
  templateNote: string | null;
  disabled?: boolean;
  briefTextRef: RefObject<HTMLTextAreaElement | null>;
  editCopyRef: RefObject<HTMLButtonElement | null>;
  nameRef: RefObject<HTMLInputElement | null>;
  /** True while the `@` list is open, so the dialog's Esc closes the list instead of the dialog. */
  mentionListOpenRef: MutableRefObject<boolean>;
  onPreviewChange?: (preview: ObjectiveBriefPreview | null) => void;
}

/**
 * "What is this run for?" in the Contact Relationship Nurture run dialog (#549, UX contract v2 §1).
 */
export function AccountObjectiveFields({
  draft,
  onChange,
  errors,
  savedBriefs,
  templateNote,
  disabled,
  briefTextRef,
  editCopyRef,
  nameRef,
  mentionListOpenRef,
  onPreviewChange,
}: AccountObjectiveFieldsProps) {
  const commercial = draft.kind === "commercial";
  const [targets, setTargets] = useState<ObjectiveMentionTargets | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [savedTexts, setSavedTexts] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmCopy, setConfirmCopy] = useState(false);
  /** Set when "Replace" confirmed the copy, so closing the confirm focuses the copied brief. */
  const copyConfirmed = useRef(false);
  const previewDelay = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const savedText = draft.mode === "saved" && draft.savedPath ? savedTexts[draft.savedPath] : undefined;
  const activeText = draft.mode === "saved" ? savedText ?? undefined : draft.text;
  const selectedSaved = savedBriefs.find((brief) => brief.path === draft.savedPath) ?? null;

  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    // Clear first so repeating the same message is announced again.
    setAnnouncement("");
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(text), 50);
  }, []);
  useEffect(() => () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
  }, []);

  useEffect(() => {
    mentionListOpenRef.current = picker !== null;
  }, [mentionListOpenRef, picker]);

  // `@` targets: loaded once the operator chooses Business outcome.
  useEffect(() => {
    if (!commercial || targets || targetsFailed) return;
    const controller = new AbortController();
    fetch("/api/objectives/mentions", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("mentions unavailable");
        setTargets(await response.json() as ObjectiveMentionTargets);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setTargetsFailed(true);
      });
    return () => controller.abort();
  }, [commercial, targets, targetsFailed]);

  // The selected saved brief's text, shown read-only and previewed.
  useEffect(() => {
    const path = draft.mode === "saved" ? draft.savedPath : null;
    if (!commercial || !path || path in savedTexts) return;
    const controller = new AbortController();
    fetch(`/api/objectives/${encodeURIComponent(briefNameFromPath(path))}`, { signal: controller.signal })
      .then(async (response) => {
        const body = response.ok ? await response.json() as { text?: unknown } : null;
        setSavedTexts((current) => ({ ...current, [path]: typeof body?.text === "string" ? body.text : null }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [commercial, draft.mode, draft.savedPath, savedTexts]);

  const runPreview = useCallback((text: string) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    fetch("/api/objectives/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview unavailable");
        const data = await response.json() as ObjectiveBriefPreview;
        setPreview({ text, data: data.workspace === "unavailable" ? null : data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreview({ text, data: null });
      });
  }, []);

  // Contract decision 2: 600 ms after typing pauses; right away for a kind change, a saved brief,
  // or the first check. Blur flushes through `runPreview` directly.
  useEffect(() => {
    if (!commercial || activeText === undefined) return;
    const delay = previewDelay.current;
    previewDelay.current = 600;
    previewTimer.current = setTimeout(() => runPreview(activeText), delay);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [activeText, commercial, runPreview]);

  useEffect(() => () => previewAbort.current?.abort(), []);

  const currentPreview = preview && preview.text === activeText ? preview : null;
  useEffect(() => {
    onPreviewChange?.(currentPreview?.data ?? null);
  }, [currentPreview, onPreviewChange]);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const element = briefTextRef.current;
    if (caret === null || !element) return;
    pendingCaret.current = null;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [briefTextRef, draft.text, draft.mode]);

  const options = picker && targets
    ? mentionOptions(targets).filter((option) => {
        const query = picker.query.toLowerCase();
        return !query
          || option.token.slice(1).toLowerCase().includes(query)
          || option.label.toLowerCase().includes(query);
      })
    : [];
  const showNoProducts = Boolean(targets && targets.productsFile !== "present");

  const openPicker = useCallback((next: { start: number; query: string } | null) => {
    if (!next) {
      setPicker(null);
      return;
    }
    // Announce outside the state update: an updater must stay pure (React may call it twice).
    if (!picker && targets) announce(mentionListAnnouncement(mentionOptions(targets).length));
    setPicker({ ...next, active: picker && picker.query === next.query ? picker.active : 0 });
  }, [announce, picker, targets]);

  const syncPicker = (text: string, caret: number) => {
    const match = TOKEN_BEFORE_CARET.exec(text.slice(0, caret));
    openPicker(match ? { start: caret - match[2].length - 1, query: match[2] } : null);
  };

  const setKind = (kind: ObjectiveKind) => {
    previewDelay.current = 0;
    onChange({ ...draft, kind });
  };

  const setText = (text: string, caret: number) => {
    onChange({ ...draft, text });
    syncPicker(text, caret);
  };

  const insertMention = (option: MentionOption) => {
    const element = briefTextRef.current;
    if (!picker || !element) return;
    const end = element.selectionStart ?? picker.start + picker.query.length + 1;
    const text = `${draft.text.slice(0, picker.start)}${option.token} ${draft.text.slice(end)}`;
    pendingCaret.current = picker.start + option.token.length + 1;
    setPicker(null);
    onChange({ ...draft, text });
    announce(`Inserted ${option.label}.`);
  };

  const onBriefKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!picker) return;
    if (event.key === "Escape") {
      // The dialog's own Esc handler sees the list open and keeps the dialog (contract §1.3).
      event.preventDefault();
      setPicker(null);
      return;
    }
    if (!options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setPicker({ ...picker, active: (picker.active + step + options.length) % options.length });
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(options[Math.min(picker.active, options.length - 1)]);
    }
  };

  const mentionAFile = () => {
    const element = briefTextRef.current;
    const position = element?.selectionStart ?? draft.text.length;
    const before = draft.text.slice(0, position);
    const insert = before && !/\s$/.test(before) ? " @" : "@";
    const text = `${before}${insert}${draft.text.slice(position)}`;
    pendingCaret.current = position + insert.length;
    onChange({ ...draft, text });
    openPicker({ start: position + insert.length - 1, query: "" });
  };

  const selectBrief = (value: string) => {
    previewDelay.current = 0;
    setPicker(null);
    onChange(value === WRITE_VALUE
      ? { ...draft, mode: "write" }
      : { ...draft, mode: "saved", savedPath: value });
  };

  const copySaved = () => {
    if (savedText == null) return;
    setConfirmCopy(false);
    pendingCaret.current = 0;
    previewDelay.current = 0;
    onChange({ ...draft, mode: "write", text: savedText, save: false });
    announce(`Copied ${briefNameFromPath(draft.savedPath ?? "")} into a new brief for this run.`);
  };

  const requestCopy = () => {
    const typed = draft.text;
    if (typed.trim() && typed !== OBJECTIVE_BRIEF_TEMPLATE && typed !== savedText) {
      setConfirmCopy(true);
      return;
    }
    copySaved();
  };

  const setSave = (save: boolean) => {
    onChange({ ...draft, save, name: save && !draft.name ? suggestBriefName(draft.text) : draft.name });
  };

  const view = targetsView(targets);
  const length = draft.text.length;
  const listOpen = picker !== null && (options.length > 0 || showNoProducts || targetsFailed);

  return (
    <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0" aria-describedby="objective-kind-help">
      <legend className="p-0 text-sm font-medium">What is this run for?</legend>
      <p id="objective-kind-help" className="text-xs text-muted-foreground">{KIND_HELP}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
          <input
            type="radio"
            name="objective-kind"
            value="relationship_only"
            className="mt-1 accent-primary"
            checked={draft.kind === "relationship_only"}
            onChange={() => setKind("relationship_only")}
            disabled={disabled}
            aria-describedby="objective-kind-relationship-desc"
          />
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-medium">Relationship only</span>
            <span id="objective-kind-relationship-desc" className="block text-xs text-muted-foreground">
              Keep in touch. Drafts don&apos;t mention an offering, pricing or a pitch.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
          <input
            type="radio"
            name="objective-kind"
            value="commercial"
            className="mt-1 accent-primary"
            checked={draft.kind === "commercial"}
            onChange={() => setKind("commercial")}
            disabled={disabled}
            aria-describedby="objective-kind-commercial-desc"
          />
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-medium">Business outcome</span>
            <span id="objective-kind-commercial-desc" className="block text-xs text-muted-foreground">
              Drafts work toward a result you name, such as an evaluation call.
            </span>
          </span>
        </label>
      </div>
      {templateNote ? (
        <p className="text-xs text-muted-foreground" data-testid="objective-template-note">{templateNote}</p>
      ) : null}
      {draft.kind === "relationship_only" ? (
        <p className="text-xs text-muted-foreground">{RELATIONSHIP_KIND_NOTE}</p>
      ) : null}

      {commercial ? (
        <div className="space-y-3 rounded-lg border p-3" data-testid="objective-brief-panel">
          <div className="space-y-2">
            <Label htmlFor="objective-brief-source">Objective brief</Label>
            <Select
              value={draft.mode === "saved" && draft.savedPath ? draft.savedPath : WRITE_VALUE}
              onValueChange={selectBrief}
              disabled={disabled}
            >
              <SelectTrigger id="objective-brief-source" aria-describedby="objective-brief-source-help" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <BriefOption value={WRITE_VALUE} label="Write a new brief" />
                {draft.mode === "saved" && draft.savedPath && !selectedSaved ? (
                  <BriefOption value={draft.savedPath} label={briefNameFromPath(draft.savedPath)} />
                ) : null}
                {savedBriefs.map((brief) => (
                  <BriefOption
                    key={brief.path}
                    value={brief.path}
                    label={brief.name}
                    description={`${brief.outcome ? textWithMentionNames(brief.outcome, view) : "No Outcome"} · updated ${formatBriefDate(brief.updatedAt)}`}
                  />
                ))}
              </SelectContent>
            </Select>
            <p id="objective-brief-source-help" className="text-xs text-muted-foreground">
              Write a brief for this run, or reuse one saved in the workspace.
            </p>
          </div>

          {draft.mode === "write" ? (
            <div className="space-y-2">
              <Label htmlFor="objective-brief-text">Brief</Label>
              <p id="objective-brief-help" className="text-xs text-muted-foreground">
                Write in markdown under these headings. Only Outcome is required. Type @ to mention BRAND.md, SOUL.md or a product in PRODUCTS.md. Don&apos;t put contact details in a brief.
              </p>
              <div className="relative">
                <Textarea
                  id="objective-brief-text"
                  ref={briefTextRef}
                  value={draft.text}
                  rows={13}
                  maxLength={BRIEF_MAX_CHARS}
                  className="min-h-64 font-mono text-xs"
                  disabled={disabled}
                  aria-invalid={errors.brief ? true : undefined}
                  aria-describedby={errors.brief ? "objective-brief-error objective-brief-help" : "objective-brief-help"}
                  aria-autocomplete="list"
                  aria-controls="objective-mention-list"
                  aria-activedescendant={listOpen && options.length ? `objective-mention-option-${picker!.active}` : undefined}
                  onChange={(event) => setText(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                  onClick={(event) => syncPicker(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
                  onKeyDown={onBriefKeyDown}
                  onBlur={() => {
                    setPicker(null);
                    runPreview(draft.text);
                  }}
                />
                <ul
                  id="objective-mention-list"
                  role="listbox"
                  aria-label="Mention a workspace file"
                  hidden={!listOpen}
                  className="mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
                  data-testid="objective-mention-list"
                >
                  {listOpen
                    ? options.map((option, index) => (
                        <li
                          key={option.token}
                          id={`objective-mention-option-${index}`}
                          role="option"
                          aria-selected={picker?.active === index}
                          className="cursor-pointer rounded-sm px-2 py-1.5 aria-selected:bg-accent"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertMention(option);
                          }}
                        >
                          <span className="block text-sm">{option.label}</span>
                          <span className="block break-all text-xs text-muted-foreground">{option.description}</span>
                        </li>
                      ))
                    : null}
                  {listOpen && showNoProducts ? (
                    <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">{NO_PRODUCTS_NOTE}</li>
                  ) : null}
                  {listOpen && targetsFailed ? (
                    <li role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">
                      Couldn&apos;t load the workspace files right now.
                    </li>
                  ) : null}
                </ul>
              </div>
              {errors.brief ? (
                <p id="objective-brief-error" className="text-xs text-destructive">{errors.brief}</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={mentionAFile} disabled={disabled}>
                  <Plus className="mr-1 h-3 w-3" /> Mention a file
                </Button>
                {length >= BRIEF_COUNTER_FROM ? (
                  <p className="text-xs text-muted-foreground">{briefCounter(length)}</p>
                ) : null}
              </div>
              <div className="flex items-start justify-between gap-3 pt-1">
                <div className="space-y-0.5">
                  <Label htmlFor="objective-brief-save" className="text-sm">Save as a reusable brief</Label>
                  <p id="objective-brief-save-help" className="text-xs text-muted-foreground">
                    Saved in the Signals workspace, so you and agents can use it in later runs.
                  </p>
                </div>
                <Switch
                  id="objective-brief-save"
                  aria-describedby="objective-brief-save-help"
                  checked={draft.save}
                  onCheckedChange={setSave}
                  disabled={disabled}
                />
              </div>
              {draft.save ? (
                <div className="space-y-2">
                  <Label htmlFor="objective-brief-name">Name</Label>
                  <Input
                    id="objective-brief-name"
                    ref={nameRef}
                    value={draft.name}
                    maxLength={63}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    disabled={disabled}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "objective-brief-name-error objective-brief-name-help" : "objective-brief-name-help"}
                    onChange={(event) => onChange({ ...draft, name: event.target.value })}
                  />
                  {errors.name ? (
                    <p id="objective-brief-name-error" className="text-xs text-destructive">{errors.name}</p>
                  ) : null}
                  <p id="objective-brief-name-help" className="break-all text-xs text-muted-foreground">
                    {briefNameHelp(draft.name)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2" data-testid="objective-saved-brief">
              <p className="break-all text-xs text-muted-foreground">
                {`${draft.savedPath ?? ""}${selectedSaved ? ` · updated ${formatBriefDate(selectedSaved.updatedAt)}` : ""}`}
              </p>
              <pre
                tabIndex={0}
                aria-label="Saved brief text"
                className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs"
              >
                {savedText ?? (savedText === null ? "Couldn't load this brief." : "Loading…")}
              </pre>
              {errors.saved ? (
                <p id="objective-saved-error" className="text-xs text-destructive">{errors.saved}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  ref={editCopyRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={requestCopy}
                  disabled={disabled || savedText == null}
                  aria-describedby={errors.saved ? "objective-saved-error objective-copy-help" : "objective-copy-help"}
                >
                  <Pencil className="mr-1 h-3 w-3" /> Edit a copy
                </Button>
                <p id="objective-copy-help" className="text-xs text-muted-foreground">
                  To change it for later runs too, edit the file in the Signals workspace.
                </p>
              </div>
            </div>
          )}

          <ObjectivePreview
            checking={activeText === undefined || !currentPreview}
            result={currentPreview}
          />
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">{announcement}</p>

      <AlertDialog open={confirmCopy} onOpenChange={setConfirmCopy}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Opened from state with no trigger, Radix would hand focus back to whatever held it
            // before — on Replace, the Edit a copy button that just unmounted. Contract v2 §7:
            // Replace lands at the start of the copied brief; Cancel/Esc return to Edit a copy.
            event.preventDefault();
            if (copyConfirmed.current) {
              copyConfirmed.current = false;
              const element = briefTextRef.current;
              element?.focus();
              element?.setSelectionRange(0, 0);
            } else {
              editCopyRef.current?.focus();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {`The brief you were writing will be replaced by a copy of ${briefNameFromPath(draft.savedPath ?? "")}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                copyConfirmed.current = true;
                copySaved();
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fieldset>
  );
}

function BriefOption({ value, label, description }: { value: string; label: string; description?: string }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className="relative flex w-full cursor-default select-none flex-col items-start rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground"
    >
      <span className="absolute right-2 top-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    </SelectPrimitive.Item>
  );
}

/** "What Signals found in this brief" (contract §1.4). Not a live region on purpose. */
function ObjectivePreview({ checking, result }: { checking: boolean; result: PreviewResult | null }) {
  const data = result?.data ?? null;
  const files = data?.mentions.filter((mention) => !(mention.path === "PRODUCTS.md" && mention.anchor)) ?? [];
  return (
    <section className="space-y-2 rounded-lg bg-muted/50 p-3" aria-labelledby="objective-preview-heading" data-testid="objective-preview">
      <div className="flex items-center justify-between gap-2">
        <h3 id="objective-preview-heading" className="text-xs font-semibold text-muted-foreground">
          What Signals found in this brief
        </h3>
        {checking ? <span className="text-xs text-muted-foreground">Checking…</span> : null}
      </div>
      {result && !data ? <p className="text-xs text-muted-foreground">{PREVIEW_FAILED}</p> : null}
      {data ? (
        <>
          <dl className="space-y-1.5 text-xs">
            <PreviewRow label="Outcome">
              {data.parsed.outcome ? (
                <Found ok><MentionText text={data.parsed.outcome} view={data} /></Found>
              ) : (
                <Found ok={false} danger>{PREVIEW_OUTCOME_MISSING}</Found>
              )}
            </PreviewRow>
            <PreviewRow label="Offering">
              {data.offering ? (
                <Found ok>{`${data.offering.name} · ${proofPoints(data.offering.proofPointCount)}`}</Found>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </PreviewRow>
            <PreviewRow label="Unknowns">
              {data.parsed.unknowns.length ? (
                <ol className="list-decimal space-y-0.5 pl-5">
                  {data.parsed.unknowns.map((unknown, index) => (
                    <li key={`${index}:${unknown}`}><MentionText text={unknown} view={data} /></li>
                  ))}
                </ol>
              ) : (
                <span className="text-muted-foreground">None listed</span>
              )}
            </PreviewRow>
            {files.length ? (
              <PreviewRow label="Files">
                <div className="space-y-1">
                  {files.map((mention) => (
                    <Found key={mention.raw} ok={Boolean(mention.resolved)}>
                      {mention.resolved ? mention.path : `${mention.raw} not found`}
                    </Found>
                  ))}
                </div>
              </PreviewRow>
            ) : null}
          </dl>
          {data.limitations.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-warning">Limits on these drafts</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {data.limitations.map((code) => (
                  <li key={code} className="break-words">{limitationSentence(code, data)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[6rem_1fr] sm:gap-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Found({ ok, danger, children }: { ok: boolean; danger?: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`flex items-start gap-1 ${danger ? "text-destructive" : ""}`}>
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ok ? "text-muted-foreground" : danger ? "" : "text-warning"}`}
        aria-hidden="true"
      />
      <span className="min-w-0">{children}</span>
    </span>
  );
}
