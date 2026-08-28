# Instagram Post Audit

Run any caption (and its carousel slide text) through the 2026 Instagram ranking
checklist. Catches AI tells, format violations (first-125 hook, caption length,
hashtag sizing, emoji), reach suppressors (engagement bait, mixed media), and
structural weaknesses before publishing. This is the `ig-humanizer --mode audit`
workflow: detection only, no rewrite.

## When to use

- Before publishing a hand-written or AI-drafted caption or carousel
- When `ig-caption-writer` or `ig-carousel-planner` finishes a draft (auto-invoked)
- When a recent post underperformed and the user wants a post-mortem

## Input

- A caption, and for a carousel the slide text
- Optional: target audience, scheduled time, the surface (image / carousel / Reel)

## Output

- **Pass / Fail** header
- **Blockers** (must fix before publishing)
- **Warnings** (ship-risky)
- **Suggested fixes** for each issue
- **Timing recommendation** given the audience

## Checks

### Blockers (auto-fail)

1. Em dash / en dash / double dash present.
2. The hook needs the second line to make sense (the first 125 chars do not
   stand alone).
3. Caption over 2,200 chars.
4. 20-30 hashtags, or hashtags mid-sentence.
5. Engagement bait ("comment YES", "tag 3 friends", "double tap if you agree").
6. Opens with "In today's fast-paced world" or similar.
7. Ends with "What do you think?" or "Thoughts?".
8. Contains AI vocabulary blacklist words (see `../references/scrub-rules.md`).
9. Carousel mixes images and video, or has more than 10 slides.
10. No media plan (Instagram rejects text-only posts).

### Warnings (flag with a suggested fix)

11. More than 5 hashtags, or an all-broad set a small account cannot rank in.
12. 4+ emoji, or emoji sprinkled through every line.
13. Uniform line lengths (machine rhythm).
14. No specific number anywhere the claim would allow one.
15. No named entity (person, company, tool).
16. Rule-of-three list without concrete items.
17. Carousel slide 1 is a bare title, not a promise + open loop.
18. The strongest carousel point is buried on the last body slide.
19. No clear primary goal: the draft chases saves, shares, comments, and follows
    all at once. Pick one (see `../../../references/hook-formulas.md`
    "Engagement-goal split").
20. CTA is generic or there are three competing CTAs.

### Info (neutral notes)

21. Suggested posting window given the audience.
22. Surface recommendation (single image vs carousel vs Reel) given the material.
23. Save/send opportunity: if the draft is a list/framework/how-to, note that it
    should be structured to maximize saves; if it is a contrarian/myth payoff,
    structure it to maximize sends.

## Steps

1. Detect the surface: single image, carousel, or Reel.
2. Measure the caption: char count, where the first 125 chars cut, hashtag count
   and sizing, emoji count.
3. Run the blocker checks. If any fail, return **FAIL** with specific fixes;
   optionally offer to hand off to `ig-humanizer` for an auto-rewrite.
4. If no blockers, run the warnings.
5. Return the structured report with a timing note and a media reminder.

## Related

- `ig-humanizer` - aggressive rewrite if the audit fails
- `ig-caption-writer` / `ig-carousel-planner` - regenerate using a proven formula
