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
  nicheColors: Map<string, string>;
  selectedNicheId: string | null;
  onSelectedNicheIdChange: (nicheId: string | null) => void;
  layers: ExploreMapLayerVisibility;
  onLayersChange: (layers: ExploreMapLayerVisibility) => void;
};

export function ExploreMapToolbar({
  niches,
  nicheColors,
  selectedNicheId,
  onSelectedNicheIdChange,
  layers,
  onLayersChange,
}: ExploreMapToolbarProps) {
  return (
    <>
      {niches.length > 0 ? (
        <div
          className="absolute left-4 top-20 z-10 flex max-h-[calc(100%-10rem)] w-56 flex-col gap-1 overflow-y-auto rounded-xl border border-border/60 bg-background/90 p-2 shadow-sm backdrop-blur-md"
          data-testid="explore-map-niche-filters"
        >
          {niches.map((niche) => {
            const selected = selectedNicheId === niche.entityId;
            const dotColor = nicheColors.get(niche.entityId) ?? "var(--primary)";
            return (
              <button
                key={niche.entityId}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onSelectedNicheIdChange(selected ? null : niche.entityId)
                }
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-2 text-left text-xs transition-colors",
                  selected
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "hover:bg-muted/80",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{niche.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {niche.memberCount}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="absolute bottom-16 right-4 z-10">
        <LayerToggleRow layers={layers} onLayersChange={onLayersChange} />
      </div>
    </>
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
      className="flex shrink-0 items-center gap-4 rounded-xl border border-border/60 bg-background/90 px-3 py-2 shadow-sm backdrop-blur-md"
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
