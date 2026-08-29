# Signals Writing overlays

Overlays are versioned, machine-readable platform guidance. Load exactly one overlay for the
surface being drafted or audited. Variants pin `overlay.id` and `overlay.version`; changing any
active rule or formula requires an overlay version bump.

## File contract

Each file has flat frontmatter with `overlayId`, positive integer `version`, `platform`,
`surfaces`, ISO `reviewedAt`, and provenance `sources`. It then contains exactly one tagged JSON
array for rules and one for formulas:

```text
```json signals-writing:rules
[...]
```

```json signals-writing:formulas
[...]
```
```

Rule IDs use `<platform>/<surface>/<class>/<slug>`. Formula IDs use
`<platform>/<surface>/<slug>@<overlayVersion>`. A rule record carries `class`, `statement`,
`applies`, `severity`, `source`, and `status`. Heuristic and aesthetic records also carry
`confidence` and `reviewBy`; hard rules cite a platform document or an enforcing adapter/server
test and do not expire.

Formula records carry `surfaces`, `goals`, `shape`, ordered `slots`, `claimRules`, `consent`,
`source`, `confidence`, `reviewBy`, and `status`. Shapes are containers, not factual templates:
every factual slot resolves to the evidence spine. `consent: true` means a named-party formula
requires public-source evidence or explicit consent.

## Promotion and retirement

Corpus-derived guidance begins at low confidence. Promote only with a durable external source or
a Signals outcome record that names its sample size and window. Deprecate rather than silently
delete a record used by persisted variants. Expired heuristics may inform review but cannot be
presented as current platform truth until reviewed.

The validator in `scripts/verify-signals-writing-skill.mjs` checks layout, IDs, provenance,
catalog completeness, tagged JSON, and package-safe paths.
