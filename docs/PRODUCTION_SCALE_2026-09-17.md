# Production scale posture — writeoff-23910 (September 17, 2026)

Scope: the Next.js 15 SSR service that Firebase Hosting runs on Cloud Run
(`frameworksBackend` → 2nd-gen function `ssrwriteoff23910`, `us-central1`),
the Firestore usage the code generates, and the OpenAI spend controls already
in the tree. Targets: **first launch 5,000 DAU / 200 concurrent users**;
**growth 100,000 DAU**. Nothing in this document changes `firebase.json`; the
snippet in section 3 is for the operator to apply.

Unit prices used (Cloud Run request-based billing, us-central1 tier 1, list):
active vCPU $0.000024/s, idle min-instance vCPU $0.0000025/s, memory
$0.0000025/GiB-s (active and idle), requests $0.40 per million; monthly free
tier 180,000 vCPU-s, 360,000 GiB-s, 2M requests. Firestore multi-region list:
reads $0.06, writes $0.18, deletes $0.02 per 100k (regional databases are
half that); 50k reads / 20k writes per day free.

## 1. What the current `frameworksBackend` does

```json
"frameworksBackend": { "region": "us-central1", "memory": "1GiB", "cpu": 1,
                       "minInstances": 0, "maxInstances": 2, "timeoutSeconds": 60, "concurrency": 80 }
```

| Setting | Effect on this app |
| --- | --- |
| `minInstances: 0` | The Next 15 standalone server (firebase-admin, Stripe, Plaid, OpenAI SDKs, `pdf-lib`, `tesseract.js` externals) cold-starts in roughly 3–6 s on gen2. After 15 idle minutes, and on every scale-out, the first requests eat that. The p95 > 3 s alert in `scripts/production-observability.sh` would fire every morning on this setting alone. |
| `maxInstances: 2` | Hard ceiling of 2 × 80 = 160 in-flight requests, but the real ceiling is CPU: one vCPU renders roughly 15–25 light SSR/API requests per second. Two instances is a launch-day risk, not a growth setting. |
| `concurrency: 80` | Cloud Run admits up to 80 requests into one Node process. Node runs JavaScript on one event loop: I/O-bound routes (Firestore, Plaid, Stripe, OpenAI awaits) interleave fine; a CPU-bound request stalls the other 79. The CPU-bound routes here are `pdf-lib` generation (`lib/reports/planning-pdf.ts`, `lib/reports/preparer-report.ts`, `app/api/tax/form-1040/route.ts`: 0.3–2 s of CPU each) and Tesseract OCR (`app/api/receipts/process/route.ts` → `lib/ocr/receipt-processor.ts`: 2–10 s of CPU per image, WASM worker threads). |
| `memory: 1GiB` | Baseline RSS of the server is ~250–350 MiB. `pdf-lib` documents are generated (no IRS template embedding) and stay in the tens of MB; Tesseract adds a ~100–200 MiB worker plus decoded image buffers (10 MiB uploads decode to 40–80 MiB). Two concurrent OCR jobs plus a PDF on one instance approach the limit, and Node's default heap sizing does not know about the container limit, so the failure mode is an OOM kill (a 5xx burst), not slow GC. |
| `cpu: 1` | Correct for cost: a second vCPU does not speed up a single event loop. It only helps Tesseract's worker threads and GC. |
| `timeoutSeconds: 60` | Firebase Hosting rewrites to the SSR function time out at 60 s regardless, so a larger value buys nothing for hosted requests. Long work is already asynchronous (analysis tasks via `functions-analysis`). Keep 60. |

Autoscaling is driven by CPU utilization (target 60%) and concurrency, per
instance. With `concurrency: 80` the scheduler is happy to keep piling requests
on one CPU-saturated instance until the CPU signal catches up; lowering
concurrency makes it add instances earlier, which is exactly what a mixed
I/O + CPU workload wants.

## 2. Sizing against the targets

Traffic model (assumptions, stated so they can be corrected with real
metrics after week one): 40 SSR/API requests per active user per day (page
renders, `check-access` on every protected load, dashboard snapshot,
transactions, analysis-status polling); peak = 200 concurrent users acting
every 10–15 s → **15–20 req/s**; average request 150–300 ms wall time, 30–80 ms
CPU; 2% of requests are PDF/OCR.

| | First launch (5k DAU / 200 concurrent) | Growth (100k DAU) |
| --- | --- | --- |
| Requests / month | ~6M | ~120M |
| Peak req/s | 15–20 | 300–400 |
| Instances busy at peak (1 vCPU, concurrency 40) | 1–2 (3 during an OCR burst) | 20–30 |
| Average instances busy (24 h) | ~1 for 14 h/day, idle otherwise | ~8 |
| `minInstances` | 1 (no morning cold start; second instance cold-starts only under a burst) | 2–3 |
| `maxInstances` | 20 (10× headroom; caps Firestore and OpenAI fan-out) | 40 |
| `concurrency` | 40 | 40 (raise to 60–80 only once OCR moves out of the SSR process) |
| `cpu` / `memory` | 1 / 2GiB | 1 / 2GiB; go to 2 vCPU only if OCR/PDF dominate p95 |

Why not 2 vCPU at launch: it doubles active CPU cost for a workload whose
latency is Firestore round trips, and Cloud Run counts `cpu: 2` against the
same concurrency; the event loop still serializes JavaScript. Revisit if the
`writeoff_review_required_422`/latency-by-route metrics show PDF/OCR routes
driving p95.

### Cost estimates (SSR compute only, list prices, no CUD)

First launch, recommended (1 vCPU, 2 GiB, min 1, concurrency 40):

- Active: ~1 instance busy 14 h/day → 1.5M vCPU-s − 180k free = 1.32M × $0.000024 ≈ **$32**; memory 3.0M GiB-s − 360k free ≈ 2.65M × $0.0000025 ≈ **$7**
- Idle min instance the other 10 h/day: 1.08M s × ($0.0000025 + 2 × $0.0000025) ≈ **$8**
- Requests: (6M − 2M) × $0.40/M ≈ **$2**
- **≈ $50/month** (≈ $40 with 1 GiB; the current `minInstances: 0` config would be ≈ $30 but pays for it in cold starts and 5xx under bursts).

Growth (1 vCPU, 2 GiB, min 2, max 40):

- Active: ~8 instances × 2.63M s = 21M vCPU-s × $0.000024 ≈ **$505**; memory 42M GiB-s × $0.0000025 ≈ **$105**
- Idle min instances: mostly busy; ≈ **$10**
- Requests: 118M × $0.40/M ≈ **$47**
- **≈ $670/month**; with `cpu: 2` add ≈ $500. A 1-year Cloud Run CUD takes 17% off the compute lines once the traffic is steady.

The Functions codebases are small next to this: `syncAllUsersTransactions`
runs every 2 h (max 540 s, 1 instance); the two analysis functions are capped
at `maxInstances: 2, concurrency: 2, 256MiB` and sit in the free tier at 5k DAU
(low tens of dollars at 100k DAU).

## 3. Recommended `firebase.json` snippet (operator applies; not edited here)

First launch:

```json
"frameworksBackend": {
  "region": "us-central1",
  "memory": "2GiB",
  "cpu": 1,
  "minInstances": 1,
  "maxInstances": 20,
  "timeoutSeconds": 60,
  "concurrency": 40
}
```

Growth (switch when sustained instance count > 5 or DAU > 30k):

```json
"frameworksBackend": {
  "region": "us-central1",
  "memory": "2GiB",
  "cpu": 1,
  "minInstances": 2,
  "maxInstances": 40,
  "timeoutSeconds": 60,
  "concurrency": 40
}
```

The change ships with the next coordinated release (`firebase.json` is part of
the `deploy-config` surface in `scripts/production-rollback-plan.mjs`). Verify
after deploy with
`gcloud functions describe ssrwriteoff23910 --gen2 --region us-central1 --project writeoff-23910 --format 'yaml(serviceConfig.availableMemory,serviceConfig.minInstanceCount,serviceConfig.maxInstanceCount,serviceConfig.maxInstanceRequestConcurrency,serviceConfig.timeoutSeconds)'`
(never the default format: it prints environment variables).

## 4. Firestore cost drivers visible in the code

Ordered by expected spend.

1. **Unbounded whole-history reads per request.** `getTransactionsServer`
   (`lib/firebase/transactions-server.ts:249-290`) runs four full queries with
   no `limit`: root `transactions` by `userId`, `collectionGroup('transactions')`
   by `userId`, then the same two by `user_id`. Documents that carry both fields
   are read twice. Nine API routes call it (`/api/transactions`,
   `/api/tax-savings`, `/api/monthly-deductions`, `/api/transactions/analysis-status`,
   `/api/receipts/process`, `/api/database/transactions`, …), and
   `readOwnedTransactions` (`lib/reports/export-records.ts:27-41`) does the
   same for exports. A user with 1,500 transactions costs 1,500–3,000 reads per
   dashboard-ish request. At 5k DAU × 5 such requests/day × 1,000 reads that is
   25M reads/day ≈ **$15/day ≈ $450/month** (multi-region list) — larger than
   the SSR bill. The eleven collection-group indexes in `firestore.indexes.json`
   (`transactions` by `userId`/`user_id` + `date`, `is_deductible`,
   `analysis_status`, `analyzed`, `updated_at`, `trans_id`) make these queries
   possible; they do not make them cheaper. Mitigation, in order: query only the
   tax year in view (`date` range — the indexes exist), paginate, and serve the
   dashboard from the materialized `lib/tax/dashboard-snapshot.ts` document
   instead of recomputing from raw transactions.
2. **Client-side collection-group listeners.** `lib/firebase/hooks.ts:53,132,203`
   and `lib/firebase/transactions.ts:306,390` attach `onSnapshot` on
   `collectionGroup('transactions')`; every mount re-reads the full result set
   (one read per document) and every write re-reads changed documents on every
   open tab. Same mitigation: bound by date.
3. **Per-request profile reads.** `app/api/subscriptions/check-access/route.ts:13`
   reads `user_profiles/{uid}` on every protected-app load and
   `lib/subscriptions/feature-access.ts:8` reads it again on every premium API
   call. ~100k reads/day at 5k DAU ≈ $2/month — cheap, but it is on the hot path
   and the client fetches it with `cache: 'no-store'`
   (`lib/subscriptions/client-status.ts:89`), so every navigation pays it.
4. **Durable rate limiter writes.** `lib/security/rate-limit.ts:164-168` runs a
   transaction (1 read + 1 write) per limited request on `rate_limits`; writes
   cost 3× reads. Session creation falls back to memory, everything else denies
   when Firestore is unavailable. Bounded by the limits themselves
   (`aiAnalyzeTransaction` 60/h, `receiptProcess` 60/10 min, `plaidLinkToken`
   20/10 min, `userExport` 1/h). TTL deletes are billed too.
5. **A write on every bank-connection read.** `listPlaidConnections` and
   `listPlaidConnectionSummaries` (`lib/plaid/connections.ts:110-124`) call
   `migrateLegacyPlaidConnection`, which for an already-migrated profile still
   runs `refreshBankConnectionProjection` — a transaction that queries
   `plaid_connections` and **updates `user_profiles/{uid}`** every time.
   `/api/plaid/import-status` polls this during imports. Cheap fix: skip the
   update when `bankConnected` is unchanged.
6. **Analysis pipeline fan-out.** Each analyzed transaction costs a task document
   plus 3–5 updates (lease, attempts, result) and two Eventarc-triggered function
   invocations per write to `analysis_tasks`; the functions guard on status so
   the loop terminates, but every invocation performs reads. Proportional to
   new transactions, not DAU.
7. **Scheduled sync.** Every 2 h for every connected user: profile and
   connection reads plus upserts for changed transactions from Plaid's cursor
   sync. Proportional to bank activity; the `writeoff_scheduled_sync_completed`
   metric and Firestore write graphs show it as a 2-hourly comb.

The observability kit's "Firestore reads > 3× 7-day baseline" alert is aimed
at item 1 and 2 misbehaving (a listener loop or a scraping session).

## 5. OpenAI cost control already present

- **One server-only key, per-task models** (`lib/openai/client.ts`): transaction
  analysis and voice parsing default to `gpt-4o-mini`; the tax assistant and
  document extraction use `gpt-4o`. `OPENAI_MODEL` is a global override (an
  emergency lever to pin everything to `gpt-4o-mini`). Requests carry
  `store: false`; per-call `timeout` and `maxRetries` are explicit.
- **Bounded, de-duplicated background analysis** (`lib/ai/analysis-jobs.ts`):
  `MAX_ATTEMPTS = 3`, `TASK_MAX_AGE_MS = 23 h`, a lease so two workers never
  analyze the same task, exponential backoff `min(60 s × 2^(n−1), 300 s)`, and
  an `inputHash` so an unchanged transaction with an active task never triggers a
  new model call.
- **Bounded concurrency** (`functions-analysis/src/index.ts:7-8`):
  `maxInstances: 2, concurrency: 2` → at most 4 worker calls in flight, i.e. a
  hard ceiling of a few model calls per second regardless of queue depth.
- **Per-user rate limits** (`lib/security/rate-limit.ts:80-82`):
  `aiAnalyzeTransaction` 60/hour, `receiptUpload`/`receiptProcess` 60/10 min.
- **Kill switch**: `AI_ANALYSIS_ENABLED=false` (`lib/ai/provider-status.ts:13`)
  disables model calls without a redeploy of code paths; statement import is
  capped at 400 transactions per batch (`docs/OPENAI_KEY_ROUTING_2026-09-16.md`).

Rough spend (check the current OpenAI price list before budgeting): a
transaction analysis is ~1k tokens on `gpt-4o-mini`, well under $0.001; 5k DAU
generating ~30 new transactions/month each is ~150k analyses ≈ **$50–100/month**.
The tax assistant on `gpt-4o` is the expensive surface at roughly $0.01–0.03
per turn; 10% of DAU asking 3 questions/day would be ≈ **$450–1,300/month** at
5k DAU and scales linearly. OpenAI is billed outside Google Cloud, so the GCP
budget alert does not see it: set a monthly usage limit in the OpenAI
organization settings (operator action; nothing in the code can enforce it).

## 6. What to watch in week one

- Cloud Run instance count vs. the `maxInstances` cap, and `container/cpu/utilizations` p95.
- `writeoff_ssr_5xx` by route (OOM kills show up as 5xx bursts on OCR/PDF routes).
- Firestore document reads per day vs. the estimates above; if item 1 dominates,
  the date-bounded query change is the highest-value follow-up in the codebase.
- OpenAI usage dashboard against the limit you set.
