"use client";

import { Suspense } from "react";
import { SettingsPageClient } from "@/app/dashboard/settings/settings-page-client";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageClient />
    </Suspense>
  );
}
