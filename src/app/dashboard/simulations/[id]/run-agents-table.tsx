"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatLaunchDate } from "@/lib/launches-display";
import { summarizeAgentGrounding } from "@/lib/simulation-run-display";
import { TranscriptSessionCache } from "@/lib/simulation-transcript-client";

export type RunAgentRow = {
  id: string;
  contactId: string | null;
  engagementScore: number | null;
  outcome: string | null;
  grounding: Record<string, unknown>;
};

interface RunAgentsTableProps {
  runId: string;
  agents: RunAgentRow[];
  transcriptsPrunedAt: number | null;
}

export function RunAgentsTable({ runId, agents, transcriptsPrunedAt }: RunAgentsTableProps) {
  const transcriptCache = useMemo(() => new TranscriptSessionCache(), []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No agent results yet.</p>;
  }

  async function toggleTranscript(agentId: string) {
    if (transcriptsPrunedAt) return;

    const next = new Set(expanded);
    if (next.has(agentId)) {
      next.delete(agentId);
      setExpanded(next);
      return;
    }

    next.add(agentId);
    setExpanded(next);

    const cached = transcriptCache.get(agentId);
    if (!cached) {
      await transcriptCache.load(runId, agentId);
      setExpanded(new Set(next));
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Persona</TableHead>
          <TableHead>Engagement</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Transcript</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => {
          const summary = summarizeAgentGrounding(agent.grounding);
          const isExpanded = expanded.has(agent.id);
          const transcriptState = transcriptCache.get(agent.id);

          return (
            <TableRow key={agent.id}>
              <TableCell>
                <div className="space-y-0.5">
                  <span>{summary.name}</span>
                  {agent.contactId && (
                    <p className="font-mono text-xs text-muted-foreground">{agent.contactId}</p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {summary.headline ?? "—"}
              </TableCell>
              <TableCell>
                {agent.engagementScore != null ? agent.engagementScore.toFixed(2) : "—"}
              </TableCell>
              <TableCell>
                {agent.outcome ? (
                  <Badge variant="outline">{agent.outcome}</Badge>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="align-top">
                {transcriptsPrunedAt ? (
                  <span className="text-sm text-muted-foreground">
                    Pruned {formatLaunchDate(transcriptsPrunedAt)}
                  </span>
                ) : (
                  <div className="space-y-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 py-1"
                      onClick={() => toggleTranscript(agent.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="mr-1 h-4 w-4" />
                      ) : (
                        <ChevronRight className="mr-1 h-4 w-4" />
                      )}
                      Show transcript
                    </Button>
                    {isExpanded && (
                      <TranscriptPanel
                        state={transcriptState}
                        onRetry={() => {
                          transcriptCache.load(runId, agent.id).then(() => {
                            setExpanded(new Set(expanded));
                          });
                        }}
                      />
                    )}
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TranscriptPanel({
  state,
  onRetry,
}: {
  state: ReturnType<TranscriptSessionCache["get"]>;
  onRetry: () => void;
}) {
  if (state === "loading" || state === undefined) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <p className="text-sm text-muted-foreground">No transcript recorded for this agent.</p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{state.message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ScrollArea className="max-h-80 rounded border bg-muted/30 p-2">
        <pre className="text-xs font-mono whitespace-pre-wrap">
          {JSON.stringify(state.content, null, 2)}
        </pre>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        {state.byteSize} bytes
        {state.tokenCount != null ? ` · ${state.tokenCount} tokens` : ""}
      </p>
    </div>
  );
}
