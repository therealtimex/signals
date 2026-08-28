"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleHelp, Loader2, Mail, Radio, Route, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
        <p className="text-xs text-muted-foreground">Last interaction: {relativeTime(summary.lastInteractionAt)}</p>
      </CardContent>
    </Card>
  );
}

function strengthLabel(person: OrgPersonRow) {
  if (person.strength.score === null) return "No data yet";
  return `${person.strength.band} · ${person.strength.score}`;
}

export function CompanyPeopleTable({ companyName, people }: { companyName: string; people: OrgPersonRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>People at {companyName}</CardTitle></CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">No people linked yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Run Snowball Network or link a contact to start mapping relationships.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Title</TableHead><TableHead>Relationship</TableHead><TableHead>Email</TableHead><TableHead>Last activity</TableHead><TableHead>Next action</TableHead></TableRow></TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.employment.id}>
                    <TableCell><Link href={`/dashboard/contacts/${person.contact.id}`} className="font-medium hover:underline">{person.contact.name}</Link></TableCell>
                    <TableCell className="text-muted-foreground">{person.employment.title ?? "Not set"}</TableCell>
                    <TableCell><Badge variant={person.strength.band === "strong" ? "default" : "secondary"} className="capitalize">{strengthLabel(person)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {person.emailStatus.status === "verified" ? <CheckCircle2 className="size-3.5 text-primary" /> : <CircleHelp className="size-3.5 text-muted-foreground" />}
                        <span className="max-w-48 truncate">{person.emailStatus.address ?? "No email"}</span>
                        {person.emailStatus.status !== "none" ? <Badge variant="outline" className="capitalize">{person.emailStatus.status}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(person.lastInteractionAt)}</TableCell>
                    <TableCell><Button asChild variant="outline" size="sm"><Link href={`/dashboard/contacts/${person.contact.id}`}>{person.nextAction.label}</Link></Button></TableCell>
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

  async function run(action: "infer" | "generate") {
    setPending(action);
    setMessage(null);
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
      const refreshedResponse = await fetch(`/api/orgs/${orgId}/email-intelligence`);
      if (refreshedResponse.ok) {
        setIntelligence(await refreshedResponse.json() as EmailIntelligence);
      }
      setMessage(`Generated ${body.created ?? 0} email candidate${body.created === 1 ? "" : "s"}.`);
    }
    setPending(null);
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
            <div className="grid grid-cols-4 gap-2 text-center">
              {(["predicted", "uncertain", "verified", "invalid"] as const).map((status) => <div key={status} className="rounded-lg bg-muted/50 p-2"><p className="font-semibold tabular-nums">{intelligence.candidateCounts[status]}</p><p className="text-xs capitalize text-muted-foreground">{status}</p></div>)}
            </div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run("infer")}>{pending === "infer" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}Infer pattern</Button><Button size="sm" disabled={pending !== null || !intelligence.selected} onClick={() => run("generate")}>{pending === "generate" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}Generate for people</Button></div>
          </>
        )}
        <p className="text-xs text-muted-foreground">Predicted addresses are never used for outreach until verified.</p>
        {message ? <p className="text-sm" role="status">{message}</p> : null}
      </CardContent>
    </Card>
  );
}

export function CompanyFeed({ orgId, initial, category, followedAt }: { orgId: string; initial: TimelineResult; category: "signal" | "workspace" | "note"; followedAt: number | null }) {
  const [items, setItems] = useState(initial.data);
  const [followed, setFollowed] = useState(Boolean(followedAt));
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const visible = items.filter((item) => category === "note" ? item.type === "note" : item.category === category);

  async function refresh() {
    const response = await fetch(`/api/orgs/${orgId}/timeline?pageSize=100`);
    if (response.ok) {
      const result = await response.json() as TimelineResult;
      setItems(result.data);
    }
  }

  async function toggleFollow() {
    setPending(true);
    try {
      const nextFollowed = !followed;
      const response = await fetch(`/api/orgs/${orgId}/follow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ follow: nextFollowed }) });
      if (response.ok) { setFollowed(() => nextFollowed); await refresh(); }
    } finally {
      setPending(false);
    }
  }

  async function scan() {
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/orgs/${orgId}/signal-scan`, { method: "POST" });
      if (response.ok) {
        setMessage("Signal scan started.");
      } else {
        const body = await response.json().catch(() => ({}));
        setMessage(typeof body.error === "string" ? body.error : "Signal scan could not start.");
      }
    } finally {
      setPending(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setPending(true);
    try {
      const response = await fetch(`/api/orgs/${orgId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityType: "note", summary: note.trim() }) });
      if (response.ok) { setNote(""); await refresh(); }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle className="capitalize">{category === "note" ? "Notes" : category}</CardTitle><div className="flex gap-2">{category === "signal" ? <><Button variant="outline" size="sm" disabled={pending} onClick={toggleFollow}>{followed ? "Unfollow" : "Follow"}</Button><Button size="sm" disabled={pending} onClick={scan}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Radio className="size-3.5" />}Scan now</Button></> : null}</div></CardHeader>
      <CardContent className="space-y-4">
        {category === "note" ? <div className="space-y-2"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add company context for people and agents…" /><Button size="sm" disabled={pending || !note.trim()} onClick={addNote}>Add note</Button></div> : null}
        {message ? <p className="text-sm" role="status">{message}</p> : null}
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
