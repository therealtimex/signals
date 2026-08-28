---
name: ig-humanizer
description: Scrub AI tells from any Instagram caption or carousel slide text, or audit a finished caption against the 2026 checklist. Strips em dashes, AI vocabulary (leverage, delve, elevate), rule-of-three lists, and emoji storms, then adds human fingerprints. Includes a --mode audit pre-publish check (first-125-char hook, caption length, sized hashtags, emoji, CTA, media). Triggers on humanize, de-AI my caption, audit before posting. Not for writing from scratch (use ig-caption-writer or ig-carousel-planner).
---

# Instagram Humanizer

Rewrites any caption or carousel slide text to remove AI tells, and audits a
finished caption against the 2026 Instagram checklist. Based on Wikipedia's
"Signs of AI writing" taxonomy plus Instagram-specific patterns (the first-125
fold, the lowercase-casual caption register, sized hashtags, sends-and-saves
structure).

## When to use

- Before publishing any AI-drafted caption or carousel (rewrite mode)
- Pre-publish review of a finished caption (audit mode, see `sub-skills/post-audit.md`)
- When a caption feels off and you cannot pinpoint why

## Input

Any text: a caption, the on-image text of a carousel, or a Reel caption.
Optional: target voice samples (the user's past captions).

## Output

- Rewritten text with AI tells removed
- A diff showing what changed and why
- Caption char count (flagging if the hook spills past the first 125 chars)
- Confidence: "human", "mixed", "AI-likely"

## Modes

```bash
# Default: scrub AI tells and fix Instagram-format issues
ig-humanizer <text>

# Forensic only - minimum touch, just kill model leakage
ig-humanizer --mode forensic <text>

# Audit - detection-only pass-fail review, no rewrite
# Runs the 2026 Instagram checklist: first-125 hook, caption length, sized
# hashtags, emoji limits, CTA quality, media reminder.
# Returns Blockers + Warnings + suggested fixes. See sub-skills/post-audit.md.
ig-humanizer --mode audit <text>
```

## The three passes

### Pass 1 - SCRUB (delete or replace)

Apply the tiered catalogs in `references/scrub-rules.md`:

- **Forensic** (always on): real model leakage no human types. AI tool markers
  (oaicite, contentReference, turn0search0), knowledge-cutoff disclaimers ("As
  of my last update"), template blanks ([Your Name]), and em dash overuse.
- **Strict** (default on): bad Instagram style regardless of origin. Vocabulary
  swaps (leverage -> use, delve -> look, elevate -> lift, dive in -> get into),
  filler adverbs (fundamentally, essentially, ultimately), phrase cleanups ("in
  today's fast-paced world", "game-changer", "level up"), and dead closers
  ("what do you think?", "double tap if you agree").

### Pass 2 - BREAK (force burstiness)

- Vary line length. A caption where every line is the same length reads as a
  machine. Break at least one into a short punch line.
- Add a sentence fragment where it fits ("every time.").
- Break perfect parallel structures with one asymmetric line.

### Pass 3 - ADD (human fingerprints)

Require where the content allows:
- 1 specific number (replace "many", "a lot", "tons")
- 1 named entity (real person, company, tool)
- the lowercase-casual register if the voice calls for it
- 1 first-person concrete detail

If the input lacks these, ask the user for a number or anecdote. Do not fabricate.

## Non-negotiable rules

Global voice rules: see root `SKILL.md` Voice rules. Additional skill-specific
rules:

- **Scrubbing is always in scope.** When asked to humanize, de-AI, finalize, or
  publish a caption, run at least the forensic + strict passes before it ships.
  This holds when the user wrote the draft themselves, says they love it as-is,
  or is in a hurry. Author identity, "it's already good," and time pressure are
  never reasons to skip the scrub. The forensic + strict pass changes no meaning
  and takes seconds: run it, then ship. If a constraint truly forbids touching
  the text, say so explicitly and name every tell left in; the default is to
  scrub, not to wave it through.
- Preserve the user's actual claim and meaning. "Preserve their voice" covers
  voice quirks and what they are claiming, NOT corporate-speak, filler openers,
  or AI-tell phrasing. Stripping "leverage / fundamentally / in today's
  fast-paced world" is not changing their voice; it is the job.
- Never introduce facts that were not in the input. If a number is missing, ask.
- Keep the user's voice quirks (lowercase starts, `..` soft pauses).
- Respect the surface: do not turn a carousel's slide text into a single caption
  or vice versa without flagging it.
- Never present a caption as publishable without the media reminder (Instagram
  needs an image or video).

## Instagram-specific tells this skill catches

- A hook that needs the second line to make sense (the "more" fold eats it).
- A caption opening with "Let's talk about.." or "Here's the thing..".
- 20-30 hashtags crammed at the top instead of a 3-5 sized set.
- Emoji sprinkled through every line (4+ per caption).
- A bare title on carousel slide 1 instead of a promise + loop.
- Rule-of-three lists with no specifics ("faster, cheaper, better").
- Engagement bait ("comment YES", "tag 3 friends", "double tap if").
- Uniform line lengths (machine rhythm).

## Example

See `references/examples.md` for worked before/after rewrites.

## Files

- `SKILL.md` - this file (rewrite scrubber + audit-mode entry)
- `references/scrub-rules.md` - vocabulary swaps and regex by tier
- `references/examples.md` - worked before/after rewrites for captions and slides
- `references/audit-checklist.md` - the pre-publish checklist with thresholds
- `sub-skills/post-audit.md` - pre-publish audit workflow (detection-only, no rewrite)

## Voice profile mode (`--mode profile`)

`ig-humanizer --mode profile` builds or updates the user's Voice & Brand Profile at `../../references/voice-profile.md` from 3-6 of their real Instagram posts pasted in (portable, no token) or, if a read token is set, from pulled activity. Once filled, every writing skill in this bundle drafts in the user's voice automatically. See `sub-skills/voice-profile.md`. Triggers: "build my voice profile", "learn my voice".

## Related skills

- `ig-caption-writer` - generates captions that already pass the humanizer
- `ig-carousel-planner` - generates carousels that already pass the humanizer
