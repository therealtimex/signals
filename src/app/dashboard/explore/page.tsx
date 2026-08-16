import { ExploreMapView } from "@/components/explore/explore-map-view";

export default function ExplorePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">Explore</h1>
        <p className="text-muted-foreground mt-1">
          Map your audience constellation and drill into explore cards.
        </p>
      </div>
      <ExploreMapView />
    </div>
  );
}
