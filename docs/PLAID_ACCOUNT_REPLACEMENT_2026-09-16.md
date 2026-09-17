# Plaid account replacement

The application now uses only explicit server environment configuration. It never reads the old Firebase `functions.config().plaid` credentials and never defaults to Sandbox. Staging now uses the newly selected account’s Sandbox credentials and a dedicated bank-token encryption key. Secrets remain outside Git.

## Required configuration

| Setting | Purpose |
| --- | --- |
| `PLAID_CLIENT_ID` | Client ID from the newly selected Plaid account |
| `PLAID_SECRET` | That account's secret for the selected environment |
| `PLAID_ENV` | Explicitly `sandbox` or `production` |
| `PLAID_TOKEN_ENCRYPTION_KEY` | Server-only key for the connection store; keep stable while encrypted connections exist |

Staging permits Sandbox only. A production app marker, the production Firebase project, or a WriteOff production domain rejects Sandbox. Unmarked production runtimes also require production banking, with explicit local/demo preview exceptions. Conflicting staging/production markers fail closed. Missing credentials prevent a Plaid API request rather than recovering an old credential.

The shared client reads current configuration when a bank operation runs, so importing an unrelated route does not require Plaid credentials. It binds to the explicit provider endpoint without a fallback and does not pin a previous credential in a warm process.

## Rollout sequence

1. Configure the new account's Sandbox credentials on staging and verify client-account ownership in the provider dashboard.
2. Complete authentic Link, import, signed webhook, incremental sync, automatic analysis, reconnect, and disconnect tests against synthetic data.
3. Obtain the new account's production credentials before a separate production rollout. Do not substitute Sandbox keys on the live app.
4. Plan existing-bank reconnection with the old/new provider accounts. Existing access tokens and Items belong to their originating provider account/environment; this code does not transfer them. Preserve saved tax records and avoid treating a provider switch as permission to delete records or revoke old Items.

## Configuration audit

- Current staging entry points: `lib/plaid/config.ts`, `lib/plaid/client.ts`, `app/api/plaid/create-link-token/route.ts`, and the signed webhook verifier.
- Current deployment preflight: `scripts/staging-preflight.mjs`, selected by `firebase.staging.json`.
- The only checked-out environment file found was `staging/.env.local`. Its contents were not printed or changed during this audit.
- The separate `source/` checkout still contains earlier Plaid configuration in `lib/plaid/client.ts`, `lib/plaid/sync-helper.ts`, and `app/api/plaid/{create-link-token,accounts,recurring-transactions,webhook}/route.ts`. That checkout was inspected read-only and has not received these fixes. Deploy the reviewed staging branch, not an older checkout.
- Legacy key names retired from runtime fallback: `plaid.client_id`, `plaid.clientId`, `plaid.secret`, and `plaid.env` in Firebase Functions runtime config. Existing deployed runtime configuration has not been deleted by this change.
- Legacy API spellings now delegate to canonical authenticated handlers, and compatibility browser helpers no longer read or write Plaid tokens.
- The separate scheduled-sync source in `functions/` now selects only active server connections matching its explicit `PLAID_CLIENT_ID` and `PLAID_ENV`. Its `SITE_URL`, Firebase project, environment, and bound `CLOUD_FUNCTION_SECRET` must agree. It has no default production target and reads no tokens. This codebase is **not** included in the current staging deployment; its existing deployed job is unchanged until separately configured and deployed.

## Validation

The focused configuration, client, staging isolation, webhook, scheduled-selector, and legacy-alias suites passed 124 tests. They cover ignored legacy credentials, missing/invalid environments, production-to-Sandbox refusal, conflicting app markers, explicit local previews, missing credentials, credential replacement between calls, authentic ES256 verification, retry-safe receipts, current-account-only scheduled selection, and preserved alias authentication failures. Provider ownership and delivery remain separate authentic Sandbox checks.

## Deployment preparation and cleanup

- New Sandbox credentials verified against Plaid institutions API (HTTP 200).
- Current staging Hosting uses `ssrwriteoffproductionte`. Unused staging functions `createLinkToken` and `ssrwriteoff23910` were retired after verifying no current Hosting/preview/caller references and no requests in seven days. Their old Plaid Secret Manager versions were disabled, with private recovery archives retained.
- The prior local production-recovery environment’s old Plaid client ID/secret entries were removed. Existing live deployment is separate from this staging release and must be replaced at the production cutover; no claim is made that historical deployment artifacts or provider-issued keys have been revoked.
- Dedicated `ANALYSIS_WORKER_SECRET` now matches staging SSR and the analysis bridge; worker origin points only at staging. Both previously missing analysis workers were deployed successfully.
- Bank replacement release: full suite 2,444 passed, with 13 opt-in security cases separately passing in isolated emulators. TypeScript passed; lint has no errors (existing warnings remain). Staging isolation preflight passed. Subsequent UI/date policy checks passed 118 focused tests.
- New rules deployed before the bank backend, so clients cannot read the private bank store or forge bank ownership/projection fields.
- Staging release `36f9106` passed authentic provider and browser tests; UI policy/date polish `3a23912` was subsequently deployed and its formatted review date verified in the browser.

## Authentic Sandbox verification (September 16–17, 2026)

Only a dedicated synthetic QA account was used. No real customer transaction confirmations were changed.

- The new provider account imported exactly three custom transactions through the application's authenticated Link/exchange path. Tokens are encrypted in the private connection store; client reads were denied.
- All three imports automatically completed OpenAI analysis through the Firestore workers, each with a category, explanation, and IRS source references. Ambiguous expenses remained unresolved for user confirmation.
- Repeated incremental sync preserved transaction IDs/count and saved zero duplicates. A genuine Plaid-signed callback caused an exact-item update and a verified success receipt.
- A second bank with zero transactions connected successfully. Its account-usage page accurately reported no activity yet and returned to Bank accounts after saving.
- Plaid's Sandbox login reset produced `ITEM_LOGIN_REQUIRED`. The browser's Repair connection flow successfully reauthenticated the same custom bank account; the next incremental sync succeeded with all three records and confirmations intact.
- Disconnecting only the empty bank through the browser left the primary bank connected and retained both saved accounts. No records were deleted.
- The provider's default data-use wording was corrected and published to describe business accounting/tax preparation and financial tracking.

## Production status

The new Plaid team's production request was submitted September 16. Its dashboard reports review pending and a required security questionnaire outstanding; it estimates 2–3 business days. That estimate is Plaid's, not a launch commitment. New-account production credentials and actual production-bank verification remain required.

Production worker configuration, deployment isolation, OAuth return support, and runtime updates are being validated separately. Refer to `PRODUCTION_CUTOVER_2026-09-16.md` for release prerequisites, including existing-user history reconciliation. Sandbox success does not certify the old live release or automatically switch production credentials.
