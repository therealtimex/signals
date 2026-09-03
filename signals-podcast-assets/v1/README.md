# Signals Podcast — Suno assets (v1)

Lossless **WAV masters** for podcast IDs and guide-video beds (`convert-guide-video --music` accepts WAV directly; slice to MP3 only when shipping a committed bed like `guide/video/audio/tour-bed.mp3`).

## Account

**Suno Pro** (Sep 2026). Export via `suno-pp-cli download --format wav`. Run `suno-pp-cli auth login --chrome` after tier or session changes.

## Download

```bash
cd signals-podcast-assets/v1
./download-all.sh
# optional: MANIFEST="$PWD/manifest.json" ./download-all.sh
```

`download-all.sh` syncs metadata and pulls **WAV** for every manifest entry. API `audio_url` is often `…/api/forbidden`; Pro WAV export is the supported path.

Single clip:

```bash
suno-pp-cli auth login --chrome
suno-pp-cli download <clip_id> --format wav --out .
```

## Video tour beds (#409)

For `npm run automation:convert-guide-video`, prefer **`local-first-flow-b7756c1e.wav`** (warm Rhodes, no beat grid). Trim a **50s slice from ~40s** into the track to skip Suno’s intro ramp, then optionally export MP3 for `guide/video/audio/tour-bed.mp3`.

Avoid **Network Snowball** for screencast tours (percussion implies a grid the UI doesn’t follow).

## Manifest

`podcast-manifest.json` (default) — 13 podcast + GTM session clips:

- Suno `id`, `title`, `duration_sec` (editorial hint, often shorter than file length)
- `suggested_filename` — `.wav` master name

`manifest.json` — full local-library export (same shape).

## Sonic bible

See `docs/signals-podcast-sonic-bible.md`.
