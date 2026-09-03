# React Doctor false positives

The local-triage playbook reads this file before editing. A suppression here is valid only while
every predicate below is still observable in the code; if a predicate stops holding, the diagnostic
is real again.

## react-doctor/no-fetch-response-used-without-status-check

The detector flags `.json()` on a `Response` that has not been status-checked *earlier in the
statement order*. It cannot see a status check that comes after a **non-throwing** parse, which is
the correct shape when the error body is what carries the message. All eight occurrences below
parse defensively and gate on status before the parsed value is used as data.

Predicates — all must hold for the occurrence to stay suppressed:

1. the parse cannot throw (`.json().catch(...)`, or `res.ok ? res.json() : fallback`), and
2. `response.ok` / `response.status` is checked before the body is used as success data, and
3. the failure path does not read a success-only field.

| Occurrence | Shape |
| --- | --- |
| `src/app/dashboard/launches/launch-dialog.tsx:80` | `if (res.ok) { …; return }` runs *first*; the parse only builds the error message. |
| `src/app/dashboard/launches/variant-dialog.tsx:160` | Same shape as launch-dialog. |
| `src/app/dashboard/settings/personality-tab.tsx:149` | `requestJson` parses with `.catch(() => null)` then `if (!response.ok) throw`. |
| `src/components/personality-onboarding-dialog.tsx:129` | Parse with `.catch(() => null)`, then `if (!response.ok \|\| !body?.success) return null`. |
| `src/components/personality-onboarding-dialog.tsx:192` | Same shape, throwing instead of returning. |
| `src/components/himalaya-mail-accounts-section.tsx:133` | Parse with `.catch(() => ({}))`, then `if (!res.ok)` before any field is read. |
| `scripts/app-automation/flows/run-experience-contract.mjs:289` | The contract runner's `api()` returns `{ ok, status, body }`; scenarios assert on `status`. Hiding the body would remove the evidence a contract records. |
| `scripts/qa/persona-agent-job-smoke.ts:78` | Parse with `.catch(() => ({}))`, then `if (!response.ok) throw` including the status and body. |

Everything else this rule reported on 2026-09-03 was a real defect and was fixed: 26 sites where a
4xx/5xx body was parsed and used as success data.
