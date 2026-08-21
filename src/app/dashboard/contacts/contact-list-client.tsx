"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AddContactDialog } from "@/components/add-contact-dialog";
import { ContactListAvatar } from "@/components/contact-list-avatar";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import { EnrichmentScoreBadge } from "@/components/enrichment-score-badge";
import { PaginationControls } from "@/components/pagination-controls";
import { PlatformMark } from "@/components/platform-mark";
import { Users, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatContactListSubtitle } from "@/lib/contact-detail-format";
import { identityProfileHref } from "@/lib/contact-identity-handle";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";

const funnelStages = ["all", "prospect", "engaged", "qualified", "opportunity", "customer", "advocate"];

/** Check if a contact is archived by parsing its metadata JSON. */
function isArchived(contact: ContactDTO): boolean {
  try {
    const meta = JSON.parse(contact.metadata ?? "{}");
    return meta.archived === 1;
  } catch {
    return false;
  }
}

interface ContactListClientProps {
  contacts: ContactDTO[];
  total: number;
  page: number;
  pageSize: number;
  currentSearch?: string;
  currentFunnelStage?: string;
  includeArchived?: boolean;
  currentWorkflowRunId?: string;
}

export function ContactListClient({
  contacts,
  total,
  page,
  pageSize,
  currentSearch,
  currentFunnelStage,
  includeArchived,
  currentWorkflowRunId,
}: ContactListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentSearch ?? "");

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/dashboard/contacts?${params.toString()}`);
    },
    [router, searchParams]
  );

  const createPageUrl = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (p > 1) {
        params.set("page", String(p));
      } else {
        params.delete("page");
      }
      return `/dashboard/contacts?${params.toString()}`;
    },
    [searchParams]
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams("search", search);
  }

  if (contacts.length === 0 && !currentSearch && !currentFunnelStage && !currentWorkflowRunId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            No contacts yet
          </CardTitle>
          <CardDescription>
            Add your first contact to start building your CRM.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddContactDialog />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {currentWorkflowRunId ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">Workflow run</Badge>
          <span>
            Showing contacts created in run{" "}
            <span className="font-mono text-foreground">{currentWorkflowRunId.slice(0, 8)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.delete("createdWorkflowRunId");
              params.delete("page");
              router.push(`/dashboard/contacts?${params.toString()}`);
            }}
          >
            Clear
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="min-w-56 flex-1">
          <Input
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </form>
        <Select
          defaultValue={currentFunnelStage ?? "all"}
          onValueChange={(v) => updateParams("funnelStage", v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Funnel stage" />
          </SelectTrigger>
          <SelectContent>
            {funnelStages.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All Stages" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={includeArchived ? "secondary" : "outline"}
          size="sm"
          onClick={() => updateParams("archived", includeArchived ? "" : "true")}
          className="gap-1.5"
        >
          <Archive className="h-3.5 w-3.5" />
          {includeArchived ? "Hide Archived" : "Show Archived"}
        </Button>
        <AddContactDialog />
      </div>

      {contacts.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              No contacts match your filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-0 w-full">Name</TableHead>
                <TableHead className="w-auto min-w-[7.5rem] whitespace-nowrap">Identities</TableHead>
                <TableHead className="hidden w-auto whitespace-nowrap sm:table-cell">Stage</TableHead>
                <TableHead className="hidden w-auto whitespace-nowrap sm:table-cell">Enrichment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => {
                const archived = isArchived(contact);
                const subtitle = formatContactListSubtitle(contact);
                const href = `/dashboard/contacts/${contact.id}`;
                return (
                <TableRow
                  key={contact.id}
                  className={`cursor-pointer hover:bg-accent/30 transition-colors ${archived ? "opacity-60" : ""}`}
                  onClick={() => router.push(href)}
                >
                  <TableCell className="min-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <ContactListAvatar contact={contact} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link
                            href={href}
                            className="font-medium hover:underline truncate"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {contact.name}
                          </Link>
                          {contact.isSelf ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                              You
                            </Badge>
                          ) : null}
                          {archived && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 shrink-0">
                              <Archive className="h-2.5 w-2.5" />
                              Archived
                            </Badge>
                          )}
                        </div>
                        {subtitle ? (
                          <p className="text-xs text-muted-foreground truncate">
                            {subtitle}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {contact.identities.length > 0 ? (
                      <div className="flex w-max items-center gap-1">
                        {contact.identities.map((identity) => {
                          const profileHref = identityProfileHref(identity);
                          const mark = (
                            <PlatformMark platform={identity.platform} size="sm" />
                          );
                          if (!profileHref) {
                            return (
                              <span key={identity.id}>{mark}</span>
                            );
                          }
                          return (
                            <a
                              key={identity.id}
                              href={profileHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {mark}
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    <FunnelStageBadge stage={contact.funnelStage} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    <EnrichmentScoreBadge score={contact.enrichmentScore} />
                  </TableCell>
                </TableRow>
                );
              })}
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
