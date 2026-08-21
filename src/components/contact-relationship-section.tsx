"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ContactRelationshipDTO } from "@/lib/db/queries/contact-relationship";
import {
  RELATIONSHIP_STAGES,
  formatLastTouch,
  formatRelationshipStage,
} from "@/lib/contact-detail-format";

type ContactRelationshipSectionProps = {
  contactId: string;
  isSelf?: boolean;
  openTaskCount?: number;
  onOpenTasks?: () => void;
};

export function ContactRelationshipSection({
  contactId,
  isSelf = false,
  openTaskCount = 0,
  onOpenTasks,
}: ContactRelationshipSectionProps) {
  const router = useRouter();
  const [relationship, setRelationship] = useState<ContactRelationshipDTO | null>(null);
  const [stage, setStage] = useState("");
  const [warmth, setWarmth] = useState(50);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(!isSelf);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesBaseline = useRef("");

  useEffect(() => {
    if (isSelf) return;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/relationship`);
        if (!res.ok) return;
        const body = (await res.json()) as { relationship: ContactRelationshipDTO | null };
        setRelationship(body.relationship);
        if (body.relationship) {
          setStage(body.relationship.stage ?? "");
          setWarmth(body.relationship.warmth ?? 50);
          setNotes(body.relationship.notes ?? "");
          notesBaseline.current = body.relationship.notes ?? "";
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [contactId, isSelf]);

  async function persist(next: { stage: string; warmth: number; notes: string }) {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/relationship`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: next.stage || null,
          warmth: next.warmth,
          notes: next.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save relationship");
      }
      const body = (await res.json()) as { relationship: ContactRelationshipDTO };
      setRelationship(body.relationship);
      notesBaseline.current = next.notes;
      setSaved(true);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (isSelf) {
    return (
      <Card className="gap-4 py-4">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This contact is you. Audience and enrichment are drawn around this profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="gap-4 py-4">
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading relationship…</p>
        </CardContent>
      </Card>
    );
  }

  const lastTouch = relationship?.lastMeaningfulInteraction
    ? formatLastTouch(relationship.lastMeaningfulInteraction)
    : null;
  const nextAction = !stage
    ? "Choose a stage"
    : lastTouch
      ? `Last touch ${lastTouch}`
      : "No recent interaction";

  return (
    <Card className="gap-4 py-4">
      <CardContent className="space-y-4">
        <div className="grid gap-x-6 gap-y-1 md:grid-cols-[max-content_minmax(0,1fr)]">
          <div className="flex h-5 items-center gap-2">
            <h2 className="text-sm font-semibold">Relationship</h2>
            {saving || saved ? (
              <p className="text-xs text-muted-foreground">{saving ? "Saving…" : "Saved"}</p>
            ) : null}
          </div>
          <Label htmlFor="relationship-notes" className="flex h-5 items-center text-sm font-semibold">
            Notes
          </Label>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground" title="Private to this workspace">
              {nextAction}
            </p>
            <div className="flex flex-wrap gap-1.5 md:flex-nowrap">
              {RELATIONSHIP_STAGES.map((value) => {
                const selected = stage === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    disabled={saving}
                    onClick={() => {
                      setStage(value);
                      void persist({ stage: value, warmth, notes });
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    {formatRelationshipStage(value)}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="relationship-warmth" className="text-xs">
                  Warmth
                </Label>
                <span className="text-xs font-medium tabular-nums">{warmth}</span>
              </div>
              <input
                id="relationship-warmth"
                type="range"
                min={0}
                max={100}
                step={1}
                value={warmth}
                disabled={saving}
                onChange={(event) => setWarmth(Number(event.target.value))}
                onPointerUp={() => void persist({ stage, warmth, notes })}
                onKeyUp={() => void persist({ stage, warmth, notes })}
                className="h-2 w-full cursor-pointer accent-primary"
              />
            </div>
          </div>

          <div className="min-h-[7rem]">
            <Textarea
              id="relationship-notes"
              value={notes}
              rows={4}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== notesBaseline.current) {
                  void persist({ stage, warmth, notes });
                }
              }}
              placeholder="Private context for the next conversation"
              className="h-full min-h-[7rem] resize-none"
            />
          </div>
        </div>

        {openTaskCount > 0 && onOpenTasks ? (
          <Button type="button" variant="ghost" size="sm" className="px-0" onClick={onOpenTasks}>
            {openTaskCount} open {openTaskCount === 1 ? "task" : "tasks"}
          </Button>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
