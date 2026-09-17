# Production rollback — writeoff-23910 (September 17, 2026)

This is the `rollbackCompatibility` procedure for the coordinated release pipeline
(`prepare-production-release` → `production:deploy` → `firebase deploy --only
hosting,firestore,storage,functions`). The evidence itself is produced by
`scripts/production-rollback-plan.mjs`; this page explains the rule it applies,
how to run it, and what no redeploy can undo.

## 1. Generate the plan (read-only, no credentials)

```sh
# live = the release_commit input of the last successful "Deploy prepared production release" run
# release = the commit you are about to dispatch (or just dispatched)
node scripts/production-rollback-plan.mjs --from <live-sha> --to <release-sha>
node scripts/production-rollback-plan.mjs --from <live-sha> --to <release-sha> --json   # machine-readable
```

The script runs only `git rev-parse`, `git diff --name-only --no-renames` and
`git cat-file` in the local checkout. It prints:

| Section | Content |
| --- | --- |
| Surfaces changed | every changed path classified as `hosting/app`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `functions`, `functions-analysis`, `deploy-config` (firebase.json/.firebaserc), `release-pipeline`, or `not-deployed` |
| Rules / indexes | whether rules or indexes moved, and whether an app-only rollback is safe |
| Rollback sequence | the exact steps through the same pipeline (or the console path when the live commit predates the pipeline) |
| Cannot be rolled back | the data migrations and provider-side state, with their backup artifacts |
| Evidence | one JSON line to paste into `rollbackCompatibility.evidence` |

Unknown shipped paths default to `hosting/app` on purpose: a false "app changed"
is harmless, a false "not deployed" would hide a change. The classifier is unit
tested in `tests/production-rollback-plan.test.ts`.

### Where `--from` comes from

The running app does not expose its git commit (only the Next build id). The
authoritative source is GitHub → Actions → "Deploy prepared production release"
→ the last successful run → input `release_commit`. Before the first release
through this pipeline there is no such commit: production is the Node 20 SSR
revision recorded in `docs/PRODUCTION_CUTOVER_2026-09-16.md`. For that baseline
pass the last commit that was deployed by the old process if you know it, or the
oldest commit on the branch; the script detects that the commit lacks
`.github/workflows/deploy.yml`, `scripts/prepare-production-release.mjs`,
`scripts/production-preflight.mjs` or `scripts/deploy-production-release.mjs`
and prints the console rollback path instead of a workflow dispatch.

## 2. The rule: rules and app move together

**If `firestore.rules` or `storage.rules` changed between the live commit and the
release, rolling back the app alone is unsafe.** The release rules deny the legacy
plaintext bank-token fields on profiles and accounts and lock the server-only
collections (`plaid_connections`, analysis tasks, webhook receipts, `rate_limits`,
`account_deletions`, `support_audit`). The previous app reads and writes shapes
those rules reject, so users would see permission errors; and rolling the rules
back while the new app stays up leaves the new server-only collections
unprotected under permissive rules. The same holds in both directions, which is
why the pipeline deploys `hosting`, `firestore` (rules + indexes), `storage` and
both Functions codebases in one run and refuses partial `firebase deploy`
invocations (the predeploy hooks check `WRITEOFF_COORDINATED_DEPLOY`).

Corollaries the script encodes:

- `firestore.indexes.json` is additive under `--non-interactive`; the deploy
  never drops indexes, so the release index set stays and the old queries
  tolerate the superset. Do not delete indexes during a rollback.
- Rolling back to a commit where `functions-analysis` did not exist leaves the
  analysis functions deployed; `--non-interactive` never deletes functions. They
  would call an `/api/internal/analysis-worker` route the old app does not have
  and retry for up to 24 h. Delete them explicitly if you roll back that far.
- `firebase.json` changes (CSP headers, `frameworksBackend`, codebases) are part
  of the app surface: they are only applied by a full redeploy.

## 3. Rollback through the pipeline (both commits carry it)

1. Decide on a trigger from `docs/PRODUCTION_GO_LIVE_RUNBOOK_2026-09-17.md`
   ("Rollback trigger criteria"). Once the Plaid credential migration has run
   for real users (section 4) a forward fix is almost always the better option.
2. Pause the scheduler so old and new sync code never interleave:
   `gcloud scheduler jobs pause firebase-schedule-syncAllUsersTransactions-us-central1 --location us-central1 --project writeoff-23910`.
3. Take a fresh export before touching anything:
   `gcloud firestore export gs://writeoff-23910-firestore-backups --database '(default)' --project writeoff-23910`
   (bucket created by `scripts/production-observability.sh`). Note the output
   folder in the incident record.
4. Write a migration review JSON for the rollback commit
   (`"commit": "<live-sha>"`, all eight reviews `reviewed: true` with evidence —
   `validateMigrationReview` pins the exact commit) and update the GitHub
   `production` environment secret `PRODUCTION_MIGRATION_REVIEW_JSON`.
   `PRODUCTION_ENV_FILE` normally stays; check `scripts/production-preflight.mjs`
   at the rollback commit for any variable it requires that the current file
   lacks.
5. Dispatch **Deploy prepared production release** with
   `release_commit=<live-sha>` and `confirmation=deploy:writeoff-23910:<live-sha>`.
   The workflow checks out that commit, runs `prepare-production-release.mjs`
   from it, and `npm run production:deploy` redeploys every surface together.
6. Verify (same smoke list as a forward release) and resume the scheduler:
   `gcloud scheduler jobs resume firebase-schedule-syncAllUsersTransactions-us-central1 --location us-central1 --project writeoff-23910`.

## 4. What cannot be rolled back by redeploying code

| Item | What happens at release | Why a redeploy cannot undo it | Backup artifact |
| --- | --- | --- | --- |
| Plaid credential migration (`lib/plaid/connections.ts` `migrateLegacyPlaidConnection`) | On the first authenticated read per legacy profile: plaintext `plaid_token` / `access_token` / `plaid_item_id` / `plaid_transactions_cursor` are deleted from `user_profiles/{uid}` and `accounts/*`, the token is encrypted with `PLAID_TOKEN_ENCRYPTION_KEY` into `plaid_connections/{itemId}` (`status: relink_required`), `plaid_credentials_migrated: true` is set | The old app and old scheduler only look at the deleted profile fields; after rollback every migrated user appears disconnected. The encrypted copy is unreadable without the same key | Pre-release managed backup / export in `gs://writeoff-23910-firestore-backups`; PITR reads at a timestamp before the release; the private read-only inventory from `npm run production:migration-inventory` (mode-0600 JSON outside the checkout, digest printed) |
| Historical overlap decisions | `potentialHistoricalOverlaps` in the inventory are `human_review_required`; the operator decides which record is canonical and which confirmations survive | Those are human writes outside the codebase | The inventory JSON and digest, plus the separate decision evidence cited in `historicalOverlapReconciliation.evidence` |
| Provider-side state | New Plaid Items under client `6aab263acbddc2000d721272`; Stripe live customers and subscriptions; Firebase Auth password resets; `account_deletions` gates; legacy connections in `revocation_required` | Not stored in the repository or in Firestore alone | Provider dashboards; the Stripe/Plaid event logs |
| Indexes | New composite / collection-group indexes are built | Additive; nothing to undo | — |

A wholesale restore from a backup also discards every write users made after
the release. Treat it as the last resort; the runbook's rollback triggers are
about the code surfaces, not the data.

## 5. Evidence for the release review

Paste the JSON line printed under "rollbackCompatibility evidence" into
`.writeoff-production-migration-review.json` → `rollbackCompatibility.evidence`,
together with:

- the `--from` provenance (workflow run URL or the baseline note),
- the pre-release backup location (managed backup name or export folder),
- the statement that the migration review for the rollback commit has been
  drafted (or where it will come from), so a rollback is dispatchable within
  minutes rather than blocked on paperwork.
