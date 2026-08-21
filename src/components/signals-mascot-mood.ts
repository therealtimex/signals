export const SIGNALS_MASCOT_MOODS = [
  "attentive",
  "curious",
  "happy",
  "angry",
  "excited",
  "proud",
  "laughing",
  "neutral",
  "surprised",
  "bored",
  "scared",
  "suspicious",
  "sleepy",
  "shy",
  "sad",
] as const;

export type SignalsMascotMood = (typeof SIGNALS_MASCOT_MOODS)[number];

export type SignalsMascotToastTone =
  "success" | "danger" | "warning" | "celebrate";

/** Source kit in `public/logo/` uses French filenames; the app API stays English. */
export const SIGNALS_MASCOT_SOURCE_FILES = {
  attentive: "attentif.svg",
  curious: "curieux.svg",
  happy: "heureux.svg",
  angry: "colere.svg",
  excited: "excite.svg",
  proud: "fier.svg",
  laughing: "hilare.svg",
  neutral: "neutre.svg",
  surprised: "surpris.svg",
  bored: "blase.svg",
  scared: "effraye.svg",
  suspicious: "mefiant.svg",
  sleepy: "somnolent.svg",
  shy: "timide.svg",
  sad: "triste.svg",
} as const satisfies Record<SignalsMascotMood, string>;

export function mascotMoodForToast(
  tone: SignalsMascotToastTone,
): SignalsMascotMood {
  if (tone === "danger") return "angry";
  if (tone === "warning") return "suspicious";
  if (tone === "celebrate") return "laughing";
  return "happy";
}

export function mascotMoodForEnrichmentStatus(
  status: string,
): SignalsMascotMood {
  if (status === "completed") return "happy";
  if (status === "failed") return "angry";
  if (status === "running") return "excited";
  return "curious";
}

/** Sections of the app the sidebar mark reacts to, keyed by route segment. */
const SECTION_MOODS: Record<string, SignalsMascotMood> = {
  dashboard: "attentive",
  explore: "curious",
  contacts: "happy",
  organizations: "attentive",
  content: "proud",
  launches: "excited",
  workflows: "excited",
  analytics: "curious",
  goals: "proud",
  simulations: "surprised",
  settings: "neutral",
  guide: "shy",
  help: "shy",
};

/** Picks the sidebar mark's mood from the active route. */
export function mascotMoodForPathname(pathname: string): SignalsMascotMood {
  // "/dashboard/launches/123" prefers "launches" over the "dashboard" root.
  const segments = pathname.split("/").filter(Boolean).slice(1).reverse();
  for (const segment of segments) {
    const mood = SECTION_MOODS[segment];
    if (mood) return mood;
  }
  return SECTION_MOODS.dashboard;
}
