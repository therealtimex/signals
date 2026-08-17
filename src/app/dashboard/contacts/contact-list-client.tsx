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
import { Users, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";

const funnelStages = ["all", "prospect", "engaged", "qualified", "opportunity", "customer", "advocate"];
const platformLabels: Record<string, string> = {
  x: "X",
  linkedin: "LI",
  gmail: "GM",
  substack: "SS",
};

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
  selfContact?: ContactDTO;
  total: number;
  page: number;
  pageSize: number;
  currentSearch?: string;
  currentFunnelStage?: string;
  includeArchived?: boolean;
}

export function ContactListClient({
  contacts,
  selfContact,
  total,
  page,
  pageSize,
  currentSearch,
  currentFunnelStage,
  includeArchived,
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

  if (contacts.length === 0 && !currentSearch && !currentFunnelStage) {
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
      {selfContact ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">You</Badge>
          <span>
            Your profile:{" "}
            <Link href={`/dashboard/contacts/${selfContact.id}`} className="font-medium text-foreground hover:underline">
              {selfContact.name}
            </Link>
          </span>
        </div>
      ) : null}
      <div className="flex items-center gap-4">
        <form onSubmit={handleSearchSubmit} className="flex-1">
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
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-36">Company</TableHead>
                <TableHead className="w-28">Identities</TableHead>
                <TableHead className="w-28">Stage</TableHead>
                <TableHead className="w-28">Enrichment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => {
                const archived = isArchived(contact);
                return (
                <TableRow key={contact.id} className={`hover:bg-accent/30 transition-colors ${archived ? "opacity-60" : ""}`}>
                  <TableCell>
                    <div className="flex items-center gap-3 min-w-0">
                      <ContactListAvatar contact={contact} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link
                            href={`/dashboard/contacts/${contact.id}`}
                            className="font-medium hover:underline truncate"
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
                        {contact.headline ? (
                          <p className="text-xs text-muted-foreground truncate">
                            {contact.headline}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate">
                    {contact.company ?? "—"}
                  </TableCell>
                  <TableCell>
                    {contact.identities.length > 0 ? (
                      <div className="flex gap-1">
                        {contact.identities.map((identity) => (
                          <Badge key={identity.id} variant="secondary" className="text-xs">
                            {platformLabels[identity.platform] ?? identity.platform}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <FunnelStageBadge stage={contact.funnelStage} />
                  </TableCell>
                  <TableCell>
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
