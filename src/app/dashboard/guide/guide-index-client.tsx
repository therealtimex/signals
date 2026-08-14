"use client";

import Link from "next/link";
import {
  Rocket,
  Users,
  FileText,
  Zap,
  BarChart3,
  MessageSquare,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { GuideMeta } from "@/lib/guide/types";

const ICON_MAP: Record<string, LucideIcon> = {
  Rocket,
  Users,
  FileText,
  Zap,
  BarChart3,
  MessageSquare,
};

interface GuideIndexClientProps {
  guides: GuideMeta[];
}

export function GuideIndexClient({ guides }: GuideIndexClientProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading-1">User Guide</h1>
        <p className="text-muted-foreground mt-1">
          In-depth tutorials covering every Signals feature.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide) => {
          const Icon = ICON_MAP[guide.icon] ?? FileText;
          return (
            <Link key={guide.slug} href={`/dashboard/guide/${guide.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {guide.order}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base mt-3">{guide.title}</CardTitle>
                  <CardDescription>{guide.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
