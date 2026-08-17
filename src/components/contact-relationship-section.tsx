"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContactRelationshipDTO } from "@/lib/db/queries/contact-relationship";

const STAGES = ["stranger", "acquaintance", "warm", "close", "inner_circle"] as const;

type ContactRelationshipSectionProps = {
  contactId: string;
};

export function ContactRelationshipSection({ contactId }: ContactRelationshipSectionProps) {
  const router = useRouter();
  const [relationship, setRelationship] = useState<ContactRelationshipDTO | null>(null);
  const [stage, setStage] = useState<string>("");
  const [warmth, setWarmth] = useState("50");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/relationship`);
        if (!res.ok) return;
        const body = (await res.json()) as { relationship: ContactRelationshipDTO | null };
        setRelationship(body.relationship);
        if (body.relationship) {
          setStage(body.relationship.stage ?? "");
          setWarmth(String(body.relationship.warmth ?? 50));
          setNotes(body.relationship.notes ?? "");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [contactId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/relationship`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: stage || null,
          warmth: Number(warmth),
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save relationship");
      }
      const body = (await res.json()) as { relationship: ContactRelationshipDTO };
      setRelationship(body.relationship);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading relationship…</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relationship</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Private to this workspace (`local_only`). Meaningful activity logs update last meaningful
          interaction automatically.
        </p>
        {relationship?.lastMeaningfulInteraction ? (
          <p className="text-sm text-muted-foreground">
            Last meaningful interaction:{" "}
            {new Date(relationship.lastMeaningfulInteraction * 1000).toLocaleString()}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="relationship-stage">Stage</Label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger id="relationship-stage">
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="relationship-warmth">Warmth (0–100)</Label>
            <Input
              id="relationship-warmth"
              type="number"
              min={0}
              max={100}
              value={warmth}
              onChange={(event) => setWarmth(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="relationship-notes">Notes</Label>
          <Textarea
            id="relationship-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : "Save relationship"}
        </Button>
      </CardContent>
    </Card>
  );
}
