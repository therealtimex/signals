import type { ContactExploreNiche } from "@/lib/db/queries/contact-explore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ExploreNicheChipsProps = {
  niches: ContactExploreNiche[];
};

export function ExploreNicheChips({ niches }: ExploreNicheChipsProps) {
  if (niches.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Niches</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {niches.map((niche) => (
            <a
              key={niche.id}
              href="#"
              title="Niche detail coming soon"
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-muted"
            >
              <span>{niche.name}</span>
              {niche.weight != null && (
                <span className="text-xs text-muted-foreground">
                  {(niche.weight * 100).toFixed(0)}%
                </span>
              )}
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
