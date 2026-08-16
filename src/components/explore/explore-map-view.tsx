"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Telescope, Users } from "lucide-react";
import type { ExploreMapResponse } from "@/lib/db/queries/explore-map";
import { ExploreMapCanvas } from "@/components/explore/explore-map-force-graph";
import { ExploreContactDrawer } from "@/components/explore/explore-contact-drawer";
import { ExploreOwnerChip } from "@/components/explore/explore-owner-chip";
import { ExploreSelfPicker } from "@/components/explore/explore-self-picker";
import { formatExploreMapBadge } from "@/components/explore/explore-map-utils";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExploreMapResponse; hasContactCandidates: boolean };

export function ExploreMapView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchMap = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const contactsPromise = fetch("/api/contacts?pageSize=1");
      const mapRes = await fetch("/api/explore/map");

      if (!mapRes.ok) {
        const body = (await mapRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${mapRes.status})`);
      }

      const data = (await mapRes.json()) as ExploreMapResponse;

      let hasContactCandidates = true;
      try {
        const contactsRes = await contactsPromise;
        if (contactsRes.ok) {
          const contactsBody = (await contactsRes.json().catch(() => null)) as {
            total?: number;
          } | null;
          if (contactsBody) {
            hasContactCandidates = (contactsBody.total ?? 0) > 0;
          }
        }
      } catch {
        // Spec §5.1: count-fetch errors fall back to the ≥1 CTA variant.
      }

      setLoadState({ status: "ready", data, hasContactCandidates });
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
    const width = Math.floor(node.clientWidth);
    const height = Math.floor(node.clientHeight);
    if (width > 0 && height > 0) {
      setContainerSize({ width, height });
    }
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

  const { data, hasContactCandidates } = loadState;
  const ownerName = data.meta.owner?.name ?? "You";

  const picker = (
    <ExploreSelfPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      currentOwnerId={data.meta.ownerContactId}
      onOwnerChanged={() => void fetchMap()}
    />
  );

  if (data.meta.ownerContactId === null) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <EmptyState
          icon={Users}
          title="Set yourself to see your audience"
          description={
            hasContactCandidates
              ? "Your audience map is drawn around your own contact. Tell Signals which contact is you."
              : "Create your profile to anchor the map — audience connections attach to it as they sync."
          }
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasContactCandidates ? (
            <>
              <Button onClick={() => setPickerOpen(true)}>Choose my contact</Button>
              <AddContactDialog
                title="Create your profile"
                payloadExtras={{ isSelf: true }}
                onCreated={() => void fetchMap()}
                trigger={<Button variant="outline">Create my profile</Button>}
              />
            </>
          ) : (
            <AddContactDialog
              title="Create your profile"
              payloadExtras={{ isSelf: true }}
              onCreated={() => void fetchMap()}
              trigger={<Button>Create my profile</Button>}
            />
          )}
        </div>
        {picker}
      </div>
    );
  }

  if (data.meta.totalContacts === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <ExploreOwnerChip
          name={ownerName}
          onChange={() => setPickerOpen(true)}
        />
        <EmptyState
          icon={Telescope}
          title="No audience connections synced yet"
          description="Followers and connections will appear here once your graph syncs."
          cta={{ label: "View contacts", href: "/dashboard/contacts" }}
        />
        {picker}
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100vh-12rem)] rounded-xl border border-border bg-card/40">
      <div className="absolute left-4 top-4 z-10">
        <ExploreOwnerChip
          name={ownerName}
          onChange={() => setPickerOpen(true)}
          className="rounded-md border border-border bg-background/80 px-2 py-1 backdrop-blur-sm"
        />
      </div>
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
      {picker}
    </div>
  );
}
