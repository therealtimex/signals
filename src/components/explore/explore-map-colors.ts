const CHART_TOKEN_NAMES = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
] as const;

export type ExploreMapThemeColors = {
  primary: string;
  mutedForeground: string;
  foreground: string;
  chart: string[];
};

const FALLBACK_THEME: ExploreMapThemeColors = {
  primary: "rgb(59, 130, 246)",
  mutedForeground: "rgb(113, 113, 122)",
  foreground: "rgb(24, 24, 27)",
  chart: [
    "rgb(59, 130, 246)",
    "rgb(16, 185, 129)",
    "rgb(245, 158, 11)",
    "rgb(236, 72, 153)",
    "rgb(139, 92, 246)",
    "rgb(14, 165, 233)",
    "rgb(234, 179, 8)",
    "rgb(244, 63, 94)",
  ],
};

/** Resolve a CSS color token to a canvas-compatible computed color. */
export function resolveCssColor(
  token: string,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): string {
  if (!root || typeof document === "undefined") {
    return FALLBACK_THEME.foreground;
  }

  const probe = document.createElement("span");
  probe.style.color = token;
  probe.style.display = "none";
  root.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  root.removeChild(probe);

  if (!resolved || resolved === "rgba(0, 0, 0, 0)") {
    return FALLBACK_THEME.foreground;
  }
  return resolved;
}

export function readExploreMapThemeColors(
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): ExploreMapThemeColors {
  if (!root) return FALLBACK_THEME;

  return {
    primary: resolveCssColor("var(--primary)", root),
    mutedForeground: resolveCssColor("var(--muted-foreground)", root),
    foreground: resolveCssColor("var(--foreground)", root),
    chart: CHART_TOKEN_NAMES.map((token) => resolveCssColor(`var(${token})`, root)),
  };
}

function parseCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const rgbMatch = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }

  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}

function appendOklchAlpha(oklchColor: string, alpha: number): string {
  const match = oklchColor.match(/^oklch\(\s*(.+)\s*\)$/i);
  if (!match) return oklchColor;
  const components = match[1].replace(/\s*\/\s*[\d.]+%?\s*$/i, "").trim();
  return `oklch(${components} / ${alpha})`;
}

function mixColorWithAlphaViaBrowser(
  color: string,
  alpha: number,
  root: HTMLElement,
): string | null {
  const probe = document.createElement("span");
  probe.style.color = `color-mix(in oklch, ${color} ${Math.round(alpha * 100)}%, transparent)`;
  probe.style.display = "none";
  root.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  root.removeChild(probe);

  if (!resolved || resolved === "rgba(0, 0, 0, 0)") {
    return null;
  }
  return resolved;
}

export function withAlpha(
  color: string,
  alpha: number,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): string {
  const clamped = Math.min(Math.max(alpha, 0), 1);
  const trimmed = color.trim();

  if (/^oklch\(/i.test(trimmed)) {
    return appendOklchAlpha(trimmed, clamped);
  }

  if (root && typeof document !== "undefined") {
    const mixed = mixColorWithAlphaViaBrowser(trimmed, clamped, root);
    if (mixed) return mixed;
  }

  const rgb = parseCssColorToRgb(trimmed);
  if (!rgb) return trimmed;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

export function nicheTypeResolvedColor(
  nicheType: string,
  theme: ExploreMapThemeColors,
): string {
  const index =
    nicheType === "interest"
      ? 0
      : nicheType === "firmographic"
        ? 1
        : nicheType === "behavioral"
          ? 2
          : nicheType === "custom"
            ? 3
            : 4;
  return theme.chart[index] ?? theme.chart[4] ?? FALLBACK_THEME.chart[4];
}

export function buildExploreMapLinkColor(
  kind: "follows" | "connected_to" | "belongs_to_niche",
  mutual: boolean | null,
  theme: ExploreMapThemeColors,
): string {
  if (kind === "belongs_to_niche") {
    return withAlpha(theme.mutedForeground, 0.35);
  }
  return withAlpha(theme.foreground, mutual ? 0.45 : 0.25);
}
