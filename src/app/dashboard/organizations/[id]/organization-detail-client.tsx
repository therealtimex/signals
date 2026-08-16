"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import type { Org } from "@/lib/db/types";
import type { OrgLinkedContact } from "@/lib/db/queries/orgs";

const platformLabels: Record<string, string> = {
  x: "X",
  linkedin: "LI",
  gmail: "GM",
  substack: "SS",
};

interface OrganizationDetailClientProps {
  org: Org;
  contacts: OrgLinkedContact[];
}

export function OrganizationDetailClient({ org, contacts }: OrganizationDetailClientProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-heading-1">{org.name}</h1>
          <Badge variant="secondary" className="capitalize">
            {org.orgType}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          Organization profile and linked contacts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Domain</p>
              <p>{org.domain ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Website</p>
              {org.website ? (
                <a href={org.website} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                  {org.website}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Location</p>
              <p>{org.location ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Description</p>
              <p className="whitespace-pre-wrap">{org.description ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Graph</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Linked contacts</p>
              <p className="text-2xl font-semibold tabular-nums">{contacts.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Scope</p>
              <p className="capitalize">{org.scope.replace("_", " ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Source</p>
              <p>{org.source ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts linked via <code className="text-xs">works_at</code> edges yet.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-28">Stage</TableHead>
                    <TableHead className="w-28">Identities</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/contacts/${contact.id}`}
                          className="font-medium hover:underline"
                        >
                          {contact.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {contact.worksAtTitle ?? "—"}
                      </TableCell>
                      <TableCell>
                        <FunnelStageBadge stage={contact.funnelStage} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {contact.identities.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            contact.identities.map((identity) => (
                              <Badge key={identity.id} variant="outline" className="text-xs">
                                {platformLabels[identity.platform] ?? identity.platform}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
