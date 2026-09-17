# Production go-live runbook — writeoff-23910 (September 17, 2026)

One ordered checklist for the operator, from a read-only inventory to the
rollback decision. Every step names the exact command or console path, what you
should see, and which field of the release review
(`.writeoff-production-migration-review.json`, schema in
`docs/production-release-review.example.json`) it satisfies. Steps 1–9 happen
before the deploy; step 10 is the deploy; 11–12 are after it; 13 is the
security work that needs a human decision.

Conventions: `<angle brackets>` are values you supply and never paste into chat,
tickets or logs. Placeholder paths under `/private/...` mean a directory outside
every git checkout, `chmod 700`. Nothing in this runbook prints a secret value.

## 0. Before you start

| Item | Requirement | Check |
| --- | --- | --- |
| Identity | A human Google identity with Owner (one-time setup) on `writeoff-23910`; the deploy service account is used only by CI | `gcloud auth list` shows the human account active; `gcloud config get-value project` prints `writeoff-23910` |
| Firebase CLI | `firebase login` with the same identity | `firebase projects:list` includes `writeoff-23910` |
| Node | `. "$HOME/.nvm/nvm.sh" && nvm use 22.23.2` (`.nvmrc`) | `node -v` → `v22.23.2` |
| Checkout | A clean clone at the release commit, not the working tree you edit in | `git status --porcelain` empty; `git rev-parse HEAD` is the 40-char `<release-sha>` |
| Kit | `scripts/production-observability.sh`, `scripts/production-secrets.sh`, `scripts/production-rollback-plan.mjs`, `scripts/production-migration-inventory.mjs` | `bash -n scripts/production-*.sh && node --check scripts/production-rollback-plan.mjs` |
| Companion docs | `docs/PRODUCTION_CUTOVER_2026-09-16.md` (prerequisites), `docs/PRODUCTION_ROLLBACK_2026-09-17.md`, `docs/PRODUCTION_SCALE_2026-09-17.md` | read once |

The kit scripts default to `--print`: they echo every `gcloud`/`firebase`
command with comments and run nothing. Read the printed plan before `--apply`.

## 1. Inventory (read-only)

**Satisfies:** `legacyProfileMigration.evidence`, `historicalOverlapReconciliation.evidence` (the digest), and the `--from` provenance for `rollbackCompatibility`.

1. Record what is live now (paste the outputs into the release record, they contain no secrets):

```sh
gcloud functions list --project writeoff-23910 --regions us-central1 --v2 \
  --format 'table(name.basename(),state,buildConfig.runtime,updateTime)'
gcloud run services describe ssrwriteoff23910 --region us-central1 --project writeoff-23910 \
  --format 'value(status.latestReadyRevisionName,spec.template.spec.containers[0].resources.limits)'
firebase firestore:indexes --project writeoff-23910 > /private/release/indexes-before.json
gcloud scheduler jobs list --location us-central1 --project writeoff-23910
```

Expected today (from `docs/PRODUCTION_CUTOVER_2026-09-16.md`): `ssrwriteoff23910`
on `nodejs20`, the older scheduled-sync function, **no** `queueBankTransactionAnalysis`
/ `processBankTransactionAnalysis`. If the analysis functions are already
present, someone deployed since the cutover audit; find out who before continuing.

2. Firestore rules currently published: Firebase console → Firestore Database →
   Rules → note the "Published" timestamp; same under Storage → Rules. (The
   September 16 audit identity got HTTP 403 on the rules API; use the console.)

3. Private migration inventory (no writes, no Plaid calls, nothing exported but counts):

```sh
npm ci --include=dev
npm run production:migration-inventory -- \
  --project writeoff-23910 \
  --output /private/release/production-migration-inventory-$(date -u +%Y%m%dT%H%MZ).json \
  --confirm read-only:writeoff-23910
```

Expected: a JSON block with `totals` (September 17 baseline: 40 profiles, 11
`legacyProfiles`, 25 `accountDocuments`, 0 `privateConnections`) and a `digest`,
then `No records were changed. Potential overlaps still require human review.`
Confirm `totals.profilesRequiringPaginatedMigration` is `0`; a nonzero value
means a profile with more than 400 account documents that the in-app migration
refuses (`Bank migration requires a paginated administrative cleanup`) and needs
an administrative cleanup before release.

4. Rollback plan for this release (needs only the local checkout):

```sh
node scripts/production-rollback-plan.mjs --from <live-sha> --to <release-sha>
```

`<live-sha>` is the `release_commit` of the last successful "Deploy prepared
production release" run. For the first release through the pipeline there is
none; pass the last commit the old process deployed (or the branch base) and the
script prints the console rollback path instead. Keep the "rollbackCompatibility
evidence" line.

## 2. Backup

**Satisfies:** `rollbackCompatibility.evidence` (backup artifact); precondition for `legacyProfileMigration`.

1. PITR, the private backup bucket, the daily backup schedule and the weekly
   export job are created by the observability kit. Print first, then apply
   (idempotent; safe to re-run):

```sh
scripts/production-observability.sh --project writeoff-23910 \
  --alert-email <ops-alias@writeoffapp.com> --budget-amount <usd> --billing-account <XXXXXX-XXXXXX-XXXXXX>
scripts/production-observability.sh --project writeoff-23910 --apply \
  --alert-email <ops-alias@writeoffapp.com> --budget-amount <usd> --billing-account <XXXXXX-XXXXXX-XXXXXX>
```

Expected in `--apply`: `gcloud firestore databases update --enable-pitr` succeeds
(or reports PITR already enabled), bucket `gs://writeoff-23910-firestore-backups`
exists with uniform access, public access prevention and a 400-day retention
policy, a daily backup schedule and a weekly export Cloud Scheduler job exist.

2. Take the **pre-release export now** (the daily schedule's first run is not
   today):

```sh
gcloud firestore export gs://writeoff-23910-firestore-backups/pre-release-$(date -u +%Y%m%dT%H%MZ) \
  --database '(default)' --project writeoff-23910
gcloud firestore operations list --database '(default)' --project writeoff-23910 --filter 'done=false'
```

Expected: an operation name; the second command returns nothing once the export
is complete. Record the `gs://...` folder in the release record.

3. Auth users backup (optional but recommended because the release touches
   sign-in flows). This file is exactly the kind of export that leaked as
   `users.json` (step 13): write it **only** under `/private`, never inside a
   checkout, and delete it after the retention you decide on.

```sh
umask 077
firebase auth:export /private/release/auth-export-$(date -u +%Y%m%dT%H%MZ).json --format=json --project writeoff-23910
```

4. Receipts bucket (user uploads) is not touched by the release; skip unless you
   want a same-day copy: `gcloud storage rsync -r gs://writeoff-23910.firebasestorage.app gs://writeoff-23910-firestore-backups/storage-pre-release-<date>`.

## 3. Plaid credential migration

**Satisfies:** `legacyProfileMigration`, `historicalOverlapReconciliation`, `oldClientCompatibility`.

The migration runs as an operator command **before** the deploy:
`npm run production:plaid-migration` (`scripts/production-plaid-credential-migration.mjs`),
which shares its transaction core with the lazy per-user path in
`lib/plaid/legacy-migration.ts`. Per profile, in one Firestore transaction: the
plaintext `plaid_token` / `access_token` is encrypted with
`PLAID_TOKEN_ENCRYPTION_KEY` into `plaid_connections/{itemId}` with
`status: relink_required`, the plaintext fields (`plaid_token`, `access_token`,
`plaid_item_id`, `plaid_transactions_cursor`) are deleted from the profile and its
`accounts/*`, and `plaid_credentials_migrated: true` is set. Profiles with more
than 400 accounts take the paginated path. Old-account tokens are never sent to
the new Plaid client; users relink. Because no profile carries a token when the
new rules land, old browser bundles keep working (verified by
`tests/plaid-migration.emulator.test.ts`).

What you do before the deploy (export `PLAID_TOKEN_ENCRYPTION_KEY` in the shell first; the backup directory must be absolute, outside the checkout, and private):

1. Generate the new Plaid key and preserve it (password manager entry named for
   the project; losing it makes every encrypted connection unreadable):
   `openssl rand -hex 32` → `PLAID_TOKEN_ENCRYPTION_KEY` (64 hex). It must differ
   from `SSN_ENCRYPTION_KEY`, which must be the **existing** production value.
2. Dry run — writes `plaid-credential-migration-plan-<timestamp>.json` (0600) and prints its sha256:

   ```sh
   npm run production:plaid-migration -- --project writeoff-23910 \
     --backup /absolute/private/path/plaid-migration --confirm plan:writeoff-23910
   ```

3. Read the plan (one entry per legacy profile), then apply with its digest. Apply
   writes and digest-verifies a full backup of every affected document before the
   first transaction, refuses if production changed since the plan, and is idempotent:

   ```sh
   npm run production:plaid-migration -- --project writeoff-23910 \
     --backup /absolute/private/path/plaid-migration \
     --apply --confirm apply:writeoff-23910:<sha256 printed by the dry run>
   ```

4. Verify — exits nonzero while any profile or account still carries a token.
   Run it again immediately before step 10:

   ```sh
   npm run production:plaid-migration -- --project writeoff-23910 \
     --backup /absolute/private/path/plaid-migration --verify --confirm verify:writeoff-23910
   ```

   Cite the plan digest, backup digest and verify output in
   `legacyProfileMigration.evidence` and `oldClientCompatibility.evidence`.
5. Historical overlap reconciliation happens **after** users relink with the new
   client (new Item ids can duplicate old purchases). The reviewed decisions file
   and `npm run production:overlap-reconcile` (dry run → `--apply`) are described
   in `docs/PRODUCTION_CUTOVER_2026-09-16.md`; until relinks exist, record in
   `historicalOverlapReconciliation.evidence` that the inventory showed the
   candidate groups and that the apply command is staged for the relink day.
6. Rules and app go out in one `firebase deploy` but not atomically (seconds
   apart). Choose a low-traffic time and announce it.

Post-deploy verification of the migration is in step 11.6.

## 4. Verify provider and platform prerequisites

**Satisfies:** `plaidProductionAccess`, `stripeLiveConfiguration`, `rulesAndIndexes`.

| Check | Where | Expected |
| --- | --- | --- |
| Plaid production access | Plaid dashboard → Team Settings → the **new** team (client `6aab263acbddc2000d721272`) → Production access | Approved for Transactions. The release waits for this approval; bank linking is not shipped disabled |
| Plaid redirect URI | Plaid dashboard → Team Settings → API → Allowed redirect URIs | Contains exactly `https://writeoffapp.com/plaid/oauth` |
| Plaid webhook | after deploy `curl -s https://writeoffapp.com/api/plaid/webhook` | `{"status":"healthy",...}`; the URL you put in `PLAID_WEBHOOK_URL` is `https://writeoffapp.com/api/plaid/webhook` |
| Stripe live keys | Stripe dashboard (live mode toggled) → Developers → API keys | `sk_live_`/`rk_live_` secret, `pk_live_` publishable; the preflight rejects `_test_` anywhere |
| Stripe prices | Stripe → Products | Basic monthly (existing price, amount unchanged), Premium monthly, Premium yearly, optional Basic yearly; four **distinct** `price_` ids |
| Stripe webhook | Stripe → Developers → Webhooks → endpoint `https://writeoffapp.com/api/stripe/webhook` (live) | Signing secret `whsec_...` → `STRIPE_WEBHOOK_SECRET`; events for checkout/subscription lifecycle enabled |
| Rules diff | `git diff <live-sha> <release-sha> -- firestore.rules storage.rules` | Read it. The release rules deny legacy token fields and lock server-only collections; that is why step 10 deploys everything together |
| Index diff | `diff <(node -e 'console.log(JSON.stringify(require("./firestore.indexes.json").indexes,null,1))') <(node -e 'console.log(JSON.stringify(require("/private/release/indexes-before.json").indexes,null,1))')` | New collection-group indexes on `transactions` (14 indexes + 2 field overrides in the file). Deploy never deletes indexes in non-interactive mode |
| Node 22 everywhere | Appendix A | all `engines.node` = `22`, `.nvmrc` = `22.23.2`, workflows use `node-version-file` |

Write the Plaid/Stripe screenshots or dashboard URLs into the two provider
`evidence` fields and the rules/index diff summary (plus the post-deploy check in
step 11.3–11.4) into `rulesAndIndexes.evidence`.

## 5. Secrets

**Satisfies:** `secretManagerBindings`.

```sh
scripts/production-secrets.sh --project writeoff-23910            # inventory + provisioning commands, nothing runs
```

What the script enumerates (read from the code, not guessed):

- **Secret Manager secrets bound to Functions (REQUIRED before deploy):**
  `CLOUD_FUNCTION_SECRET` → `syncAllUsersTransactions` (`functions/src/index.ts` `defineSecret`),
  `ANALYSIS_WORKER_SECRET` → `queueBankTransactionAnalysis`, `processBankTransactionAnalysis`
  (`functions-analysis/src/index.ts` `defineSecret`). `firebase deploy --non-interactive`
  fails if either is missing.
- **Server-only secrets that live in the SSR env file (step 8), not as bindings:**
  `PLAID_SECRET`, `OPENAI_API_KEY`, `PLAID_TOKEN_ENCRYPTION_KEY`, `SSN_ENCRYPTION_KEY`,
  `ANALYSIS_WORKER_SECRET`, `CLOUD_FUNCTION_SECRET` (same values as the bindings),
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **Optional runtime reads:** `RESEND_API_KEY`, `RATE_LIMIT_HASH_SECRET`,
  `FIREBASE_ADMIN_PRIVATE_KEY` (omit on Cloud Run; ADC is used).

Provision the two Functions secrets (script section E). Generate each value
once into the password manager (you need it again for the env file in step 8),
then feed it to gcloud on stdin so it never appears in shell history or `ps`:

```sh
gcloud secrets create CLOUD_FUNCTION_SECRET --replication-policy automatic --project writeoff-23910 --labels app=writeoff,env=production
pbpaste | gcloud secrets versions add CLOUD_FUNCTION_SECRET --data-file=- --project writeoff-23910     # value generated with: openssl rand -hex 32
gcloud secrets create ANALYSIS_WORKER_SECRET --replication-policy automatic --project writeoff-23910 --labels app=writeoff,env=production
pbpaste | gcloud secrets versions add ANALYSIS_WORKER_SECRET --data-file=- --project writeoff-23910
```

(`pbpaste` is macOS; on Linux use `xclip -o` or `wl-paste`. If a secret already
exists, skip `create` and only add a version.)

Grant the runtime service account accessor on those two secrets only (section
F), give the deploy service account its least-privilege project roles (section
H: `roles/firebasehosting.admin`, `roles/cloudfunctions.developer`,
`roles/run.admin`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`,
`roles/firebase.viewer`, plus `roles/iam.serviceAccountUser` on the runtime SA),
and run the one-time Eventarc/Pub/Sub service-agent bindings for the Firestore
triggers (section I). The exact `gcloud … add-iam-policy-binding` lines are in
the `--print` output.

Then verify without touching values:

```sh
scripts/production-secrets.sh --project writeoff-23910 --verify \
  --deploy-sa <deployer>@writeoff-23910.iam.gserviceaccount.com
```

Expected: the two REQUIRED rows read `exists=yes enabled_version=yes runtime_accessor=yes`;
RECOMMENDED rows (the SSR-only names) may be `no` if you keep those values only
in the password manager; the deploy SA role list matches section H; the
service-agent bindings are present. Paste that output (it has no values) as
`secretManagerBindings.evidence` (section J lists what the reviewer expects),
together with the statement that the SSR env file carries identical
`ANALYSIS_WORKER_SECRET`/`CLOUD_FUNCTION_SECRET` values.

## 6. Observability

**Satisfies:** operational readiness for the post-deploy checks in step 11 and the alert-driven triggers in step 12 (no review field of its own; note the policy names in the release record).

Step 2 already ran `--apply`. Confirm the full set and keep the read-back:

```sh
scripts/production-observability.sh --project writeoff-23910 --verify
```

Expected read-back:

- Firestore `(default)`: `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED`; one daily backup schedule (14-week retention, the maximum); Scheduler job `writeoff-firestore-weekly-export` `ENABLED`.
- Log-based metrics: `writeoff_worker_retry_required`, `writeoff_subscription_unavailable`, `writeoff_review_required_422`, `writeoff_ssr_5xx`, `writeoff_scheduled_sync_completed`.
- Alert policies (display names): `WriteOff SSR 5xx ratio > 2% (5 min)`, `WriteOff SSR p95 latency > 3 s (5 min)`, `WriteOff Cloud Functions error rate > 10% (10 min)`, `WriteOff scheduled bank sync silent for 84600s` (23.5 h — the Cloud Monitoring maximum for absence conditions; the requested 26 h is not representable), `WriteOff Firestore reads > 3x 7-day baseline`, `WriteOff login page uptime check failing`, all routed to the e-mail channel you passed.
- Uptime check on `https://writeoffapp.com/auth/login` (HTTPS, expects 200, SSL validated).
- Budget on the billing account for this project with 50/90/100 % actual and 100 % forecast thresholds.

Console cross-check: Google Cloud console → Monitoring → Alerting → Policies
(six `WriteOff …` policies), Monitoring → Uptime checks (one), Billing →
Budgets & alerts (one). Until the first deploy the SSR-based policies have no
data; that is expected.

## 7. GitHub `production` environment

**Satisfies:** the deploy path itself; record the environment URL in the release record.

Console path: `https://github.com/pratz456/TestOffwrite/settings/environments` →
**New environment** → name `production` (must match `environment.name` in
`.github/workflows/deploy.yml`).

1. **Deployment protection rules → Required reviewers:** add at least one person
   who is *not* the person dispatching. The workflow pauses at "Waiting for
   review" until they approve.
2. **Deployment branches and tags:** "Selected branches and tags" → add the
   release branch pattern only. The workflow checks out `inputs.release_commit`
   regardless of branch, so this restricts *who can run the workflow file*, not
   which commit ships; the confirmation input pins the commit.
3. **Environment secrets** (Settings → Environments → production → Add secret):

| Secret | Content | How to set from the operator machine |
| --- | --- | --- |
| `PRODUCTION_ENV_FILE` | The complete env file from step 8, verbatim (multi-line) | `gh secret set PRODUCTION_ENV_FILE --repo pratz456/TestOffwrite --env production < /private/release/production.env` |
| `PRODUCTION_MIGRATION_REVIEW_JSON` | The completed review JSON from step 9 | `gh secret set PRODUCTION_MIGRATION_REVIEW_JSON --repo pratz456/TestOffwrite --env production < /private/release/migration-review.json` |
| `FIREBASE_SERVICE_ACCOUNT` | JSON key of the deploy service account from step 5 | `gcloud iam service-accounts keys create /private/release/deployer.json --iam-account <deployer>@writeoff-23910.iam.gserviceaccount.com --project writeoff-23910 && gh secret set FIREBASE_SERVICE_ACCOUNT --repo pratz456/TestOffwrite --env production < /private/release/deployer.json && shred -u /private/release/deployer.json` (`rm -P` on macOS) |

Verify (read-only): `gh api repos/pratz456/TestOffwrite/environments/production --jq '.protection_rules[].type'`
→ includes `required_reviewers`; `gh secret list --repo pratz456/TestOffwrite --env production`
→ the three names. The workflow tests `test -n` on each secret and fails
immediately if one is empty.

## 8. Prepare the env file

**Satisfies:** input to `plaidProductionAccess`, `stripeLiveConfiguration`, `secretManagerBindings`; validated by the preflight.

Write `/private/release/production.env` (`umask 077`). Every variable below is
either required by `validateProductionConfiguration()` in
`scripts/production-preflight.mjs` or checked when present. **(S)** = secret
value; keep those out of any chat, ticket or log.

**Environment selectors (required)**

```
WRITEOFF_ENV=production
NEXT_PUBLIC_APP_ENV=production
```

**Firebase web app (required; public identifiers, not secrets — still do not paste)**

```
NEXT_PUBLIC_FIREBASE_PROJECT_ID=writeoff-23910
NEXT_PUBLIC_FIREBASE_API_KEY=<web API key of the writeoff-23910 web app>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writeoff-23910.firebaseapp.com
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=writeoff-23910.firebasestorage.app      # or writeoff-23910.appspot.com — whichever the project actually uses
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=930596534802
NEXT_PUBLIC_FIREBASE_APP_ID=1:930596534802:web:<hex from the Firebase console>
```

Optional, checked only when present: `FIREBASE_ADMIN_PROJECT_ID` (must be
`writeoff-23910`), `FIREBASE_ADMIN_CLIENT_EMAIL` (must end in
`@writeoff-23910.iam.gserviceaccount.com`), `FIREBASE_ADMIN_PRIVATE_KEY` **(S)**
— omit all three on Cloud Run, Application Default Credentials are used;
`FIREBASE_STORAGE_BUCKET`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT`
(if set, must equal the production values); `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
and `NEXT_PUBLIC_GA_MEASUREMENT_ID` (analytics: an open ownership decision, see
`docs/PRELAUNCH_READINESS.md`; leave unset to ship without the tag).

**Origins (required, exact)**

```
NEXT_PUBLIC_SITE_URL=https://writeoffapp.com
ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com
```

**Plaid (required)**

```
PLAID_ENV=production
PLAID_CLIENT_ID=6aab263acbddc2000d721272          # pinned by the preflight; another account needs a code review
PLAID_SECRET=<production secret of that client>                              (S)
PLAID_REDIRECT_URI=https://writeoffapp.com/plaid/oauth
PLAID_WEBHOOK_URL=https://writeoffapp.com/api/plaid/webhook                # optional; if set must be exactly this
PLAID_TOKEN_ENCRYPTION_KEY=<new 64-hex from step 3>                           (S)
```

**Taxpayer-identifier encryption (required)**

```
SSN_ENCRYPTION_KEY=<the EXISTING production 64-hex key — never rotate here>   (S)   # must differ from the Plaid key
```

**Worker shared secrets (required, ≥ 32 chars, identical to the Secret Manager versions from step 5)**

```
ANALYSIS_WORKER_SECRET=<same value as Secret Manager ANALYSIS_WORKER_SECRET>  (S)
CLOUD_FUNCTION_SECRET=<same value as Secret Manager CLOUD_FUNCTION_SECRET>    (S)
```

**OpenAI (required)**

```
OPENAI_API_KEY=<server-only key; funding verified in the OpenAI dashboard>    (S)
```

Optional: `OPENAI_MODEL=<model>` (global override, `lib/openai/client.ts`),
`AI_ANALYSIS_ENABLED=false` (kill switch, `lib/ai/provider-status.ts`; leave
unset to enable).

**Stripe (required; live mode)**

```
STRIPE_SECRET_KEY=<sk_live_… or rk_live_…>                                    (S)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<pk_live_…>
STRIPE_WEBHOOK_SECRET=<whsec_… of the live endpoint>                          (S)
STRIPE_PRICE_ID_MONTHLY=<price_… Premium monthly>
STRIPE_PRICE_ID_YEARLY=<price_… Premium yearly>
STRIPE_PRICE_ID_BASIC_MONTHLY=<price_… the existing Basic price>
```

Optional aliases that must agree with the above when present:
`STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID`,
`NEXT_PUBLIC_STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY`,
`NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_MONTHLY`, `STRIPE_PRICE_ID_BASIC`,
`NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC`, `STRIPE_PRICE_ID_BASIC_YEARLY`,
`NEXT_PUBLIC_STRIPE_PRICE_ID_BASIC_YEARLY`. All configured price ids must be
distinct; any `sk_test_`/`rk_test_`/`pk_test_` value fails the preflight.

**Feature switches (required state)**

```
COLUMN_TAX_MODE=disabled          # and no other COLUMN_TAX_* variable at all
```

Must be absent or `false`: `STRIPE_TEST_MODE_EXPIRE_TODAY`, `ENABLE_TRANSACTION_RESET`,
anything containing `EMULATOR`, `FIREBASE_AUTH_EMULATOR_HOST`. Never prefix a
server-only name with `NEXT_PUBLIC_` (`PLAID_`, `ANALYSIS_WORKER_`,
`CLOUD_FUNCTION_`, `SSN_`, `OPENAI_`, `COLUMN_TAX_`, `STRIPE_SECRET`,
`STRIPE_WEBHOOK`); the preflight rejects it.

**Optional runtime**

```
RATE_LIMIT_HASH_SECRET=<random ≥ 32 chars>   (S)   # HMAC for rate-limit keys; plain SHA-256 without it
RESEND_API_KEY=<re_…>                        (S)   # CPA-question e-mail; logged server-side without it
SUPPORT_ADMIN_UIDS=<uid,uid>                       # support routes allowlist; also needs the admin custom claim
```

Bank connections require the production Plaid credentials above; this release does not launch with bank linking disabled.

**Validate the file before it goes anywhere** (from the release checkout, after `npm ci --include=dev`; prints only rule names):

```sh
node -e 'import("./scripts/production-preflight.mjs").then(async m => {
  const fs = await import("node:fs"); const { parse } = await import("dotenv");
  const env = parse(fs.readFileSync(process.argv[1], "utf8"));
  const cfg = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
  const r = m.validateProductionConfiguration(env, { project: "writeoff-23910", hosting: cfg.hosting });
  console.log(r.errors.length ? r.errors.join("\n") : "env OK"); process.exitCode = r.errors.length ? 1 : 0; })' /private/release/production.env
```

Expected: `env OK`. Any other line is the exact rule that failed; fix and re-run.

## 9. Migration review JSON

**Satisfies:** all eight review fields; `validateMigrationReview()` rejects the deploy otherwise.

```sh
cp docs/production-release-review.example.json /private/release/migration-review.json
```

Fill: `commit` = `<release-sha>` (exact 40 chars; the deploy rejects any other),
`reviewedBy`, `reviewedAt` (ISO 8601), and for each of
`legacyProfileMigration`, `historicalOverlapReconciliation`,
`oldClientCompatibility`, `plaidProductionAccess`, `stripeLiveConfiguration`,
`secretManagerBindings`, `rulesAndIndexes`, `rollbackCompatibility`:
`"reviewed": true` and a nonempty `"evidence"` pointing at the artifact from
steps 1–6 (inventory digest, decision document, provider dashboard URLs, secrets
`--verify` output, rules/index diff, rollback-plan evidence line + export folder).
Do not flip a flag whose work is not done; the guard only checks the shape.

Full dress rehearsal that runs the same code path as CI, locally, without deploying:

```sh
node scripts/prepare-production-release.mjs \
  --source "$PWD" --output /private/release/rehearsal \
  --env-file /private/release/production.env --migration-review /private/release/migration-review.json
cd /private/release/rehearsal && npm ci --include=dev && \
  node scripts/production-preflight.mjs --project writeoff-23910 --config firebase.json
cd - && rm -rf /private/release/rehearsal          # it contains a copy of the env file
```

Expected: `Prepared private production release from commit <release-sha>. No deployment was performed.`
then `PASS: prepared production configuration checks; provider and rollout verification still required`
with three `PENDING:` lines (provider/Stripe/Secret-Manager reminders — they are
informational). Then upload the two files as the environment secrets in step 7.

## 10. Deploy — `workflow_dispatch`

**Satisfies:** the release itself; the run URL becomes the `--from` provenance for the next release.

Console path: `https://github.com/pratz456/TestOffwrite/actions/workflows/deploy.yml`
→ **Run workflow** → "Use workflow from": the release branch → inputs:

| Input | Value |
| --- | --- |
| `release_commit` | `<release-sha>` — the full 40-character SHA, lower-case |
| `confirmation` | `deploy:writeoff-23910:<release-sha>` — same SHA, character for character |

Or from the operator machine:

```sh
gh workflow run deploy.yml --repo pratz456/TestOffwrite --ref <release-branch> \
  -f release_commit=<release-sha> -f confirmation=deploy:writeoff-23910:<release-sha>
gh run watch --repo pratz456/TestOffwrite
```

Expected sequence in the run: "Verify manual release confirmation" passes (it
re-derives `git rev-parse HEAD` and compares) → Node from `.nvmrc` → `npm ci` →
"Materialize private reviewed release inputs" prints
`Prepared private production release from commit …` → the required reviewer
approves the `production` environment → `npm run production:deploy` runs the
preflight, builds the app and both Functions packages, reruns the preflight, then
`firebase deploy --only hosting,firestore,storage,functions --non-interactive`
→ `Production deployment command completed for commit <release-sha>.` → "Remove
private release material" always runs. Total 20–40 min (frameworks build + four
function deploys). Concurrency group `writeoff-production-deploy` serializes runs.

If the run fails **before** `firebase deploy` starts, nothing changed in
production; fix and dispatch again. If it fails **during** the deploy, some
surfaces may be updated: go straight to step 11 to see which, then decide per
step 12.

## 11. Post-deploy verification

**Satisfies:** `rulesAndIndexes.evidence` (11.3–11.4), completes `legacyProfileMigration` (11.6); confirms `secretManagerBindings` (11.5).

### 11.1 Smoke URLs (unauthenticated, from any machine)

```sh
for p in / /auth/login /auth/sign-up /auth/forgot-password /about /privacy /contact /help /help-support /welcome /tools /tools/1099-tax-calculator /blog /manifest.json; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code} %{time_total}s' "https://writeoffapp.com$p")"; done
curl -s -o /dev/null -w 'protected      %{http_code} -> %{redirect_url}\n' https://writeoffapp.com/protected
curl -s https://writeoffapp.com/api/plaid/webhook; echo
curl -s -o /dev/null -w 'plaid webhook POST no sig    %{http_code}\n' -X POST -d '{}' https://writeoffapp.com/api/plaid/webhook
curl -s -o /dev/null -w 'stripe webhook POST no sig   %{http_code}\n' -X POST -d '{}' https://writeoffapp.com/api/stripe/webhook
curl -s -o /dev/null -w 'check-access no auth         %{http_code}\n' https://writeoffapp.com/api/subscriptions/check-access
curl -s -o /dev/null -w 'ai/status no auth            %{http_code}\n' https://writeoffapp.com/api/ai/status
curl -s -o /dev/null -w 'analysis-worker no secret    %{http_code}\n' -X POST -d '{}' https://writeoffapp.com/api/internal/analysis-worker
curl -s -o /dev/null -w 'sync-internal no secret      %{http_code}\n' -X POST -d '{}' https://writeoffapp.com/api/plaid/sync-transactions-internal
curl -sI https://writeoffapp.com/auth/login | grep -i '^content-security-policy'
```

Expected: every page `200` (first request after deploy may take 3–6 s: cold
start); `/protected` redirects (3xx) to the login page; the Plaid webhook GET
returns `{"status":"healthy",…}`; both webhook POSTs without a signature return
`4xx` (never `5xx`); the four authenticated/internal routes return `401`/`403`;
the CSP header from `firebase.json` is present on `/auth/login`.

Then, in a browser: sign in with a **staff** account → dashboard loads →
`/protected/settings` → open a report PDF once (exercises `pdf-lib` on the new
instance size) → sign out.

### 11.2 SSR service

```sh
gcloud functions describe ssrwriteoff23910 --gen2 --region us-central1 --project writeoff-23910 \
  --format 'yaml(state,buildConfig.runtime,serviceConfig.availableMemory,serviceConfig.availableCpu,serviceConfig.minInstanceCount,serviceConfig.maxInstanceCount,serviceConfig.maxInstanceRequestConcurrency,serviceConfig.timeoutSeconds,serviceConfig.revision)'
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="ssrwriteoff23910" AND severity>=ERROR' \
  --project writeoff-23910 --freshness 30m --limit 50 --format 'value(timestamp,severity,jsonPayload.message,textPayload)'
```

Expected: `state: ACTIVE`, `runtime: nodejs22`, the `frameworksBackend` values
from `firebase.json` at `<release-sha>` (see `docs/PRODUCTION_SCALE_2026-09-17.md`
for the values you chose), a new revision; no ERROR lines other than known
startup noise.

### 11.3 Rules deployed

```sh
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" https://firebaserules.googleapis.com/v1/projects/writeoff-23910/releases
```

Expected: releases `projects/writeoff-23910/releases/cloud.firestore` and
`…/releases/firebase.storage/<bucket>` whose `updateTime` is after the deploy.
Compare content with the release commit:

```sh
RULESET=$(curl -s -H "Authorization: Bearer $TOKEN" https://firebaserules.googleapis.com/v1/projects/writeoff-23910/releases \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).releases.find(r=>r.name.endsWith("/cloud.firestore")).rulesetName))')
curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$RULESET" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source.files[0].content))' \
  | diff - firestore.rules && echo "firestore.rules deployed == committed"
```

Console alternative: Firestore Database → Rules → "Published" timestamp is now;
Storage → Rules likewise.

### 11.4 Indexes built

```sh
gcloud firestore indexes composite list --database '(default)' --project writeoff-23910 \
  --format 'table(name.basename(),collectionGroup,queryScope,state)'
firebase firestore:indexes --project writeoff-23910 > /private/release/indexes-after.json
```

Expected: every index `READY`. Indexes in `CREATING` are still building
(minutes to an hour on a small database); queries that need them fail with
`FAILED_PRECONDITION` until then, so do not announce until the `transactions`
collection-group indexes are `READY`. The after-file should be a superset of the
release `firestore.indexes.json`.

### 11.5 Functions, scheduler, triggers

```sh
gcloud functions list --project writeoff-23910 --regions us-central1 --v2 \
  --format 'table(name.basename(),state,buildConfig.runtime,serviceConfig.secretEnvironmentVariables[].key,updateTime)'
gcloud scheduler jobs describe firebase-schedule-syncAllUsersTransactions-us-central1 --location us-central1 --project writeoff-23910 --format 'value(state,schedule,lastAttemptTime)'
gcloud eventarc triggers list --location us-central1 --project writeoff-23910 --format 'yaml(name,destination,eventFilters)'
```

Expected: `ssrwriteoff23910`, `syncAllUsersTransactions` (secret key
`CLOUD_FUNCTION_SECRET`), `queueBankTransactionAnalysis` and
`processBankTransactionAnalysis` (secret key `ANALYSIS_WORKER_SECRET`), all
`ACTIVE` on `nodejs22`; the scheduler job `ENABLED` with `every 2 hours`; two
Eventarc triggers on `google.cloud.firestore.document.v1.written`.

Logs after the first scheduled run (or force one — it only touches connections
with `status: active`, none exist right after migration, so it is a cheap end-to-end test):

```sh
gcloud scheduler jobs run firebase-schedule-syncAllUsersTransactions-us-central1 --location us-central1 --project writeoff-23910
sleep 60
gcloud functions logs read syncAllUsersTransactions --gen2 --region us-central1 --project writeoff-23910 --limit 30
gcloud functions logs read processBankTransactionAnalysis --gen2 --region us-central1 --project writeoff-23910 --limit 30
```

Expected: `Scheduled bank synchronization completed` with `users`, `succeeded`,
`failed` counts and no `401`/`403` (a 401 means the env-file
`CLOUD_FUNCTION_SECRET` differs from the Secret Manager version). The analysis
worker log is empty until a transaction is written; after the staff sign-in
above triggers an analysis, expect no `WORKER_RETRY_REQUIRED` /
`ANALYSIS_WORKER_RETRY_REQUIRED` (secret mismatch) lines.

### 11.6 Migration actually ran

Sign in as a legacy **staff** account (one of the 11 legacy profiles that
belongs to the team), open the dashboard, then re-run the read-only inventory:

```sh
npm run production:migration-inventory -- --project writeoff-23910 \
  --output /private/release/production-migration-inventory-post-$(date -u +%Y%m%dT%H%MZ).json --confirm read-only:writeoff-23910
```

Expected: that profile shows `credentialMigrationMarked: true`,
`legacyProfileCredentialPresent: false`, `privateConnectionStates: ["relink_required"]`;
`totals.privateConnections` increased by one; `totals.legacyProfiles` decreased
by one. The UI shows the bank as "relink required" and Connect Bank works
against the new client. The `--verify` run before the deploy already proved no
profile carries a token; re-run the inventory at the end of day one to confirm.

### 11.7 Alerts armed

Monitoring → Alerting: the SSR policies now show data; the uptime check is
green. Fire a synthetic check of the notification channel (Monitoring →
Alerting → Notification channels → Send test notification) and confirm the mail
arrives at the ops alias.

## 12. Rollback trigger criteria

Decide within the first 60 minutes; after that, migrated users have started
relinking banks under the new Plaid client and a rollback to the old app makes
those connections invisible — forward-fix instead. Procedure and the
"rules and app move together" rule: `docs/PRODUCTION_ROLLBACK_2026-09-17.md`,
plan: `node scripts/production-rollback-plan.mjs --from <release-sha> --to <live-sha>`.

| Signal | Threshold | Action |
| --- | --- | --- |
| `WriteOff login page uptime check failing` | 2 consecutive failures, or any smoke page in 11.1 returns `5xx` twice | **Roll back all surfaces** (dispatch the previous `release_commit`) unless the cause is an env-file value — then fix the file, re-prepare, redeploy forward |
| `WriteOff SSR 5xx ratio > 2% (5 min)` | fires | Same as above |
| `WriteOff SSR p95 latency > 3 s (5 min)` | still firing 10 min *after* warm-up, with instance count at `maxInstances` | Not a rollback: raise `maxInstances` per `docs/PRODUCTION_SCALE_2026-09-17.md` in a forward release |
| Sign-in / dashboard | `permission-denied` for a migrated staff account, or profile load fails for every legacy user | Rules ↔ app mismatch → **roll back rules + app together**, never one of them |
| Migration | `Bank migration requires a paginated administrative cleanup` or `Bank connection ownership mismatch` in SSR logs | Not a rollback: that user is untouched; run the administrative cleanup, they retry |
| `SUBSCRIPTION_UNAVAILABLE` metric | > 5/min for 10 min, or a known Premium customer paywalled | Stripe env or webhook secret → forward fix (redeploy with corrected env); rollback does not help |
| `writeoff_worker_retry_required` metric / `WriteOff Cloud Functions error rate > 10% (10 min)` | sustained > 15 min | `ANALYSIS_WORKER_SECRET` mismatch or SSR down → fix env / SSR; tasks retry for 24 h and self-heal |
| Scheduled sync | `401` in `syncAllUsersTransactions` logs, or `WriteOff scheduled bank sync silent for 84600s` | `CLOUD_FUNCTION_SECRET` mismatch or scheduler paused → forward fix |
| `WriteOff Firestore reads > 3x 7-day baseline` | fires with no user growth | Investigate `getTransactionsServer` fan-out (scale doc); consider lowering `maxInstances`; rollback only if reads come from a new code path |
| Data integrity | any unintended write to customer records (wrong `is_deductible` stamps, deleted accounts) | **Stop**: pause the scheduler, disable the analysis functions (`gcloud functions delete` or set `AI_ANALYSIS_ENABLED=false` via forward release), then restore from PITR/export as the last resort — it discards every write since the timestamp |

Rollback dispatch inputs are the same as step 10 with `release_commit=<live-sha>`
and a review JSON pinned to `<live-sha>` in `PRODUCTION_MIGRATION_REVIEW_JSON`
(draft it now so it is minutes, not hours). Before the first pipeline release
there is no dispatchable `<live-sha>`; the plan script prints the console path.

## 13. Security-ops items that need a human

### 13.1 Reset the two accounts from the old `users.json` export

A Firebase Auth export (`users.json`, two users with `passwordHash`, `salt`,
e-mail, `providerUserInfo`) was committed in `61e18ba` ("Add project files") and
deleted in `a14b49f`. Treat both credentials as compromised even though the
project's scrypt signer key is not in the file.

1. Identify the accounts locally without printing anything else:

```sh
git show 61e18ba:users.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const u of (Array.isArray(j)?j:j.users))console.log(u.localId)})'
```

2. Invalidate the leaked password and every session, then let the owner set a
   new one (needs `roles/firebaseauth.admin` on the human identity and
   `gcloud auth application-default login` done first; run from the release
   checkout where `firebase-admin` is installed):

```sh
node -e '
const admin = require("firebase-admin"); const crypto = require("node:crypto");
admin.initializeApp({ projectId: "writeoff-23910" });
(async () => { for (const uid of process.argv.slice(1)) {
  await admin.auth().updateUser(uid, { password: crypto.randomBytes(32).toString("base64url") });
  await admin.auth().revokeRefreshTokens(uid);
  console.log(uid, "password replaced, sessions revoked"); } process.exit(0); })().catch(e => { console.error(e.message); process.exit(1); });' <uid-1> <uid-2>
```

3. Firebase console → Authentication → Users → find each account → row menu →
   **Reset password** (sends the reset e-mail through the project template).
   Tell both owners out of band why they received it. If either account is not
   a real customer (test account), **Disable account** instead.

Expected: both users must sign in again; the old password no longer works.
Record the date in the security log; this is not a release-review field.

### 13.2 Purge `users.json` from git history

**DESTRUCTIVE. Rewrites every commit on every branch, requires a force-push,
invalidates every existing clone, worktree (`/tmp/wt/*`), open PR and CI cache.
Do NOT run without the repository owner's explicit written go, and not on
release day while a deploy may be dispatched from a SHA that will change.**

```sh
# 1. Fresh mirror clone (git-filter-repo refuses to run on a used clone).
git clone --mirror https://github.com/pratz456/TestOffwrite.git /private/purge/TestOffwrite.git
cd /private/purge/TestOffwrite.git

# 2. Remove the file from all history (git-filter-repo ≥ 2.38; `pip install git-filter-repo` or `brew install git-filter-repo`).
git filter-repo --invert-paths --path users.json --force

# 3. Confirm it is gone from every ref.
git log --all --oneline -- users.json | wc -l      # expected: 0

# 4. FORCE-PUSH the rewritten history (the owner runs this, nobody else).
git push --force --mirror https://github.com/pratz456/TestOffwrite.git
```

After the push: ask GitHub Support to purge cached views and dangling commits
(they persist in the "activity" and PR views until removed); every collaborator
re-clones; recreate any long-lived branches from the rewritten SHAs; the
`release_commit` SHAs recorded in past workflow runs will no longer resolve — keep
the mapping printed by `filter-repo` (`.git/filter-repo/commit-map`) with the
release record. Rotate anything else that was ever committed alongside (the
`.env` history was already reviewed; re-run `git log --all --diff-filter=A --name-only -- '*.env*' '*.json'` and look).

## Appendix A — Node 22 runtime check (September 17, 2026)

Firebase decommissions Node 20 for Cloud Functions on **2026-10-30**. What selects the runtime here:

| Surface | Selector | Value | OK |
| --- | --- | --- | --- |
| SSR function `ssrwriteoff23910` (frameworks) | root `package.json` → `engines.node` | `"22"` | yes |
| `functions` (codebase `default`) | `functions/package.json` → `engines.node` | `"22"` | yes |
| `functions-analysis` (codebase `analysis`) | `functions-analysis/package.json` → `engines.node` | `"22"` | yes |
| Build/deploy runners | `.github/workflows/deploy.yml`, `.github/workflows/ci.yml` → `node-version-file: ".nvmrc"` | `.nvmrc` = `22.23.2` | yes |
| `firebase.json` / `firebase.staging.json` | no `runtime` key (runtime comes from `engines`) | — | yes |
| Deploy wrapper | `scripts/deploy-production-release.mjs` has **no** Node-major gate of its own (the gate described in `docs/NODE22_RUNTIME_VALIDATION_2026-09-16.md` belonged to the retired wrapper); the runner version is pinned only by `.nvmrc` in the workflow | — | note |

Remaining Node 20 mentions — none affect a deployed runtime; listed so nobody is misled (no edits made):

- **Live production** — `ssrwriteoff23910` currently runs `nodejs20` (cutover audit, 2026-09-16). This release is what moves it to 22; verify in step 11.2.
- `tools/powershell/ensure-node-20.ps1` — legacy **filename** kept for shortcuts; its contents select 22.23.2.
- `docs/LOCAL_PREVIEW_2026-09-16.md:84` — "with Node 20" in a local-preview instruction; stale, should say 22.
- `docs/PRODUCT_ROADMAP_2026-09-17.md:83`, `docs/STAGING_VALIDATION_2026-09-15.md:71`, `docs/AI_TRANSACTION_WORKER_2026-09-16.md:60`, `docs/PLATFORM_SMOKE_REPORT_2026-09-15.md` (9, 66, 70, 96), `docs/CURSOR_HANDOFF_2026-09-16.md:49`, `docs/NODE22_RUNTIME_VALIDATION_2026-09-16.md` — historical statements about earlier runs; accurate as history.
- `docs/archive/root-notes/{FIREBASE_DEPLOYMENT_TROUBLESHOOTING,NVM_FIX_INSTRUCTIONS,NVM_SETUP_COMPLETE}.md` — archived setup notes for Node 20.18.0.
- `.github/` — no `node-version: 20`; nothing to change there.

## Appendix B — release-review field → step

| Field | Produced in | Evidence to cite |
| --- | --- | --- |
| `legacyProfileMigration` | 1.3, 2, 3, 11.6 | inventory digest(s), export folder, post-deploy inventory delta |
| `historicalOverlapReconciliation` | 1.3, 3.2 | inventory digest + the human decision document |
| `oldClientCompatibility` | 3.3 | coordinated-deploy acknowledgment + support script for reload |
| `plaidProductionAccess` | 4 | Plaid dashboard: production access, redirect URI, webhook URL |
| `stripeLiveConfiguration` | 4 | Stripe dashboard: live keys, four distinct prices, live webhook |
| `secretManagerBindings` | 5, 11.5 | `production-secrets.sh --verify` output + `gcloud functions list … secretEnvironmentVariables` |
| `rulesAndIndexes` | 4, 11.3, 11.4 | rules/index diff + firebaserules release compare + `READY` index list |
| `rollbackCompatibility` | 1.4, 2.2, 12 | `production-rollback-plan.mjs` evidence line + export folder + drafted rollback review |
