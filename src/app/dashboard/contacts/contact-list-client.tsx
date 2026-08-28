"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useEffect, useMemo } from "react";
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
import { ContactListFilterChips } from "@/components/contact-list-filter-chips";
import { ContactListSavedViewsToolbar } from "@/components/contact-list-saved-views-toolbar";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import { RelationshipGoalBadge } from "@/components/relationship-goal-badge";
import { EnrichmentScoreBadge } from "@/components/enrichment-score-badge";
import { PaginationControls } from "@/components/pagination-controls";
import { PlatformMark } from "@/components/platform-mark";
import { Users, Archive, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatContactListSubtitle } from "@/lib/contact-detail-format";
import { identityProfileHref } from "@/lib/contact-identity-handle";
import {
  CONTACT_CREATION_DETAIL_TAGS,
  CREATED_SOURCE_FILTER_OPTIONS,
  type ContactListFilterChip,
  type ContactListFilterState,
  contactListFiltersToSearchParams,
  contactListHasProvenanceFilters,
  contactListHasUserFilters,
  describeContactListFilterChips,
  removeContactListFilterKeys,
} from "@/lib/contacts/list-filter-state";
import {
  CONTACT_LIST_PLATFORMS,
  CONTACT_LIST_SORT_OPTIONS,
  ENRICHMENT_TIERS,
  ENRICHMENT_TIER_LABELS,
  RELATIONSHIP_GOAL_FILTER_OPTIONS,
  RELATIONSHIP_GOAL_STATUS_FILTER_OPTIONS,
  contactListSortValue,
} from "@/lib/contacts/list-filters";
import { CREATION_TAG_LABELS } from "@/lib/db/creation-sources";
import type {
  ContactProvenanceTemplateOption,
  ContactProvenanceWorkflowRunOption,
} from "@/lib/db/queries/contact-list-provenance";
import { PLATFORM_DISPLAY_NAMES } from "@/lib/platforms/capabilities";
import type { Platform } from "@/lib/db/platforms";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";

const funnelStages = ["all", "prospect", "engaged", "qualified", "opportunity", "customer", "advocate"];

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
  filters: ContactListFilterState;
  provenanceTemplates: ContactProvenanceTemplateOption[];
  provenanceWorkflowRuns: ContactProvenanceWorkflowRunOption[];
}

export function ContactListClient({
  contacts,
  total,
  page,
  pageSize,
  filters,
  provenanceTemplates,
  provenanceWorkflowRuns,
}: ContactListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(filters.search ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    contactListHasProvenanceFilters(filters),
  );

  const templateNames = useMemo(
    () => Object.fromEntries(provenanceTemplates.map((row) => [row.id, row.name])),
    [provenanceTemplates],
  );
  const workflowRunLabels = useMemo(
    () =>
      Object.fromEntries(
        provenanceWorkflowRuns.map((row) => [
          row.id,
          row.templateName
            ? `${row.templateName} · ${row.id.slice(0, 8)} (${row.contactCount})`
            : `Run ${row.id.slice(0, 8)} (${row.contactCount})`,
        ]),
      ),
    [provenanceWorkflowRuns],
  );
  const filterChips = useMemo(
    () =>
      describeContactListFilterChips(filters, {
        templateNames,
        workflowRunLabels,
      }),
    [filters, templateNames, workflowRunLabels],
  );

  const navigateWithFilters = useCallback(
    (next: ContactListFilterState) => {
      const params = contactListFiltersToSearchParams(next);
      router.push(`/dashboard/contacts?${params.toString()}`);
    },
    [router],
  );

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === "enrichmentTier") {
        params.delete("minEnrichmentScore");
        params.delete("maxEnrichmentScore");
      }
      if (key === "minEnrichmentScore" || key === "maxEnrichmentScore") {
        params.delete("enrichmentTier");
      }
      if (key === "hasRelationshipGoal") {
        if (value === "true") {
          params.set("hasRelationshipGoal", "true");
        } else {
          params.delete("hasRelationshipGoal");
        }
      } else if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/dashboard/contacts?${params.toString()}`);
    },
    [router, searchParams],
  );

  useEffect(() => {
    setSearch(filters.search ?? "");
  }, [filters.search]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (filters.search ?? "")) return;
    const timer = window.setTimeout(() => {
      updateParams("search", trimmed);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, filters.search, updateParams]);

  const updateSort = useCallback(
    (combined: string) => {
      const option = CONTACT_LIST_SORT_OPTIONS.find((entry) => entry.value === combined);
      if (!option) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("sort", option.sort);
      params.set("order", option.order);
      params.delete("page");
      router.push(`/dashboard/contacts?${params.toString()}`);
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    navigateWithFilters({ archived: filters.archived });
    setSearch("");
  }, [navigateWithFilters, filters.archived]);

  const removeChip = useCallback(
    (chip: ContactListFilterChip) => {
      const next = removeContactListFilterKeys(filters, chip.removeKeys);
      navigateWithFilters({ ...next, archived: filters.archived });
      if (chip.removeKeys.includes("search")) {
        setSearch("");
      }
    },
    [filters, navigateWithFilters],
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
    [searchParams],
  );

  const hasUserFilters = contactListHasUserFilters(filters);
  const provenanceFilterCount = [
    filters.createdSource,
    filters.createdSourceDetail,
    filters.createdTemplateId,
    filters.createdWorkflowRunId,
  ].filter(Boolean).length;

  useEffect(() => {
    if (contactListHasProvenanceFilters(filters)) {
      setAdvancedOpen(true);
    }
  }, [
    filters.createdSource,
    filters.createdSourceDetail,
    filters.createdTemplateId,
    filters.createdWorkflowRunId,
  ]);
  const hasListFilters = hasUserFilters || Boolean(filters.archived);

  if (contacts.length === 0 && !hasListFilters) {
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

  const sortValue = contactListSortValue(filters.sort, filters.order);

  return (
    <div className="space-y-4">
      <ContactListSavedViewsToolbar filters={filters} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search name, company, email, handle..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-56 max-w-sm flex-1"
          />
          <Select
            value={filters.funnelStage ?? "all"}
            onValueChange={(v) => updateParams("funnelStage", v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Funnel stage" />
            </SelectTrigger>
            <SelectContent>
              {funnelStages.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All stages" : s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.platform ?? "all"}
            onValueChange={(v) => updateParams("platform", v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {CONTACT_LIST_PLATFORMS.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {PLATFORM_DISPLAY_NAMES[platform as Platform] ?? platform}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={filters.archived ? "secondary" : "outline"}
            size="sm"
            onClick={() => updateParams("archived", filters.archived ? "" : "true")}
            className="gap-1.5"
          >
            <Archive className="h-3.5 w-3.5" />
            {filters.archived ? "Hide archived" : "Show archived"}
          </Button>
          <AddContactDialog />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={filters.relationshipGoal ?? "all"}
            onValueChange={(v) => updateParams("relationshipGoal", v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Relationship goal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All goals</SelectItem>
              {RELATIONSHIP_GOAL_FILTER_OPTIONS.map((goal) => (
                <SelectItem key={goal.value} value={goal.value}>
                  {goal.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.relationshipGoalStatus ?? "all"}
            onValueChange={(v) => updateParams("relationshipGoalStatus", v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Goal status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {RELATIONSHIP_GOAL_STATUS_FILTER_OPTIONS.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.hasRelationshipGoal ? "true" : "all"}
            onValueChange={(v) => updateParams("hasRelationshipGoal", v)}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Goal assigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any goal state</SelectItem>
              <SelectItem value="true">Has goal assigned</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.enrichmentTier ?? "all"}
            onValueChange={(v) => updateParams("enrichmentTier", v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Enrichment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All enrichment</SelectItem>
              {ENRICHMENT_TIERS.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {ENRICHMENT_TIER_LABELS[tier]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortValue} onValueChange={updateSort}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_LIST_SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasUserFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          ) : null}
        </div>
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {advancedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Advanced filters
            {provenanceFilterCount > 0 ? (
              <Badge variant="secondary" className="text-xs">
                {provenanceFilterCount}
              </Badge>
            ) : null}
          </button>
          {advancedOpen ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Select
                value={filters.createdSource ?? "all"}
                onValueChange={(v) => updateParams("createdSource", v)}
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Created via" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {CREATED_SOURCE_FILTER_OPTIONS.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.createdSourceDetail ?? "all"}
                onValueChange={(v) => updateParams("createdSourceDetail", v)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Source detail" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All provenance tags</SelectItem>
                  {CONTACT_CREATION_DETAIL_TAGS.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {CREATION_TAG_LABELS[tag]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.createdTemplateId ?? "all"}
                onValueChange={(v) => updateParams("createdTemplateId", v)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Workflow template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All templates</SelectItem>
                  {provenanceTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} ({template.contactCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.createdWorkflowRunId ?? "all"}
                onValueChange={(v) => updateParams("createdWorkflowRunId", v)}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Workflow run" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflow runs</SelectItem>
                  {provenanceWorkflowRuns.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {workflowRunLabels[run.id] ?? run.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <ContactListFilterChips chips={filterChips} onRemove={removeChip} />
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
                              return <span key={identity.id}>{mark}</span>;
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
                      <div className="flex flex-col gap-1 items-start">
                        <FunnelStageBadge stage={contact.funnelStage} />
                        {contact.relationshipGoal ? (
                          <RelationshipGoalBadge
                            goal={contact.relationshipGoal}
                            status={contact.relationshipGoalStatus}
                          />
                        ) : null}
                      </div>
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
