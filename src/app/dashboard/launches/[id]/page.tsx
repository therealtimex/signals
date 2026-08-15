import { notFound } from "next/navigation";
import { getGoal } from "@/lib/db/queries/goals";
import { getLaunchWithDetails } from "@/lib/db/queries/launches";
import { LaunchDetailClient } from "../launch-detail-client";

export default async function LaunchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const launch = getLaunchWithDetails(id, { includeLocalOnly: true });
  if (!launch) {
    notFound();
  }

  const linkedGoals = launch.goalIds
    .map((goalId) => {
      const goal = getGoal(goalId);
      return goal ? { id: goal.id, name: goal.name } : null;
    })
    .filter((goal): goal is { id: string; name: string } => goal !== null);

  return <LaunchDetailClient launch={launch} linkedGoals={linkedGoals} />;
}
