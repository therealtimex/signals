# Signals Podcast — Sonic Bible (v1)

One-page reference for **Suno generation**, **suno-pp-cli** library management, and **editor** mix/fade.  
Brand: local-first relationship GTM — human, intelligent, warm tech (not stock corporate).

---

## Core identity

| Element | Spec |
|--------|------|
| **Tempo** | **96 BPM** (all podcast assets; do not vary per episode) |
| **Key feel** | Warm, open; avoid dark/minor-only beds for main theme |
| **Energy** | Confident, grounded, optimistic — clarity over hype |
| **Vocals** | **Never** on IDs, beds, or bumpers (host is the only voice) |
| **Forbidden** | Trap drops, dubstep, brass stabs, “startup horn”, busy hi-hats, lyrical hooks |

### Palette (use every episode)

- **Lead:** Clean Rhodes / electric piano motif (recognizable 3–5 note hook)
- **Body:** Soft analog synth pads, gentle pulse bass
- **Rhythm:** Tight muted kick + light percussion (intro bed only; strip for outros)
- **Accent:** Subtle glitch/tick (workflow hint) — **sparse**, never under dense VO
- **Space:** Voiceover-safe mix; leave **midrange** clear for speech

### Reference generations (Suno library)

| Title | Clip ID (variant to prefer) | Use |
|-------|------------------------------|-----|
| Network Snowball | `f041f8b9-f63d-495e-89f2-2cd007977cfd` | Primary bed / workflow energy |
| Local First Flow | `b7756c1e-2eab-43b5-b84c-93cc303f1d51` | Warm brand / “local-first” episodes |
| Local First Flow (short) | `2db37c55-9d8d-4f7b-9c46-826e169cf7f6` | Teasers, tight cuts (2:00) |

Sync & fetch: `suno-pp-cli sync` → `suno-pp-cli clips get <id>` → `./signals-podcast-assets/v1/download-all.sh` (Pro **WAV** masters; account is **Suno Pro** as of Sep 2026).

---

## Asset kit (produce once; reuse forever)

| Asset | Target length | Loudness role | Notes |
|-------|---------------|---------------|--------|
| **A. Intro sting** | **4–8 s** | Peak element (−12 LUFS moment) | Same every episode; logo + “Signals Podcast” |
| **B. Intro bed** | **20–40 s** | Under host (−18 to −24 dB under VO) | Fade music **3–5 s** after intro script ends |
| **C. Segment bump** | **2–4 s** | Optional (−14 LUFS) | Same motif as sting, shorter |
| **D. Outro bed** | **15–30 s** | Under closing (−20 dB under VO) | Drums drop last 8 s; pads only |
| **E. Outro tail** | **4–8 s** | Fade to silence | No hard stop; reverb tail |

**Episode rule:** Play **A** every time → **B** under welcome → content dry or light bed → **D** under outro → **E** or fade **D** to silence.

---

## Structure templates

### A. Intro sting (fixed)

```
0:00–0:02  Rhodes hook (motif enters)
0:02–0:05  Soft pulse + pad swell
0:05–0:08  Hold / slight lift → clean cut OR 0.5s reverb tail
```

Suno prompt anchor: *“Podcast intro sting, 6 seconds, instrumental, warm Rhodes motif, soft pulse, Signals podcast, no vocals, 96 BPM.”*

### B. Intro bed + fade under host

```
0:00–0:08  Sparse (piano + pulse only) — host can speak immediately
0:08–0:25  Gentle lift (bass + light drums)
0:25–0:35  Sustained plateau — duck under voice
           Host finishes → music fade 3–5 s to −∞ or to segment level
```

### D–E. Outro + fade

```
0:00–0:12  Full bed (match intro palette)
0:12–0:20  Remove drums; Rhodes + pads
0:20–0:28  Simplify to pads only
0:28–0:35  Long open tail — editor fade 4–8 s after last spoken word
```

---

## Editor mix sheet

| Setting | Value |
|---------|--------|
| Podcast delivery target | **−16 LUFS** integrated (mono-safe) |
| Intro sting peak | ≤ host peak; avoid clipping on logo hit |
| Bed under VO | **−18 to −24 dB** relative to voice (adjust per mic) |
| Fade under intro | **3–5 s** logarithmic |
| Fade outro | **4–8 s** after final word; no abrupt cut |
| Sting → bed | **0–0.5 s** crossfade or hard cut on downbeat |
| File format | **48 kHz / 24-bit WAV** masters; **MP3 320** for distribution if needed |

### Carve points from full tracks (if not regenerating shorts)

| Source | Intro sting | Intro bed | Outro |
|--------|-------------|-----------|--------|
| Network Snowball `f041f8b9…` | ~0:15–0:23 | ~0:00–0:35 | last ~0:25 |
| Local First Flow `b7756c1e…` | ~0:10–0:18 | ~0:00–0:40 | last ~0:30 |
| Local First Flow `2db37c55…` | ~0:08–0:16 | full 2:00 (trim) | last ~0:20 |

---

## Suno generation checklist

1. Style/tags always include: `instrumental, 96 BPM, voiceover-safe, podcast, warm Rhodes, no vocals`
2. Lyrics field: `[Instrumental]` only
3. Generate **2 variants**; pick one, **save vibe**: `suno-pp-cli vibes` (after you name the recipe)
4. Name clips: `Signals Podcast — Intro Sting`, `Signals Podcast — Outro Fade`, etc.
5. Never use AI Overview / unrelated GTM video scores as stings without editing — stings must be **short and identical** week to week

### Ready-made tag string (paste into Suno style)

```
instrumental, 96 BPM, podcast, warm Rhodes, soft synth pads, tight lo-fi drums, gentle pulse bass, cinematic tech, voiceover-safe, confident human, Signals, no vocals, fade-friendly tail
```

---

## suno-pp-cli maintenance

Account: **Suno Pro** (Sep 2026) — WAV export via CLI; refresh auth after upgrade: `suno-pp-cli auth login --chrome`.

```bash
suno-pp-cli doctor          # auth + cache health
suno-pp-cli sync            # after each generation session
suno-pp-cli grep "Signals Podcast"
./signals-podcast-assets/v1/download-all.sh   # WAV masters (Pro export)
suno-pp-cli download <id> --format wav --out ./signals-podcast-assets/v1
suno-pp-cli ship <id> --to ./signals-podcast-bundle   # editor bundle + art
```

Store masters in repo or DAM: `signals-podcast-assets/v1/` with fixed filenames:

- `signals-podcast-intro-sting.wav`
- `signals-podcast-intro-bed.wav`
- `signals-podcast-outro-bed.wav`
- `signals-podcast-bump.wav`

---

## Versioning

| Version | Date | Change |
|---------|------|--------|
| **v1.0** | 2026-09-02 | Initial bible; 96 BPM, Rhodes+pulse palette, Network Snowball / Local First Flow refs |

**Do not** change intro sting or BPM mid-season without calling it “Season 2” rebrand.
