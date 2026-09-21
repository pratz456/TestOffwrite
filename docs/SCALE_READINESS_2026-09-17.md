# Scale readiness: hot-path inventory, fixes and cost controls

Date: 2026-09-17. Branch: `cursor/t2-perf-b231`. Scope: Next.js 15 App Router on Firebase Hosting SSR
(`firebase.json` frameworksBackend: `1GiB`, `timeoutSeconds: 60`, `concurrency: 80`, `maxInstances: 2`,
`minInstances: 0`, `us-central1`), Firestore, Cloud Functions (`functions/` scheduled sync,
`functions-analysis/` Firestore triggers), OpenAI.

Notation used below: `N` = a user's transaction documents, `A` = bank accounts, `C` = Plaid connections,
`J` = analysis jobs (one per account), `T` = tax-year records (a few per year), `M` = mileage trips,
`R` = receipts. "CG" = collection-group query on `transactions`. Read/write counts are Firestore billed
document operations per request unless noted; `count()` aggregations are billed one read per 1,000
index entries scanned.

## 1. Summary of findings (ranked by impact at 100k-1M users)

1. Full-scan owner reads on the dashboard path. A dashboard open performs roughly `5N` reads:
   the realtime `useTransactions` listener (client SDK, unbounded `or(userId, user_id)` query),
   `GET /api/transactions`, `GET /api/monthly-deductions`, `GET /api/tax-savings` and
   `GET /api/transactions/analysis-status` each read every transaction the user owns. React Query
   staleTime (2-5 min) bounds repeats per tab, not per visit. Mitigations shipped: cursor paging for
   `GET /api/transactions`, field projection for the two aggregate routes (payload/memory only; read
   count is unchanged). Structural fix still needed: a per-user summary document (section 9).
2. Report/tax endpoints read every transaction three times. `readOwnedTransactions` runs two owner
   CG queries plus a per-account walk and dedupes by path, so `compute-1040`, `form-1040`,
   `schedule-c/export`, `schedule-se`, `quarterly-reminders`, `profit-loss`, `generate-pdf`,
   `reports/export`, `audit-support`, `export-csv` and `user/export` each cost `A + 3N` reads and hold
   three copies of every document in memory before PDF/CSV generation. This is the dominant SSR memory
   and 60 s timeout risk (section 4.2).
3. Plaid sync is a sequential N+1 write loop: per saved transaction about 4 reads, 2 writes and a lease
   heartbeat transaction, each awaited in turn (about 5 round trips per transaction). A 1,500-row
   initial import is 7,000+ sequential Firestore round trips inside a 60 s SSR request (section 5.1).
4. `deleteUserData` was one query away from failing: the `firestore.indexes.json` overrides for
   `transactions.userId` / `transactions.user_id` listed only `COLLECTION_GROUP` entries, which
   removes the automatic collection-scope single-field indexes, and `deleteUserData` runs
   `collection('transactions').where(owner, '==', uid)` with errors propagating. Fixed by restoring the
   collection-scope entries (section 7).
5. `GET /api/transactions/paginated` accepted 16 sort/filter combinations of which 4 were indexed;
   the others failed with `FAILED_PRECONDITION`. Fixed by indexing the matrix; the route has no
   first-party caller and the extra indexes have a storage cost (section 7).
6. Scheduled Plaid sync processed every user serially with no time budget or resume marker; past
   roughly 500 users it could not finish inside 540 s. Fixed (section 6.4).
7. Notification jobs iterated all `user_profiles` with unbounded `.get()` calls and ran N+1
   per-account queries per user. Fixed with cursor paging (200/page), a time budget and
   collection-group / aggregation queries (section 6.3). None of these jobs is scheduled in this repo
   yet.
8. Every API request performs an Identity Toolkit `GetAccountInfo` call because
   `getAuthenticatedUser` passes `checkRevoked = true`. Firebase Authentication limits are
   500 requests/s per service account and 1,000/s per project (10M/day), and the SSR backend uses one
   service account, so total API throughput is capped near 500 req/s regardless of instance count.
9. `GET /api/subscriptions/check-access` reads the profile three times and calls
   `stripe.subscriptions.retrieve` on every request for subscribed users. Stripe live-mode read
   limits (100/s by default) become the ceiling for dashboard loads well before Firestore does.
10. OpenAI spend is the dominant variable cost, one to two orders of magnitude above Firestore for
    the same transaction volume (section 8). The lease/hash design prevents concurrent duplicate
    billing; sequential re-analysis of an unchanged transaction is still possible through
    `POST /api/ai/analyze-transaction`.

## 2. Data model and expected document counts

Assumptions (typical U.S. freelancer/SMB user): 2 bank connections, 3-4 accounts, about 120 posted
transactions per month, 2 years of history retained (median `N` about 3,000; p95 about 10,000; p99
about 25,000), one durable analysis task per transaction, receipts on about 5% of transactions.

| Collection (path) | Per user (median) | 1k users | 100k users | 1M users | Written by |
| --- | --- | --- | --- | --- | --- |
| `user_profiles/{uid}` | 1 | 1k | 100k | 1M | profile, billing, sync status |
| `user_profiles/{uid}/accounts/{id}` | 4 | 4k | 400k | 4M | Plaid link, manual/import accounts |
| `.../accounts/{id}/transactions/{id}` | 3,000 | 3M | 300M | 3B | Plaid sync, manual, receipts, worker |
| `analysis_tasks/{sha256}` | 3,000 (one per analyzed transaction, retained) | 3M | 300M | 3B | analysis queue |
| `analysis_jobs/{uid}_{accountId}` | 4 | 4k | 400k | 4M | analysis queue |
| `receipts/{id}` | 150 | 150k | 15M | 150M | receipt upload |
| tax-year records (`w2_income`, `income_1099`, `gross_receipts`, `tax_deductions`, `tax_organizers`, `form_8879`, `income_reconciliations`) | 20 | 20k | 2M | 20M | tax routes |
| `user_profiles/{uid}/{mileage_trips,quarterly_payments,assets,settings,stripe_sync,recurring_transactions}` | 80 | 80k | 8M | 80M | settings, mileage, Plaid recurring |
| `notifications/{id}`, `notification_preferences/{uid}` | 100/yr | 100k | 10M | 100M | notification engine |
| `plaid_connections/{itemId}`, `processed_webhooks/{id}`, `stripe_events/{id}` | 2 + about 500/yr | 500k | 50M | 500M | Plaid/Stripe webhooks |
| `user_corrections/{id}`, `cpa_questions/{id}`, `rate_limits/{id}` | 60 | 60k | 6M | 60M | review, CPA, limiter |
| Total documents | about 6,400 | about 6.9M | about 690M | about 6.9B | |

Storage: a transaction document with AI fields is 2-3 KiB (the suggestion is stored three times:
`ai_suggestion`, `ai`, and flattened `ai_*` fields). At 1M users that is 6-9 TiB of documents. Each
composite index on `transactions` adds roughly 100-300 B per document; with 29 composite indexes on the
collection group (17 before this branch, 12 added for the paginated sort matrix), index storage exceeds
document storage. See section 7 for pruning guidance.

Where costs concentrate:

- Reads: dashboard opens (`5N`) and report generation (`A + 3N`). At 100k users, one dashboard open per
  active user per day with median `N` is about 1.5B reads/day. Everything else is small multiples of `A`
  or `T`.
- Writes: per new transaction about 2 writes (sync) + 3 (enqueue) + 4-5 (claim, lease, suggestion, task
  status, job progress) = about 10 writes and 4 Firestore-trigger invocations (two of them make an
  internal HTTPS call). At 100k users and 120 transactions/month: about 120M writes and 48M function
  invocations per month.
- Model calls: one `gpt-4o-mini` call per transaction revision (two on a retryable failure). At 100k
  users: about 12M calls/month. This is the line item that dominates the bill.

## 3. Runtime envelope and platform ceilings

- SSR backend: `maxInstances: 2` x `concurrency: 80` = 160 concurrent requests for the whole API and
  page surface; `minInstances: 0` adds cold starts after idle. This is hosting configuration and is
  out of scope for this branch, but it is the first hard ceiling at 100k users (a few thousand daily
  actives with 10+ requests per dashboard open saturate it at peak).
- 1 GiB per instance is shared by up to 80 concurrent requests. Any single request that holds `3N`
  transaction documents (about 2.5 KiB raw, 3-4x as JS objects) uses roughly `N x 25 KiB`: 40 MiB at
  the median, 250 MiB at p95, 600 MiB at p99. Two p95 report requests on one instance plus PDF
  generation is an OOM risk.
- 60 s per request: sequential Firestore round trips cost 10-20 ms each from `us-central1`; anything
  above about 3,000 sequential awaits cannot finish.
- Identity Toolkit: `verifyIdToken(token, true)` / `verifySessionCookie(cookie, true)` on every
  request = one `GetAccountInfo` per API call (500/s per service account, 1,000/s per project).
- Firestore: the one-sustained-write-per-second-per-document guideline matters for
  `user_profiles/{uid}` (sync progress flags, `last_sync`, scheduled-sync status, billing and trial
  writes all land on the same document) and for `analysis_jobs/{uid}_{accountId}`, which every finished
  task updates inside a transaction (contention retries when several workers finish the same account
  at once). The 10 MiB commit size bounds `mark-personal` (one batch for a whole account). The 200
  composite index limit is at 47/200 after this branch.

## 4. API route inventory

Auth cost (every authenticated route): token/cookie verification with revocation check (1 Identity
Toolkit RPC, no Firestore). Routes using `enforceRateLimit` add one Firestore transaction (1 read, 1
write) on `rate_limits`. `requireFeatureAccess` adds 1 profile read. Indexes: "single" means only
automatic single-field indexes are needed; otherwise the composite index is named (all present in
`firestore.indexes.json`, verified by `tests/firestore-indexes.test.ts`).

### 4.1 Transactions

| Route | Reads | Writes | Indexes | N+1 / unbounded | Memory / time (1 GiB / 60 s) |
| --- | --- | --- | --- | --- | --- |
| `GET /api/transactions` | 1 CG query: `N` (or `limit`+1 when paging). Zero-transaction user: 2 CG + `A` (per-account fallback). Before this branch: four unconditional queries (two top-level `collection('transactions')` owner queries, which failed silently under the index override, plus both collection-group owner queries) merged by id, i.e. `N` to `2N` reads depending on how many rows carry both owner fields, then the same merge for `monthly-deductions`, `tax-savings`, `analysis-status`, `receipts/process`, `database/transactions` | 0 | single (`userId`/`user_id` CG override); paging: `userId+date DESC`, `user_id+date DESC` | Unbounded without `limit` (legacy contract kept); `limit<=500` + cursor now available | Full read holds `N` docs; 25k rows about 600 MiB peak, several seconds |
| `GET /api/transactions/paginated` | 1 `count()` aggregation (1 read/1,000 entries) + `offset` projected reads + `limit` (<=100) reads. Before: `N` reads for the total | 0 | `userId[+is_deductible]+{updated_at,date,amount,merchant_name} ASC/DESC` (16) | Offset paging bills skipped rows; page depth should stay small | Bounded |
| `GET/PUT /api/transactions/[id]` | 1-2 CG lookups (`limit 1`); on a miss the fallback reads `A` accounts and then every transaction of every account (`A + N`) before returning 404. PUT adds `user_corrections` reads (learning engine) | PUT: 1 update + 1 correction write | `userId+trans_id`, `user_id+trans_id`; `user_corrections userId+timestamp DESC` | Fallback is an unbounded full scan on misses (404 costs `N` reads; abusable) | p99 users: 600 MiB on a miss |
| `POST /api/transactions/[id]/review` | transaction: account + transaction docs | 1 update; invalidates taxpayer-context memo | none | none | Bounded |
| `POST /api/transactions/manual` | 1 | 1-2 | none | none | Bounded |
| `POST /api/transactions/reset-unreviewed-classifications` | `A + N` | up to `N` updates in 450-op batches | none | Full scan by design | 25k rows several seconds; safe batching |
| `GET /api/transactions/export-csv` | `A + 3N` (`readOwnedTransactions`) | 0 | single | Three copies of every row; CSV built in memory, no streaming, no row limit | Highest memory per read; p95 user about 250 MiB |
| `GET /api/transactions/analysis-status` | `J` (`analysis_jobs where userId`) + `N` (`getTransactionsServer`) | 0 | single | Full scan to compute counts | Same as `GET /api/transactions` |
| `POST /api/transactions/apply-learning`, `GET /api/analysis-job`, `GET/POST/PUT /api/analysis-status` | 0-10 (`limit 10`) | <=1 | `analysis_status userId+created_at DESC` | none | Bounded |
| `POST /api/fix-transaction-analysis`, `POST /api/migrate-ai-analysis` | `N` | up to `N` sequential updates (`for ... await`) | single | N+1 writes | > about 2,500 rows cannot finish in 60 s |
| `GET/POST /api/database/transactions` | `N` / 1 | 0 / 1 | single | Full read | As `GET /api/transactions` |
| `GET /api/debug/transactions`, `GET /api/debug/transaction-status` | `A + N` per call | 0 | `account_id+user_id` CG | Full scans | Debug routes; should be admin-gated or removed |

### 4.2 Aggregates, tax computation and reports

| Route | Reads | Writes | Indexes | N+1 / unbounded | Memory / time |
| --- | --- | --- | --- | --- | --- |
| `GET /api/monthly-deductions`, `GET /api/tax-savings` | 1 profile + 1 CG query = `N` reads, now projected to 3-4 fields | 0 | single | Full scan (aggregation in process) | Projection cuts payload about 10x; read count unchanged |
| `GET /api/tax/compute-1040`, `POST /api/tax/form-1040` | `readTaxExportTransactions` (`A + 3N`) + 5 tax-year queries (2 with `limit 1`) + profile + assets subcollection + 4 quarterly payments + reconciliation decisions (which re-read `gross_receipts` and `income_1099`), all in `Promise.all` | 0 | `userId+taxYear` on each tax-year collection | `3N` full scan; duplicate tax-year reads | `3N` copies; PDF (form-1040) on top |
| `POST /api/tax/schedule-c/export`, `GET /api/tax/schedule-c/calculate`, `GET /api/tax/schedule-se/auto`, `GET /api/tax/quarterly-reminders` | `A + 3N` + 3-6 tax-year queries + profile (quarterly-reminders invokes the `compute-1040` handler for the annual figures, then adds 2 `limit 1` queries, the profile and 4 payment docs) | 0 | `userId+taxYear` | `3N` full scan | Same |
| `POST /api/reports/profit-loss`, `POST /api/reports/generate-pdf`, `POST /api/reports/export` | `A + 3N` (+ home-office/assets docs) | 0 | single | `3N`; PDF in memory | Same |
| `GET /api/reports/audit-support` | `A + 3N + M + 2R` (receipts queried by both owner fields) | 0 | single | `3N` + receipts twice | Same plus receipt metadata |
| `GET/POST /api/user/export` | profile + `A + 3N + 2R` + 6 top-level collections x 2 owner fields + 4 profile subcollections | 0 (rate limit 1/hour, 12 attempts/hour) | single | Largest single request in the app | Zip built in memory; p95 user is the OOM edge |
| `GET/POST/DELETE /api/income/*`, `/api/tax/{deductions,organizer,form-8879,year-lock,filing,quarterly-payments}` | 1-4 small queries (`userId+taxYear`, often `limit 1`) | <=1 transaction | `userId+taxYear` | none | Bounded |
| `POST /api/tax/import-document`, `POST /api/tax/import-bank-statement` | 1 duplicate-W-2 lookup (`userId+taxYear+employerEIN`) / 1 account transaction | rows in 400-op batches (`<=500` rows) | `w2_income userId+taxYear+employerEIN` | none | OpenAI `gpt-4o` vision call per document |
| `GET/POST /api/settings/*`, `GET/POST/DELETE /api/mileage*` | 1-`M` reads (`mileage_trips` full collection, no limit) | 1 | single | `mileage_trips` unbounded (small per user) | Bounded in practice |

### 4.3 AI

| Route | Reads | Writes | External | Duplicate-billing controls |
| --- | --- | --- | --- | --- |
| `POST /api/ai/analyze-transaction` | rate-limit tx (1) + 1-2 CG owner lookups (`limit 1`) + lease tx (1) + profile (1) + taxpayer context (memoized per uid for 60 s; miss = 1 CG query `<= 500` reads or `A` + `<= 150 x A` fallback) + home-office doc | rate limit (1), lease (1), suggestion or release (1) | 1-2 `gpt-4o-mini` calls | Lease (`ANALYSIS_LEASE_MS` 240 s) returns 409 to concurrent callers; 60/hour/uid limiter; no check that an identical revision was already analyzed (section 8) |
| `POST /api/internal/analysis-worker` (enqueue) | tx: account, transaction, task, job (4) | task, job, transaction (3) | none | Task id = sha256(owner, account, transaction); active task + same `inputHash`/`inputRevision` = no new task |
| `POST /api/internal/analysis-worker` (process) | task (1) + claim tx (5) + taxpayer context (memo) + finalize tx (3) | claim: task + lease (2); finalize: task + transaction + job (3) | 1-2 `gpt-4o-mini` calls | Generation + lease token + input hash rechecked before persisting; `MAX_ATTEMPTS` 3 |
| `POST /api/plaid/auto-analyze` | account + `N_account` transactions + 4 reads per row (enqueue tx) | up to 3 per row | none | Sequential per row; `N_account` > about 1,500 cannot finish in 60 s |
| `POST /api/ai/tax-assistant`, `POST /api/ai/parse-voice-command` | 0 | 0 | 1 `gpt-4o` / `gpt-4o-mini` call | Per user action; no Firestore rate limit on these two routes |
| `POST /api/cpa-question`, `GET /api/cpa-question` | 0 / `cpa_questions where userId orderBy createdAt` (unbounded, small) | 1 | none | none |

### 4.4 Plaid, billing, account lifecycle

| Route | Reads | Writes | External / notes |
| --- | --- | --- | --- |
| `POST /api/plaid/sync-transactions` (full import) | profile + `C` connections + per saved transaction: lease heartbeat tx (1), account (1), existing doc (1), `createTransactionServer` existence check (1) | profile 2 + per transaction: heartbeat (1) + create (1) | Plaid `transactionsGet` paged; sequential loop; 1,500 rows = about 7,500 round trips; exceeds 60 s |
| `POST /api/plaid/sync-transactions-internal` (scheduled) | same per-row cost over `added + modified`; `removed` rows: `A` account reads + 1 query each | same | Called by the Cloud Function with a 90 s fetch timeout; SSR still caps at 60 s |
| `POST /api/plaid/exchange-public-token` | connection + link-operation docs | connection + profile + initial incremental sync (as above) | Plaid exchange |
| `GET /api/plaid/items`, `GET /api/plaid/accounts`, `GET /api/plaid/import-status` | `C` + legacy migration check (1) [+ profile] | 0-1 | `accounts`: Plaid `accountsGet` per connection |
| `POST /api/plaid/refresh-balances`, `POST /api/plaid/recurring-transactions` | `C` | `A` updates / `S` deletes + `S` sets (per stream, sequential) | Plaid calls per connection |
| `POST /api/plaid/webhook`, `POST /api/stripe/webhook` | 1 dedupe doc + connection / 1 profile | 1-3 | Signature verification; idempotency docs |
| `GET /api/subscriptions/check-access` | profile x3 + `stripe_sync/state` + trial start tx | trial start (<=2) + reconcile tx (<=3) | `stripe.subscriptions.retrieve` on every call for subscribed users (Stripe 100 reads/s live) |
| `POST /api/stripe/*` | 1-2 profile | 0-1 | Stripe API; 10/10 min limiter |
| `DELETE /api/user/delete` | 3 connection queries + `deleteQueryBatch` over about 20 collection/owner-field pairs (500/batch) | deletes everything owned | Now depends on the restored collection-scope single-field indexes for `transactions` |
| `GET /api/support/account/[uid]` | 8 parallel reads incl. `analysis_tasks where userId limit 100` | 1 audit write | Admin only; 60/10 min limiter |
| `POST /api/accounts/[accountId]/mark-personal` | `N_account` | one batch with `N_account` merges (single commit; 10 MiB bound) | Should batch in <=450 ops like `reset-unreviewed-classifications` |
| `GET /api/accounts`, `GET/POST/PUT/DELETE /api/database/accounts` | `A` / DELETE: 4 owner queries (CG + top-level, both owner fields) + batched deletes | `N_account` deletes | Indexed (`account_id+userId`, `account_id+user_id`, both scopes) |
| `GET /api/receipts/[filename]`, `POST /api/upload-receipt`, `POST/PUT /api/receipts/process` | 1 / 1 / 1-2 + `N` when matching against `getTransactionsServer` | 1 / 1 / 1-3 | OCR provider; storage upload; 60/10 min limiters |

## 5. Background jobs

### 5.1 `functions/src/index.ts` `syncAllUsersTransactions` (every 2 hours, 540 s, `maxInstances 1`)

Before: one `plaid_connections where status == 'active'` query (`select` projection), then a serial loop
over every user calling `/api/plaid/sync-transactions-internal` with a 90 s fetch timeout and two
profile writes per user; no time budget, no resume marker. Worst case one user = 90 s, so about six slow
users exhausted the run and every later user was never reached.

After (this branch): `runWithConcurrency(users, 5, ...)` with `withTimeout(100 s)` per user,
`createTimeBudget(480 s)` gating each start (a user only starts if it can finish inside the budget),
deterministic order (`orderFromCursor`), and a progress marker in
`scheduled_jobs/plaid_transaction_sync` (`cursor`, `lastRun` stats). Coverage per run is bounded by the
downstream SSR route, not by the function: with a typical 5-15 s per user, one run covers roughly
150-450 users; at 100k connected users a full pass takes many runs, which the cursor now supports but
which also means each user is synced far less often than every 2 hours. Plaid webhooks remain the
primary path; the scheduled job is the retry net. Recommendation: fan out to Cloud Tasks (one task per
user) once connected users exceed a few thousand.

Firestore cost per run: 1 query (`C_active` reads) + 1 state read + 3 writes per started user +
1 state write.

### 5.2 `functions-analysis/src` triggers

- `queueBankTransactionAnalysis`: `onDocumentWritten` on every transaction document. It fires for every
  worker status write as well (lease, suggestion), each filtered out cheaply by `shouldQueueBankWrite`
  but still billed as an invocation: about 4 invocations per analyzed transaction, 2 of which make an
  internal HTTPS call (90 s timeout, `retry: true`, `maxInstances 2`, `concurrency 2`).
- `processBankTransactionAnalysis`: `onDocumentWritten` on `analysis_tasks`; only `queued` with a new
  `generation` proceeds. Eventarc retries any non-2xx (busy lease, backoff, transient failure) with its
  own backoff for up to 24 h; the bridge drops events older than 23 h.
- Throughput ceiling: `maxInstances: 2` x `concurrency: 2` = 4 concurrent worker calls, each 5-30 s
  (OpenAI). That is roughly 10-40 analyses/s at best, about 1-3M per day. A 100k-user initial-import
  burst (12M transactions/month, bursty on signup) queues for hours; the durable task design tolerates
  that, but `analysis_status` UI will show long "pending" periods. Raising `maxInstances` is a
  deployment setting and is not changed here.

### 5.3 `lib/notifications/notification-engine.ts`

Before: four generators each did `collection('user_profiles').get()` (or an inequality filter without
limit), then per user listed accounts and queried each account's transactions (N+1), reading full
documents to count. After: `runUserProfileBatch` pages `user_profiles` with `limit 200` ordered by
`(filterField?, __name__)`, resumes from an opaque cursor, stops at a time budget (default 50 s) and
isolates per-user failures. Per-user work is now one aggregation (`count()` on
`userId+analysis_status`), one `limit 1` existence query (`userId+category+date DESC`), or one bounded
date-window query (`userId+is_deductible+date DESC`, `limit 2000`). Cost per page: 200 profile reads +
1-3 small queries per user + 1 notification write per hit. These generators are not wired to any
scheduler in this repository; when scheduled, feed the returned `cursor` back into the next invocation.

### 5.4 Webhooks

`POST /api/plaid/webhook` and `POST /api/stripe/webhook` are idempotent via `processed_webhooks` /
`stripe_events` documents (1 read + 1-3 writes). Both bypass auth but sit behind signature verification
and the middleware cache policy. Growth of `processed_webhooks` is linear in webhook volume and nothing
prunes it; consider a TTL policy (`fieldOverrides` with `ttl: true`).

## 6. Fixes shipped on this branch

All changes preserve response shapes and semantics for existing callers.

### 6.1 (a) `getTransactionsServer` short-circuit, paging, projection

`lib/firebase/transactions-server.ts`: the strategy chain is `collectionGroup(userId)` ->
`collectionGroup(user_id)` -> per-account walk, and returns at the first strategy that yields data
(a collection-group query already covers top-level `transactions`, so the old duplicate top-level
strategies were removed). New `options`: `limit` (<= `MAX_TRANSACTIONS_PAGE_SIZE` = 500) with an opaque
`cursor` (`date` + document path, ordered `date DESC, __name__ DESC`) returned as `nextCursor`, and
`fields` projection (identity fields always included). `GET /api/transactions` accepts `limit` and
`cursor` and returns `nextCursor`; without `limit` it behaves exactly as before.
`getPaginatedTransactionsServer` uses a `count()` aggregation for `totalCount` and a projected skip
query for `startAfter`. `monthly-deductions` and `tax-savings` request only the fields they aggregate.
Response headers: `Cache-Control: private, no-store`.

Short-circuit trade-off: the previous implementation merged the `userId` and `user_id` result sets. Every
current writer (`createTransactionServer`, manual entries, receipts, document import, Plaid sync) sets
`userId` only, so `user_id` is a legacy field and the fallback query now runs only when a user has no
`userId` rows at all. A user who still holds legacy `user_id`-only rows next to modern rows would see
only the modern rows in the transaction list (reports and exports are unaffected: `readOwnedTransactions`
still merges both owner fields with the per-account walk). If production still contains such mixed
users, a one-time backfill that sets `userId` on `user_id`-only rows (listable with the
`collectionGroup('transactions').where('user_id', '==', uid)` query) restores the union at no read cost
per request.

### 6.2 (b) Taxpayer context confirmed-history reads

`lib/ai/taxpayer-context-server.ts`: one collection-group query
(`userId == uid, review_status == 'confirmed', orderBy date desc, limit 500`) with a fallback to
per-account reads capped at `CONFIRMED_PER_ACCOUNT` = 150 when the index is missing or legacy rows lack
`userId`. Results are memoized in process per uid for `CONFIRMED_HISTORY_TTL_MS` = 60 s (LRU, 256
entries, failed loads are not cached), so a batch of tasks for one user reads the history once per
instance per minute. `reviewTransaction` (`lib/transactions/review.ts`) calls
`invalidateTaxpayerContextCache(uid)` after a confirmation/correction commits. Composite index
`transactions userId+review_status+date DESC` added.

### 6.3 (c) User-profile iteration jobs

`lib/notifications/user-profile-batch.ts` (`runUserProfileBatch`, `USER_PROFILE_PAGE_SIZE` = 200,
`DEFAULT_BATCH_TIME_BUDGET_MS` = 50 s, opaque `encodeBatchCursor`) and the rewired generators in
`notification-engine.ts` (section 5.3). No other "iterate all user_profiles" job exists in `app/`,
`lib/` or `functions*/`; the scheduled sync iterates `plaid_connections` and is covered by 6.4.

### 6.4 (d) Scheduled sync concurrency, timeouts, budget, cursor

`functions/src/scheduler.ts` (pure helpers: `runWithConcurrency`, `withTimeout`, `createTimeBudget`,
`orderFromCursor`, `nextCursor`), constants in `functions/src/sync-config.ts`
(`SYNC_CONCURRENCY` 5, `PER_USER_TIMEOUT_MS` 100 s, `RUN_TIME_BUDGET_MS` 480 s,
`SYNC_FUNCTION_TIMEOUT_SECONDS` 540), the rewired `syncAllUsersTransactions`, and a
`firestore.rules` block closing `scheduled_jobs/*` to clients. Retry (`retryCount: 1`) is requested
only when a started user failed, not when users were merely deferred to the next run.

### 6.5 (e) Cache-Control

`middleware.ts` sets `Cache-Control: private, no-store` on every `/api/*` response on both middleware
branches (including the early-return webhook/internal branch). Next.js 15.5 applies `next.config`
`headers()` and middleware response headers as a baseline (`res.setHeader`, middleware wins on the
same key) and appends route-handler headers (`res.appendHeader`), so a route can add but not remove
the directive. `next.config.ts` already sent `no-store, no-cache, must-revalidate` for `/api/(.*)`
without `private`; both are now present. Explicit headers were also added to `transactions`,
`monthly-deductions` and `tax-savings`. `GET /api/transactions/paginated` still sets
`private, max-age=60`; because the baseline `no-store` is already present the browser will not cache
it, so that directive is dead rather than harmful. Heavy report endpoints: all already send
`private, no-store`; none streams (PDF/CSV/zip are buffered), and none has a row limit. The bounding
control today is the plan gate (`requireFeatureAccess`) and, for `user/export`, the 1/hour limiter.
Streaming would not reduce Firestore reads or the `3N` snapshot memory; the read-set change in section
9 is the effective fix.

### 6.6 (f) Index coverage

See section 7 and `tests/firestore-indexes.test.ts`.

## 7. Firestore indexes

`firestore.indexes.json` grew from 31 to 47 composite indexes (`indexes` JSON carries no comments; the
reasons live here). `firebase deploy --only firestore:indexes` builds them in the background; queries
that need a new index fail with `FAILED_PRECONDITION` until the build completes, so deploy indexes
before the code that relies on them.

Added, `transactions` collection group:

| Fields | Query |
| --- | --- |
| `userId, review_status, date DESC` | `taxpayer-context-server` confirmed history |
| `userId, is_deductible, date DESC` | notification celebrations (date window) |
| `userId, is_deductible, updated_at DESC` | paginated `status` filter, default sort |
| `userId, category, date DESC` | notification mileage reminder (date window) |
| `account_id, userId` / `account_id, user_id` | `deleteAccountServer` step 2, `debug/transactions` |
| `userId [+ is_deductible] x {updated_at, date, amount, merchant_name} x {ASC, DESC}` (12 new; 4 existed) | `getPaginatedTransactionsServer` sort matrix |

Added, collection scope: `transactions account_id+userId` and `account_id+user_id`
(`deleteAccountServer` step 2b on the legacy top-level collection), `cpa_questions userId+createdAt DESC`,
`notifications userId+sentAt DESC`, `user_corrections userId+timestamp DESC`,
`userId+merchantName+timestamp DESC`, `userId+category+timestamp DESC`,
`w2_income userId+taxYear+employerEIN`, and `userId+taxYear` on `gross_receipts`, `income_1099`,
`w2_income`, `tax_deductions`, `tax_organizers`, `form_8879`, `income_reconciliations`. Equality-only
pairs can be served by merging single-field indexes, but explicit composites avoid the zig-zag merge
cost on `taxYear` (low selectivity) and make the coverage test uniform.

Field overrides: `transactions.userId` and `transactions.user_id` now list
`COLLECTION ASC/DESC/CONTAINS` in addition to `COLLECTION_GROUP ASC/DESC`. An override replaces the
automatic single-field indexes for that field, so the previous file had silently disabled
collection-scope owner filters on any `transactions` collection.

Pre-existing indexes with no matching query in `app/`, `lib/`, `functions*/` or `mobile/` (candidates
for removal after confirming no external consumer): `transactions userId+analyzed`, `user_id+analyzed`,
`user_id+analysis_status`, `userId+is_deductible` (2 fields), `user_id+is_deductible+date DESC`,
`analysis_status status+userId+created_at DESC`, `income_1099 userId+createdAt DESC`.

Storage trade-off: the 12 paginated-matrix indexes exist only so every combination the route accepts is
servable. If `GET /api/transactions/paginated` stays unused (no web or mobile caller today), remove the
route or restrict `sortBy`/`sortOrder` to the sorts a client needs and drop the rest; each index on
`transactions` is roughly 0.3-0.9 TiB at 1M users.

## 8. Cost controls: OpenAI

Call sites: `lib/ai/analyzeTransaction.ts` (transaction analysis, `gpt-4o-mini`, `max_tokens 1000`,
25 s timeout, SDK `maxRetries: 0`), `app/api/ai/tax-assistant` (`gpt-4o`), `app/api/ai/parse-voice-command`
(`gpt-4o-mini`), `app/api/tax/import-document` and `import-bank-statement` (`gpt-4o`, per uploaded
document). `lib/openai/analysis.ts` contains a second analyzer that no application code imports (dead
code; not a billing path).

Paths that can call the model more than once per transaction revision:

1. `analyzeTransactionWithRetry` performs up to 2 attempts per invocation when the first fails with a
   retryable error (timeout, 429, 5xx). A 25 s client timeout on a request the provider actually
   completed is billed and discarded, then repeated.
2. `processAnalysisTask` allows `MAX_ATTEMPTS` = 3 task executions (backoff 60 s x 2^(n-1), capped at
   300 s). Combined with (1) the worst case is 6 model calls for one revision, all on provider-side
   failures.
3. Lease expiry: a worker that crashes after the model returned but before the finalize transaction
   commits loses the result; after `ANALYSIS_LEASE_MS` (240 s) the next attempt re-bills. Documented in
   `docs/AI_TRANSACTION_WORKER_2026-09-16.md` as "exactly-once provider billing is not guaranteed".
4. `POST /api/ai/analyze-transaction` (manual analysis) claims the lease and calls the model without
   checking whether `ai_suggestion.inputHash` already equals `analysisInputHash(record)` for the current
   `profileHash`. Repeated clicks on an unchanged, already-analyzed transaction bill once per click, up to
   the 60/hour/uid limiter. This is the only path where an identical revision is billed again without a
   failure in between.
5. Plaid `modified` events change `analysisInputRevision` only when `analysisInputHash` changes
   (`updateImportedTransactionForAnalysis`), so cosmetic bank updates do not re-bill. A removal followed
   by re-add restores the row and enqueues once for the restored revision.

Verification of the lease/hash logic against duplicate billing across worker retries
(`lib/ai/analysis-jobs.ts`, `lib/ai/analysis-persistence.ts`):

- Enqueue is idempotent: task id = sha256(userId, accountId, transactionId); an active task with the
  same `inputHash` and `inputRevision` returns `queued` without writing. A completed/failed task is only
  replaced when the input changed or an explicit retry is requested after a 60 s cooldown.
- Claim runs in a transaction that rejects when the task `generation` changed, the task is terminal,
  the record holds an active lease, or `nextAttemptAt` is in the future (`busy`, non-2xx, Eventarc
  retries later without calling the model). Only the claiming transaction increments `attempts` and
  writes the lease token onto the record, so two workers cannot both hold a lease.
- Finalize re-reads task and record in a transaction and requires `work.generation === generation`,
  `work.leaseToken === claim.lease.token` and `isAnalysisLeaseCurrent` (token, stored hash, expiry and a
  fresh hash of the record). A stale worker's result is discarded (`AI_INPUT_CHANGED` / `obsolete`), so
  a duplicate call can waste money but cannot write a stale suggestion.
- `shouldProcessTask` only fires for `queued` with a new `generation`; status writes from the worker
  itself do not re-trigger processing.

Residual risk: (3) and (4) above. (3) is bounded by 3 attempts per revision and is only reachable on
process interruption. (4) is bounded by the 60/hour limiter and user intent. Proposed mitigation for (4)
(not applied, since it changes what the "analyze again" button does): return the saved suggestion when
`ai_suggestion.inputHash` and `ai_suggestion.profileHash` match the current record and profile unless
the client passes an explicit `force` flag. Additional guard for (1): make the retry conditional on the
error class (retry 429/5xx, do not retry a client-side timeout) or raise the timeout above the observed
p99 completion time for `gpt-4o-mini` structured outputs.

Illustrative spend at 100k users: 12M transaction analyses/month at roughly 2-5k prompt tokens plus
up to 1k completion tokens each costs about $0.0005-0.0015 per call at current `gpt-4o-mini` list
prices, i.e. roughly $6k-18k per month, versus a few hundred dollars of Firestore writes for the same
volume (120M writes). Any duplicate-call rate above about 1% is material.

## 9. Recommended next steps (not in this branch)

1. Per-user summary document maintained by the review path and the analysis worker (monthly deductible
   totals, counts by status, last-updated). Dashboard routes and the stats hook read one document;
   `monthly-deductions`, `tax-savings`, `analysis-status` and the client listener drop from `N` to 1
   read each. This removes finding 1 outright.
2. `readOwnedTransactions`: treat the per-account walk as authoritative and replace the two
   collection-group owner queries with collection-scope queries on the legacy top-level `transactions`
   collection (and any other legacy path confirmed by a one-time audit). Same result set, `A + N` reads
   instead of `A + 3N`, one copy in memory. Then stream CSV rows and page PDF inputs.
3. Plaid sync writes: read existing ids per account with one projected `select('trans_id')` query,
   write new rows with `BulkWriter`, heartbeat the lease every 50 rows instead of every row. Cuts a
   1,500-row import from about 7,500 round trips to about 40.
4. Bound the dashboard listener (`useTransactions`) to a date window (current and prior tax year) or
   switch it to the paged API; every worker write on any transaction currently pushes a snapshot to
   every open dashboard.
5. `GET /api/transactions/[id]` fallback: replace the full account walk with one `doc(...).get()` per
   account (the fallback only matches `doc.id === id` for rows without owner fields), turning a 404 from
   `A + N` reads into `A + 1`.
6. Drop `checkRevoked` for read-only routes (tokens expire within an hour) or memoize the revocation
   check per uid for 60 s in process; keep it for session creation, exports, deletion and billing.
7. Cache the reconciled subscription for a few minutes per uid (Stripe webhooks already keep the
   profile current) so `check-access` stops calling Stripe on every dashboard load.
8. Hosting: `maxInstances: 2` is the first hard ceiling; revisit with traffic data (out of scope here).
9. TTL policies on `processed_webhooks`, `stripe_events`, `rate_limits`, and completed `analysis_tasks`.

## 10. Tests

- `tests/transactions-server-pagination.test.ts`: strategy short-circuit (first non-empty strategy
  wins, per-account fallback only when both owner queries are empty), cursor paging (`limit`, opaque
  cursor round-trip, malformed cursor, oversized `limit` -> 400), projection, `count()` aggregation in
  `getPaginatedTransactionsServer`, and `GET /api/transactions` contract including `Cache-Control`.
- `tests/taxpayer-context-memo.test.ts`: per-uid memoization, TTL expiry, invalidation via
  `reviewTransaction`, failed loads not cached, fallback to per-account reads on missing index / legacy
  rows, `CONFIRMED_HISTORY_CAP`.
- `tests/user-profile-batch.test.ts`: 200-per-page cursor paging, time budget stop and resume,
  ordering for range-filtered fields, per-user failure isolation, `NotificationEngine` aggregation and
  page sizes.
- `tests/plaid-scheduled-sync-scheduler.test.ts`: `runWithConcurrency` limit/order/failure isolation/
  `shouldStart` gating, `withTimeout`, `createTimeBudget`, the 540 s invariant, `orderFromCursor` /
  `nextCursor`, and the `scheduled_jobs` rules block.
- `tests/firestore-indexes.test.ts`: table-driven catalogue of every `.where().where()` /
  `.where().orderBy()` combination (server and client SDK, including the paginated matrix and the
  `or()` branches of the dashboard listener) checked against `firestore.indexes.json` with the planner's
  prefix rules, plus structural checks (well-formed entries, no duplicates, <= 200) and the
  single-field override scopes.

Two existing suites were adapted to the new read paths without changing what they assert:
`tests/analyze-transaction-availability.test.ts` stubs `loadTaxpayerContext` with a profile-only
context (its route-level `collectionGroup` spy otherwise also counts the confirmed-history query), and
the hand-rolled Firestore fake in `tests/transaction-receipt-metadata.test.ts` now implements
`Query.count()` and `select()`.

Run: `npx vitest run tests/transactions-server-pagination.test.ts tests/taxpayer-context-memo.test.ts tests/user-profile-batch.test.ts tests/plaid-scheduled-sync-scheduler.test.ts tests/firestore-indexes.test.ts tests/plaid-scheduled-sync.test.ts tests/bank-analysis-jobs.test.ts tests/taxpayer-context.test.ts tests/analyze-transaction-availability.test.ts`,
`npx tsc --noEmit --incremental false -p tsconfig.json`, `npx tsc --noEmit -p functions/tsconfig.json`.
