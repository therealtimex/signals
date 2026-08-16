"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";
import { ContactExploreCardView } from "@/components/contact-explore-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type ExploreContactDrawerProps = {
  contactId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExploreContactDrawer({
  contactId,
  open,
  onOpenChange,
}: ExploreContactDrawerProps) {
  const [explore, setExplore] = useState<ContactExploreCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, ContactExploreCard>>(new Map());

  useEffect(() => {
    if (!open || !contactId) return;

    const cached = cacheRef.current.get(contactId);
    if (cached) {
      setExplore(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplore(null);

    void fetch(`/api/contacts/${contactId}/explore`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Failed to load explore card (${res.status})`);
        }
        return (await res.json()) as ContactExploreCard;
      })
      .then((data) => {
        if (cancelled) return;
        cacheRef.current.set(contactId, data);
        setExplore(data);
        setLoading(false);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load explore card",
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] max-w-[90vw] overflow-y-auto sm:max-w-[400px]">
        <SheetHeader>
          <SheetTitle>Explore</SheetTitle>
          <SheetDescription>Audience profile</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : null}
          {error && contactId ? (
            <div className="space-y-3 text-sm">
              <p className="text-destructive">{error}</p>
              <Link
                href={`/dashboard/contacts/${contactId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open contact page
              </Link>
            </div>
          ) : null}
          {!loading && !error && explore && contactId ? (
            <ContactExploreCardView contactId={contactId} explore={explore} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
