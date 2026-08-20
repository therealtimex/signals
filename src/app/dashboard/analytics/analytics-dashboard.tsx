"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AreaChartCard } from "@/components/charts/area-chart-card";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { DonutChartCard } from "@/components/charts/donut-chart-card";
import { RankedTableCard } from "@/components/charts/ranked-table-card";
import { StatCardsRow } from "@/components/charts/stat-cards-row";
import { ChartSkeleton, StatCardSkeleton } from "@/components/charts/chart-skeleton";
import { formatCost, formatTokens } from "@/lib/analytics/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Cpu,
  Zap,
  Heart,
  Eye,
  MessageSquare,
  Quote,
  Repeat2,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { likeIcon } from "@/components/engagement-metrics";
import {
  getAnalyticsSectionLabel,
  type AnalyticsMetricKey,
} from "@/lib/analytics/platform-columns";
import {
  buildPlatformSections,
  type PlatformSection,
} from "@/lib/analytics/platform-sections";
import type {
  PlatformEngagementAverages,
  TopPostRow,
} from "@/lib/db/queries/analytics";

type TimeRange = "7d" | "30d" | "90d" | "all";
type TabId = "overview" | "agents" | "engagement" | "content" | "sync-health";

 

export function AnalyticsDashboard() {
  const [range, setRange] = useState<TimeRange>("30d");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [data, setData] = useState<Record<TabId, any>>({
    overview: null,
    agents: null,
    engagement: null,
    content: null,
    "sync-health": null,
  });
  const [loading, setLoading] = useState<Record<TabId, boolean>>({
    overview: false,
    agents: false,
    engagement: false,
    content: false,
    "sync-health": false,
  });

  const fetchTab = useCallback(
    async (tab: TabId, r: TimeRange) => {
      setLoading((prev) => ({ ...prev, [tab]: true }));
      try {
        const res = await fetch(`/api/analytics/${tab}?range=${r}`);
        if (res.ok) {
          const json = await res.json();
          setData((prev) => ({ ...prev, [tab]: json }));
        }
      } finally {
        setLoading((prev) => ({ ...prev, [tab]: false }));
      }
    },
    []
  );

  // Fetch active tab when tab or range changes
  useEffect(() => {
    fetchTab(activeTab, range);
  }, [activeTab, range, fetchTab]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="w-full">
          <div className="flex items-center justify-between w-full gap-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="engagement">Engagement</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="sync-health">Sync Health</TabsTrigger>
            </TabsList>
            <Select value={range} onValueChange={(v) => setRange(v as TimeRange)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TabsContent value="overview" className="mt-4">
            {loading.overview ? <OverviewSkeleton /> : <OverviewTab data={data.overview} />}
          </TabsContent>

          <TabsContent value="agents" className="mt-4">
            {loading.agents ? <AgentsSkeleton /> : <AgentsTab data={data.agents} />}
          </TabsContent>

          <TabsContent value="engagement" className="mt-4">
            {loading.engagement ? <EngagementSkeleton /> : <EngagementTab data={data.engagement} />}
          </TabsContent>

          <TabsContent value="content" className="mt-4">
            {loading.content ? <ContentSkeleton /> : <ContentTab data={data.content} />}
          </TabsContent>

          <TabsContent value="sync-health" className="mt-4">
            {loading["sync-health"] ? <SyncHealthSkeleton /> : <SyncHealthTab data={data["sync-health"]} />}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ── Tab Components ──────────────────────────────

function OverviewTab({ data }: { data: any }) {
  if (!data) return null;

  return (
    <div className="space-y-4">
      <AreaChartCard
        title="Contact Growth"
        description="New contacts added over time"
        data={data.contactGrowth}
        dataKeys={[{ key: "count", label: "Contacts", color: "var(--chart-1)" }]}
        xAxisKey="date"
      />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <BarChartCard
          title="Enrichment Score Distribution"
          description="Contact data completeness"
          data={data.enrichmentDistribution}
          dataKeys={[{ key: "count", label: "Contacts", color: "var(--chart-2)" }]}
          xAxisKey="bucket"
        />
        <DonutChartCard
          title="Platform Mix"
          description="Contacts by platform"
          data={data.platformMix.map((r: any) => ({ name: r.platform, value: r.count }))}
        />
      </div>
    </div>
  );
}

function AgentsTab({ data }: { data: any }) {
  if (!data) return null;

  const { costSummary } = data;

  return (
    <div className="space-y-4">
      <StatCardsRow
        items={[
          {
            label: "Total Cost",
            value: formatCost(costSummary.totalCost),
            icon: DollarSign,
          },
          {
            label: "Input Tokens",
            value: formatTokens(costSummary.totalInputTokens),
            icon: Cpu,
          },
          {
            label: "Output Tokens",
            value: formatTokens(costSummary.totalOutputTokens),
            icon: Zap,
          },
        ]}
      />
      <AreaChartCard
        title="Cost Over Time"
        description="Daily AI spending"
        data={data.costOverTime}
        dataKeys={[{ key: "cost", label: "Cost ($)", color: "var(--chart-1)" }]}
        xAxisKey="date"
        yAxisFormatter={(v) => `$${v}`}
      />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <DonutChartCard
          title="Cost by Workflow Type"
          description="Spending breakdown"
          data={data.costByType.map((r: any) => ({ name: r.workflowType, value: r.cost }))}
        />
        <BarChartCard
          title="Token Usage by Model"
          description="Input vs output tokens per model"
          data={data.tokensByModel}
          dataKeys={[
            { key: "inputTokens", label: "Input", color: "var(--chart-1)", stacked: true },
            { key: "outputTokens", label: "Output", color: "var(--chart-3)", stacked: true },
          ]}
          xAxisKey="model"
          layout="vertical"
          yAxisFormatter={formatTokens}
        />
      </div>
      <RankedTableCard
        title="Cost per Template"
        description="Spending by workflow template"
        data={data.costPerTemplate}
        columns={[
          { key: "templateName", label: "Template" },
          { key: "runCount", label: "Runs", align: "right" },
          { key: "totalCost", label: "Total Cost", align: "right", format: (v) => formatCost(Number(v)) },
          { key: "avgCost", label: "Avg Cost", align: "right", format: (v) => formatCost(Number(v)) },
        ]}
        barKey="totalCost"
      />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <BarChartCard
          title="Workflow Success Rate"
          description="Completed vs failed runs"
          data={data.successRate}
          dataKeys={[
            { key: "completed", label: "Completed", color: "var(--chart-6)", stacked: true },
            { key: "failed", label: "Failed", color: "var(--destructive)", stacked: true },
          ]}
          xAxisKey="workflowType"
        />
        <BarChartCard
          title="Avg Duration by Type"
          description="Average run time in seconds"
          data={data.avgDuration}
          dataKeys={[{ key: "avgDurationSeconds", label: "Seconds", color: "var(--chart-7)" }]}
          xAxisKey="workflowType"
          layout="vertical"
        />
      </div>
    </div>
  );
}

function EngagementTab({ data }: { data: any }) {
  if (!data) return null;

  // Pivot volume data: each date becomes a row with type columns
  const volumeByDate = new Map<string, Record<string, unknown>>();
  const engagementTypes = new Set<string>();
  for (const item of data.volume) {
    engagementTypes.add(item.type as string);
    if (!volumeByDate.has(item.date as string)) {
      volumeByDate.set(item.date as string, { date: item.date });
    }
    const row = volumeByDate.get(item.date as string)!;
    row[item.type as string] = item.count;
  }
  const volumeData = Array.from(volumeByDate.values());
  const typeKeys = Array.from(engagementTypes).slice(0, 8); // limit to 8 for colors

  const CHART_COLORS = [
    "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
    "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
  ];

  return (
    <div className="space-y-4">
      <AreaChartCard
        title="Engagement Volume"
        description="Activity over time by type"
        data={volumeData}
        dataKeys={typeKeys.map((type, i) => ({
          key: type,
          label: type,
          color: CHART_COLORS[i],
          stacked: true,
        }))}
        xAxisKey="date"
      />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <BarChartCard
          title="Inbound vs Outbound"
          description="Weekly engagement direction"
          data={data.directionSummary}
          dataKeys={[
            { key: "inbound", label: "Inbound", color: "var(--chart-1)", stacked: true },
            { key: "outbound", label: "Outbound", color: "var(--chart-3)", stacked: true },
          ]}
          xAxisKey="period"
        />
        <BarChartCard
          title="Engagement Type Breakdown"
          description="Total by type"
          data={data.typeBreakdown}
          dataKeys={[{ key: "count", label: "Count", color: "var(--chart-2)" }]}
          xAxisKey="type"
          layout="vertical"
        />
      </div>
      <RankedTableCard
        title="Top Engaged Contacts"
        description="Contacts with the most interactions"
        data={data.topContacts}
        columns={[
          { key: "name", label: "Contact" },
          { key: "count", label: "Engagements", align: "right" },
        ]}
        barKey="count"
      />
    </div>
  );
}

const METRIC_ICONS: Record<AnalyticsMetricKey, LucideIcon> = {
  likes: Heart,
  comments: MessageSquare,
  shares: Share2,
  retweets: Repeat2,
  quotes: Quote,
  impressions: Eye,
};

function metricIcon(key: AnalyticsMetricKey, platform: string | null): LucideIcon {
  if (key === "likes") return likeIcon(platform);
  return METRIC_ICONS[key];
}

/** Averages are keyed by the same column names the metric specs use. */
const AVERAGE_KEYS: Record<AnalyticsMetricKey, keyof PlatformEngagementAverages> = {
  likes: "avgLikes",
  comments: "avgComments",
  shares: "avgShares",
  retweets: "avgRetweets",
  quotes: "avgQuotes",
  impressions: "avgImpressions",
};

function PlatformEngagementSection({ section }: { section: PlatformSection }) {
  const { platform, metrics, posts, averages } = section;
  const label = getAnalyticsSectionLabel(platform);

  return (
    <div className="space-y-4">
      <RankedTableCard
        title={`Top Posts — ${label}`}
        description="Best performing content on this platform"
        data={posts}
        columns={[
          { key: "title", label: "Title", format: (v) => String(v ?? "Untitled") },
          ...metrics.map((metric) => ({
            key: metric.key,
            label: metric.label,
            align: "right" as const,
          })),
          { key: "total", label: "Total", align: "right" as const },
        ]}
        barKey="total"
      />
      {averages && (
        <StatCardsRow
          items={metrics.map((metric) => ({
            label: `Avg ${metric.label}`,
            value: Math.round(Number(averages[AVERAGE_KEYS[metric.key]])).toString(),
            icon: metricIcon(metric.key, platform),
          }))}
        />
      )}
    </div>
  );
}

function ContentTab({ data }: { data: any }) {
  if (!data) return null;

  const topPosts: TopPostRow[] = data.topPosts ?? [];
  const averages: PlatformEngagementAverages[] = data.avgMetrics ?? [];
  const sections = buildPlatformSections(topPosts, averages);

  return (
    <div className="space-y-4">
      <BarChartCard
        title="Content Published Over Time"
        description="Posts published per day"
        data={data.publishedOverTime}
        dataKeys={[{ key: "count", label: "Posts", color: "var(--chart-1)" }]}
        xAxisKey="date"
      />
      {sections.length > 0 ? (
        sections.map((section) => (
          <PlatformEngagementSection key={section.platform ?? "unattributed"} section={section} />
        ))
      ) : (
        <RankedTableCard
          title="Top Posts by Engagement"
          description="Best performing content"
          data={[]}
          columns={[{ key: "title", label: "Title" }]}
        />
      )}
      <DonutChartCard
        title="Content Type Distribution"
        description="Posts by content type"
        data={data.typeDistribution.map((r: any) => ({ name: r.contentType, value: r.count }))}
      />
    </div>
  );
}

function SyncHealthTab({ data }: { data: any }) {
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Platform health status cards */}
      {data.platformHealth.length > 0 ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.platformHealth.map((p: any) => (
            <Card key={`${p.platform}-${p.accountStatus}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-heading-3 capitalize">{p.platform}</CardTitle>
                  <StatusDot status={p.accountStatus} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={p.accountStatus === "active" ? "default" : "destructive"}>
                      {p.accountStatus}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sync State</span>
                    <span className="capitalize">{p.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items Synced</span>
                    <span className="font-mono">{p.totalSynced.toLocaleString()}</span>
                  </div>
                  {p.lastSyncedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Sync</span>
                      <span className="text-xs">
                        {new Date(p.lastSyncedAt * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No platform accounts connected. Go to Settings to connect a platform.
          </CardContent>
        </Card>
      )}

      {data.graphIntegrity && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-heading-3">Graph Integrity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total edges</span>
                <span className="font-mono">{data.graphIntegrity.totalEdges}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Issues</span>
                <Badge variant={data.graphIntegrity.issueCount > 0 ? "destructive" : "default"}>
                  {data.graphIntegrity.issueCount}
                </Badge>
              </div>
              {data.graphIntegrity.issueCount > 0 && (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {data.graphIntegrity.sampleIssues.map((issue: any) => (
                    <div key={`${issue.edgeId}-${issue.endpoint}`}>
                      {issue.edgeType}: {issue.endpoint} {issue.nodeType}:{issue.nodeId.slice(0, 8)}… (
                      {issue.reason})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <BarChartCard
        title="Sync Activity Over Time"
        description="Sync runs per day"
        data={data.syncActivity}
        dataKeys={[
          { key: "successCount", label: "Success", color: "var(--chart-6)", stacked: true },
          { key: "failCount", label: "Failed", color: "var(--destructive)", stacked: true },
        ]}
        xAxisKey="date"
      />

      <RankedTableCard
        title="Recent Sync Errors"
        description="Latest failed sync runs"
        data={data.recentErrors}
        columns={[
          { key: "runId", label: "Run ID", format: (v) => String(v).slice(0, 8) + "..." },
          { key: "errorItems", label: "Errors", align: "right" },
          {
            key: "completedAt",
            label: "When",
            format: (v) => v ? new Date(Number(v) * 1000).toLocaleDateString() : "—",
          },
          {
            key: "errors",
            label: "Details",
            format: (v) => {
              try {
                const arr = JSON.parse(String(v));
                return Array.isArray(arr) ? arr[0]?.slice(0, 50) ?? "—" : "—";
              } catch {
                return "—";
              }
            },
          },
        ]}
      />
    </div>
  );
}

// ── Skeleton Loading States ─────────────────────

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <ChartSkeleton />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

function AgentsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <ChartSkeleton />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

function EngagementSkeleton() {
  return (
    <div className="space-y-4">
      <ChartSkeleton />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div className="space-y-4">
      <ChartSkeleton />
      <ChartSkeleton />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

function SyncHealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <ChartSkeleton />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-green-500"
      : status === "paused"
        ? "bg-yellow-500"
        : "bg-red-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}
