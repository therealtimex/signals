# Structured audit

Audit the exact ordered units that will be persisted. The model supplies observations; the helper
supplies hard measurements and the deterministic verdict; Signals revalidates both.

## Procedure

1. Run `writing-cli.cjs measure` on the unit file and copy its `hard` object unchanged.
2. Check every factual span against the claim map and classify preserved, altered, missing proof
   claims, invented spans, and included private claims.
3. Apply hard and claim rules first, then approved voice, then dated heuristics and aesthetics under
   the selected precedence.
4. A finding code's penultimate path segment must equal its `class`. Only hard/claim findings may
   be blockers. Only voice/heuristic/aesthetic findings may be skipped for voice.
5. Set voice status to `rules_first`, `applied`, or `none` from the variant inputs.
6. Run `writing-cli.cjs verdict --audit ... --spine ...`, copy the verdict, then precheck.

Verdict is `block` for applied blockers, invented claims, altered verbatim-required claims,
unapproved private inclusion, or over-limit units. It is `warn` for applicable warnings,
rules-first mode, missing proof claims, or non-blocking alterations. Otherwise it is `pass`.

## Humanizing observations

These are low-confidence or optional observations, not claims about authenticity. Skip a heuristic
when it conflicts with an approved protected quirk under voice-first precedence and record why.

```json signals-writing:rules
[
  {
    "id":"core/heuristic/ai-tell-phrases",
    "class":"heuristic", "statement":"Review stock transition phrases that make the draft sound less like the approved samples.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/linkedin-skills/linkedin-humanizer/SKILL.md","observedAt":"2026-04"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/tricolon-cadence",
    "class":"heuristic", "statement":"Review repeated three-part cadence when the profile does not show that habit.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/humanizer-skill/SKILL.md","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/uniform-sentence-length",
    "class":"heuristic", "statement":"Vary sentence length when the draft is mechanically uniform and the voice supports variation.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/humanizer-skill/SKILL.md","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/rhetorical-question-open",
    "class":"heuristic", "statement":"Review a rhetorical-question opener when it is absent from the approved voice.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/linkedin-skills/linkedin-humanizer/SKILL.md","observedAt":"2026-04"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/summary-close",
    "class":"heuristic", "statement":"Remove a redundant summary ending when the message already lands clearly.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/humanizer-skill/SKILL.md","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/hedge-stack",
    "class":"heuristic", "statement":"Review stacked hedges that weaken a supported point beyond the approved voice.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/humanizer-skill/SKILL.md","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/emoji-bullets",
    "class":"heuristic", "statement":"Review emoji used as repetitive bullets when the profile does not use that format.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/linkedin-skills/linkedin-humanizer/SKILL.md","observedAt":"2026-04"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/heuristic/title-case-headers",
    "class":"heuristic", "statement":"Review title-case mini-headings when they conflict with the observed format habits.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"corpus","path":"docs-dev/refs/linkedin-skills/linkedin-humanizer/SKILL.md","observedAt":"2026-04"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/aesthetic/em-dash-sparingly",
    "class":"aesthetic", "statement":"Prefer the profile's punctuation pattern over adding repeated em dashes.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/aesthetic/emoji-count",
    "class":"aesthetic", "statement":"Match emoji frequency to the approved profile and surface context.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/aesthetic/list-vs-prose",
    "class":"aesthetic", "statement":"Choose list or prose structure from the message and observed voice, not a universal preference.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"core/aesthetic/sign-off-style",
    "class":"aesthetic", "statement":"Use a sign-off only when it matches the approved samples and CTA intent.",
    "applies":["core"], "severity":"info",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

## Persistence check

The audit overlay/core versions must match the variant, hard values must match the measured units,
and the audit input must describe the current body. On revision, rerun the complete audit; never
reuse a prior audit ID or input hash. The server derives both and keeps bounded history.
