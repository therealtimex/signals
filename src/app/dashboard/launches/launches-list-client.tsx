"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { Plus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { PaginationControls } from "@/components/pagination-controls";
import type { LaunchWithDetails } from "@/lib/db/queries/launches";
import { LAUNCH_STATUSES } from "@/lib/db/gtm-status";
import { LaunchDialog } from "./launch-dialog";
import { LaunchesListView } from "./launches-list-view";

const statusFilters = [{ value: "all", label: "All" }, ...LAUNCH_STATUSES.map((status) => ({
  value: status,
  label: status.charAt(0).toUpperCase() + status.slice(1),
}))];

interface LaunchesListClientProps {
  launches: LaunchWithDetails[];
  total: number;
  page: number;
  pageSize: number;
  currentStatus?: string;
  currentSearch?: string;
  includeLocalOnly: boolean;
  hasAnyLaunches: boolean;
}

function LaunchesListInner({
  launches,
  total,
  page,
  pageSize,
  currentStatus,
  currentSearch,
  includeLocalOnly,
  hasAnyLaunches,
}: LaunchesListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState(currentSearch ?? "");

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      router.push(`/dashboard/launches?${params.toString()}`);
    },
    [router, searchParams],
  );

  function setStatusFilter(value: string) {
    pushParams((params) => {
      if (value === "all") {
        params.delete("status");
      } else {
        params.set("status", value);
      }
      params.delete("page");
    });
  }

  function submitSearch() {
    pushParams((params) => {
      const trimmed = search.trim();
      if (trimmed) {
        params.set("search", trimmed);
      } else {
        params.delete("search");
      }
      params.delete("page");
    });
  }

  function setIncludePrivate(checked: boolean) {
    pushParams((params) => {
      if (checked) {
        params.set("includeLocalOnly", "true");
      } else {
        params.delete("includeLocalOnly");
      }
      params.delete("page");
    });
  }

  const createPageUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage > 1) {
        params.set("page", String(nextPage));
      } else {
        params.delete("page");
      }
      return `/dashboard/launches?${params.toString()}`;
    },
    [searchParams],
  );

  if (!hasAnyLaunches) {
    return (
      <>
        <EmptyState
          icon={Rocket}
          title="No launches yet"
          description="Create a launch here or from your terminal agent to start testing content in the Wind Tunnel."
        />
        <div className="flex justify-center">
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New launch
          </Button>
        </div>
        <LaunchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={() => router.refresh()}
        />
      </>
    );
  }

  const filtersActive = Boolean(currentStatus || currentSearch || includeLocalOnly);

  return (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={currentStatus ?? "all"} onValueChange={setStatusFilter}>
          <TabsList className="flex-wrap h-auto">
            {statusFilters.map((filter) => (
              <TabsTrigger key={filter.value} value={filter.value}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New launch
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex gap-2 max-w-md w-full"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search launches..."
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="flex items-center gap-2">
          <Switch
            id="include-private"
            checked={includeLocalOnly}
            onCheckedChange={setIncludePrivate}
          />
          <Label htmlFor="include-private">Include private</Label>
        </div>
      </div>

      {launches.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No launches match the current filters.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} launch{total !== 1 ? "es" : ""}
            {filtersActive ? " (filtered)" : ""}
          </p>
          <LaunchesListView launches={launches} />
        </>
      )}

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        createPageUrl={createPageUrl}
      />

      <LaunchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}

export function LaunchesListClient(props: LaunchesListClientProps) {
  return (
    <Suspense fallback={<div className="animate-pulse h-64 bg-muted rounded-lg" />}>
      <LaunchesListInner {...props} />
    </Suspense>
  );
}
