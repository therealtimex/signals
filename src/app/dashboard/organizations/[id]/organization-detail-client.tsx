"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SnowballDialog } from "@/components/snowball-dialog";
import { ProvenanceLine } from "@/components/provenance-line";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { getOrgEmailIntelligence } from "@/lib/contacts/email-patterns/intelligence";
import type { listOrgTimeline } from "@/lib/db/queries/org-activities";
import type { OrgPersonRow } from "@/lib/db/queries/org-people";
import type { getOrgRelationshipSummary } from "@/lib/db/queries/org-relationships";
import type { OrgDTO } from "@/lib/serializers/org";
import { orgTabHref, parseOrgTab, type OrgTab } from "../organization-tabs";
import { EditOrganizationDialog } from "./edit-organization-dialog";
import { EnrichCompanyButton } from "./enrich-company-button";
import {
  CompanyFeed,
  CompanyPeopleTable,
  EmailIntelligenceCard,
  RelationshipOverview,
} from "./company-intelligence-panels";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function OrganizationDetailClient({
  org: initialOrg,
  people,
  relationships,
  emailIntelligence,
  timeline,
  selfContact,
}: {
  org: OrgDTO;
  people: OrgPersonRow[];
  relationships: ReturnType<typeof getOrgRelationshipSummary>;
  emailIntelligence: ReturnType<typeof getOrgEmailIntelligence>;
  timeline: ReturnType<typeof listOrgTimeline>;
  selfContact: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseOrgTab(searchParams.get("tab"));
  const [org, setOrg] = useState(initialOrg);
  const [snowballOpen, setSnowballOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  function navigate(tab: string) {
    if (tab === "signals") {
      void fetch(`/api/orgs/${org.id}/feed-seen`, { method: "POST" });
    }
    router.replace(orgTabHref(org.id, tab as OrgTab), { scroll: false });
  }

  const profileFields = [
    { label: "Domain", value: org.domain },
    { label: "Website", value: org.website, href: org.website },
    { label: "Industry", value: org.industry },
    { label: "Company size", value: org.companySize },
    { label: "Headquarters", value: org.location },
    { label: "Description", value: org.description },
  ];
  const mostlyEmpty = org.completeness.score < 35;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="size-14 rounded-xl">
            <AvatarImage src={org.avatarUrl ?? undefined} alt={`${org.name} logo`} />
            <AvatarFallback className="rounded-xl text-base font-semibold">
              {initials(org.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-heading-1">{org.name}</h1>
              {org.orgType !== "company" ? (
                <Badge variant="secondary" className="capitalize">
                  {org.orgType}
                </Badge>
              ) : null}
              {org.accountStage ? (
                <Badge variant="outline" className="capitalize">
                  {org.accountStage}
                </Badge>
              ) : null}
            </div>
            {org.domain ? (
              <a
                href={`https://${org.domain}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline"
              >
                {org.domain}
              </a>
            ) : (
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={() => setEditOpen(true)}
              >
                Add company domain
              </button>
            )}
            <ProvenanceLine provenance={org.provenance} />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {org.owner ? <span>Owner: {org.owner.name}</span> : null}
              {org.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <EnrichCompanyButton orgId={org.id} />
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSnowballOpen(true)}>
            <Sparkles className="size-3.5 text-primary" /> Snowball Network
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={navigate}>
        <TabsList variant="line" className="max-w-full overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="people">People ({people.length})</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          {mostlyEmpty ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">This company profile is mostly empty</p>
                  <p className="text-sm text-muted-foreground">
                    Fill in the basics now; agent enrichment can add cited details later.
                  </p>
                </div>
                <Button size="sm" onClick={() => setEditOpen(true)}>
                  Fill in the basics
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Company profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {profileFields.map((field) => (
                  <div key={field.label}>
                    <p className="text-muted-foreground">{field.label}</p>
                    {field.value ? (
                      field.href ? (
                        <a
                          href={field.href}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-primary hover:underline"
                        >
                          {field.value}
                        </a>
                      ) : (
                        <p className="whitespace-pre-wrap">{field.value}</p>
                      )
                    ) : (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => setEditOpen(true)}
                      >
                        Add {field.label.toLowerCase()}
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <RelationshipOverview summary={relationships} />
            <EmailIntelligenceCard orgId={org.id} initial={emailIntelligence} />
          </div>
        </TabsContent>

        <TabsContent value="people" className="pt-4">
          <CompanyPeopleTable companyName={org.name} people={people} />
        </TabsContent>

        <TabsContent value="signals" className="pt-4">
          <CompanyFeed orgId={org.id} initial={timeline} category="signal" followedAt={org.followedAt} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <CompanyFeed orgId={org.id} initial={timeline} category="workspace" followedAt={org.followedAt} />
        </TabsContent>
        <TabsContent value="notes" className="pt-4">
          <CompanyFeed orgId={org.id} initial={timeline} category="note" followedAt={org.followedAt} />
        </TabsContent>
      </Tabs>

      <EditOrganizationDialog
        key={`${org.id}:${org.updatedAt}:${editOpen ? "open" : "closed"}`}
        org={org}
        selfContact={selfContact}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={setOrg}
      />
      <SnowballDialog
        open={snowballOpen}
        onClose={() => setSnowballOpen(false)}
        seedType="org_id"
        seedValue={org.name}
        entityName={org.name}
      />
    </div>
  );
}
