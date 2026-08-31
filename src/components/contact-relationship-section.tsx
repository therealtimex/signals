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
  const [editingNotes, setEditingNotes] = useState(false);
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
      <Card data-contact-detail-section="relationship" className="gap-3 py-4">
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
      <Card data-contact-detail-section="relationship" className="gap-3 py-4">
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
    <Card data-contact-detail-section="relationship" className="gap-3 py-4">
      <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(16rem,1fr)]">
        <div className="space-y-2.5">
          <div className="flex min-h-6 items-center gap-2">
            <h2 className="text-sm font-semibold">Relationship</h2>
            {saving || saved ? (
              <p className="text-xs text-muted-foreground">{saving ? "Saving…" : "Saved"}</p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground" title="Private to this workspace">
            {nextAction}
          </p>
          <div className="flex flex-wrap gap-1.5">
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
                    "rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
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
          <div className="grid grid-cols-[auto_minmax(0,1fr)_2rem] items-center gap-3">
            <Label htmlFor="relationship-warmth" className="text-xs">
              Warmth
            </Label>
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
            <span className="text-right text-xs font-medium tabular-nums">{warmth}</span>
          </div>
          {openTaskCount > 0 && onOpenTasks ? (
            <Button type="button" variant="ghost" size="xs" className="px-0" onClick={onOpenTasks}>
              {openTaskCount} open {openTaskCount === 1 ? "task" : "tasks"}
            </Button>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <Label
              htmlFor={editingNotes ? "relationship-notes" : undefined}
              className="text-sm font-semibold"
            >
              Notes
            </Label>
            {!editingNotes ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Edit relationship notes"
                onClick={() => setEditingNotes(true)}
              >
                {notes ? "Edit" : "Add note"}
              </Button>
            ) : null}
          </div>
          {editingNotes ? (
            <Textarea
              id="relationship-notes"
              autoFocus
              value={notes}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== notesBaseline.current) {
                  void persist({ stage, warmth, notes });
                }
                setEditingNotes(false);
              }}
              placeholder="Private context for the next conversation"
              className="min-h-20 resize-none"
            />
          ) : (
            <button
              type="button"
              aria-label={notes ? "Open relationship notes" : "Add relationship notes"}
              onClick={() => setEditingNotes(true)}
              className={cn(
                "flex min-h-16 w-full items-start rounded-md border bg-muted/20 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                !notes && "text-muted-foreground",
              )}
            >
              <span className="line-clamp-2">
                {notes || "Add private context for the next conversation"}
              </span>
            </button>
          )}
        </div>

        {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
