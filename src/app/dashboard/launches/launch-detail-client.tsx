"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LaunchWithDetails } from "@/lib/db/queries/launches";
import { LaunchDetailView, type LinkedGoalChip } from "./launch-detail-view";
import { LaunchDialog } from "./launch-dialog";
import { VariantDialog } from "./variant-dialog";

interface LaunchDetailClientProps {
  launch: LaunchWithDetails;
  linkedGoals: LinkedGoalChip[];
}

export function LaunchDetailClient({ launch, linkedGoals }: LaunchDetailClientProps) {
  const router = useRouter();
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);

  return (
    <>
      <LaunchDetailView
        launch={launch}
        linkedGoals={linkedGoals}
        onEditLaunch={() => setLaunchDialogOpen(true)}
        onAddVariant={() => {
          setEditingVariantId(null);
          setVariantDialogOpen(true);
        }}
        onEditVariant={(variantId) => {
          setEditingVariantId(variantId);
          setVariantDialogOpen(true);
        }}
      />

      <LaunchDialog
        open={launchDialogOpen}
        onOpenChange={setLaunchDialogOpen}
        editLaunch={launch}
        onSuccess={() => router.refresh()}
      />

      <VariantDialog
        open={variantDialogOpen}
        onOpenChange={setVariantDialogOpen}
        launchId={launch.id}
        editVariantId={editingVariantId}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
