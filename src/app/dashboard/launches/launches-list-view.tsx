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
          <TableRow key={launch.id} className="cursor-pointer">
            <TableCell>
              <Link href={`/dashboard/launches/${launch.id}`} className="block">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{launch.name}</span>
                  {launch.scope === "local_only" && (
                    <Badge variant="outline">Private</Badge>
                  )}
                </div>
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/dashboard/launches/${launch.id}`} className="block">
                <Badge variant={STATUS_VARIANTS[launch.status] ?? "outline"}>
                  {launch.status}
                </Badge>
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/dashboard/launches/${launch.id}`} className="block">
                {formatVariantCount(launch.variants)}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/dashboard/launches/${launch.id}`} className="block">
                {launch.goalIds.length}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/dashboard/launches/${launch.id}`} className="block text-muted-foreground">
                {formatLaunchDate(launch.updatedAt)}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
