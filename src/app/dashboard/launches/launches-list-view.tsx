"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
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
import {
  getLaunchDetailHref,
  isLaunchRowActivationKey,
} from "./launches-list-utils";

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
  const router = useRouter();

  function navigateToLaunch(launchId: string) {
    router.push(getLaunchDetailHref(launchId));
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, launchId: string) {
    if (!isLaunchRowActivationKey(event.key)) return;
    event.preventDefault();
    navigateToLaunch(launchId);
  }

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
          <TableRow
            key={launch.id}
            className="cursor-pointer hover:bg-muted/50"
            tabIndex={0}
            role="link"
            aria-label={`Open launch ${launch.name}`}
            onClick={() => navigateToLaunch(launch.id)}
            onKeyDown={(event) => handleRowKeyDown(event, launch.id)}
          >
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="font-medium">{launch.name}</span>
                {launch.scope === "local_only" && (
                  <Badge variant="outline">Private</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANTS[launch.status] ?? "outline"}>
                {launch.status}
              </Badge>
            </TableCell>
            <TableCell>{formatVariantCount(launch.variants)}</TableCell>
            <TableCell>{launch.goalIds.length}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatLaunchDate(launch.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
