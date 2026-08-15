import { notFound } from "next/navigation";
import { getLaunchById } from "@/lib/db/queries/launches";
import { getSimulationRun } from "@/lib/db/queries/simulations";
import { getVariantById } from "@/lib/db/queries/variants";
import { RunDetailView } from "./run-detail-view";

export default async function SimulationRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = getSimulationRun(id, { includeAgents: true, includeCalibration: true });
  if (!run) {
    notFound();
  }

  const variant = getVariantById(run.variantId);
  const launch = variant ? getLaunchById(variant.launchId) : undefined;

  const agents =
    run.agents?.map((agent) => ({
      id: agent.id,
      contactId: agent.contactId,
      engagementScore: agent.engagementScore,
      outcome: agent.outcome,
      grounding: agent.grounding,
    })) ?? [];

  return (
    <RunDetailView
      run={run}
      agents={agents}
      calibrations={run.calibrations ?? []}
      variant={variant}
      launch={launch}
    />
  );
}
