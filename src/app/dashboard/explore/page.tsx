import { ExploreMapView } from "@/components/explore/explore-map-view";

export default function ExplorePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-heading-1">Explore</h1>
        <p className="text-muted-foreground mt-1">
          Your audience constellation — clustered by niche, zoomable like Signal Explore.
        </p>
      </div>
      <ExploreMapView />
    </div>
  );
}
