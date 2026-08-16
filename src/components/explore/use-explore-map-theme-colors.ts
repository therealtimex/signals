"use client";

import { useEffect, useState } from "react";
import {
  readExploreMapThemeColors,
  type ExploreMapThemeColors,
} from "@/components/explore/explore-map-colors";

export function useExploreMapThemeColors(): ExploreMapThemeColors {
  const [colors, setColors] = useState<ExploreMapThemeColors>(() => readExploreMapThemeColors());

  useEffect(() => {
    const update = () => setColors(readExploreMapThemeColors());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return colors;
}
