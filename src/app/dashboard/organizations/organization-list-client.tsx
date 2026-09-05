"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddOrganizationDialog } from "@/components/add-organization-dialog";
import { PaginationControls } from "@/components/pagination-controls";
import type { OrgListRow } from "@/lib/db/queries/orgs";

function formatUpdatedAt(updatedAt: number): string {
  const date = new Date(updatedAt * 1000);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${month[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** Initials for the logo placeholder — same treatment contacts get, so rows read as rows. */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

/** "3 people · Ada Lovelace, Alan Turing +1" — the org-side mirror of a contact's employment line. */
export function peopleSummary(count: number, names: string[]): string {
  if (count === 0) return "No linked people";
  const label = count === 1 ? "1 person" : `${count} people`;
  if (names.length === 0) return label;
  const shown = names.slice(0, 2).join(", ");
  const extra = count - Math.min(names.length, 2);
  return extra > 0 ? `${label} · ${shown} +${extra}` : `${label} · ${shown}`;
}

interface OrganizationListClientProps {
  orgs: OrgListRow[];
  total: number;
  page: number;
  pageSize: number;
  currentSearch?: string;
  currentPeople?: string;
  currentSource?: string;
  currentSort?: string;
}

export function OrganizationListClient(props: OrganizationListClientProps) {
  return (
    <Suspense fallback={<div className="animate-pulse h-64 rounded-lg bg-muted" />}>
      <OrganizationListInner {...props} />
    </Suspense>
  );
}

function OrganizationListInner({
  orgs,
  total,
  page,
  pageSize,
  currentSearch,
  currentPeople,
  currentSource,
  currentSort,
}: OrganizationListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentSearch ?? "");

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/dashboard/organizations?${params.toString()}`);
    },
    [router, searchParams],
  );

  const createPageUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage > 1) {
        params.set("page", String(nextPage));
      } else {
        params.delete("page");
      }
      return `/dashboard/organizations?${params.toString()}`;
    },
    [searchParams],
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams("search", search.trim());
  }

  if (orgs.length === 0 && !currentSearch) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            No companies yet
          </CardTitle>
          <CardDescription>
            Add a company to connect people, relationships, and signals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddOrganizationDialog />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[16rem]">
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </form>

        <Select
          value={currentPeople ?? "any"}
          onValueChange={(value) => updateParams("people", value === "any" ? "" : value)}
        >
          <SelectTrigger className="w-44"><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All companies</SelectItem>
            <SelectItem value="multiple">2+ people</SelectItem>
            <SelectItem value="unlinked">No linked people</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentSource ?? "any"}
          onValueChange={(value) => updateParams("source", value === "any" ? "" : value)}
        >
          <SelectTrigger className="w-40"><SelectValue placeholder="Any source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any source</SelectItem>
            <SelectItem value="import">Imported</SelectItem>
            <SelectItem value="agent">Agent-created</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentSort ?? "updated"}
          onValueChange={(value) => updateParams("sort", value === "updated" ? "" : value)}
        >
          <SelectTrigger className="w-44"><SelectValue placeholder="Recently updated" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="people">Most people</SelectItem>
            <SelectItem value="name">Name (A–Z)</SelectItem>
          </SelectContent>
        </Select>

        <AddOrganizationDialog />
      </div>

      {orgs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              No companies match your search.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Domain</TableHead>
                <TableHead className="w-28 text-right">People</TableHead>
                <TableHead className="w-36">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9 shrink-0">
                        <AvatarFallback>{orgInitials(org.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/organizations/${org.id}`}
                          className="font-medium hover:underline"
                        >
                          {org.name}
                        </Link>
                        <p className="text-sm text-muted-foreground truncate">
                          {peopleSummary(org.contactCount, org.linkedContactNames)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {org.domain ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{org.contactCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatUpdatedAt(org.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        createPageUrl={createPageUrl}
      />
    </div>
  );
}
