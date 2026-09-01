# Voice profiles

Voice evidence is learned from the user's real writing, not imposed as a generic style preset.
When a Personality binding is active, the whole workspace `VOICE.md` is the live voice. An approved
immutable voice profile remains evidence and attribution for observed habits; it does not override
the Personality files.

## Resolve voice from context

- `pinned`: use the returned profile reference and document.
- `pinned_superseded`: disclose the active replacement; continue with the pin unless told to switch.
- `active`: use the approved active profile.
- `ambiguous`: show candidate labels and versions, then ask the user to choose.
- `missing`: stop because the requested pin cannot be resolved.
- `none`: build a profile unless the brief explicitly selected a voice-less run.
- `unclaimed_only`: ask the user to claim or build their own profile. Never use another owner's
  writing as the active voice.

## Build or revise a profile

1. Collect at least three approved, self-authored samples. Signals content-item samples must be
   outbound, authored/imported, and not generated. Pasted/file samples require self authorship.
2. Retain inadmissible samples with `approved: false` and `excludedReason`; do not silently drop the
   audit trail.
3. Derive observed sentence range, opener/closer habits, punctuation, vocabulary keep/avoid lists,
   formats, emoji/hashtag frequency, protected quirks, and taboo patterns.
4. Copy every signature line as an exact substring and attach its sample ID.
5. Omit `ownerContactId`; Signals resolves the self contact. Default label to `default` and
   platforms to `[]` unless the user narrows it.
6. Call `upsert_voice_profile`. Present the returned draft content and server version/hash.
7. Wait for a message approving that profile/version, then call `approve_voice_profile` with
   thread-message evidence. Never synthesize approval.

An identical upsert returns the current immutable version. A changed profile creates a new draft
version; approval supersedes the prior active version without making historical variants unreadable.

## Precedence and drift

Under `voice_first`, voice beats heuristic and aesthetic advice but never hard or claim rules.
When a scrub would remove a protected quirk, leave the text intact, mark the finding
`skippedForVoice: true`, and list the rule under `heuristics.skippedForVoice`.

Under `rules_first`, platform heuristics apply ahead of voice and `voice.status` is `rules_first`.
No finding may be skipped for voice in that mode. Estimate drift from 0 to 1 as the share of
profile dimensions the draft misses; record `core/voice/drift` as a warning at 0.4 or above.

## Core voice rules

```json signals-writing:rules
[
  {
    "id":"core/voice/drift",
    "class":"voice", "statement":"Warn when the draft misses at least forty percent of the approved profile dimensions.",
    "applies":["core"], "severity":"warning",
    "value":0.4, "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}],
    "status":"active"
  },
  {
    "id":"core/voice/protected-quirk-kept",
    "class":"voice", "statement":"Keep approved protected quirks when voice-first precedence is active.",
    "applies":["core"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/voice/avoid-list",
    "class":"voice", "statement":"Flag vocabulary the approved profile marks as avoid.",
    "applies":["core"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/voice/taboo",
    "class":"voice", "statement":"Flag a profile taboo without rewriting claim meaning.",
    "applies":["core"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/voice/signature-verbatim",
    "class":"voice", "statement":"A signature line is used only as the exact approved sample substring.",
    "applies":["core"], "severity":"warning",
    "source":[{"kind":"spec","path":"specs/signals-writing-system.md"}], "status":"active"
  },
  {
    "id":"core/voice/personality-source-stale",
    "class":"voice", "severity":"warning",
    "statement":"Server-inserted when an audit knowingly retains unchanged Personality bytes after sources changed; requires fresh explicit approval.",
    "applies":["core"],
    "source":[{"kind":"spec","path":"specs/personality-projection.md"}], "status":"active"
  }
]
```

`core/voice/personality-source-stale` is server-owned. Never author, copy, or repair it in agent
input; Signals removes client copies and inserts the deterministic warning when applicable.

## Approval evidence

Use `{ kind: "thread_message", workspaceSlug, threadSlug, note }` only after the user names or
clearly identifies the draft profile and says approve. Copy the message verbatim into `note`.
Profile approval and variant approval are separate acts; one never implies the other.
