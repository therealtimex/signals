# Pre-Publish Audit Checklist (Instagram)

The thresholds the `--mode audit` pass applies. Mirror of the root
`references/algorithm-heuristics.md` checklist, with the humanizer's blocker
distinctions.

## Blockers (auto-fail)

- [ ] No em dash (`—`), en dash (`–`), or double dash (`--`).
- [ ] The first 125 chars stand alone as a hook (the "more" fold cuts the rest).
- [ ] Caption within 2,200 chars.
- [ ] 3-5 sized hashtags, not 20-30, never mid-sentence.
- [ ] No engagement bait ("comment YES", "tag 3 friends", "double tap if").
- [ ] No "In today's fast-paced world" or equivalent opener.
- [ ] No "What do you think?" / "Thoughts?" dead closer.
- [ ] No AI vocabulary blacklist words.
- [ ] Carousel: all images or all video (no mixed media), 2-10 slides.
- [ ] A media plan exists (Instagram rejects text-only posts).

## Warnings (flag with fix)

- [ ] Hashtag set is sized (2-3 niche, 1-2 mid, 0-1 broad), not all-broad.
- [ ] 0-3 emoji, placed with intent, none sprinkled.
- [ ] Line lengths vary (not all uniform).
- [ ] At least one specific number where the claim allows.
- [ ] At least one named entity.
- [ ] No rule-of-three list without concrete items.
- [ ] Carousel slide 1 promises + opens a loop, not a bare title.
- [ ] Strongest carousel point is front-loaded (slide 2-3), not buried last.
- [ ] One clear primary goal (saves / shares / comments / follows).
- [ ] One CTA, not three; it names a reason.

## Thresholds quick reference

| Metric | Limit |
|---|---|
| Caption | 2,200 chars (hook in first ~125) |
| Hashtags | 3-5 sized (30 is the hard cap but spammy) |
| Emoji per caption | 0-3 |
| Carousel slides | 2-10 |
| Reel duration | up to 3 min; 5-90s for the Reels tab |
| Aspect ratio | 4:5 to 1.91:1 |

## Scoring

- Any blocker -> **FAIL**, return fixes, offer auto-rewrite via `ig-humanizer`.
- No blockers, any warnings -> **PASS with warnings**, list each with a fix.
- Clean -> **PASS**, add the timing note, the surface sanity check, and the
  media reminder.
