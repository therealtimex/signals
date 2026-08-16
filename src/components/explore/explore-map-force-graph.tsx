"use client";

import dynamic from "next/dynamic";
import type { ExploreMapResponse } from "@/lib/db/queries/explore-map";

const ExploreMapCanvas = dynamic(
  () => import("@/components/explore/explore-map-canvas").then((mod) => mod.ExploreMapCanvas),
  { ssr: false },
);

export { ExploreMapCanvas };
export type { ExploreMapResponse };
