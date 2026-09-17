# API route security audit — 2026-09-17

Scope: every `app/api/**/route.ts` (102 files, 136 method/path operations). Branch `cursor/t3-security-b231` on base `cec95bf`.
Out of scope (edited on another branch, findings reported below): `middleware.ts`, `app/api/transactions/route.ts`,
`app/api/monthly-deductions/route.ts`, `app/api/tax-savings/route.ts`, `functions/`, `firestore.rules`, `storage.rules`.

## Method: the route contract test

`tests/api-route-contracts.test.ts` walks `app/api` at run time (no hard-coded list) and imports each module with the Admin SDK,
OpenAI, Stripe, Plaid, Cloud Storage, `fetch` and the rate-limit store replaced by fail-closed doubles
(`tests/fixtures/api-route-harness.ts`, `tests/fixtures/fake-firestore.ts`, `tests/fixtures/rate-limit-store.ts`). All 136 operations
are exercised; the skip list is empty. Per operation it asserts:

- anonymous, forged-token and unknown-session callers get 401/403/404 with a JSON body and `Cache-Control: no-store`, and no
  provider or storage call happens (six documented public exceptions: `POST /api/auth/session` 400, `POST /api/auth/logout` 200,
  `POST /api/contact` 400, `POST /api/stripe/webhook` 400/503, `GET /api/plaid/webhook` 200, `GET /api/support/account/*` 404);
- a signed-in owner sending no body, `{` or `{}` to a mutating method gets 400/422, never 500 (bodyless mutations and
  empty-body-accepting routes are tabled with a reason each);
- a session-cookie mutation from another origin is rejected (CSRF; enforced centrally in `getAuthenticatedUser`);
- routes gated on `NODE_ENV` answer 404 in production;
- a Firestore failure never reaches the body, and no body contains `stack`, `at /`, `node_modules` or `firebase-admin`.

Open findings live in a `KNOWN_GAPS` table that must shrink as fixes land; it is empty at the end of this pass. Service-secret and
webhook-signature operations are tabled separately (`SERVICE_OPERATIONS`) and checked with a forged credential.

## Findings fixed (route → issue → fix → test)

| Commit | Route(s) | Issue | Fix | Test |
|---|---|---|---|---|
| c2c0250 | 17 JSON mutations (`accounts`, `categories`, `cpa-question`, `income/*`, `settings/*`, `tax/*`, `plaid/*`, `database/accounts`, `ai/parse-voice-command`, …) | `request.json()` unguarded: empty/malformed/array body → 500 | `app/api/_lib/body.ts` `readJsonObject` → 400; typed field checks | `tests/api-json-body.test.ts`, contract |
| ed92a42 | `accounts`, `database/*`, `income/w2`, `settings/*`, `transactions/[id]`, `transactions/paginated`, `user/profile` | `details`/`error` fields echoed exception messages | Fixed messages; detail stays in server log | contract (DB-failure phase) |
| 930b511 | `tax/deductions` GET/POST, `transactions/reset-unreviewed-classifications` | Store errors escaped as text/plain 500 | try/catch → JSON 500; `taxYear` range | contract |
| ee03f61 | `plaid/items`, `plaid/items/[itemId]`, `plaid/sync-transactions`, `stripe/create-portal-session` | Unknown connection / provider outage → 500 with echoed text; unvalidated `itemId` | `PlaidDisconnectError` (404/409/503), itemId shape check, 503 on provider failure | `tests/plaid-disconnect-responses.test.ts` |
| b2ad23e, 828f59b | `tax/import-document` | Upload had no size/MIME/signature check; non-multipart → 500; `overrideFields` parsed unbounded and written as-is; no rate limit | `receiptFormData` (10 MB), image MIME + magic-byte check, bounded `overrideFields`, `taxDocumentImport` limit | `tests/tax-import-document-upload.test.ts` |
| 74d30fe | `ai/parse-voice-command`, `ai/tax-assistant`, `tax/import-bank-statement`, `cpa-question`, `reports/{generate-pdf,export,audit-support}`, `transactions/export-csv`, `tax/schedule-c/export`, `tax/form-1040`, `plaid/{sync,import}-transactions`, `plaid/refresh-balances`, `plaid/recurring-transactions` | No durable per-owner throttle on model calls, Plaid calls, full-history exports and team email | `RATE_LIMITS` policies (`deny` when the store is unavailable) enforced before the costly step | `tests/api-rate-limits.test.ts` |
| 8befb40 | `cpa-question`, `database/accounts` | Logged the asker's email, question and amounts (Resend unset) and the provider error body; logged bank account names | Log record ID and HTTP status only | `tests/cpa-question-logging.test.ts` |
| 0d41f1e | `fix-transaction-analysis`, `migrate-ai-analysis` | Maintenance passes reachable in production; per-record `error` echoed store text | 404 in production (only caller is an unmounted component); `update_failed` | `tests/maintenance-routes-production-gate.test.ts` |
| 28f136b | `plaid/sync-transactions-internal` | Anonymous caller learned the secret was unset (500 "configuration error"); unguarded body; `userId` unvalidated as a path segment; helper error echoed | No credential → 401; unconfigured → 503 without detail; `readJsonObject`; UID shape check; fixed message | `tests/internal-sync-secret.test.ts` |
| 48a4055 | `contact` | Unbounded string fields on a public route | Per-field length caps | `tests/contact-route-validation.test.ts` |

Ownership review: every `doc(<client id>)` read/write (`income/*` deletes, `analysis-status`, `analysis-job`, `receipts/*`,
`transactions/[id]`, `accounts/[accountId]/*`, `mileage/[id]`) verifies `userId` from server-written data or scopes the path under the
caller's uid; no IDOR found. Redirect/return URLs (`stripe/*`) are server-configured. Client list sizes are capped
(`transactions/paginated` ≤ 100, `settings/assets` ≤ MAX_ASSETS_PER_REQUEST, organizer ≤ 80 fields × 5,000 chars).

## Findings reported, not fixed (out of scope for this branch)

- `app/api/monthly-deductions/route.ts:48,205` — `details` echoes `error.message` to the client.
- `app/api/tax-savings/route.ts:34,43,137` — `console.error(JSON.stringify(error))` may log Firestore internals; `error.message` returned.
- `middleware.ts:106-107` — CSP `script-src 'unsafe-inline' 'unsafe-eval'` and `style-src 'unsafe-inline'` (see residual risks).
- `functions/src/index.ts` — no finding; note the scheduler now sees 503 `SYNC_UNAVAILABLE` (was 500) when the secret is unset, and it
  already treats any non-`ok` answer as `BANK_SYNC_RETRY_REQUIRED`.

## Residual risks

- CSP allows inline/eval scripts, so any XSS is not mitigated by CSP; Stripe/Plaid/GTM loaders are the constraint.
- Firebase Auth email enumeration (sign-in error codes) is a platform behaviour; enable email-enumeration protection in the console.
- `income/*` DELETE answers 403 for another owner's ID and 404 for an unknown one (existence oracle on random Firestore IDs; low).
- `POST /api/contact` performs no send; if a mailer is wired it needs an anonymous rate limit (`anonymousRateLimitKey`).
- Rate limits fail closed (`deny`) on the throttle store; a Firestore outage returns 503 on exports, AI, uploads and bank sync by design.
- The contract test exercises handlers in-process; edge middleware limits and Firebase Hosting rewrites are covered by
  `scripts/smoke-platform.mjs` against a deployment, not here.
