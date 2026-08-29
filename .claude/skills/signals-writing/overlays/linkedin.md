---
overlayId: overlay:linkedin
version: 1
platform: linkedin
surfaces: [linkedin/post]
reviewedAt: 2026-08-29
sources: [docs-dev/refs/manifest.json, src/lib/writing/variant-writing.ts]
---

# LinkedIn overlay

Use this overlay only for `linkedin/post`. Drafts are one ordered unit and publishing is beta, so
the approval card must preserve that capability label.

## Hard constraints

```json signals-writing:rules
[
  {
    "id":"linkedin/post/hard/char-limit",
    "class":"hard", "statement":"A post is at most 3000 UTF-16 code units.",
    "applies":["linkedin/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#hardLimit"}], "value":3000,
    "enforcedBy":"server:hardLimit", "status":"active"
  },
  {
    "id":"linkedin/post/hard/single-unit",
    "class":"hard", "statement":"A post contains exactly one ordered unit.",
    "applies":["linkedin/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#exactSurfaceUnits"}], "value":1,
    "enforcedBy":"server:exactSurfaceUnits", "status":"active"
  }
]
```

## Formulas

```json signals-writing:formulas
[
  {
    "id":"linkedin/post/anaphora@1",
    "surfaces":["linkedin/post"], "goals":["reposts","awareness"],
    "shape":"Repeat a natural opening across evidence-backed lines, then resolve the pattern.", "slots":[{"name":"repeated opener","from":"message.core","required":true},{"name":"supported lines","from":"message.core","required":true},{"name":"resolution","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/rip-obituary@1",
    "surfaces":["linkedin/post"], "goals":["replies","awareness"],
    "shape":"Retire an idea, not a person; show the evidence and name the replacement.", "slots":[{"name":"retired idea","from":"message.core","required":true},{"name":"proof","from":"spine.claim","required":true},{"name":"replacement","from":"message.core","required":true}],
    "claimRules":["core/claim/no-third-party-dunk"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/year-over-year-pivot@1",
    "surfaces":["linkedin/post"], "goals":["reposts","leads"],
    "shape":"Contrast two preserved time points and explain the supported change.", "slots":[{"name":"earlier claim","from":"message.core","required":true},{"name":"later claim","from":"message.core","required":true},{"name":"bounded interpretation","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-date","core/claim/no-invented-number"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/time-anchor-confession@1",
    "surfaces":["linkedin/post"], "goals":["replies","follows"],
    "shape":"Open at a supported moment, admit a genuine mistake, and state the learned constraint.", "slots":[{"name":"time anchor","from":"claim:date","required":true},{"name":"self-admission","from":"message.core","required":true},{"name":"lesson","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-date"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/self-proving-meta@1",
    "surfaces":["linkedin/post"], "goals":["reposts","follows"],
    "shape":"Demonstrate the writing principle while naming it, then show supported relevance.", "slots":[{"name":"demonstration","from":"message.core","required":true},{"name":"principle","from":"message.core","required":true},{"name":"evidence","from":"spine.claim","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/precise-ledger@1",
    "surfaces":["linkedin/post"], "goals":["saves","leads"],
    "shape":"List preserved inputs and outcomes as a compact ledger, then interpret them.", "slots":[{"name":"inputs","from":"spine.claim","required":true},{"name":"outcomes","from":"claim:number","required":true},{"name":"interpretation","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-number"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/paid-vs-free-reversal@1",
    "surfaces":["linkedin/post"], "goals":["replies","leads"],
    "shape":"Contrast paid and free using actual evidence, then reverse the expected conclusion.", "slots":[{"name":"paid evidence","from":"spine.claim","required":true},{"name":"free evidence","from":"spine.claim","required":true},{"name":"supported reversal","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/curiosity-gap@1",
    "surfaces":["linkedin/post"], "goals":["clicks","follows"],
    "shape":"Pose a truthful gap, develop the evidence, and deliver the answer in the post.", "slots":[{"name":"truthful question","from":"message.core","required":true},{"name":"evidence","from":"spine.claim","required":true},{"name":"answer","from":"message.core","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/contrarian-with-receipts@1",
    "surfaces":["linkedin/post"], "goals":["reposts","replies"],
    "shape":"State a bounded disagreement and immediately ground it in preserved evidence.", "slots":[{"name":"bounded disagreement","from":"message.core","required":true},{"name":"receipts","from":"spine.claim","required":true},{"name":"implication","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-citation"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/emotional-cold-open@1",
    "surfaces":["linkedin/post"], "goals":["replies","likes"],
    "shape":"Name a real feeling without melodrama, then connect it to supported events.", "slots":[{"name":"feeling","from":"message.core","required":true},{"name":"event evidence","from":"spine.claim","required":true},{"name":"reflection","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/permission-slip@1",
    "surfaces":["linkedin/post"], "goals":["saves","follows"],
    "shape":"Release the reader from a false obligation and support the alternative.", "slots":[{"name":"false obligation","from":"message.core","required":true},{"name":"permission","from":"message.core","required":true},{"name":"supported alternative","from":"message.core","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/expectation-reversal@1",
    "surfaces":["linkedin/post"], "goals":["reposts","replies"],
    "shape":"Set an honest expectation, reverse it with evidence, and bound the conclusion.", "slots":[{"name":"expectation","from":"message.cta","required":true},{"name":"evidence-backed reversal","from":"spine.claim","required":true},{"name":"boundary","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/named-tribute@1",
    "surfaces":["linkedin/post"], "goals":["likes","awareness"],
    "shape":"Honor an approved named party with specific public or consented evidence.", "slots":[{"name":"approved named party","from":"claim:name","required":true},{"name":"specific contribution","from":"spine.claim","required":true},{"name":"reflection","from":"message.core","required":true}],
    "claimRules":["core/claim/named-party-consent","core/claim/no-invented-name"], "consent":true,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/explain-simply@1",
    "surfaces":["linkedin/post"], "goals":["saves","awareness"],
    "shape":"State the complex idea plainly, break it into supported parts, and restate the use.", "slots":[{"name":"plain statement","from":"message.core","required":true},{"name":"parts","from":"message.core","required":true},{"name":"use","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/status-strip@1",
    "surfaces":["linkedin/post"], "goals":["awareness","leads"],
    "shape":"Report a concise sequence of current state, evidence, next step, and constraint.", "slots":[{"name":"state","from":"message.core","required":true},{"name":"evidence","from":"spine.claim","required":true},{"name":"next step","from":"message.core","required":true},{"name":"constraint","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/controlled-comparison@1",
    "surfaces":["linkedin/post"], "goals":["saves","leads"],
    "shape":"Compare like with like, name the evidence boundary, and state the bounded takeaway.", "slots":[{"name":"basis","from":"message.core","required":true},{"name":"side A","from":"spine.claim","required":true},{"name":"side B","from":"spine.claim","required":true},{"name":"boundary","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/false-binary-dissolve@1",
    "surfaces":["linkedin/post"], "goals":["replies","saves"],
    "shape":"Name a false binary, show the supported third option, and explain when it applies.", "slots":[{"name":"binary","from":"message.core","required":true},{"name":"third option","from":"message.core","required":true},{"name":"scope","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/anecdote-evidence-bridge@1",
    "surfaces":["linkedin/post"], "goals":["follows","leads"],
    "shape":"Tell a supported moment, bridge explicitly to evidence, and avoid generalizing beyond it.", "slots":[{"name":"anecdote","from":"spine.claim","required":true},{"name":"evidence bridge","from":"spine.claim","required":true},{"name":"bounded lesson","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/diverging-curves-close@1",
    "surfaces":["linkedin/post"], "goals":["reposts","leads"],
    "shape":"Show two evidence-backed trajectories and close on the growing practical difference.", "slots":[{"name":"trajectory A","from":"claim:number","required":true},{"name":"trajectory B","from":"claim:number","required":true},{"name":"bounded close","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-number"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

Formulas organize evidence; they do not license claims. If the spine cannot fill a factual slot,
choose another formula or omit the slot.

For automatic selection, prefer curiosity or bounded-contrarian shapes for replies, explanatory
or ledger shapes for saves, and story/data shapes for awareness. Evidence fit overrides the default.

## Heuristics & aesthetics

```json signals-writing:rules
[
  {
    "id":"linkedin/post/heuristic/hook-before-fold",
    "class":"heuristic", "statement":"Put the payoff in roughly the first 210 characters.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active",
    "notes":"Corpus sources disagree between about 210 and 265 characters; this overlay chooses 210."
  },
  {
    "id":"linkedin/post/heuristic/no-external-link-in-body",
    "class":"heuristic", "statement":"Prefer no external link in the body unless click intent requires it.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/heuristic/hashtags-0-2",
    "class":"heuristic", "statement":"Prefer zero to two relevant hashtags.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/heuristic/line-breaks-for-scan",
    "class":"heuristic", "statement":"Use purposeful paragraph breaks for scanning, not one-line mechanical cadence throughout.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/heuristic/no-comment-gate",
    "class":"heuristic", "statement":"Do not gate useful material behind a request to comment.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"linkedin/post/heuristic/passive-voice-ceiling",
    "class":"heuristic", "statement":"Review when passive construction exceeds roughly eight percent; do not rewrite protected voice quirks automatically.",
    "applies":["linkedin/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active",
    "notes":"Corpus sources disagree between 8 and 10 percent; this overlay chooses 8."
  }
]
```

LinkedIn beta means supported publishing with a capability warning, not an invitation to bypass the
approval and materialization gates. Shared connections are verify-only; use a dedicated connection
for multiple members. A protected voice quirk may skip heuristic/aesthetic findings only under
`voice_first`, with the skipped rule recorded.
