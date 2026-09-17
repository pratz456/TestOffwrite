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
- Dedicated `ANALYSIS_WORKER_SECRET` now matches staging SSR and the analysis bridge; worker origin points only at staging. The previously missing analysis workers will be deployed with this release.
- Full suite: 2,436 passed, with 13 opt-in security cases separately passing in isolated emulators. TypeScript passed; lint has no errors (existing warnings remain). Staging isolation preflight passed.
- New rules deployed before the bank backend, so clients cannot read the private bank store or forge bank ownership/projection fields.
- Authentic provider and browser results will be recorded after deployment.
