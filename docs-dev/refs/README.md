# Writing reference corpus (`docs-dev/refs`)

Development-only reference material for the Signals Writing System
([`specs/signals-writing-system.md`](../../specs/signals-writing-system.md), epic #346).
It is **not** product code and is **never** packaged into the RealTimeX plugin.

## What is here

63 reference "skills" (177 files) in eight families: `x-skills`, `threads-skills`,
`linkedin-skills`, `facebook-skills`, `instagram-skills`, `tiktok-skills`, `youtube-skills`, and
the single-file `humanizer-skill`. The seven platform families are near-identical ports of one
template; their shared bundle-root layer (`references/hook-formulas.md`,
`references/algorithm-heuristics.md`, `references/voice-profile.md`, root `SKILL.md`, `lib/`)
was never copied, so 167 references point at 51 files that do not exist.

## Rules for using it

1. **Reference only, re-author always.** 62 of 63 skills declare no license, author, or copyright;
   `humanizer-skill` declares MIT over text derived from a CC BY-SA 4.0 Wikipedia article with no
   copyright holder. Nothing here may be copied into `.claude/skills/` or any shipped artifact.
   Adopted patterns are rewritten in Signals' words with the corpus path recorded as provenance.
2. **Every performance claim is unsourced.** "2026 algorithm", timing windows, multipliers, and
   "corpus pull" figures start as `heuristic` rules at `confidence: low` with a review date
   (spec §5.10, §9.6). Platform limits become `hard` rules only after verification against platform
   documentation or the publish adapter.
3. **Excluded content** (spec §9.5): engagement-pod evasion, human-mimicry timing, AI-detector
   gaming, pre-publish "giants" commenting, engagement bait, personal identifiers, and named third
   parties' posts.
4. **Vendor assumptions are not product contracts.** Publora, Apify, Pixfaro, `lib.*`, detector
   APIs, and the YouTube Data API are replaced by the Signals/RealTimeX contracts in the manifest.

## Manifest

[`manifest.json`](./manifest.json) is the curated inventory: one entry per skill with surfaces,
capability, rule classes, disposition (`adopt-core`, `adopt-overlay`, `defer-353`,
`reference-only`, `exclude`), heuristic confidence, dated-claim flag, file list, dangling
references with dispositions, vendor assumptions with replacements, formula mappings to
namespaced Signals ids, exclusions, and notes; plus family-level provenance and license status.

```bash
npm run verify:writing-corpus                                   # validate (part of `npm run check`)
node scripts/verify-writing-corpus-manifest.mjs --update        # refresh mechanical fields after corpus changes
```

`--update` rewrites `files`, `missingReferences`, `vendorAssumptions`, and `datedClaims` from
disk and leaves `null` dispositions/replacements for anything new; fill those in, then validate.
Do not edit the corpus files themselves to "fix" references — the missing layer is documented,
not restored.
