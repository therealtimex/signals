---
overlayId: overlay:facebook
version: 1
platform: facebook
surfaces: [facebook/post]
reviewedAt: 2026-08-29
sources: [docs-dev/refs/manifest.json, src/lib/writing/variant-writing.ts]
---

# Facebook overlay

Use this overlay only for `facebook/post`. The target may be a profile or page; keep target-kind
differences visible in the CTA and approval risk.

## Hard constraints

```json signals-writing:rules
[
  {
    "id":"facebook/post/hard/char-limit",
    "class":"hard", "statement":"A post is at most 63206 UTF-16 code units.",
    "applies":["facebook/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#hardLimit"}], "value":63206,
    "enforcedBy":"server:hardLimit", "status":"active"
  },
  {
    "id":"facebook/post/hard/single-unit",
    "class":"hard", "statement":"A post contains exactly one ordered unit.",
    "applies":["facebook/post"], "severity":"blocker",
    "source":[{"kind":"server","path":"src/lib/writing/variant-writing.ts#exactSurfaceUnits"}], "value":1,
    "enforcedBy":"server:exactSurfaceUnits", "status":"active"
  }
]
```

## Formulas

```json signals-writing:formulas
[
  {
    "id":"facebook/post/one-line-opinion@1",
    "surfaces":["facebook/post"], "goals":["replies","likes"],
    "shape":"State one clearly framed opinion without disguising it as fact.", "slots":[{"name":"opinion","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/tiny-number@1",
    "surfaces":["facebook/post"], "goals":["reposts","awareness"],
    "shape":"Lead with one preserved number and add one bounded meaning.", "slots":[{"name":"verbatim number","from":"claim:number","required":true},{"name":"bounded meaning","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-number"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/genuine-question@1",
    "surfaces":["facebook/post"], "goals":["replies"],
    "shape":"Ask one question whose answer is genuinely useful and not predetermined.", "slots":[{"name":"context","from":"message.core","required":true},{"name":"genuine question","from":"message.core","required":true}],
    "claimRules":["core/claim/no-manipulation"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/relatable-one-liner@1",
    "surfaces":["facebook/post"], "goals":["likes","replies"],
    "shape":"Capture one recognizable supported moment in a conversational line.", "slots":[{"name":"recognizable moment","from":"claim:date","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/behind-the-scenes@1",
    "surfaces":["facebook/post"], "goals":["follows","awareness"],
    "shape":"Show a real process detail, why it mattered, and what changed.", "slots":[{"name":"process detail","from":"spine.claim","required":true},{"name":"supported meaning","from":"message.core","required":true},{"name":"change","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/useful-tip@1",
    "surfaces":["facebook/post"], "goals":["saves","reposts"],
    "shape":"Give one bounded action, the evidence behind it, and when it applies.", "slots":[{"name":"action","from":"message.core","required":true},{"name":"evidence","from":"spine.claim","required":true},{"name":"scope","from":"message.core","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/story-with-a-turn@1",
    "surfaces":["facebook/post"], "goals":["replies","follows"],
    "shape":"Tell a supported setup, reveal the real turn, and close with a bounded reflection.", "slots":[{"name":"setup","from":"message.core","required":true},{"name":"turn","from":"message.core","required":true},{"name":"reflection","from":"message.core","required":true}],
    "claimRules":["core/claim/no-invented-fact"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/announcement-with-stakes@1",
    "surfaces":["facebook/post"], "goals":["clicks","leads","awareness"],
    "shape":"State the announcement, explain the evidence-backed stakes, and give a direct CTA.", "slots":[{"name":"announcement","from":"message.core","required":true},{"name":"stakes","from":"message.core","required":true},{"name":"CTA","from":"message.cta","required":true}],
    "claimRules":["core/claim/no-unverifiable-promise"], "consent":false,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/community-spotlight@1",
    "surfaces":["facebook/post"], "goals":["likes","awareness"],
    "shape":"Spotlight an approved person or community with specific public or consented evidence.", "slots":[{"name":"approved named party","from":"claim:name","required":true},{"name":"specific contribution","from":"spine.claim","required":true},{"name":"appreciation","from":"message.core","required":true}],
    "claimRules":["core/claim/named-party-consent","core/claim/no-invented-name"], "consent":true,
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

For automatic selection, prefer genuine-question or opinion shapes for replies, useful-tip shapes
for saves, and behind-the-scenes, announcement, or number shapes for awareness. Evidence fit
overrides the default.

## Heuristics & aesthetics

```json signals-writing:rules
[
  {
    "id":"facebook/post/heuristic/short-post-sweet-spot",
    "class":"heuristic", "statement":"When the idea permits, test a compact post near eighty characters without deleting necessary evidence.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/heuristic/link-in-first-comment",
    "class":"heuristic", "statement":"For a page awareness post, consider moving a nonessential external link out of the body; never hide a required CTA destination.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/heuristic/hashtags-0-2",
    "class":"heuristic", "statement":"Prefer zero to two relevant hashtags.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/heuristic/emoji-0-2",
    "class":"heuristic", "statement":"Prefer zero to two functional emoji unless the approved voice says otherwise.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/heuristic/page-vs-profile-cta",
    "class":"heuristic", "statement":"Use an organizational CTA for page targets and a personal conversational CTA for profile targets.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"corpus","path":"docs-dev/refs/manifest.json","observedAt":"2026-07"}], "confidence":"low",
    "reviewBy":"2027-02-28", "status":"active"
  },
  {
    "id":"facebook/post/heuristic/genuine-question-only",
    "class":"heuristic", "statement":"A question must seek a real answer and must not function as vote bait or comment gating.",
    "applies":["facebook/post"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md","observedAt":"2026-08-29"}], "confidence":"high",
    "reviewBy":"2027-02-28", "status":"active"
  }
]
```

Page and organization targets carry high approval risk under the server policy. Do not dilute that
warning because the draft looks conversational. Under `voice_first`, protected quirks may skip only
heuristic or aesthetic findings and every skip remains visible in the audit.
