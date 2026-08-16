"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Telescope, Users } from "lucide-react";
import type { ExploreMapResponse } from "@/lib/db/queries/explore-map";
import { ExploreMapCanvas } from "@/components/explore/explore-map-force-graph";
import { ExploreContactDrawer } from "@/components/explore/explore-contact-drawer";
import { formatExploreMapBadge } from "@/components/explore/explore-map-utils";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExploreMapResponse };

export function ExploreMapView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchMap = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const res = await fetch("/api/explore/map");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as ExploreMapResponse;
      setLoadState({ status: "ready", data });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load audience map",
      });
    }
  }, []);

  useEffect(() => {
    void fetchMap();
  }, [fetchMap]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });
    observer.observe(node);
    setContainerSize({
      width: Math.floor(node.clientWidth),
      height: Math.floor(node.clientHeight),
    });
    return () => observer.disconnect();
  }, [loadState.status]);

  const handleContactClick = (contactId: string) => {
    setSelectedContactId(contactId);
    setDrawerOpen(true);
  };

  if (loadState.status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <EmptyState
          icon={Telescope}
          title="Could not load audience map"
          description={loadState.message}
        />
        <Button onClick={() => void fetchMap()}>Retry</Button>
      </div>
    );
  }

  const { data } = loadState;

  if (data.meta.ownerContactId === null) {
    return (
      <EmptyState
        icon={Users}
        title="Mark your own contact to see your audience"
        description='Set one contact as yourself (is_self) — agents can do this with the update_contact tool — then sync your audience connections.'
      />
    );
  }

  if (data.meta.totalContacts === 0) {
    return (
      <EmptyState
        icon={Telescope}
        title="No audience connections synced yet"
        description="Followers and connections will appear here once your graph syncs."
        cta={{ label: "View contacts", href: "/dashboard/contacts" }}
      />
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-12rem)] rounded-xl border border-border bg-card/40">
      <div className="absolute right-4 top-4 z-10">
        <Badge variant="secondary">
          {formatExploreMapBadge({
            totalContacts: data.meta.totalContacts,
            shownContacts: data.meta.shownContacts,
            truncated: data.meta.truncated,
            nodes: data.nodes,
          })}
        </Badge>
      </div>
      <div ref={containerRef} className="h-[calc(100vh-12rem)] w-full">
        {containerSize.width > 0 && containerSize.height > 0 ? (
          <ExploreMapCanvas
            nodes={data.nodes}
            edges={data.edges}
            width={containerSize.width}
            height={containerSize.height}
            onContactClick={handleContactClick}
          />
        ) : null}
      </div>
      <ExploreContactDrawer
        contactId={selectedContactId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
