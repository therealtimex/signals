import { notFound } from "next/navigation";
import { getGoal, listGoalProgress } from "@/lib/db/queries/goals";
import { GoalDetailClient } from "./goal-detail-client";

export default async function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goal = getGoal(id);
  if (!goal) notFound();

  const progress = listGoalProgress(id);

  return <GoalDetailClient goal={goal} progress={progress} />;
}
