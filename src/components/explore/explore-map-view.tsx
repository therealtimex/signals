"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Telescope, Users } from "lucide-react";
import type { ExploreMapResponse } from "@/lib/db/queries/explore-map";
import { ExploreMapCanvas } from "@/components/explore/explore-map-force-graph";
import type { ExploreMapHoverContact } from "@/components/explore/explore-map-canvas";
import { ExploreContactDrawer } from "@/components/explore/explore-contact-drawer";
import { ExploreMapHoverCard } from "@/components/explore/explore-map-hover-card";
import { ExploreOwnerChip } from "@/components/explore/explore-owner-chip";
import { ExploreSelfPicker } from "@/components/explore/explore-self-picker";
import {
  buildExploreNicheColorMap,
  EXPLORE_MAP_DEFAULT_LAYERS,
  formatExploreMapBadge,
  listExploreMapNiches,
  type ExploreMapLayerVisibility,
} from "@/components/explore/explore-map-utils";
import { ExploreMapToolbar } from "@/components/explore/explore-map-toolbar";
import { useExploreMapThemeColors } from "@/components/explore/use-explore-map-theme-colors";
import { AddContactDialog } from "@/components/add-contact-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ExploreMapResponse; hasContactCandidates: boolean };

export function ExploreMapView() {
  const theme = useExploreMapThemeColors();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedNicheId, setSelectedNicheId] = useState<string | null>(null);
  const [layers, setLayers] = useState<ExploreMapLayerVisibility>(EXPLORE_MAP_DEFAULT_LAYERS);
  const [hoverContact, setHoverContact] = useState<ExploreMapHoverContact | null>(null);
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

  const readyData = loadState.status === "ready" ? loadState.data : null;
  const nicheColorMap = useMemo(
    () => buildExploreNicheColorMap(readyData?.nodes ?? [], theme),
    [readyData, theme],
  );

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
          mood="sad"
          title="Could not load audience map"
          description={loadState.message}
        />
        <Button onClick={() => void fetchMap()}>Retry</Button>
      </div>
    );
  }

  const { data, hasContactCandidates } = loadState;
  const ownerName = data.meta.owner?.name ?? "You";
  const mapNiches = listExploreMapNiches(data.nodes);
  const statsLabel = formatExploreMapBadge({
    totalContacts: data.meta.totalContacts,
    shownContacts: data.meta.shownContacts,
    truncated: data.meta.truncated,
    nodes: data.nodes,
  });

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
          mood="shy"
          title="Set yourself to see your audience"
          description={
            hasContactCandidates
              ? "Your audience map is drawn around your own contact. Tell Signals which contact is you."
              : "Create your profile to anchor the map — audience connections attach to it as you sync."
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
    const emptyDescription = hasContactCandidates
      ? "You have contacts, but none are linked to your audience graph yet. Sync or import platform relationships (X followers/following, LinkedIn connections) from Automation → Workflows."
      : "Sync or import platform relationships — X followers and following, LinkedIn connections, and other social imports — to populate your audience map.";

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <ExploreOwnerChip
          name={ownerName}
          onChange={() => setPickerOpen(true)}
        />
        <EmptyState
          icon={Telescope}
          mood="curious"
          title="No audience connections synced yet"
          description={emptyDescription}
          cta={
            hasContactCandidates
              ? { label: "View contacts", href: "/dashboard/contacts" }
              : { label: "Open workflows", href: "/dashboard/workflows" }
          }
        />
        {picker}
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-10rem)] min-h-[520px] overflow-hidden rounded-xl border border-border/50 bg-muted/20">
      <div className="absolute left-4 top-4 z-10">
        <ExploreOwnerChip
          name={ownerName}
          onChange={() => setPickerOpen(true)}
          className="rounded-full border border-border/60 bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur-md"
        />
      </div>

      <div ref={containerRef} className="h-full w-full">
        {containerSize.width > 0 && containerSize.height > 0 ? (
          <ExploreMapCanvas
            nodes={data.nodes}
            edges={data.edges}
            width={containerSize.width}
            height={containerSize.height}
            selectedNicheId={selectedNicheId}
            layers={layers}
            onContactClick={handleContactClick}
            onHoverContactChange={setHoverContact}
          />
        ) : null}
      </div>

      <ExploreMapHoverCard contact={hoverContact} />

      <ExploreMapToolbar
        niches={mapNiches}
        nicheColors={nicheColorMap}
        selectedNicheId={selectedNicheId}
        onSelectedNicheIdChange={setSelectedNicheId}
        layers={layers}
        onLayersChange={setLayers}
      />

      <p className="pointer-events-none absolute bottom-4 left-4 z-10 text-xs text-muted-foreground">
        {statsLabel}
      </p>

      <p
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 rounded-full border border-border/60 bg-background/85 px-4 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-md md:block"
        data-testid="explore-map-hint"
      >
        Click a niche to zoom · click a follower for their explore card · scroll to zoom · drag to pan
      </p>

      <ExploreContactDrawer
        contactId={selectedContactId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
      {picker}
    </div>
  );
}
