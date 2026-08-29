# Claims and evidence spine

The spine is the common evidence boundary for every surface. A short post may omit supporting
claims, but it may never add a factual span that lacks a claim or a clearly marked opinion/CTA
origin.

## Source procedure

1. Call `get_writing_context` with `includeSources: true` and accept its redactions.
2. Create one `SourceRef` per source actually used. Generate its `src_` ID with the helper.
3. Do not refetch a redacted source with `get_content`. That would bypass the launch snapshot.
4. Mark notes, files, and URLs private when the user says so. Email, DM, inbound, and local-only
   sources remain private regardless of agent input.
5. Add `contextApproval` only after an explicit user message permitting that private source in
   this run. Preserve the verbatim message as evidence.

## Claim extraction

- Copy facts, numbers, dates, names, quotes, citations, and outcomes verbatim from a source view.
- Default `verbatimRequired: true` for numbers, dates, names, quotes, and citations.
- Inherit source sensitivity. Private claims default to `includeInOutput: false`.
- Set private output approval only after the user explicitly names or clearly identifies the claim
  and approves its use.
- Make the message core supported by at least one proof claim, or state it under `opinion`.
- Keep proof claim IDs limited to claims a valid output is expected to carry.

## Variant claim accounting

Create one `claimMap` entry for every spine claim:

- `present: true, verbatim: true` when the required text is preserved.
- `present: true, verbatim: false` when it was altered. A verbatim-required alteration blocks.
- `present: false` when omitted.
- `claims.total` is the full spine claim count.
- `claims.preserved` counts present claims satisfying their verbatim requirement.
- `claims.missing` contains absent `message.proofClaimIds`, not every omitted supporting claim.
- `claims.invented` lists any factual span with no claim/opinion/CTA origin.
- `claims.privateIncluded` lists present private claims.

## Core claim rules

```json signals-writing:rules
[
  {
    "id":"core/claim/no-invented-fact",
    "class":"claim", "statement":"Every factual assertion resolves to a spine claim or is explicitly presented as opinion.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-invented-number",
    "class":"claim", "statement":"Every number is copied from a number claim without changing its value or scope.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-invented-date",
    "class":"claim", "statement":"Every date resolves to a date claim and keeps the source wording when required.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-invented-name",
    "class":"claim", "statement":"Every named person or organization resolves to a name claim.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-invented-quote",
    "class":"claim", "statement":"Quoted language is present verbatim in a quote claim.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-invented-citation",
    "class":"claim", "statement":"A citation is emitted only when a citation claim preserves the source reference.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/verbatim-claim-kept",
    "class":"claim", "statement":"Claims marked verbatim-required keep their exact source text.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/claim-source-resolves",
    "class":"claim", "statement":"Every claim source ID resolves inside the persisted spine source snapshot.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/private-claim-excluded",
    "class":"claim", "statement":"Private claims stay out of output until durable user evidence approves that exact use.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-third-party-dunk",
    "class":"claim", "statement":"Do not turn a named third party into an attack or humiliation target.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-unverifiable-promise",
    "class":"claim", "statement":"Do not promise an outcome the evidence cannot support.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/named-party-consent",
    "class":"claim", "statement":"A formula centered on a named party requires public-source evidence or explicit consent.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/claim/no-manipulation",
    "class":"claim", "statement":"Content avoids coercive engagement schemes, evasive automation, and manufactured activity.",
    "applies":["core"], "severity":"blocker",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  }
]
```

## Privacy stop conditions

Stop and ask when a private source is needed but remains redacted, a private claim would materially
improve the output but lacks output approval, or a claim locator cannot be reconstructed from the
returned view. Omitting a risky claim is preferable to widening context silently.

Before persistence, verify source IDs, claim source IDs, proof claim IDs, lineage source IDs, and
private approvals all resolve inside the same spine document.
