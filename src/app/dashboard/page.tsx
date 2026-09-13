import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Activity, CheckSquare, FileText } from "lucide-react";
import { getDashboardMetrics, getFunnelDistribution } from "@/lib/db/queries/dashboard";
import { FunnelStageBadge } from "@/components/funnel-stage-badge";
import { AnimatedStat } from "@/components/animated-stat";
import { DashboardGreeting } from "@/components/dashboard-greeting";
import { FunnelVisualization } from "@/components/funnel-visualization";
import { PendingTaskRow } from "@/components/dashboard/pending-task-row";
import { resolvePendingTaskDestination } from "@/lib/dashboard/pending-task-destination";
import Link from "next/link";

const statGradients = [
  "from-chart-1/10 to-chart-1/5",
  "from-chart-3/10 to-chart-3/5",
  "from-chart-2/10 to-chart-2/5",
  "from-chart-4/10 to-chart-4/5",
];

const statIconColors = [
  "bg-chart-1/15 text-chart-1",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-4/15 text-chart-4",
];

export default function DashboardPage() {
  const metrics = getDashboardMetrics();
  const funnelData = getFunnelDistribution();

  const stats = [
    {
      title: "Contacts",
      value: metrics.totalContacts,
      description: "Visible, non-archived CRM contacts",
      icon: Users,
    },
    {
      title: "Workflows",
      value: metrics.activeWorkflows,
      description: "Active workflows",
      icon: Activity,
    },
    {
      title: "Pending Tasks",
      value: metrics.pendingTasks,
      description: "Tasks needing attention",
      icon: CheckSquare,
    },
    {
      title: "Content",
      value: metrics.contentItems,
      description: "Items in library",
      icon: FileText,
    },
  ];

  return (
    <div className="space-y-6">
      <DashboardGreeting />

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <Card
            key={stat.title}
            className={`bg-gradient-to-br ${statGradients[i]} border-border/50 animate-fade-slide-in hover:shadow-md transition-shadow`}
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`rounded-full p-2 ${statIconColors[i]}`}>
                <stat.icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-heading-1">
                <AnimatedStat value={stat.value} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel visualization */}
      <Card
        className="animate-fade-slide-in border-border/50"
        style={{ animationDelay: "320ms", animationFillMode: "backwards" }}
      >
        <CardHeader>
          <CardTitle className="text-heading-3">Contact Pipeline</CardTitle>
          <CardDescription>Distribution across funnel stages</CardDescription>
        </CardHeader>
        <CardContent>
          <FunnelVisualization data={funnelData} />
        </CardContent>
      </Card>

      {/* Activity cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card
          className="animate-fade-slide-in border-border/50 hover:shadow-md transition-shadow"
          style={{ animationDelay: "400ms", animationFillMode: "backwards" }}
        >
          <CardHeader>
            <CardTitle className="text-heading-3 flex items-center gap-2">
              <div className="rounded-full p-1.5 bg-chart-1/15 text-chart-1">
                <Users className="h-3.5 w-3.5" />
              </div>
              Recent Contacts
            </CardTitle>
            <CardDescription>Latest contacts added to your CRM</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.recentContacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No contacts yet. Add your first contact to get started.
              </p>
            ) : (
              <div className="space-y-1">
                {metrics.recentContacts.map((contact) => (
                  <Link
                    key={contact.id}
                    href={`/dashboard/contacts/${contact.id}`}
                    className="flex items-center justify-between rounded-lg p-2.5 hover:bg-accent/30 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{contact.name}</p>
                      {contact.company && (
                        <p className="text-xs text-muted-foreground truncate">
                          {contact.company}
                        </p>
                      )}
                    </div>
                    <FunnelStageBadge stage={contact.funnelStage} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          id="pending-tasks"
          className="animate-fade-slide-in border-border/50 hover:shadow-md transition-shadow"
          style={{ animationDelay: "480ms", animationFillMode: "backwards" }}
        >
          <CardHeader>
            <CardTitle className="text-heading-3 flex items-center gap-2">
              <div className="rounded-full p-1.5 bg-chart-2/15 text-chart-2">
                <CheckSquare className="h-3.5 w-3.5" />
              </div>
              Pending Tasks
            </CardTitle>
            <CardDescription>Tasks needing your attention</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.pendingTasksList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pending tasks. All caught up!
              </p>
            ) : (
              <div className="space-y-1">
                {metrics.pendingTasksList.map((task) => (
                  <PendingTaskRow
                    key={task.id}
                    task={task}
                    destination={resolvePendingTaskDestination(task)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
