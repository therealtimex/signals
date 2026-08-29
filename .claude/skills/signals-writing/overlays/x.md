---
overlayId: overlay:x
version: 1
platform: x
surfaces: [x/post, x/thread]
reviewedAt: 2026-08-29
sources: [docs-dev/refs/manifest.json, src/lib/writing/variant-writing.ts, src/lib/publish/x-publish.cjs]
---

# X overlay

Use this overlay only for `x/post` and `x/thread`. Both surfaces are measured per ordered unit.
The server is authoritative for limits and audit parity; the publish adapter preserves thread
order after the first unit.

## Hard constraints

```json signals-writing:rules
[
  {
    "id":"x/post/hard/char-limit",
    "class":"hard", "statement":"A post is at most 280 UTF-16 code units.",
    "applies":["x/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#hardLimit"}], "value":280,
    "enforcedBy":"server:hardLimit", "status":"active"
  },
  {
    "id":"x/thread/hard/char-limit",
    "class":"hard", "statement":"Every thread unit is at most 280 UTF-16 code units.",
    "applies":["x/thread"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#hardLimit"}], "value":280,
    "enforcedBy":"server:hardLimit", "status":"active"
  },
  {
    "id":"x/post/hard/single-unit",
    "class":"hard", "statement":"A post contains exactly one ordered unit.",
    "applies":["x/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#exactSurfaceUnits"}], "value":1,
    "enforcedBy":"server:exactSurfaceUnits", "status":"active"
  },
  {
    "id":"x/thread/hard/min-units",
    "class":"hard", "statement":"A thread contains at least two ordered units.",
    "applies":["x/thread"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#exactSurfaceUnits"}], "value":2,
    "enforcedBy":"server:thread_units", "status":"active"
  },
  {
    "id":"x/post/hard/media-count",
    "class":"hard", "statement":"A post carries no more than four media assets.",
    "applies":["x/post"], "severity":"blocker",
    "source":[{"kind":"adapter","path":".claude/skills/signals-publish/scripts/x-publish.cjs"}], "value":4,
    "enforcedBy":"adapter:x-publish.cjs", "status":"active"
  }
]
```

Treat a helper/server mismatch as a stop condition. Do not repair measurements by hand.

## Formulas

```json signals-writing:formulas
[
  {
    "id":"x/post/one-liner-contrarian@1",
    "surfaces":["x/post"], "goals":["replies","reposts","awareness"],
    "shape":"One evidence-backed sentence that overturns a familiar assumption.", "slots":[{"name":"familiar assumption","from":"message.core","required":true},{"name":"supported reversal","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/data-point@1",
    "surfaces":["x/post"], "goals":["reposts","clicks","awareness"],
    "shape":"Lead with one preserved number, then state why it matters.", "slots":[{"name":"verbatim number claim","from":"claim:number","required":true},{"name":"supported implication","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-number","core/claim/verbatim-claim-kept"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/build-in-public-confession@1",
    "surfaces":["x/post"], "goals":["replies","follows","awareness"],
    "shape":"Open with a candid self-observation, name the evidence, and close with the lesson.", "slots":[{"name":"self-observation","from":"message.core","required":true},{"name":"proof claim","from":"spine.claim","required":true},{"name":"lesson","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/mini-list@1",
    "surfaces":["x/post"], "goals":["saves","reposts"],
    "shape":"Frame a supported takeaway and list two to four compact items.", "slots":[{"name":"frame","from":"message.core","required":true},{"name":"evidence-backed items","from":"spine.claim","required":true},{"name":"close","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/relatable-cold-open@1",
    "surfaces":["x/post"], "goals":["replies","likes","follows"],
    "shape":"Start with a recognizable moment, then connect it to the supported point.", "slots":[{"name":"recognizable moment","from":"claim:date","required":true},{"name":"supported point","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/third-party-case-study@1",
    "surfaces":["x/post"], "goals":["reposts","clicks","leads"],
    "shape":"Name a party only with permission or public evidence, state the preserved result, and extract a bounded lesson.", "slots":[{"name":"approved named party","from":"claim:name","required":true},{"name":"verbatim result","from":"claim:number","required":true},{"name":"bounded lesson","from":"message.core","required":true}],
    "claimRules":["core/claim/named-party-consent","core/claim/no-third-party-dunk"], "consent":true,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/listicle-promise@1",
    "surfaces":["x/thread"], "goals":["saves","reposts","follows"],
    "shape":"Promise a bounded list, deliver one supported item per unit, and close the loop.", "slots":[{"name":"bounded promise","from":"message.core","required":true},{"name":"ordered supported items","from":"message.core","required":true},{"name":"close","from":"message.core","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/story-arc@1",
    "surfaces":["x/thread"], "goals":["follows","replies","awareness"],
    "shape":"Move from supported setup through tension and evidence to a bounded resolution.", "slots":[{"name":"setup","from":"message.core","required":true},{"name":"tension","from":"message.core","required":true},{"name":"evidence","from":"spine.claim","required":true},{"name":"resolution","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/curiosity-gap-opener@1",
    "surfaces":["x/thread"], "goals":["reposts","follows","clicks"],
    "shape":"Open a truthful question the evidence can answer, then answer it without withholding the payoff.", "slots":[{"name":"truthful gap","from":"message.core","required":true},{"name":"evidence sequence","from":"spine.claim","required":true},{"name":"answer","from":"message.core","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/how-i-teardown@1",
    "surfaces":["x/thread"], "goals":["saves","follows","leads"],
    "shape":"State the outcome, show the real sequence, and close with the constrained takeaway.", "slots":[{"name":"supported outcome","from":"claim:number","required":true},{"name":"ordered process","from":"spine.claim","required":true},{"name":"takeaway","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact","core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

Choose the formula from goal and evidence shape. Never backfill a slot with an unsupported detail.
A thread is not a split long post: each unit advances the promise and remains understandable in
sequence.

For automatic selection, prefer contrarian or genuine-tension shapes for replies, mini-list or
how-to shapes for saves, and data/story shapes for awareness. Evidence fit overrides the default.

## Heuristics & aesthetics

```json signals-writing:rules
[
  {
    "id":"x/post/heuristic/hook-first-line",
    "class":"heuristic", "statement":"Put the useful tension or payoff in the first line.",
    "applies":["x/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/heuristic/hashtags-0-1",
    "class":"heuristic", "statement":"Prefer zero or one relevant hashtag.",
    "applies":["x/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/heuristic/no-link-in-body",
    "class":"heuristic", "statement":"Prefer a body without an external link when the goal does not require a click.",
    "applies":["x/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/post/heuristic/emoji-0-1",
    "class":"heuristic", "statement":"Prefer zero or one functional emoji unless the approved voice says otherwise.",
    "applies":["x/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/heuristic/thread-promise-open-loop",
    "class":"heuristic", "statement":"The first unit makes a truthful promise the thread closes.",
    "applies":["x/thread"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/heuristic/thread-5-9-units",
    "class":"heuristic", "statement":"Prefer five to nine units when the evidence supports that depth.",
    "applies":["x/thread"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active", "notes":"Audit as warning above nine units and info below five; the hard minimum remains two."
  },
  {
    "id":"x/thread/heuristic/thread-no-link-unit-1",
    "class":"heuristic", "statement":"Prefer no external link in the opening unit.",
    "applies":["x/thread"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"x/thread/heuristic/thread-no-numbering-required",
    "class":"heuristic", "statement":"Do not add mechanical numbering when sequence is already clear.",
    "applies":["x/thread"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

Under `voice_first`, a protected quirk can skip only a heuristic or aesthetic finding and the audit
must record that skip. Hard and claim findings always apply. Under `rules_first`, all applicable
findings remain active and `voice.status` is `rules_first`.
