"use client";

import Link from "next/link";
import { BriefcaseBusiness, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContactWithIdentities } from "@/lib/db/types";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatEmploymentDate(value: number | null): string | null {
  if (!value) return null;
  const date = new Date(value * 1_000);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatEmploymentPeriod(employment: ContactWithIdentities["employments"][number]): string {
  const start = formatEmploymentDate(employment.startedAt);
  const end = employment.isCurrent ? "Present" : formatEmploymentDate(employment.endedAt);
  if (!start && !end) return employment.isCurrent ? "Current role" : "Dates not recorded";
  return `${start ?? "Start unknown"} – ${end ?? "End unknown"}`;
}

export function ContactProfileSection({
  contact,
  onEdit,
}: {
  contact: ContactWithIdentities;
  onEdit: () => void;
}) {
  const hasProfileDetails = Boolean(
    contact.profile.bio || contact.profile.headline || contact.employments.length > 0,
  );
  const orderedEmployments = [...contact.employments].sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );

  return (
    <Card data-contact-detail-section="profile">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasProfileDetails ? (
          <>
            {contact.profile.headline ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Headline
                </p>
                <p className="mt-1 text-sm">{contact.profile.headline}</p>
              </div>
            ) : null}
            {contact.profile.bio ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Biography
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{contact.profile.bio}</p>
              </div>
            ) : null}
            {contact.currentEmployment ? (
              <Link
                href={`/dashboard/organizations/${contact.currentEmployment.orgId}`}
                className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
              >
                <BriefcaseBusiness className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Current role
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {contact.currentEmployment.title ?? "Role not recorded"}
                  </p>
                  <p className="text-sm text-primary">{contact.currentEmployment.orgName}</p>
                </div>
              </Link>
            ) : null}
            {orderedEmployments.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Experience
                </p>
                <ol className="mt-3 space-y-3 border-l pl-4">
                  {orderedEmployments.map((employment) => (
                    <li key={employment.id} className="relative">
                      <span className="absolute -left-[1.18rem] top-1.5 size-2 rounded-full bg-primary" />
                      <p className="text-sm font-medium">
                        {employment.title ?? "Role not recorded"}
                      </p>
                      <Link
                        href={`/dashboard/organizations/${employment.orgId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {employment.orgName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatEmploymentPeriod(employment)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-md border border-dashed p-5 text-center">
            <p className="font-medium">Profile details are still sparse</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a biography and role, or enrich this contact from public sources.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="size-3.5" /> Edit profile
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
