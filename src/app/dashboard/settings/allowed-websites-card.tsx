"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Loader2, Lock, Plus, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  allowedWebsitesApi,
  type BrowserConnectionOption,
} from "@/lib/browser/allowed-websites-client";
import type { AllowedOriginsRuntime, AllowedOriginsView } from "@/lib/browser/allowed-websites-types";
import {
  ADD_HELP,
  cardAlert,
  connectionKindLabel,
  DEFAULTS_CAPTION,
  EMPTY_LIST,
  formatAddedMeta,
  interpretAdd,
  interpretApply,
  interpretRemove,
  interpretUndo,
  mergeChange,
  NO_PUBLISHING_CARD,
  pickInitialConnection,
  rowNotActive,
  SELECT_HELP,
  type CardAlert,
} from "@/lib/browser/allowed-websites-ui";
import { listDefaultAllowedOrigins } from "@/lib/platforms/platform-urls";

const DEFAULT_LABELS = new Map(listDefaultAllowedOrigins().map((entry) => [entry.origin, entry.label]));

type Status = { message: string; undoOrigin?: string };
type PendingFocus = { kind: "input" } | { kind: "remove"; origin: string } | null;

function readRequestedConnection(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("connection");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function withCustomOrigin(view: AllowedOriginsView, origin: string): AllowedOriginsView["custom"] {
  return view.custom.some((row) => row.origin === origin)
    ? view.custom
    : [{ origin, source: "settings", addedAt: nowSeconds() }, ...view.custom];
}

function CardStatusAlert({
  alert,
  busy,
  onTryAgain,
}: {
  alert: CardAlert;
  busy: boolean;
  onTryAgain: () => void;
}) {
  if (!alert) return null;
  const unreachable = alert === "unreachable";
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="h-4 w-4" aria-hidden />
        {unreachable ? "Can't reach the RealTimeX Browser" : "Some changes aren't active yet"}
      </p>
      <p className="mt-1">
        {unreachable
          ? "Your list is saved. Changes take effect when the RealTimeX Browser is available."
          : "They're saved, but the RealTimeX Browser didn't accept the update. Signals tries again the next time it uses this connection."}
      </p>
      <Button variant="outline" size="sm" className="mt-3" disabled={busy} onClick={onTryAgain}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
        Try again
      </Button>
    </div>
  );
}

function ConnectionChoice({
  connections,
  selectedId,
  sessionName,
  onChange,
}: {
  connections: BrowserConnectionOption[];
  selectedId: string | null;
  sessionName: string;
  onChange: (connectionId: string) => void;
}) {
  const id = useId();
  if (connections.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Applies to the browser connection <code className="font-mono text-foreground">{sessionName}</code>.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Browser connection</Label>
      <Select value={selectedId ?? undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" aria-describedby={`${id}-help`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {connections.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              <span className="font-mono">{connection.sessionName}</span>
              <span className="text-muted-foreground">{connectionKindLabel(connection)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {SELECT_HELP}
      </p>
    </div>
  );
}

function AddWebsiteForm({
  inputRef,
  url,
  error,
  adding,
  onUrlChange,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  url: string;
  error: string | null;
  adding: boolean;
  onUrlChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const describedBy = error ? `${id}-help ${id}-error` : `${id}-help`;
  return (
    <form
      className="space-y-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor={id}>Add a website</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          id={id}
          value={url}
          placeholder="https://www.example.com"
          autoComplete="off"
          inputMode="url"
          readOnly={adding}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onUrlChange(event.target.value)}
        />
        <Button type="submit" disabled={adding} aria-busy={adding}>
          {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {ADD_HELP}
      </p>
    </form>
  );
}

function CustomOriginList({
  custom,
  runtime,
  removing,
  removeRefs,
  onRemove,
}: {
  custom: AllowedOriginsView["custom"];
  runtime: AllowedOriginsRuntime | null;
  removing: string | null;
  removeRefs: RefObject<Map<string, HTMLButtonElement>>;
  onRemove: (origin: string) => void;
}) {
  const headingId = useId();
  return (
    <section className="space-y-2">
      <h3 id={headingId} className="text-sm font-medium">
        Added by you
      </h3>
      {custom.length === 0 ? (
        <p className="text-sm text-muted-foreground">{EMPTY_LIST}</p>
      ) : (
        <ul aria-labelledby={headingId} className="divide-y">
          {custom.map((row) => (
            <li key={row.origin} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm break-words [overflow-wrap:anywhere]">{row.origin}</span>
                  {rowNotActive(row.origin, runtime) && <Badge variant="warning">Not active yet</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{formatAddedMeta(row.addedAt, row.source)}</p>
              </div>
              <Button
                ref={(node) => {
                  if (node) removeRefs.current.set(row.origin, node);
                  else removeRefs.current.delete(row.origin);
                }}
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${row.origin}`}
                disabled={removing === row.origin}
                onClick={() => onRemove(row.origin)}
              >
                {removing === row.origin ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DefaultOriginList({ defaults }: { defaults: string[] }) {
  const headingId = useId();
  return (
    <section className="space-y-2">
      <h3 id={headingId} className="text-sm font-medium">
        Always allowed by Signals
      </h3>
      <p className="text-xs text-muted-foreground">{DEFAULTS_CAPTION}</p>
      <ul aria-labelledby={headingId} className="divide-y">
        {defaults.map((origin) => (
          <li key={origin} className="flex items-center gap-3 py-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 font-mono text-sm break-words [overflow-wrap:anywhere]">{origin}</span>
            <span className="text-xs text-muted-foreground">{DEFAULT_LABELS.get(origin) ?? ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Settings → Platforms → Allowed websites (#547, UX contract v1 §1). Shown only when Signals runs
 * inside RealTimeX; the parent hides it otherwise.
 */
export function AllowedWebsitesCard() {
  const [connections, setConnections] = useState<BrowserConnectionOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<AllowedOriginsView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [url, setUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const deepLinkHandled = useRef(false);

  const selected = connections.find((connection) => connection.id === selectedId) ?? null;
  const sessionName = selected?.sessionName ?? view?.sessionName ?? "signals-publish";

  const loadView = useCallback(async (connectionId: string): Promise<boolean> => {
    const outcome = await allowedWebsitesApi.get(connectionId);
    if (outcome.status === 200 && outcome.body && "effective" in outcome.body) {
      setView(outcome.body as AllowedOriginsView);
      setLoadState("ready");
      return true;
    }
    setLoadState("error");
    return false;
  }, []);

  const loadAll = useCallback(async (): Promise<boolean> => {
    setLoadState("loading");
    const listRows = async () => {
      const listed = await allowedWebsitesApi.listConnections();
      return listed.status === 200 && listed.body && "connections" in listed.body ? listed.body.connections : null;
    };
    let rows = await listRows();
    if (rows && rows.length === 0) {
      // The shared connection's row is created the first time Settings needs it (ADR-547-4).
      await allowedWebsitesApi.ensurePublishConnection();
      rows = await listRows();
    }
    const initial = rows ? pickInitialConnection(rows, readRequestedConnection()) : null;
    if (!rows || !initial) {
      setLoadState("error");
      return false;
    }
    setConnections(rows);
    setSelectedId(initial.id);
    return loadView(initial.id);
  }, [loadView]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // "Manage allowed websites" from a run lands here with focus on the card title (contract §5).
  useEffect(() => {
    if (loadState !== "ready" || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    if (window.location.hash === "#allowed-websites") {
      titleRef.current?.scrollIntoView({ block: "start" });
      titleRef.current?.focus();
    }
  }, [loadState]);

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.kind === "input") inputRef.current?.focus();
    else removeRefs.current.get(pendingFocus.origin)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  async function changeConnection(connectionId: string) {
    setSelectedId(connectionId);
    setFieldError(null);
    setStatus(null);
    setLoadState("loading");
    await loadView(connectionId);
  }

  async function add() {
    if (!selectedId || adding) return;
    setAdding(true);
    setStatus(null);
    try {
      const feedback = interpretAdd(await allowedWebsitesApi.add(selectedId, url, "settings"), sessionName);
      if (feedback.kind === "field_error") {
        setFieldError(feedback.message);
        return;
      }
      const { result } = feedback;
      setView((current) =>
        current
          ? mergeChange(current, result, result.status === "added" ? withCustomOrigin(current, result.origin) : current.custom)
          : current,
      );
      setStatus({ message: feedback.message });
      if (feedback.clearInput) setUrl("");
    } finally {
      setAdding(false);
      setPendingFocus({ kind: "input" });
    }
  }

  async function remove(origin: string) {
    if (!selectedId || !view) return;
    const index = view.custom.findIndex((row) => row.origin === origin);
    const next = view.custom[index + 1] ?? view.custom[index - 1] ?? null;
    setRemoving(origin);
    try {
      const feedback = interpretRemove(await allowedWebsitesApi.remove(selectedId, origin), sessionName);
      if (feedback.kind === "error") {
        setStatus({ message: feedback.message });
        setPendingFocus({ kind: "remove", origin });
        return;
      }
      setView((current) =>
        current ? mergeChange(current, feedback.result, current.custom.filter((row) => row.origin !== origin)) : current,
      );
      setStatus({ message: feedback.message, undoOrigin: origin });
      setPendingFocus(next ? { kind: "remove", origin: next.origin } : { kind: "input" });
    } finally {
      setRemoving(null);
    }
  }

  async function undo(origin: string) {
    if (!selectedId) return;
    const feedback = interpretUndo(await allowedWebsitesApi.add(selectedId, origin, "settings"), sessionName);
    if (feedback.kind === "field_error") {
      setStatus({ message: feedback.message });
      return;
    }
    const { result } = feedback;
    setView((current) => (current ? mergeChange(current, result, withCustomOrigin(current, result.origin)) : current));
    setStatus({ message: feedback.message });
  }

  async function alertTryAgain(alert: CardAlert) {
    if (!selectedId) return;
    setAlertBusy(true);
    try {
      if (alert === "not_active") {
        const feedback = interpretApply(await allowedWebsitesApi.apply(selectedId), sessionName);
        if (feedback.kind === "result") {
          setView((current) => (current ? mergeChange(current, feedback.change) : current));
        }
        setStatus({ message: feedback.message });
        return;
      }
      const outcome = await allowedWebsitesApi.get(selectedId);
      if (outcome.status === 200 && outcome.body && "effective" in outcome.body) {
        const fresh = outcome.body as AllowedOriginsView;
        setView(fresh);
        if (fresh.runtime?.reachable && fresh.runtime.applied === true) {
          setStatus({ message: "Connected to the RealTimeX Browser. All changes are active." });
        }
      }
    } finally {
      setAlertBusy(false);
    }
  }

  async function retryLoad() {
    const ok = selectedId ? await loadView(selectedId) : await loadAll();
    if (ok) setPendingFocus({ kind: "input" });
  }

  const alert = view ? cardAlert(view.runtime) : null;

  return (
    <Card id="allowed-websites" className="scroll-mt-6">
      <CardHeader>
        <CardTitle ref={titleRef} tabIndex={-1} className="outline-none">
          Allowed websites
        </CardTitle>
        <CardDescription>{NO_PUBLISHING_CARD}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadState === "loading" && (
          <div className="space-y-3">
            <p className="sr-only" role="status" aria-live="polite">
              Loading allowed websites…
            </p>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {loadState === "error" && (
          <div role="alert" className="rounded-lg border border-danger/25 bg-danger/10 p-4 text-sm text-danger">
            <p className="font-medium">Couldn&apos;t load allowed websites</p>
            <p>Nothing was changed.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void retryLoad()}>
              <RotateCw aria-hidden />
              Retry
            </Button>
          </div>
        )}

        {loadState === "ready" && view && (
          <>
            <CardStatusAlert alert={alert} busy={alertBusy} onTryAgain={() => void alertTryAgain(alert)} />
            <ConnectionChoice
              connections={connections}
              selectedId={selectedId}
              sessionName={sessionName}
              onChange={(connectionId) => void changeConnection(connectionId)}
            />
            <AddWebsiteForm
              inputRef={inputRef}
              url={url}
              error={fieldError}
              adding={adding}
              onUrlChange={(value) => {
                setUrl(value);
                setFieldError(null);
              }}
              onSubmit={() => void add()}
            />
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {status?.message}
              {status?.undoOrigin && (
                <>
                  {" "}
                  <Button
                    variant="link"
                    className="h-auto p-0 align-baseline"
                    onClick={() => void undo(status.undoOrigin!)}
                  >
                    Undo
                  </Button>
                </>
              )}
            </p>
            <CustomOriginList
              custom={view.custom}
              runtime={view.runtime}
              removing={removing}
              removeRefs={removeRefs}
              onRemove={(origin) => void remove(origin)}
            />
            <DefaultOriginList defaults={view.defaults} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
