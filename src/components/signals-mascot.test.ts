import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SignalsMascot } from "@/components/signals-mascot";
import {
  mascotMoodForPathname,
  SIGNALS_MASCOT_MOODS,
  SIGNALS_MASCOT_SOURCE_FILES,
  mascotMoodForEnrichmentStatus,
  mascotMoodForToast,
} from "@/components/signals-mascot-mood";

const KIT_DIR = join(process.cwd(), "public/logo");

describe("mascotMoodForToast", () => {
  it("maps success to happy and danger to angry", () => {
    expect(mascotMoodForToast("success")).toBe("happy");
    expect(mascotMoodForToast("danger")).toBe("angry");
    expect(mascotMoodForToast("warning")).toBe("suspicious");
    expect(mascotMoodForToast("celebrate")).toBe("laughing");
  });
});

describe("mascotMoodForEnrichmentStatus", () => {
  it("separates in-flight work from queued work", () => {
    expect(mascotMoodForEnrichmentStatus("running")).toBe("excited");
    expect(mascotMoodForEnrichmentStatus("pending")).toBe("curious");
  });

  it("maps completed to happy and failed to angry", () => {
    expect(mascotMoodForEnrichmentStatus("completed")).toBe("happy");
    expect(mascotMoodForEnrichmentStatus("failed")).toBe("angry");
  });
});

describe("SIGNALS_MASCOT_SOURCE_FILES", () => {
  it("points at the shipped expression kit", () => {
    expect(SIGNALS_MASCOT_SOURCE_FILES).toEqual({
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
    });
  });
});

describe("SignalsMascot", () => {
  it("renders the attentive mark as decorative by default", () => {
    const html = renderToStaticMarkup(createElement(SignalsMascot));

    expect(html).toContain('data-signals-mascot=""');
    expect(html).toContain('data-mood="attentive"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).toContain("#e152b0");
  });

  it("exposes a labelled image when it is not decorative", () => {
    const html = renderToStaticMarkup(
      createElement(SignalsMascot, {
        mood: "curious",
        decorative: false,
        title: "Enriching contact",
      }),
    );

    expect(html).toContain('data-mood="curious"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Enriching contact"');
    expect(html).not.toContain("aria-hidden");
  });
});

describe("expression kit sync", () => {
  it("renders every declared mood", () => {
    for (const mood of SIGNALS_MASCOT_MOODS) {
      const html = renderToStaticMarkup(createElement(SignalsMascot, { mood }));
      expect(html).toContain(`data-mood="${mood}"`);
    }
  });

  it("has a kit file on disk for every mood", () => {
    for (const mood of SIGNALS_MASCOT_MOODS) {
      expect(existsSync(join(KIT_DIR, SIGNALS_MASCOT_SOURCE_FILES[mood]))).toBe(
        true,
      );
    }
  });

  it("leaves no kit file unported", () => {
    const shipped = readdirSync(KIT_DIR).filter((f) => f.endsWith(".svg"));
    const ported = new Set<string>(Object.values(SIGNALS_MASCOT_SOURCE_FILES));
    expect(shipped.filter((f) => !ported.has(f))).toEqual([]);
  });
});

describe("mascotMoodForPathname", () => {
  it("prefers the deepest known section over the dashboard root", () => {
    expect(mascotMoodForPathname("/dashboard/launches/123")).toBe("excited");
    expect(mascotMoodForPathname("/dashboard/explore")).toBe("curious");
    expect(mascotMoodForPathname("/dashboard/settings")).toBe("neutral");
  });

  it("falls back to attentive on the root and unknown sections", () => {
    expect(mascotMoodForPathname("/dashboard")).toBe("attentive");
    expect(mascotMoodForPathname("/dashboard/nope")).toBe("attentive");
    expect(mascotMoodForPathname("/")).toBe("attentive");
  });
});
