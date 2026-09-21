# Durable transaction analysis

## Behavior

- Saving any posted bank record with a finite amount triggers durable analysis. Saved manual and receipt records use the same path. Pending bank entries wait until posted. Credits, refunds, transfers and zero entries are analyzed for transaction kind; amount sign alone never establishes business income or a deduction.
- The Firebase event bridge writes a task through the internal API. A second event invokes the worker and waits for it to finish. HTTP responses do not launch background model promises.
- The task ID is derived from the owner, account and transaction identifiers. Duplicate events do not create duplicate tasks. Explicit catch-up can resume paused/failed work after a one-minute cooldown and recover deliveries that expired.
- Each task gets up to three executions, with backoff. The shared analyzer independently bounds transient HTTP retries. Configuration, billing/quota, invalid-output, missing-profile and unsupported-currency errors stop automatic retries. Provider funding/configuration must be corrected before explicit catch-up resumes paused work.
- A four-minute transaction lease serializes manual and automatic analysis. Completion rechecks the lease and saved transaction inputs. Changed inputs or deleted records invalidate the result. A process interruption can cause an external model request to be repeated after lease expiry; exactly-once provider billing is not guaranteed.
- Plaid financial corrections invalidate old AI metadata and enqueue the corrected inputs. A reviewed bookkeeping category is preserved while Plaid's category is saved separately as `bank_category`. Metadata-only workflow writes do not retrigger analysis.
- The worker writes suggestions only. It never writes the user's `is_deductible`, `expense_type`, category, deduction adjustment, deduction score, or classification reason. Missing facts remain an explicit information/manual-review outcome.
- Existing plan policy is retained: AI has no premium-only gate. Reports, exports and extended history keep their separate server entitlements.

## Deployment boundary

The new `functions-analysis` package is a dedicated Firebase codebase named `analysis`. Its only exports are `queueBankTransactionAnalysis` and `processBankTransactionAnalysis`. The old `functions` package and its production-default sync scheduler are not part of `firebase.staging.json`.

Staging dispatch requires all of:

- Project `writeoff-production-testing`.
- `ANALYSIS_WORKER_ORIGIN=https://writeoff-production-testing.web.app`.
- The same private `ANALYSIS_WORKER_SECRET` of at least 32 characters in the Next server environment and the Functions Secret Manager binding.

Production dispatch now has a separate exact pair: project `writeoff-23910` and `ANALYSIS_WORKER_ORIGIN=https://writeoffapp.com`, with the matching production worker secret. No origin defaults to another environment. See [production cutover prerequisites](PRODUCTION_CUTOVER_2026-09-16.md) before deployment.

Local dispatch has one separate exception: `FUNCTIONS_EMULATOR=true`, project `demo-writeoff-security`, and origin exactly `http://127.0.0.1:3000`. It still requires the matching worker secret. Cross-project origins and emulator dispatch to hosted sites are rejected.

The bridge sends only identifiers. The OpenAI key stays in the Next server; it is not needed in the Functions package. Firestore rules deny client writes to task documents. The worker independently verifies saved account and transaction ownership, posted status, finite amounts, valid calendar dates and explicit USD before model work.

Deploying Hosting alone does not deploy the event bridge. Both dedicated Functions and Next changes must be reviewed and deployed together before claiming automatic analysis is active. Source tests use mocked provider calls; successful live AI results also require a funded provider account.

## Interfaces and progress

`POST /api/internal/analysis-worker` requires `x-analysis-worker-secret`:

```json
{"action":"enqueue","userId":"owner","accountId":"account","transactionId":"transaction"}
```

or `{ "action": "process", "taskId": "<64-character SHA-256 ID>", "generation": "<task generation>" }`.

The worker returns 503 only when delivery should retry, including active leases, transient failures and backoff. Persisted paused or finished outcomes return 200. Internal authentication failures return 401.

Authenticated `POST /api/plaid/auto-analyze` accepts `{ "accountId": "..." }` and queues saved records owned by the caller. Its response is `{ jobId, queued, status: "queued" | "idle", message }`; queued does not mean completed. It does not import bank data.

`analysis_jobs` keeps the existing `running | done | failed` status and total/processed/succeeded/failed counts, with `phase` and safe `lastErrorCode`. Transaction status remains pending/running/completed/failed. The transaction-status fallback excludes pending or invalid-amount records from automatic work and reports `breakdown.skipped`; posted income, credits and refunds are included.

Event delivery is bounded to 23 hours (inside Firebase's 24-hour retry window). After a prolonged service outage, explicit catch-up creates a new generation and reuses the abandoned progress slot. Provider error text, receipts, transaction descriptions and credentials are not stored in task documents or bridge logs.

## Verification

Focused tests cover event filtering, strict project/origin guards, internal and user authentication, owner checks, duplicate delivery, retry limits, permanent pauses, leases shared with manual analysis, concurrent user edits, deletion, aged-delivery recovery, bank corrections, progress counts and removal of request-tail work from manual/receipt creation.

Official platform behavior: [Firebase asynchronous retries](https://firebase.google.com/docs/functions/retries), [Firestore event delivery and idempotence](https://firebase.google.com/docs/functions/firestore-events), and [no work after function completion](https://firebase.google.com/docs/functions/tips).

### Local integration result — September 16, 2026

The two real Functions emulator triggers and the real Next worker were exercised against synthetic Firestore data. A pending-to-posted transition queued and processed one task without an explicit analysis request. The provider returned an unavailable outcome; the task paused, the job counted one failure and zero successes, the lease was released, and existing user classification was preserved. Redelivery/metadata writes did not cause another attempt. This is a verified failure-path integration, not successful funded model output. Evidence: `/tmp/writeoff-local-ai-event-evidence.json`.

Actual Firestore rules separately allowed owner progress reads and denied task reads/creation by that owner. Evidence: `/tmp/writeoff-local-ai-rules-evidence.json`. The final ordinary source suite passed 1,868 tests; 11 destructive emulator-suite cases were not run against the user's preserved walkthrough data. App typecheck, the production Next.js build and dedicated Functions compile passed. The local emulator used host Node 20; the deployment package requests Node 22, which has not been cloud-runtime-tested here.

The configured OpenAI key stays server-only. `GET /api/ai/status` reports configuration, not credit or health. Both legacy single-transaction URLs share the canonical owned-record handler. The model receives saved transaction context, validated dates/USD, and known profile facts; unknown age/income/entity/travel values are not fabricated.

No hosting/function deployment was performed in this original batch. The later cutover change allows the explicit production pair in source, but source support alone does not establish that production workers, secrets or migration are deployed and verified.

## AI-first review contract — September 16 update

`ai_suggestion` is a server-owned snapshot with a unique ID, transaction-input hash, normalized tax-profile hash, suggested category and transaction kind, tax decision (which may be unknown), model, tax year, policy version, questions and trusted source links. It is separate from the recorded bookkeeping category and deduction.

Authenticated `POST /api/transactions/{id}/review` accepts `{action:"confirm", accountId, suggestionId}` or an explicit correction `{action:"correct", accountId, category, transactionKind, isDeductible, reason?}`. The server verifies saved account/transaction ownership and re-reads the current suggestion and input hash in a Firestore transaction. It also reads the current business profile in that transaction and rejects stale or missing profile fingerprints; a changed entity, profession or tax fact requires new analysis or an explicit manual category correction. Display-name, subscription and updated-at changes do not affect this fingerprint. It never accepts caller-supplied AI reasoning or eligibility fields in the confirm action. Same-suggestion repeats are idempotent. Pending, unsupported currency, stale input and ambiguous kind/category are rejected.

A known category can be confirmed while tax facts remain unresolved: `review_status:"confirmed"`, `tax_review_required:true`, and `is_deductible:null`. The swipe category queue then progresses; tax-review counts and confirmed-only exports still exclude that deduction. Unsupported tax-year/entity guidance may still identify a useful bookkeeping category. Categories map to the established export taxonomy on confirmation; ordinary meals use the existing 50% calculation once. Equipment, home office, vehicle methods and unmapped categories require separate tax treatment, and mixed-use suggestions cannot silently export their full gross amount.

Explicit income confirmation maps a posted inflow to `INCOME`; transfers and personal entries do not enter deductions. A refund can be categorized, but this review flow does not approve an offset until the original expense and tax year are reconciled. Existing recorded tax decisions are not overwritten by AI confirmation; an explicit correction is required. Catch-up also upgrades legacy analyzed records with no structured suggestion instead of treating old prose as complete.
