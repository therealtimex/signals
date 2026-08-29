"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleHelp, ClipboardPlus, Loader2, Mail, Play, Radio, Route, Sparkles, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { OrgSignalScanState } from "@/lib/orgs/signal-scan-state";
import { companyActionError, type CompanyActionFeedback } from "@/lib/orgs/company-action-errors";
import { emailCandidateActionSuccessMessage } from "@/lib/orgs/email-candidate-feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { getOrgEmailIntelligence } from "@/lib/contacts/email-patterns/intelligence";
import type { listOrgTimeline } from "@/lib/db/queries/org-activities";
import type { OrgPersonRow } from "@/lib/db/queries/org-people";
import type { getOrgRelationshipSummary } from "@/lib/db/queries/org-relationships";

type RelationshipSummary = ReturnType<typeof getOrgRelationshipSummary>;
type EmailIntelligence = ReturnType<typeof getOrgEmailIntelligence>;
type TimelineResult = ReturnType<typeof listOrgTimeline>;

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return "No activity yet";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "Just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function RelationshipOverview({ summary }: { summary: RelationshipSummary }) {
  const bestPath = summary.paths[0];
  return (
    <Card>
      <CardHeader><CardTitle>Relationship overview</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <div><p className="text-muted-foreground">Current people</p><p className="text-2xl font-semibold tabular-nums">{summary.people.current}</p></div>
          <div><p className="text-muted-foreground">Known relationships</p><p className="text-2xl font-semibold tabular-nums">{summary.coverage.withRelationship}</p></div>
          <div><p className="text-muted-foreground">Verified emails</p><p className="text-2xl font-semibold tabular-nums">{summary.coverage.withVerifiedEmail}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["strong", "moderate", "weak", "unknown"] as const).map((band) => (
            <Badge key={band} variant={band === "strong" ? "default" : "secondary"} className="capitalize">
              {band === "unknown" ? "No data" : band} · {summary.strength[band]}
            </Badge>
          ))}
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 font-medium"><Route className="size-4 text-primary" />Best introduction path</div>
          <p className="mt-1 text-muted-foreground">
            {bestPath?.explanation ?? (summary.people.current ? "Run Snowball Network to discover a warm path." : "Link people to map relationship paths.")}
          </p>
        </div>
        {summary.snowball ? <p className="text-xs text-muted-foreground">Latest Snowball run: <Link className="text-primary hover:underline" href={`/dashboard/workflows/${summary.snowball.workflowRunId}`}>{summary.snowball.status}</Link> · {summary.snowball.successItems} succeeded · {summary.snowball.errorItems} errors</p> : null}
        <p className="text-xs text-muted-foreground">Last interaction: {relativeTime(summary.lastInteractionAt)}</p>
      </CardContent>
    </Card>
  );
}

function strengthLabel(person: OrgPersonRow) {
  if (person.strength.score === null) return "No data yet";
  return `${person.strength.band} · ${person.strength.score}`;
}

export function CompanyPeopleTable({ orgId, companyName, people: initialPeople }: { orgId: string; companyName: string; people: OrgPersonRow[] }) {
  const [people, setPeople] = useState(initialPeople);
  const [employment, setEmployment] = useState<"current" | "former" | "all">("all");
  const [sort, setSort] = useState<"strength" | "name" | "title" | "lastInteraction">("strength");
  const [contactId, setContactId] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<{ id: string; name: string }[]>([]);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const visible = people.filter((person) => employment === "all" || person.employment.isCurrent === (employment === "current"))
    .sort((a, b) => {
      if (sort === "name") return a.contact.name.localeCompare(b.contact.name);
      if (sort === "title") return (a.employment.title ?? "").localeCompare(b.employment.title ?? "");
      if (sort === "lastInteraction") return (b.lastInteractionAt ?? -1) - (a.lastInteractionAt ?? -1);
      return (b.strength.score ?? -1) - (a.strength.score ?? -1);
    });

  async function searchContacts() {
    if (!contactQuery.trim()) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/contacts?search=${encodeURIComponent(contactQuery.trim())}&pageSize=8`);
      if (response.ok) {
        const body = await response.json() as { data?: { id: string; name: string }[] };
        setContactResults((body.data ?? []).filter((contact) => !people.some((person) => person.contact.id === contact.id)));
      } else setMessage("Contacts could not be searched.");
    } catch {
      setMessage("Contacts could not be searched.");
    } finally {
      setPending(false);
    }
  }

  async function linkContact() {
    if (!contactId.trim()) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/contacts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contactId.trim(), title: title.trim() || null }),
      });
      if (response.ok) {
        const person = await response.json() as OrgPersonRow;
        setPeople((rows) => [...rows.filter((row) => row.employment.id !== person.employment.id), person]);
        setContactId(""); setContactQuery(""); setContactResults([]); setTitle(""); setMessage("Person linked.");
      } else {
        const body = await response.json().catch(() => ({}));
        setMessage(typeof body.error === "string" ? body.error : "Person could not be linked.");
      }
    } catch {
      setMessage("Person could not be linked.");
    } finally {
      setPending(false);
    }
  }

  async function unlinkContact(person: OrgPersonRow) {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/contacts/${person.contact.id}`, { method: "DELETE" });
      if (response.ok) {
        setPeople((rows) => rows.filter((row) => row.contact.id !== person.contact.id));
        setMessage("Person unlinked.");
      } else setMessage("Person could not be unlinked.");
    } catch {
      setMessage("Person could not be unlinked.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>People at {companyName}</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_auto_1fr_auto]">
          <Input aria-label="Search contacts" placeholder="Search existing contacts" value={contactQuery} onChange={(event) => { setContactQuery(event.target.value); setContactId(""); }} />
          <Button size="sm" variant="outline" disabled={pending || !contactQuery.trim()} onClick={searchContacts}>Find</Button>
          <Input aria-label="Employment title" placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Button size="sm" disabled={pending || !contactId.trim()} onClick={linkContact}><UserPlus className="size-3.5" />Link person</Button>
          {contactResults.length ? <div className="flex flex-wrap gap-1 md:col-span-4" aria-label="Contact search results">{contactResults.map((contact) => <Button key={contact.id} size="sm" variant={contactId === contact.id ? "default" : "outline"} onClick={() => { setContactId(contact.id); setContactQuery(contact.name); }}>{contact.name}</Button>)}</div> : contactQuery && !pending ? <p className="text-xs text-muted-foreground md:col-span-4">Search and select a contact before linking.</p> : null}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="text-xs text-muted-foreground">Employment <select aria-label="Employment filter" className="ml-1 rounded border bg-background px-2 py-1" value={employment} onChange={(event) => setEmployment(event.target.value as typeof employment)}><option value="all">All</option><option value="current">Current</option><option value="former">Former</option></select></label>
          <label className="text-xs text-muted-foreground">Sort <select aria-label="People sort" className="ml-1 rounded border bg-background px-2 py-1" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="strength">Relationship strength</option><option value="name">Name</option><option value="title">Title</option><option value="lastInteraction">Last activity</option></select></label>
        </div>
        {message ? <p className="mb-3 text-sm" role="status">{message}</p> : null}
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">No people linked yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Run Snowball Network or link a contact to start mapping relationships.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Title</TableHead><TableHead>Relationship</TableHead><TableHead>Email</TableHead><TableHead>Last activity</TableHead><TableHead>Next action</TableHead></TableRow></TableHeader>
              <TableBody>
                {visible.map((person) => (
                  <TableRow key={person.employment.id}>
                    <TableCell><Link href={`/dashboard/contacts/${person.contact.id}`} className="font-medium hover:underline">{person.contact.name}</Link></TableCell>
                    <TableCell className="text-muted-foreground">{person.employment.title ?? "Not set"}</TableCell>
                    <TableCell><details><summary className="cursor-pointer"><Badge variant={person.strength.band === "strong" ? "default" : "secondary"} className="capitalize">{strengthLabel(person)}</Badge></summary><div className="mt-2 min-w-56 space-y-1 text-xs text-muted-foreground">{person.strength.components.length ? person.strength.components.map((component) => <p key={component.key}><span className="font-medium text-foreground">{component.label}:</span> {component.detail} ({Math.round(component.weight * 100)}% weight)</p>) : <p>No relationship evidence has been recorded.</p>}</div></details></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {person.emailStatus.status === "verified" ? <CheckCircle2 className="size-3.5 text-primary" /> : <CircleHelp className="size-3.5 text-muted-foreground" />}
                        <span className="max-w-48 truncate">{person.emailStatus.address ?? "No email"}</span>
                        {person.emailStatus.status !== "none" ? <Badge variant="outline" className="capitalize">{person.emailStatus.status}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(person.lastInteractionAt)}</TableCell>
                    <TableCell><div className="flex gap-1"><Button asChild variant="outline" size="sm"><Link href={`/dashboard/contacts/${person.contact.id}`}>{person.nextAction.label}</Link></Button><Button variant="ghost" size="icon" aria-label={`Unlink ${person.contact.name}`} disabled={pending} onClick={() => unlinkContact(person)}><Trash2 className="size-3.5" /></Button></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmailIntelligenceCard({ orgId, initial }: { orgId: string; initial: EmailIntelligence }) {
  const [intelligence, setIntelligence] = useState(initial);
  const [pending, setPending] = useState<"infer" | "generate" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pattern, setPattern] = useState(initial.selected?.pattern ?? "{first}.{last}");
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  async function refresh() {
    const response = await fetch(`/api/orgs/${orgId}/email-intelligence`);
    if (response.ok) setIntelligence(await response.json() as EmailIntelligence);
  }

  async function overridePattern() {
    setPending("infer"); setMessage(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/email-intelligence/pattern`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pattern }),
      });
      if (response.ok) { setIntelligence(await response.json() as EmailIntelligence); setMessage("Email pattern overridden."); }
      else setMessage("Pattern override could not be saved.");
    } catch {
      setMessage("Pattern override could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function updateCandidate(candidateId: string, action: "verify" | "invalidate" | "probe" | "correct") {
    setPending("generate"); setMessage(null);
    try {
      const response = await fetch(`/api/email-candidates/${candidateId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "correct" ? { address: corrections[candidateId] } : {}) }),
      });
      if (response.ok) { await refresh(); setMessage(emailCandidateActionSuccessMessage(action)); }
      else { const body = await response.json().catch(() => ({})); setMessage(typeof body.error === "string" ? body.error : "Candidate could not be updated."); }
    } catch {
      setMessage("Candidate could not be updated.");
    } finally {
      setPending(null);
    }
  }

  async function run(action: "infer" | "generate") {
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(action === "infer" ? `/api/orgs/${orgId}/email-intelligence/infer` : `/api/orgs/${orgId}/email-candidates/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage(typeof body.error === "string" ? body.error : "The action could not be completed.");
      } else if (action === "infer") {
        setIntelligence(await response.json() as EmailIntelligence);
        setMessage("Email pattern inference complete.");
      } else {
        const body = await response.json() as { created?: number };
        await refresh();
        setMessage(`Generated ${body.created ?? 0} email candidate${body.created === 1 ? "" : "s"}.`);
      }
    } catch {
      setMessage("The action could not be completed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="size-4 text-primary" />Email intelligence</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!intelligence.canInfer ? (
          <div className="rounded-lg border border-dashed p-4"><p className="font-medium">Add a company domain first</p><p className="mt-1 text-muted-foreground">A domain is required to learn and generate business email patterns.</p></div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{intelligence.domain}</Badge><Badge variant="secondary">MX {intelligence.domains[0]?.mxStatus ?? "unknown"}</Badge><Badge variant="secondary">Catch-all {intelligence.domains[0]?.catchAll ?? "unknown"}</Badge></div>
            <div>
              <p className="text-muted-foreground">Selected pattern</p>
              {intelligence.selected ? (
                <div className="mt-1 flex flex-wrap items-center gap-2"><code className="rounded bg-muted px-2 py-1">{intelligence.selected.pattern}</code><Badge className="capitalize">{intelligence.selected.confidence}</Badge><span className="text-muted-foreground">based on {intelligence.selected.sampleCount} sample{intelligence.selected.sampleCount === 1 ? "" : "s"}</span></div>
              ) : <p className="mt-1">No pattern inferred yet.</p>}
            </div>
            {intelligence.patterns.length ? <div><p className="font-medium">Ranked alternatives</p><div className="mt-2 divide-y rounded border">{[...intelligence.patterns].sort((a, b) => a.rank - b.rank).map((row) => <details key={row.id} className="p-2"><summary className="cursor-pointer"><span className="font-mono">#{row.rank} {row.pattern}</span> · {Math.round(row.score * 100)}% · {row.confidence}</summary><p className="mt-1 text-xs text-muted-foreground">Evaluated {relativeTime(row.evaluatedAt)} from {row.sampleCount} sample{row.sampleCount === 1 ? "" : "s"}. Evidence: {row.evidence ?? "none"}</p></details>)}</div></div> : null}
            <div className="flex flex-wrap gap-2"><Input aria-label="Pattern override" className="max-w-64 font-mono" value={pattern} onChange={(event) => setPattern(event.target.value)} /><Button size="sm" variant="outline" disabled={pending !== null || !pattern.trim()} onClick={overridePattern}>Use pattern</Button></div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {(["predicted", "uncertain", "verified", "invalid"] as const).map((status) => <div key={status} className="rounded-lg bg-muted/50 p-2"><p className="font-semibold tabular-nums">{intelligence.candidateCounts[status]}</p><p className="text-xs capitalize text-muted-foreground">{status}</p></div>)}
            </div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run("infer")}>{pending === "infer" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Infer pattern</Button><Button size="sm" disabled={pending !== null || !intelligence.selected} onClick={() => run("generate")}>{pending === "generate" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}Generate for people</Button></div>
            {intelligence.candidates.length ? <div><p className="font-medium">Email candidates</p><div className="mt-2 space-y-2">{intelligence.candidates.map((candidate) => <div key={candidate.id} className="rounded border p-2"><div className="flex flex-wrap items-center gap-2"><code>{candidate.address}</code><Badge variant="outline" className="capitalize">{candidate.status}</Badge><span className="text-xs text-muted-foreground">{candidate.sendable ? "Eligible for this operation" : candidate.reason?.replaceAll("_", " ")}</span></div><div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => updateCandidate(candidate.id, "verify")}>Verify</Button><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => updateCandidate(candidate.id, "invalidate")}>Invalidate</Button><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => updateCandidate(candidate.id, "probe")}>Probe</Button><Input aria-label={`Correct ${candidate.address}`} className="h-8 max-w-64" placeholder="Correct address" value={corrections[candidate.id] ?? ""} onChange={(event) => setCorrections((values) => ({ ...values, [candidate.id]: event.target.value }))} /><Button size="sm" variant="outline" disabled={pending !== null || !corrections[candidate.id]} onClick={() => updateCandidate(candidate.id, "correct")}>Correct</Button></div><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Inspect evidence</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{candidate.evidence ?? "{}"}</pre></details></div>)}</div></div> : null}
          </>
        )}
        <p className="text-xs text-muted-foreground">Predicted addresses are {intelligence.automationEligibility.effectiveValue ? "eligible only when an outreach operation explicitly opts in" : "blocked from outreach by workspace policy"}. Uncertain and invalid addresses are never sendable.</p>
        {message ? <p className="text-sm" role="status">{message}</p> : null}
      </CardContent>
    </Card>
  );
}

export function CompanyFeed({ orgId, initial, category, followedAt, signalScanState, onLaunchWorkflow }: { orgId: string; initial: TimelineResult; category: "signal" | "workspace" | "note"; followedAt: number | null; signalScanState?: OrgSignalScanState; onLaunchWorkflow?: () => void }) {
  const [items, setItems] = useState(initial.data);
  const [followed, setFollowed] = useState(Boolean(followedAt));
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<CompanyActionFeedback | null>(null);
  const [localScanState, setLocalScanState] = useState<OrgSignalScanState | undefined>();
  const scanState = localScanState ?? signalScanState;
  const visible = items.filter((item) => category === "note" ? item.type === "note" : item.category === category);

  async function refresh() {
    const response = await fetch(`/api/orgs/${orgId}/timeline?pageSize=100`);
    if (response.ok) {
      const result = await response.json() as TimelineResult;
      setItems(result.data);
    }
  }

  async function toggleFollow() {
    setPending(true); setFeedback(null);
    try {
      const nextFollowed = !followed;
      const response = await fetch(`/api/orgs/${orgId}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ follow: nextFollowed }) });
      if (response.ok) {
        setFollowed(nextFollowed);
        if (scanState) {
          setLocalScanState({
            ...scanState,
            stale: nextFollowed && (
              !scanState.lastRunAt
              || Math.floor(Date.now() / 1000) - scanState.lastRunAt > 7 * 86_400
            ),
          });
        }
        setFeedback({ kind: "success", message: nextFollowed ? "Company followed." : "Company unfollowed." });
        await refresh();
      } else {
        setFeedback(await companyActionError(response, "Follow status could not be updated."));
      }
    } catch {
      setFeedback({ kind: "error", message: "Follow status could not be updated." });
    } finally {
      setPending(false);
    }
  }

  async function scan() {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/signal-scan`, { method: "POST" });
      if (response.ok) {
        setFeedback({ kind: "success", message: "Signal scan started." });
        setLocalScanState({ status: "pending", stale: scanState?.stale ?? true, permissionDenied: false, lastRunAt: scanState?.lastRunAt ?? null, message: null });
      } else {
        const error = await companyActionError(response, "Signal scan could not start.");
        setFeedback(error);
        setLocalScanState({ status: "failed", stale: scanState?.stale ?? true, permissionDenied: error.kind === "permission", lastRunAt: scanState?.lastRunAt ?? null, message: error.message });
      }
    } catch {
      setFeedback({ kind: "error", message: "Signal scan could not start." });
    } finally {
      setPending(false);
    }
  }

  async function createFollowUpTask() {
    setPending(true); setFeedback(null);
    try {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Review company signals", taskType: "follow_up", relatedOrgId: orgId }) });
      setFeedback(response.ok
        ? { kind: "success", message: "Follow-up task created." }
        : await companyActionError(response, "Task could not be created."));
    } catch {
      setFeedback({ kind: "error", message: "Task could not be created." });
    } finally {
      setPending(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setPending(true); setFeedback(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityType: "note", summary: note.trim() }) });
      if (response.ok) {
        setNote("");
        setFeedback({ kind: "success", message: "Note added." });
        await refresh();
      } else {
        setFeedback(await companyActionError(response, "Note could not be added."));
      }
    } catch {
      setFeedback({ kind: "error", message: "Note could not be added." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle className="capitalize">{category === "note" ? "Notes" : category}</CardTitle><div className="flex flex-wrap gap-2">{category === "signal" ? <><Button variant="outline" size="sm" disabled={pending} onClick={toggleFollow}>{followed ? "Unfollow" : "Follow"}</Button><Button variant="outline" size="sm" disabled={pending} onClick={createFollowUpTask}><ClipboardPlus className="size-3.5" />Create task</Button>{onLaunchWorkflow ? <Button variant="outline" size="sm" onClick={onLaunchWorkflow}><Play className="size-3.5" />Snowball workflow</Button> : null}<Button size="sm" disabled={pending} onClick={scan}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}Scan now</Button></> : null}</div></CardHeader>
      <CardContent className="space-y-4">
        {category === "note" ? <div className="space-y-2"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add company context for people and agents…" /><Button size="sm" disabled={pending || !note.trim()} onClick={addNote}>Add note</Button></div> : null}
        {category === "signal" && scanState ? <div className="space-y-2 text-sm" aria-live="polite">{scanState.permissionDenied ? <p className="rounded border border-destructive/40 bg-destructive/5 p-3">Signal scan permission was denied. Check the RealTimeX workspace connection.</p> : null}{scanState.status === "pending" ? <p className="rounded border p-3">Signal scan is in progress. Existing results remain visible.</p> : null}{scanState.status === "partial" ? <p className="rounded border border-amber-500/40 bg-amber-500/5 p-3">The last scan was partial. {scanState.message}</p> : null}{scanState.status === "failed" && !scanState.permissionDenied ? <p className="rounded border border-destructive/40 bg-destructive/5 p-3">The last scan failed. {scanState.message}</p> : null}{scanState.stale && scanState.status !== "pending" ? <p className="rounded border border-amber-500/40 bg-amber-500/5 p-3">Signal coverage is stale or has not been scanned yet.</p> : null}</div> : null}
        {feedback ? <p className={feedback.kind === "success" ? "text-sm" : feedback.kind === "permission" ? "rounded border border-destructive/40 bg-destructive/5 p-3 text-sm" : feedback.kind === "not_embedded" ? "rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm" : "text-sm text-destructive"} role="status">{feedback.message}</p> : null}
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center"><p className="font-medium">No {category === "note" ? "notes" : `${category} items`} yet</p><p className="mt-1 text-sm text-muted-foreground">{category === "signal" ? "Follow this company or scan for funding, hiring, leadership, product, and news signals." : "Company and relationship history will appear here."}</p></div>
        ) : (
          <div className="divide-y rounded-lg border">
            {visible.map((item) => <article key={`${item.kind}:${item.id}`} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><Badge variant="secondary" className="capitalize">{item.type.replaceAll("_", " ")}</Badge>{item.isNew ? <Badge>New</Badge> : null}</div><h3 className="mt-2 font-medium">{item.title}</h3>{item.summary ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.summary}</p> : null}{item.whyItMatters ? <p className="mt-2 text-sm"><span className="font-medium">Why it matters:</span> {item.whyItMatters}</p> : null}</div><time className="text-xs text-muted-foreground">{relativeTime(item.occurredAt)}</time></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{item.sourceLabel}</span>{item.contact ? <Link href={`/dashboard/contacts/${item.contact.id}`} className="text-primary hover:underline">{item.contact.name}</Link> : null}{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Source</a> : null}</div></article>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
