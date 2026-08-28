# Scrub Rules (Instagram)

Tiered catalogs the humanizer applies. Load this file when actually executing a
scrub. Two tiers: forensic (always on) and strict (default on).

## FORENSIC tier (always on)

Real model leakage no human types. Delete or flag on sight.

| Pattern | Action |
|---|---|
| `oaicite`, `contentReference`, `turn0search0`, `attached_file`, `grok_card` | delete the marker |
| "As of my last update", "As of my knowledge cutoff", "I cannot browse" | delete the disclaimer line |
| `[Your Name]`, `[Brand]`, `[insert X here]`, `YYYY-MM-DD` template blanks | flag, ask the user to fill |
| 3+ em dashes in a caption | replace each with `..`, a period, or a line break |

## STRICT tier (default on)

Bad Instagram style regardless of who wrote it.

### Punctuation

- Curly quotes -> straight quotes.
- `--` -> a period or a line break.
- Em dash (`—`) / en dash (`–`) -> `..`, a comma, or two sentences.

### Vocabulary swaps

| AI word | Swap to |
|---|---|
| leverage | use |
| utilize | use |
| facilitate | help |
| streamline | simplify |
| harness | use |
| foster | build |
| delve | look at |
| elevate | lift |
| empower | help |
| unlock | open up |
| dive in / dive into | get into |
| robust | solid |
| seamless | smooth |
| cultivate | grow |

### Filler adverbs (delete)

fundamentally, essentially, ultimately, crucially, notably, simply, just (as a
hedge), really (as a hedge).

### Dead phrases (delete or rewrite)

- "in today's fast-paced world", "in the digital age"
- "at the end of the day"
- "game-changer", "deep dive", "level up", "next level", "must-have"
- "it's not just X, it's Y"
- "the world of {thing}"

### Dead closers (rewrite to a landing or a specific ask)

- "What do you think?"
- "Thoughts?"
- "Double tap if you agree."
- "Tag 3 friends who need this."
- "Comment YES below."

## Instagram-format scrubs (always apply)

- A hook that needs line 2 to make sense: rewrite so the first 125 chars stand
  alone.
- 6+ hashtags, or any mid-sentence: cut to a 3-5 sized set at the end or in the
  first comment (see `../../../references/hashtag-strategy.md`).
- 4+ emoji, or emoji on every line: cut to 0-3 placed with intent.
- A bare carousel slide-1 title: rewrite to a promise + open loop.
- Uniform line lengths: break at least one into a short punch.
- A caption over 2,200 chars: tighten.

## Negative parallelism

Strip the "not X, but Y" / "it isn't about X, it's about Y" constructions. They
are an AI rhythm tell. Rewrite to a direct claim.
