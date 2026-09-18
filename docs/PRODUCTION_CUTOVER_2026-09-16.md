# Production cutover prerequisites

This is a release checklist for the replacement Plaid account and automatic analysis. Static configuration checks are not evidence that provider production access, real bank linking, or every taxpayer scenario works. No production deployment is performed by the preparation script.

## Required before release

- The **new** Plaid account must have production Transactions access. Use its production secret, never the old account or the Sandbox secret. Register `https://writeoffapp.com/plaid/oauth` before configuring that exact `PLAID_REDIRECT_URI`; verify `https://writeoffapp.com/api/plaid/webhook` is reachable. Bank availability, institution OAuth, and production limits still require actual provider validation.
- Set `PLAID_ENV=production`, the new `PLAID_CLIENT_ID` and `PLAID_SECRET`, and a new dedicated 64-hex `PLAID_TOKEN_ENCRYPTION_KEY`. Preserve that key after first use. **Keep the existing production `SSN_ENCRYPTION_KEY` unchanged** so saved taxpayer identifiers remain decryptable; it must differ from the Plaid key.
- Set `ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com`. Provision production `ANALYSIS_WORKER_SECRET` and `CLOUD_FUNCTION_SECRET` in Secret Manager with runtime access. The corresponding values in the Next server must match their Functions secrets. The OpenAI key belongs only in the server, with funding verified separately.
- Verify Stripe live secret/publishable keys and the live webhook signing secret. Explicitly map the existing Basic price to `STRIPE_PRICE_ID_BASIC_MONTHLY` (and any existing Basic yearly price). Keep its price unchanged. Map Premium monthly/yearly prices separately, with agreeing public aliases. Verify live price ownership, amounts, currency, recurrence, portal and webhook settings through Stripe; `price_` identifiers do not encode live/test mode.
- Keep `COLUMN_TAX_MODE=disabled`. Filing provider onboarding and launch are separate from record exports and tax guidance.
- Deploy under Node 22 after the complete build, test and provider regression checks. Production SSR is configured for launch traffic: 2 GiB memory (PDF and export generation hold whole record sets in memory), 1 CPU, 60-second timeout, concurrency 40, minimum 1 and maximum 20 instances in `us-central1` (changed 2026-09-17 from the preview allocation of concurrency 80 / max 2). Basis: a concurrency probe of the production build on a 4-core VM served rendered pages at about 450 requests/s with 40 ms median latency, while `GET /api/tax/compute-1040` — which reads every transaction of the year — took 55 ms alone and about 400 ms at 20 concurrent requests for a 60-transaction user, and about 1 s for a 1,200-transaction user. Node handles one request's CPU work at a time, so lower per-instance concurrency with more instances keeps tax endpoints responsive; `minInstances 1` removes the cold start from the first visit. Re-tune from Cloud Run metrics after launch; this is a starting posture, not a throughput guarantee.

## Prepare an isolated snapshot

Do not replace staging's `.env.local`, deploy its compiled artifacts to production, or rely on a shell override to change their Firebase project. Review and commit the release code first. Store production values in a private file outside the checkout; never commit it or paste its contents into logs/chat.

```sh
node scripts/prepare-production-release.mjs \
  --source /absolute/path/to/reviewed-checkout \
  --output /absolute/path/to/new-production-release \
  --env-file /absolute/private/path/to/production.env \
  --migration-review /absolute/private/path/to/completed-migration-review.json
```

The script refuses dirty source or an existing output directory. It exports the exact commit, excludes ignored staging/build artifacts, creates a private `.env.production.local`, records its digest, and writes only non-secret Functions routing parameters. It does not install dependencies, contact providers, build or deploy. Editing the prepared env or review requires preparing a new release.

A **separate completed release review** is mandatory, with no env-variable bypass. Its JSON must specify `schemaVersion: 1`, `project: "writeoff-23910"`, the exact release `commit`, a nonempty `reviewedBy`, and an ISO `reviewedAt`. Each of `legacyProfileMigration`, `historicalOverlapReconciliation`, `oldClientCompatibility`, `plaidProductionAccess`, `stripeLiveConfiguration`, `secretManagerBindings`, `rulesAndIndexes`, and `rollbackCompatibility` must contain `reviewed: true` and a nonempty `evidence` reference to the completed assessment/validation. These are explicit operator acknowledgments, not automated proof. The predeploy guard verifies the copied review, its digest and commit. Do not mark unresolved migration, provider, secret, rules/index or rollback work reviewed simply to pass the guard. This implementation does not create provider approval or merge/discard historical records.

`docs/production-release-review.example.json` is a deliberately incomplete template. Every review flag is false; copy it to a private path and replace fields only with actual evidence. The `legacyProfileMigration` and `oldClientCompatibility` entries name the exact artifacts and digests the bulk credential migration command emits; their text starts with `REPLACE` and is not evidence until the real digests are substituted.

Install dependencies and run checks from that isolated directory using Node 22. Run the guard explicitly before any deployment:

```sh
npm ci --include=dev
node scripts/production-preflight.mjs --project writeoff-23910 --config firebase.json
```

The same guard runs in production hosting and Functions predeploy hooks. It rejects wrong project/site/bucket/auth app, mixed local env files, conflicting inherited config, Sandbox/test credentials, missing encryption/worker settings, test switches, and overlapping Basic/Premium prices. The Plaid client identifier must exactly match the replacement account verified for this rollout; another account requires an explicit code/configuration review. A pass confirms static consistency only. It does not verify that the supplied secret belongs to that account, production provider approval, key funding, Secret Manager equality, already-deployed rules, or migration readiness.

Production hosting uses `firebase.json`, explicitly targeting `writeoff-23910`. `firebase.staging.json` stays isolated and uses only the staging project. The production config includes both `default` (bank sync scheduler) and `analysis` codebases; a hosting-only deployment does **not** deploy the worker or scheduler.

After the release review is complete, the sole supported deployment entry point is:

```sh
npm run production:deploy -- --confirm "deploy:writeoff-23910:<exact-40-character-commit>"
```

It reruns the preflight, builds the app and both Functions packages, reruns the preflight immediately before release, and asks Firebase to deploy Hosting, Firestore rules/indexes, Storage rules, and both Functions codebases together. It intentionally omits `--force`. Firebase target releases are coordinated but not transactional; retain the reviewed compatible rollback plan.

Release integrity guards: the manifest records the git blob ID of every reviewed source file and the preflight rejects any edit or deletion made after preparation; Firebase predeploy hooks require the coordinated-deploy token that only the release script supplies, so a direct partial `firebase deploy --only …` fails; and dependency install/build scripts run without deployment credentials or provider secrets in their environment. The prepared `.env.production.local` is still readable on disk during the build, so keep lockfiles pinned and review dependency changes.

## Existing-user migration and rollout order

The new `firestore.rules` deny a browser read of `user_profiles/{uid}` (and of an `accounts/*` document) while the document still contains a `plaid_token` or `access_token` field. Old browser clients read their profile straight through the Firestore SDK and never call the API handshake that migrates those fields, so the only sequence in which existing users keep working is to empty every profile of tokens **before** the rules land. The sequence below was verified with `tests/plaid-migration.emulator.test.ts` against the repository rules: a seeded token-bearing profile is `permission-denied` to its own owner, the shared migration core removes the token, the same client reads the profile again and `plaid_connections/{itemId}` remains denied.

1. **Inventory (read-only).** Run `npm run production:migration-inventory` (below). It counts legacy profiles/accounts and flags any profile with more than 400 account documents; it writes no records.
2. **Backup + bulk credential migration.** Run `npm run production:plaid-migration` (below) with the release `PLAID_TOKEN_ENCRYPTION_KEY`: dry run, review the private plan, then `--apply`. Before its first write it exports and verifies a private mode-0600 backup of every profile and account document it will change. It executes `migrateLegacyPlaidCredentials` from `lib/plaid/legacy-migration.ts`, the same transaction the profile API runs lazily: the legacy token is encrypted into `plaid_connections/{itemId}` as `relink_required`, the public `plaid_token`/`access_token`/`plaid_item_id`/`plaid_transactions_cursor` fields are deleted, account token fields are deleted, and `plaid_credentials_migrated: true` is set. Profiles above 400 accounts are cleaned in follow-up transactions of at most 400 writes with the completion marker written last, so a rerun resumes an interrupted cleanup. Transactions, accounts, confirmations and existing private connections are never deleted. Preserve the key used here; the app must run with the same one.
3. **Verify zero token-bearing profiles.** Run the command with `--verify`. It exits nonzero while any profile or account document still carries a token and writes a private verify report. Do not continue until it passes. A token that remains because the plan refused a profile (for example an Item already owned by another user, reported as `expectedRefusal: ownership_mismatch`) needs manual review first. The old application is still live until step 4 and writes a new public token whenever a user links a bank, so rerun steps 2–3 immediately before step 4 (both are idempotent: a rerun migrates nothing and reports so) and keep that window short.
4. **Coordinated release.** `npm run production:deploy` releases the app, Firestore rules and indexes, Storage rules and both Functions codebases together. Because step 2 left no profile with a token, old clients that are still open keep reading their profile under the new rules and the lazy handshake only refreshes `bankConnected` for them. **Running step 4 without step 2 locks every legacy user out** until an API call performs the migration for them, because the new rules deny their profile read and the old client never triggers the handshake. Verify after release that the server-only `plaid_connections`, analysis task and webhook receipt collections are denied to browsers and that the old scheduler no longer selects public `plaid_token` fields.
5. **Relink with the replacement Plaid client.** Old-account credentials stay encrypted as `relink_required` and are never sent with the new account's credentials; imported transactions and confirmations remain. Users link again (`PLAID_ACCOUNT_REPLACEMENT_2026-09-16.md`); the new provider's identifiers must not cause duplicate imported history to be treated as new tax expenses without the documented reconciliation. Then check a real authorized production bank link, asynchronous first import, automatic AI suggestions, manual reanalysis, OAuth resume, reconnect, signed webhooks, two-bank isolation and exact-bank disconnect before advertising fully working banking, and confirm no provider secret appears in browser-readable records or returned JSON.

Independent deploy commands are still not atomic and Firebase target releases are coordinated but not transactional; keep the compatible rollback plan. Missing Plaid encryption prevents legacy profile loading even if new bank linking is disabled, so `PLAID_TOKEN_ENCRYPTION_KEY` must be present in the release environment as well as in the shell that ran step 2.

Account deletion keeps a private durable gate outside the profile. New bank exchanges and checkout customer creation cannot start after that gate is set; unresolved operations prevent identity/record erasure. Ambiguous Stripe creation or failed customer compensation needs support review of the retained billing operation (including its customer identifier when known); it never expires automatically. An old-provider bank cannot be considered revoked merely by clicking Disconnect: its encrypted recovery record remains in `revocation_required` until manual revocation is verified. The old credentials are never tried with the replacement provider account.

### Read-only migration inventory

After obtaining authorized production read access, create the private per-user/account inventory without writing to Firestore or calling Plaid:

```sh
npm run production:migration-inventory -- \
  --project writeoff-23910 \
  --output /absolute/private/path/production-migration-inventory.json \
  --confirm read-only:writeoff-23910
```

The command pins the production project, refuses emulators, writes a new mode-0600 file outside the checkout, and prints aggregate totals/digest only. It inventories legacy credential locations, account/transaction counts, saved confirmations/tax decisions, private connection states, and exact cross-account date/amount/merchant/currency matches. Raw tokens, Item IDs, merchant text and amounts are never written to the report.

Every overlap is labeled `human_review_required`; the command never chooses a canonical record, changes a confirmation, merges data or marks the release review complete. Exact-match candidates can miss real duplicates and can include legitimate repeated purchases. Use the private record references for the documented human reconciliation and retain separate evidence of the decision.

### Bulk legacy credential migration (steps 2 and 3)

Run from the reviewed checkout with authorized production Admin credentials and the release `PLAID_TOKEN_ENCRYPTION_KEY` exported in the shell (never on the command line or in a committed file). The private directory must be absolute and outside the checkout; the command creates it with mode 0700 if it is missing.

```sh
# Step 2a: dry run. Writes plaid-credential-migration-plan-<timestamp>.json (mode 0600) and prints its sha256.
npm run production:plaid-migration -- \
  --project writeoff-23910 \
  --backup /absolute/private/path/plaid-migration \
  --confirm plan:writeoff-23910

# Step 2b: read the plan (one entry per legacy profile: action, token on profile / on N accounts,
# Item present, account count, paginated, expected refusal). Then apply with the plan digest.
npm run production:plaid-migration -- \
  --project writeoff-23910 \
  --backup /absolute/private/path/plaid-migration \
  --apply --confirm apply:writeoff-23910:<sha256 printed by the dry run>

# Step 3: verify. Exits nonzero while any profile or account still carries a token.
npm run production:plaid-migration -- \
  --project writeoff-23910 \
  --backup /absolute/private/path/plaid-migration \
  --verify --confirm verify:writeoff-23910
```

Apply refuses to start unless the plan file with that exact digest is in the backup directory, was produced with the same encryption key, and still matches production (a legacy profile that appeared or changed since the dry run requires a new plan). It then writes `plaid-credential-migration-backup-<digest16>.json` — the full profile and token-bearing account documents, including the tokens — verifies the file digest, and only then runs the shared migration transaction per profile, recording per-profile outcomes in `plaid-credential-migration-apply-<digest16>.json`. A second apply with the same plan is refused because that backup already exists. The verify report is `plaid-credential-migration-verify-<timestamp>.json`. Standard output carries counts, file paths and digests only; the plan, backup and reports contain uids, and the backup contains credentials, so keep the directory private and record the digests in the release review: `legacyProfileMigration` cites the plan, backup and apply digests; `oldClientCompatibility` cites the passing verify report digest together with the emulator test run. The command refuses any project other than `writeoff-23910` and any `FIRESTORE_EMULATOR_HOST`; `--allow-emulator` exists only for the local `demo-*` test suite.

### Historical overlap reconciliation

The old record keeps the owner's confirmations, so a relinked bank's re-import of the same purchase is marked **superseded** and excluded from every total. Nothing is deleted or merged, and neither record's `is_deductible` or `review_status` changes.

1. **Decisions file.** For each `potentialHistoricalOverlaps` group, an authorized reviewer compares the referenced records and writes one decision per pair: `canonical` is the record carrying the owner's history (the old Item's account, or a legacy root `transactions/{id}` record), `candidate` is the relinked account's record. `duplicate` supersedes the candidate; `distinct` records `overlap_reviewed: true` on the candidate so it leaves later inventories; `defer` writes nothing. Copy the inventory command's printed digest into `inventoryDigest` and keep the file outside the checkout with mode 0600. Notes may describe the reasoning; they never reach the records or the evidence file.

```json
{ "schemaVersion": 1, "project": "writeoff-23910", "inventoryDigest": "<sha256 printed by the inventory command>",
  "reviewedBy": "<name>", "reviewedAt": "2026-09-18T15:00:00Z",
  "decisions": [{ "group": "<inventory group label>",
    "canonical": "user_profiles/<uid>/accounts/<old account>/transactions/<id>",
    "candidate": "user_profiles/<uid>/accounts/<relinked account>/transactions/<id>",
    "decision": "duplicate", "note": "Same purchase re-imported after relink" }] }
```

2. **Dry run (default).** Validates every decision against the records as they exist now and prints counts plus the plan digest; nothing is written.

```sh
npm run production:overlap-reconcile -- --project writeoff-23910 \
  --decisions /absolute/private/path/overlap-decisions.json \
  --inventory /absolute/private/path/production-migration-inventory.json
```

It refuses a pair whose date, amount, merchant text or currency no longer match, a pending or bank-removed record, a canonical that is itself superseded, a candidate already superseded by another record, records with different owners or the same account scope, and decision sets that contradict each other (a candidate is superseded by exactly one canonical and is never also `distinct`). Fix the file or the records and rerun; no partial plan is ever applied.

3. **Apply.** Confirm the printed plan digest. The command writes a mode-0600 JSON backup of every record it will touch to `--backup` first, then stamps candidates in Firestore transactions of at most 400 records that re-read and re-validate each pair, and finally writes a mode-0600 evidence file listing the decision ids applied and the record paths changed (no amounts or merchants). Rerunning with the same confirmation writes nothing. Emulators are refused unless `--allow-emulator` is passed for a local rehearsal.

```sh
npm run production:overlap-reconcile -- --project writeoff-23910 \
  --decisions /absolute/private/path/overlap-decisions.json \
  --apply --confirm apply:writeoff-23910:<plan digest from the dry run> \
  --backup /absolute/private/path/overlap-backups \
  --evidence /absolute/private/path/overlap-evidence-<date>.json
```

4. **What `superseded_by` means.** A superseded record carries the full path of its canonical record in `superseded_by`, plus `superseded_at`, `superseded_reason: "historical_overlap"` and `superseded_decision_id`. These fields (and `overlap_reviewed*`) are Admin SDK only; both client update rules keep them outside the editable allow-lists. Superseded records are excluded from Schedule C totals, tax exports, the audit support packet (counted under `excluded.superseded`), income candidates, AI taxpayer context, dashboard counts, notifications and the transactions list and tabs; a detail opened by direct link explains the exclusion. The complete owner data export still includes them with a hashed reference to the canonical record. Reversal is not automated: undoing a decision needs a separate review and an Admin SDK write that clears the fields.

5. **Release review evidence.** The decisions file (its digest), the inventory digest it was reviewed against, and the apply command's evidence file path and digest are the evidence for `historicalOverlapReconciliation` in the release review. If the inventory reports zero groups, record that inventory digest instead.

## Application behavior changes that reach existing users at rollout

These are code-level effects of the 2026-09-17 merges, separate from the banking migration above. None writes to customer records on its own.

- **Paid tier verification.** Reports and exports require a server-verified `subscriptionPlan` (`basic` or `premium`). A paid profile without it is treated as locked until `GET /api/subscriptions/check-access` reconciles it from Stripe, which the app calls on every protected-app load. Live Stripe keys must therefore be configured before the app deploy, or Premium customers see the paywall until they are. Basic keeps extended bank history only, as approved.
- **Home office.** A profile with a legacy `home_office_method` but no saved `settings/homeOffice` facts now receives `HOME_OFFICE_REVIEW_REQUIRED` from the annual estimate, Form 1040 PDF, Schedule C/SE and worksheet routes until the Settings questions are answered. The dashboard and Tax Preview link straight to the section. Previously the method was silently ignored.
- **Confirmed deductions.** Schedule C totals, the dashboard and the audit support packet count `is_deductible === true` only with a server-stamped `review_status` or a legacy decision created before `2026-09-18T00:00:00Z` with no review-pipeline fields. Records confirmed through the API after the cutoff are stamped automatically; direct client edits of `is_deductible` on stamped records are rejected by the rules.
- **Income reconciliation.** Overlapping bank/receipt/1099 income still returns `INCOME_RECONCILIATION_REQUIRED`, now with candidates and an owner decision flow instead of a bare 422. No existing income record is merged or edited.
- **Superseded bank records.** Only records the operator command stamps with `superseded_by` (see "Historical overlap reconciliation") change behavior: they leave every total, list and review queue, and their detail view shows a short exclusion note. Until decisions are applied, nothing is hidden and duplicates from a relink still double-count.
- **Consents.** New sign-ups (including Google) record acknowledgments on the profile through the profile API. Accounts created before the consent record existed, or recorded under an earlier version than `CONSENT_TERMS_VERSION` (`2026-09-18`), see the re-acknowledgment gate in place of the app until the three required acknowledgments (Terms of Service, bank data, AI review) are saved; billing and data & privacy controls remain reachable without agreeing.
- **Analytics.** The GA tag and its CSP origins render only when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set. The measurement-ID ownership decision (`G-1P3GNBHB9J` vs `G-LE26KP7E9N`) and the static CSP in `firebase.json` for `/auth/**` and `/login` are still open operator items.
- **State estimates.** A saved state now produces an informational, year-labeled planning estimate for the encoded states or an explicit `supported: false`; it is never added to the federal total. CA 2026 and OH 2026 schedules are unpublished and correctly unsupported.

## Can the code ship with banking unavailable?

Missing Plaid credentials fail closed and lazy initialization keeps unrelated routes from crashing. That alone is not a complete disabled-bank launch: the current UI can still offer Connect Bank, and migration still needs the encryption key. A limited release needs explicit unavailable-state UI, preserved record access, migration/rules coordination and accurate marketing. The current production preflight intentionally requires complete banking configuration for a full-platform launch.

## Facts observed during this audit

Read-only metadata on September 16, 2026 showed production `ssrwriteoff23910` on Node 20 (last updated September 15), plus the older scheduled-sync function; no analysis queue/process Functions were deployed. Production Secret Manager listed the prior OpenAI/Plaid secret resources, with no analysis-worker or Plaid-encryption resource; SSR runtime environment metadata did not expose packaged `.env` values, so resource absence does not prove every packaged setting is absent. The gcloud identity could not read production Firestore rules (HTTP 403); current production rules must be verified through an authorized Firebase identity before rollout.

Production deployment is manual-only through `.github/workflows/deploy.yml`; ordinary pushes cannot trigger it. Dispatch requires an exact commit and matching confirmation, the protected GitHub `production` environment, private `PRODUCTION_ENV_FILE` and `PRODUCTION_MIGRATION_REVIEW_JSON` environment secrets, and the Firebase service-account secret. The workflow prepares a fresh isolated release and calls the same coordinated deploy entry point. Configure required reviewers on the GitHub `production` environment before relying on this path. Direct partial-deploy convenience scripts are disabled.

Read-only Firestore aggregate inventory on September 17 found 40 production profiles, 11 profiles with nonempty legacy bank credentials (and 11 with nonempty bank Item IDs), 25 saved account documents, and zero private `plaid_connections` documents. Account-specific filtered aggregates could not run because of query prerequisites; no indexes were changed. These counts establish the immediate relink scope, not verified account correspondence or absence of overlapping transactions. No customer identifiers, credentials, transactions, or amounts were retrieved/exported for this inventory.

## Release status when further testing stopped

Code commit `6993d3b` was pushed to `codex/staging-readiness` and successfully deployed to `writeoff-production-testing.web.app`. The staging SSR service is ACTIVE on Node 22, revision `ssrwriteoffproductionte-00034-saf`, with 1024 MiB memory. Both analysis workers and the updated Firestore rules were deployed. The final code suite recorded 2,643 passing tests plus 14 separately passing security-rule tests; TypeScript passed and lint reported zero errors with 887 existing warnings.

The new Plaid team's production request remains pending; the user is handling the security questionnaire. Production was not deployed or switched to the replacement provider. The 11 legacy connected profiles still require the coordinated migration and historical-overlap work described above.

The OAuth browser check reached the institution handoff but did not observe a provider popup or callback return; see `PLAID_OAUTH_VALIDATION.md`. A separate synthetic account-deletion smoke stopped at its receipt-upload prerequisite (`SYNTHETIC_RECEIPT_UPLOAD_FAILED`) before issuing any account-deletion request. Its underlying cause was not investigated after the user requested no additional testing, and account deletion is not recorded as a hosted end-to-end pass.

Cleanup disconnected both synthetic Sandbox banks and removed their encrypted credentials. The isolated synthetic account and its three transaction records remain for traceability; no customer records or confirmations were changed. No further test runs are scheduled by this work.
