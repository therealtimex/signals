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
import { Badge } from "@/components/ui/badge";
import { AddOrganizationDialog } from "@/components/add-organization-dialog";
import { PaginationControls } from "@/components/pagination-controls";
import type { OrgListRow } from "@/lib/db/queries/orgs";

function formatUpdatedAt(updatedAt: number): string {
  return new Date(updatedAt * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface OrganizationListClientProps {
  orgs: OrgListRow[];
  total: number;
  page: number;
  pageSize: number;
  currentSearch?: string;
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
      <div className="flex items-center gap-4">
        <form onSubmit={handleSearchSubmit} className="flex-1">
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </form>
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
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-40">Domain</TableHead>
                <TableHead className="w-28 text-right">Contacts</TableHead>
                <TableHead className="w-36">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/organizations/${org.id}`}
                      className="font-medium hover:underline"
                    >
                      {org.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {org.orgType}
                    </Badge>
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
