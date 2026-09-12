"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Participant = {
  subjectKey: string;
  displayName: string;
  profileUrl: string | null;
  rsvp: string;
  attendance: "unknown";
};

export function EventParticipantReport({
  workflowRunId,
  capability,
}: {
  workflowRunId: string;
  capability: string;
}) {
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/runs/${workflowRunId}/event-report`, {
        headers: { "x-signals-event-report-capability": capability },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Registered guest report is unavailable or expired.");
      const body = (await response.json()) as {
        participants?: Participant[];
        session?: { name?: string };
      };
      setParticipants(body.participants ?? []);
      setSessionName(body.session?.name ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load registered guest report.");
    } finally {
      setLoading(false);
    }
  }

  async function revokeReport() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/runs/${workflowRunId}/event-report`, {
        method: "DELETE",
        headers: { "x-signals-event-report-capability": capability },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Registered guest report could not be revoked.");
      setParticipants(null);
      setSessionName(null);
      setRevoked(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke registered guest report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-emerald-300/60 p-3">
      <p className="text-xs font-medium">
        {revoked
          ? "Registered guest report access was revoked for this run."
          : "Registered guest observations are available for this run."}
      </p>
      {revoked ? (
        <p className="text-xs text-muted-foreground">Protected report access has been revoked.</p>
      ) : participants === null ? (
        <Button type="button" size="sm" variant="outline" onClick={loadReport} disabled={loading}>
          {loading ? "Loading…" : "View protected guest report"}
        </Button>
      ) : (
        <div className="space-y-2">
          {sessionName && (
            <p className="text-xs text-muted-foreground">Observed through session: {sessionName}</p>
          )}
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {participants.map((participant) => (
              <li key={participant.subjectKey}>
                {participant.profileUrl ? (
                  <a href={participant.profileUrl} target="_blank" rel="noreferrer" className="underline">
                    {participant.displayName}
                  </a>
                ) : (
                  participant.displayName
                )}{" "}
                <span className="text-muted-foreground">
                  (RSVP: {participant.rsvp}; attendance: {participant.attendance})
                </span>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="ghost" onClick={revokeReport} disabled={loading}>
            {loading ? "Revoking…" : "Revoke report access"}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
