# Production connections and verification: September 24, 2026

## Released application

The hardening release is live at **https://writeoffapp.com**. A controlled launch is the appropriate next step. New-bank onboarding, a new paid checkout, and production application-email delivery still need live completion checks before broad paid acquisition.

- Application commit: `a219cbe6278d788e3f8720f5ea6a6c296ebf28f1`, branch `codex/2027-tax-coverage`, repository `pratz456/TestOffwrite`.
- Firebase project: `writeoff-23910`. Vercel is not the current serving path.
- Deployment completed successfully at **19:14:49 UTC**.
- Hosting: `9c9f43597a684745`; SSR: `ssrwriteoff23910-00438-jef`; Next build: `2__I5vXNcPcerUcbTzF4u`.
- Later documentation commits describe this release without changing its deployed application hash.
- The immutable release uses the committed prepare/preflight/coordinated-deploy scripts, private environment review, and Node 22.

## Changes in this release

### Sign-in and app updates

Email sign-in reuses supported Firebase persistence instead of unconditionally requiring local storage. The integrity-checked Firebase adapter patch prevents expired app reuse, concurrent initialization races, and deletion of apps still serving requests. Authentication checks remain enforced.

Service-worker updates and network recovery no longer reload pages automatically. An explicit Refresh action lets people finish their current step. The final browser check applied it and retained owner-account access. The logo loaded from its static asset.

### Bank records and AI

Restored transactions clear removal state atomically while preserving confirmed categories, decisions, receipts, and notes. Removed, pending, or superseded records cannot enter the AI queue or receive a late analysis result. Manual and background analysis share lease-validity protection.

The completed legacy migration moved bank secrets to encrypted server-only records. Before/after verification preserved accounts, transactions, and saved tax decisions. **Do not rerun the migration.** Legacy credentials are never sent to the replacement Plaid account.

Owners with old history use `/plaid/reconnect`. Replacement records stay private until account mapping and duplicate/distinct/defer review. Confirmed records remain intact; deferred records stay outside tax totals. Activation requires completed history retrieval and resolved decisions. Persistent account/date boundaries protect subsequent backfills. See [guided reconnect](PLAID_GUIDED_RECONNECT.md).

### Billing and access

Pending, unpaid, and trial subscription recovery goes to billing instead of duplicate checkout. Canceled Basic accounts can resubscribe. Manage billing opens Payment settings. Customer/subscription ownership is checked before billing cleanup during account deletion. Stripe requests use bounded retries and timeouts.

Basic retains its existing price and extended history. Reports and exports require Premium. Pending asynchronous payments do not grant Premium or replace a settled plan. The owner's Premium state and Payment settings loaded correctly after deployment.

### Deployment safety

CI covers every pull request and `codex/**` push without production provider secrets, uses read-only repository access, and checks fresh installs, runtime audits, lint, tests, isolated web build, TypeScript, and both workers.

Serving existing static branding directly prevents Firebase's generated SSR package from injecting an outdated image dependency. The actual final generated runtime has **zero high/critical audit findings; nine moderate findings remain**. Next's maintained image dependency and the authentication patch remain present. This does not claim the image optimizer endpoint is disabled.

Throttle-record TTL is declared in source so deployments preserve it. No TTL applies to financial records.

## Provider status

| Connection | Verified | Remaining boundary |
| --- | --- | --- |
| Firebase | Fresh production Google login; 19 password/session lifecycle checks on a disposable fixture; final owner dashboard, Premium state, Payment settings and logo. Seven ACTIVE functions, 47 READY indexes, matching rules, two enabled schedules. | Fixture verification was set through Admin for session testing. It does not prove verification/reset inbox delivery. Fixture was deleted. |
| OpenAI | Shared server key. GPT-4.1-mini transactions, GPT-4o assistant/documents, GPT-4o-mini voice. Candidate-key probes passed; real production transaction analysis returned 200 in 5.4 seconds and requested missing business-purpose facts. Successful model analysis requires a model call. | Connectivity and workflow evidence do not certify every tax conclusion. Confirmed decisions were preserved. |
| Plaid | Approved new production account, Transactions access, OAuth return, signature-verified webhook, encrypted credentials and extended-history request. Production Link-token creation and guided reconnect page passed. | New institution login/MFA, exchange, imported history, subsequent sync and genuine Plaid webhook still need one complete production run. No new bank consent was accepted by the agent. |
| Stripe | Payments, payouts and ACH Direct Debit Active; no active account tasks. Existing paid subscription matches access; prices and portal verified. Two genuine automatic subscription-update webhooks returned 200, with a processed deduplication receipt. | No new purchase, charge, cancellation, refund or ACH settlement submitted. Existing events do not establish a new checkout lifecycle. |
| Resend | Existing key and verified sender domain. Support reports success only after a provider message ID. Bounded delivery, idempotency, reply-to checks and durable rate limiting tested. | Production support/verification/reset inbox tests await the separately requested authorization. |

Operational alert email is separate from application email. Critical alerts to `writeoffapp@gmail.com` were explicitly authorized. A test alert reached that inbox; its temporary policy and metric were then removed.

## Exact-release validation

- **6,088 tests passed**, 236 files passed; **48 opt-in tests skipped** in six files. Skips cover live AI, rules emulator, Plaid migration emulator, and bank-restoration emulator groups. The default configuration also excludes a real-database transaction-update test.
- Separately: 19 rules-emulator checks, 59 reconnect security assertions, and three actual Firestore restoration/concurrency/withdrawal emulator tests passed. Rules remained unchanged after their checks.
- TypeScript passed. Lint: **zero errors, 1,023 warnings**.
- Hosted GitHub [PR CI](https://github.com/pratz456/TestOffwrite/actions/runs/36045712200) and [push CI](https://github.com/pratz456/TestOffwrite/actions/runs/36045708138) both passed on the exact application commit.
- App and both worker source runtime audits: zero high/critical findings; moderate findings remain. The actual generated SSR package was independently audited.
- **27/27 independent release checks passed**: uploaded SSR archive matches 46 expected environment values and exact private bytes, all 1,269 compiled Next files, and all 213 Hosting assets. Worker source/locks, adapter tarball/hash, rules, schedules, secret references and three field overrides match. Scoped TTL is ACTIVE.
- Current Hosting tag is the sole remaining tag and points to the current revision; 100% traffic serves the current release. Old tags were removed after deployment.
- **13/13 public HTTP/authentication/signature smoke checks passed at 19:16:54 UTC** after final deployment. The synthetic signed unhandled Stripe probe is distinct from separately observed genuine provider deliveries.
- Final owner browser check passed dashboard, Premium state, Manage billing routing to `?tab=payment`, and logo loading. Captured warnings/errors were attributable to installed browser extensions, not WriteOff.
- Scanning all 213 generated public assets found no exact matches for the nine configured private credential values checked. This is a scoped check, not universal proof of absence of secrets.

Verification covers uploaded artifacts and provider state, not direct inspection of the running container filesystem. Private reviews, backups, hashes and provider readbacks remain outside the repository.

## Recovery and monitoring

- Firestore point-in-time recovery and delete protection enabled; daily managed backup schedule configured with 14-week retention. First scheduled backup completion has not yet been observed.
- A saved pre-cutover export restored **5,615 documents in approximately 85 seconds** into a separate deny-all database. Anonymous and authenticated reads were denied; structural validation passed. Temporary database, test Auth fixtures and exact rule artifacts were deleted. Source backup remained unchanged; production database remained present. This proves exported-data recovery, not full Auth/Storage/application failover.
- Five alert policies cover regional availability, SSR errors, background errors, absent sync completions and excessive age of unacknowledged analysis messages. Inbox delivery was verified. Transport-age monitoring does not cover every silently acknowledged stalled job.
- One normal scheduled-sync run completed and produced its monitored heartbeat. It found zero eligible bank owners, so it does not prove a fresh bank import.

See [operations and recovery evidence](PRODUCTION_LAUNCH_OPERATIONS_2026-09-24.md) for thresholds, resource identities and limits.

## Remaining launch gates

1. Owner completes bank consent and institution login/MFA in the prepared reconnect screen. Then verify mapping, imported history, automatic AI processing, subsequent sync and provider webhook.
2. Observe a new paid checkout and entitlement update when the owner elects to transact; also observe asynchronous settlement/failure before relying on live ACH behavior.
3. Complete the already-requested production support/verification/reset inbox checks after authorization.
4. Begin with a controlled cohort and observe workload, errors and support needs. Mass-acquisition load testing has not been performed.

Automatic filing remains disabled. Exports/preparer packages are review records, not complete IRS-fileable returns. Missing facts and ambiguous income overlap block incomplete estimates. Unpublished 2027 annual figures remain pending; no claim of every tax situation being covered is made.

## Rollback and maintenance

SSR retains `minInstances: 0` for Firebase Hosting pinned-revision compatibility; cold starts may add latency. Once a reconnect session activates, rollback to the old importer is unsafe because it lacks the historical boundary. Prefer a compatible forward fix. Otherwise quiesce writers, fence reconnect Items or backport compatible handling, preserve cursors and subsequent writes, and retain the exact encryption key and recovery records. Never rerun the completed migration or restore an old snapshot over new records.

Maintain the adapter through its [integrity and regression procedure](../vendor/firebase-frameworks/README.md). Re-audit the generated deployment tree when Firebase CLI or Next.js packaging changes.
