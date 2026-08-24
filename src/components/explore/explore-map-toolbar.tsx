"use client";

import type { ExploreMapNicheNode } from "@/lib/db/queries/explore-map";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EXPLORE_MAP_DEFAULT_LAYERS,
  type ExploreMapLayerVisibility,
} from "@/components/explore/explore-map-utils";
import { cn } from "@/lib/utils";

type ExploreMapToolbarProps = {
  niches: ExploreMapNicheNode[];
  selectedNicheId: string | null;
  onSelectedNicheIdChange: (nicheId: string | null) => void;
  layers: ExploreMapLayerVisibility;
  onLayersChange: (layers: ExploreMapLayerVisibility) => void;
};

export function ExploreMapToolbar({
  niches,
  selectedNicheId,
  onSelectedNicheIdChange,
  layers,
  onLayersChange,
}: ExploreMapToolbarProps) {
  if (niches.length === 0) {
    return (
      <div className="absolute bottom-4 right-4 z-10">
        <LayerToggleRow layers={layers} onLayersChange={onLayersChange} />
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div
        className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border bg-background/90 p-2 backdrop-blur-sm"
        data-testid="explore-map-niche-filters"
      >
        {niches.map((niche) => {
          const selected = selectedNicheId === niche.entityId;
          return (
            <button
              key={niche.entityId}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                onSelectedNicheIdChange(selected ? null : niche.entityId)
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              <span>{niche.label}</span>
              <span className="text-muted-foreground">{niche.memberCount}</span>
            </button>
          );
        })}
      </div>
      <LayerToggleRow layers={layers} onLayersChange={onLayersChange} />
    </div>
  );
}

function LayerToggleRow({
  layers,
  onLayersChange,
}: {
  layers: ExploreMapLayerVisibility;
  onLayersChange: (layers: ExploreMapLayerVisibility) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-4 rounded-md border border-border bg-background/90 px-3 py-2 backdrop-blur-sm"
      data-testid="explore-map-layer-toggles"
    >
      <div className="flex items-center gap-2">
        <Switch
          id="explore-layer-follows"
          checked={layers.showFollows}
          onCheckedChange={(showFollows) =>
            onLayersChange({ ...layers, showFollows })
          }
          size="sm"
        />
        <Label htmlFor="explore-layer-follows" className="text-xs">
          Follows
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="explore-layer-niches"
          checked={layers.showNiches}
          onCheckedChange={(showNiches) =>
            onLayersChange({ ...layers, showNiches })
          }
          size="sm"
        />
        <Label htmlFor="explore-layer-niches" className="text-xs">
          Niches
        </Label>
      </div>
    </div>
  );
}

export { EXPLORE_MAP_DEFAULT_LAYERS };
