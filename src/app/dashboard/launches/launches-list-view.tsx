import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LaunchWithDetails } from "@/lib/db/queries/launches";
import { formatLaunchDate, formatVariantCount } from "@/lib/launches-display";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  generating: "secondary",
  simulating: "secondary",
  ready: "default",
  live: "default",
  completed: "secondary",
  archived: "outline",
};

interface LaunchesListViewProps {
  launches: LaunchWithDetails[];
}

export function LaunchesListView({ launches }: LaunchesListViewProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Variants</TableHead>
          <TableHead>Goals</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {launches.map((launch) => (
          <TableRow key={launch.id} className="hover:bg-muted/50">
            <TableCell colSpan={5} className="p-0">
              <Link
                href={`/dashboard/launches/${launch.id}`}
                className="grid grid-cols-5 items-center gap-2 px-2 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{launch.name}</span>
                  {launch.scope === "local_only" && (
                    <Badge variant="outline">Private</Badge>
                  )}
                </div>
                <div>
                  <Badge variant={STATUS_VARIANTS[launch.status] ?? "outline"}>
                    {launch.status}
                  </Badge>
                </div>
                <div>{formatVariantCount(launch.variants)}</div>
                <div>{launch.goalIds.length}</div>
                <div className="text-muted-foreground">
                  {formatLaunchDate(launch.updatedAt)}
                </div>
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
