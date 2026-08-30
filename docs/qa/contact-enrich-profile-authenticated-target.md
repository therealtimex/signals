# Contact Enrich Profile authenticated-target QA (#384)

This runbook validates issue #384 only against the RealTimeX **Dev** host and the disposable,
receipt-backed **Signals issue-384 QA** Local App. Never repoint or exercise the canonical
**Signals** Local App.

## Setup

```bash
cd /Users/realtimex/rtgit/realtimex-ai-app
yarn dev:all

cd /Users/realtimex/.realtimex.ai/desktop-user-data/app/users/trungle_rta_vn/storage/working-data/realtimex-dev/worktrees/loop-issue-384-b512b84d
node scripts/qa/provision-signals-qa-local-app.mjs \
  --issue 384 \
  --worktree "$PWD" \
  --loop-id loop-issue-384-b512b84d
```

Record the provisioner receipt, assigned Signals port, disposable `SIGNALS_DATA_DIR`, and exact
LinkedIn target/session before testing. Settings → Platform connections must show the intended
LinkedIn profile and **Verify** must succeed.

## Baseline-to-upgrade thread migration

1. Provision the same issue QA app on base `551e1f7` with its disposable data directory.
2. Run **Enrich profile** once to create the legacy **Contact Web Research** thread and record its
   exact slug plus `workflow_templates.rtx_thread_slug`.
3. Stop only the issue QA app. Switch only its launcher/worktree to branch `issue-384`, preserving
   the receipt and disposable data directory; do not edit SQLite.
4. Run **Enrich profile** again. The same slug must now resolve to **Contact Enrich Profile**, the
   stored binding must be unchanged, and the Signals workspace must contain exactly one research
   thread.

Record the exact guarded commands and before/after slug/name evidence below during execution.

## Required scenarios and evidence

| Scenario | Required evidence |
|---|---|
| Authenticated success | `POST` returns 202; brief contains exact target/session/start URL/handles/lease; session list before/during proves the same CDP port and no new profile; authenticated LinkedIn content marker and `/in/` visit; `blockedUrls` empty. |
| Lease lifecycle | `/api/platform-targets` shows holder `contact-web-research:<runId>` while pending; completion returns `leaseRelease: { released: true, alreadyGone: false }`; lease is no longer held before cascade. |
| Signed-out LinkedIn | `POST` returns 409 `RESEARCH_TARGET_UNAVAILABLE` with reason `LOGIN_REQUIRED` and Platform connections repair copy; no terminal dispatch or anonymous session. Restore login afterward. |
| No eligible target | Forget the disposable LinkedIn target and ensure no X fallback; 409 contains the exact settings path and UI link; no brief, dispatch, session, or lease row. Re-discover the target afterward if needed. |
| Auth-wall write guard | `upsert_contact_identity` with `https://www.linkedin.com/authwall?...` returns `VALIDATION_ERROR`; a real `/in/...` URL succeeds. |

Because the contact error state changed, capture and commit redacted before/after screenshots under
`.evidence/` for desktop/mobile × light/dark using the repository naming convention.

## Execution record

Status: pending Dev embedded QA.

- Receipt: pending
- QA Local App ID / port: pending
- Disposable data directory: pending
- Legacy thread slug/name: pending
- Upgraded thread slug/name: pending
- Prepared target/session/CDP port: pending
- Workflow run and lease IDs: pending
- Negative-path results: pending
- Screenshot files: pending

## Teardown and hygiene gate

```bash
node scripts/qa/cleanup-signals-qa-local-app.mjs --issue 384
REALTIMEX_RUNTIME=dev \
  node scripts/qa/verify-signals-local-app-hygiene.mjs --issue 384
```

Then stop `yarn dev:all` and confirm the issue Signals port plus `3100`, `3101`, and `9888` are
clear. QA is incomplete until the hygiene verifier confirms the canonical app still points to the
canonical checkout with `SIGNALS_DATA_DIR=~/.signals` and no issue QA record remains.
