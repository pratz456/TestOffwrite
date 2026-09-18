# Support runbook (2026-09-17)

Step-by-step procedures for the recovery states that the application deliberately leaves for a human. Every procedure is read-first: pull the account summary, confirm the state named in the section, then act. Nothing here bypasses the safety gates in code; where a gate exists (deletion marker, ownership review, legacy revocation) the procedure explains how to satisfy it, not how to skip it.

All Firestore edits described below are Admin SDK writes from an authorized operator environment (Cloud Shell or a workstation with production credentials issued for the task). No Firestore rule allows a browser to perform them; `rate_limits`, `support_audit`, `plaid_connections` and `account_deletions/**` are deny-all for clients (`firestore.rules`).

## 1. Prerequisites and tools

### 1.1 Account diagnostics endpoint

`GET /api/support/account/{uid}` (`app/api/support/account/[uid]/route.ts`) returns a redacted summary built by `buildAccountDiagnostics` in `lib/support/account-diagnostics.ts`: auth record state, masked email, entitlement (`lib/subscriptions/entitlements.ts`), billing identifiers and last webhook revision, every `plaid_connections` record for the user (status, provider identity match, presence flags for the encrypted token and cursor, lease state, last sync), the `account_deletions/{uid}` gate with unresolved link/billing operations and revocation records, and analysis queue counts with the distinct `lastErrorCode` values. It never returns access tokens, encrypted tokens, cursors, taxpayer identifiers, Stripe secrets or transaction amounts; `assertRedacted` refuses to send a response that contains such a field.

Access requires both of:

1. The caller's UID appears in the server-only environment variable `SUPPORT_ADMIN_UIDS` (comma-separated). With this variable unset the route answers 404 for everyone.
2. The caller's verified Firebase token carries the custom claim `admin: true`. Grant it from an operator environment with `adminAuth.setCustomUserClaims(uid, { admin: true })`; the staff member must sign out and back in so a fresh token carries the claim (`lib/firebase/api-auth.ts` exposes it as `user.admin`).

Non-admin callers receive the same 404 as a missing route. Every successful lookup writes `{ actorUid, subjectUid, action, at }` to `support_audit` (`lib/support/access.ts`); lookups are limited to 60 per admin per 10 minutes (`RATE_LIMITS.supportAccountLookup`). Call it with the staff member's session cookie or bearer ID token, for example from the browser console of a signed-in admin session: `await (await fetch('/api/support/account/' + uid)).json()`.

### 1.2 Durable rate limits

Costly and destructive routes share the fixed-window limiter in `lib/security/rate-limit.ts`, stored in `rate_limits` and advanced in Firestore transactions so every hosting instance counts together. The middleware address limits (`middleware.ts`) remain a coarser per-instance first line only. Policies (`RATE_LIMITS`):

| Scope | Key | Limit | When the store is unreachable |
| --- | --- | --- | --- |
| `auth.session` | hashed client address | 30 / 10 min | per-instance memory window (sign-in stays available) |
| `receipt.upload`, `receipt.process` | UID | 60 / 10 min | refuse (503 `RATE_LIMIT_UNAVAILABLE`) |
| `ai.analyze-transaction` | UID | 60 / hour | refuse |
| `user.export` (completed archives; a failed attempt is refunded) | UID | 1 / hour | refuse |
| `user.export.attempts` (every attempt, including failures) | UID | 12 / hour | refuse |
| `user.delete` | UID | 10 / hour | refuse |
| `stripe.checkout`, `stripe.portal` | UID | 10 / 10 min | refuse |
| `plaid.link-token` | UID | 20 / 10 min | refuse |
| `support.account` | admin UID | 60 / 10 min | refuse |

A throttled request receives 429 with `Retry-After` and `code: "RATE_LIMITED"` (`AI_RATE_LIMITED` for analysis). A user who reports a persistent 429 that the window does not explain can be unblocked by deleting their window document: its ID is `rateLimitKeyHash(scope, uid)` from `lib/security/rate-limit.ts` (SHA-256, or HMAC when `RATE_LIMIT_HASH_SECRET` is configured). Deleting a document only restarts one owner's window. Persistent 503 `RATE_LIMIT_UNAVAILABLE` responses mean Firestore itself is not answering; treat that as the incident, not the limiter.

Expired windows are ignored by the code and can be purged by Firestore TTL. Enable the policy once per project:

```sh
gcloud firestore fields ttls update expiresAt --collection-group=rate_limits --enable-ttl --project=<project-id>
```

### 1.3 What not to do

- Never copy an access token, encrypted token, cursor or Stripe secret into a ticket, chat or spreadsheet.
- Never try an old Plaid account's credentials with the new account's keys, and never call `/item/remove` with a token whose `clientId`/`environment` do not match the current configuration (`lib/plaid/connections.ts` refuses this for the same reason).
- Never delete `account_deletions/{uid}` or any `plaid_revocations` record to "unstick" a deletion. Those records are the only recovery path for an Item or Stripe customer the application could not confirm.
- Never edit `user_profiles/{uid}.subscriptionPlan`, `subscriptionStatus` or `hasHistoricalAccess` by hand to grant access; reconcile from Stripe instead (section 4).

## 2. Legacy bank connection in `revocation_required`

### How it arises

Bank connections created under the previous Plaid account were retired by `migrateLegacyPlaidConnection` (`lib/plaid/connections.ts`) into `plaid_connections/{itemId}` with `status: 'relink_required'`, `clientId: null`, `environment: null` and the encrypted legacy token. When such a user clicks Disconnect or deletes their account, `disconnectPlaidItem` (`lib/plaid/delete-item.ts`) cannot revoke the Item with the current keys, sets `status: 'revocation_required'` and keeps the record. `deleteUserData` (`lib/firebase/delete-user-data.ts`) then refuses with `LEGACY_BANK_REVOCATION_REQUIRED` (409, not retryable) and retains the profile, records and Auth user. The user is told to contact support.

### Procedure

1. Pull diagnostics. Confirm a `bankConnections[]` entry with `status: 'revocation_required'` (or `'relink_required'`), `currentProvider: false` and `hasEncryptedToken: true`. Note its `itemId` and `institutionId`.
2. Revoke the Item at its originating provider account. Sign in to the **old** Plaid dashboard (the account whose `client_id` created the Item), locate the Item by ID and remove it there. If dashboard removal is unavailable, an operator may call `/item/remove` with the old account's own `client_id`/`secret`, decrypting the token with `decryptPlaidToken(uid, itemId, encryptedAccessToken)` (`lib/plaid/connections.ts`) inside the operator environment only; the plaintext is never stored or transmitted anywhere else. Treat `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN` as already revoked.
3. Record the revocation. In the operator environment, run the same transition the application uses, which also refreshes the `bankConnected` projection:

   ```ts
   import { removePlaidConnection, withPlaidConnection } from '@/lib/plaid/connections';
   await withPlaidConnection(uid, itemId, (_connection, leaseId) => removePlaidConnection(uid, itemId, leaseId), true);
   ```

   The result is `status: 'disconnected'` with `encryptedAccessToken` and `cursor` removed. Imported transactions, receipts and confirmations are untouched.
4. If the user asked for deletion, tell them to retry from Settings (or repeat `DELETE /api/user/delete` with their own session). `deleteUserData` now passes the legacy check, revokes current-provider banks with `disconnectPlaidItem`, closes billing, deletes files and records, and deletes the Auth user last. Deletion attempts are limited to 10 per hour per user.
5. If the user is staying, they may reconnect the same bank through Link; the new Item is created under the current provider account and saved by `savePlaidConnection`. Historical imports from the old Item remain and should be reviewed for duplicates per `docs/PRODUCTION_CUTOVER_2026-09-16.md` (historical overlap reconciliation) before advising the user.

## 3. Stuck `account_deletions/{uid}` operations

`account_deletions/{uid}` holds `deletionRequested`, `linkOperations` (`lib/plaid/link-operations.ts`) and `billingOperations` (`lib/stripe/checkout-operations.ts`), plus the `plaid_revocations/{operationId}` subcollection. None of these expire. While any operation is present, `deleteUserData` returns `ACCOUNT_OPERATION_PENDING` (409); while `deletionRequested` is true, new bank exchanges and Checkout customer creation refuse (`ACCOUNT_DELETION_IN_PROGRESS`, `ACCOUNT_DELETION_PENDING`). Diagnostics list the operations under `deletion` with their `state` and `startedAt`.

### 3.1 Link operations

| State | Meaning | Action |
| --- | --- | --- |
| `in_flight` | `beginPlaidLinkOperation` ran and the exchange has not reported a result. | Wait 30 minutes past `startedAt`. If it is still present, treat it as `exchange_unknown` below; a crashed request never writes a final state. |
| `exchange_unknown` | Plaid may have created an Item whose access token the app never saved (no recovery record). | In the current Plaid dashboard, look for an Item for this user's institution created at `startedAt`. Remove it in the dashboard if found. Then close the operation with `finishPlaidLinkOperation(uid, operationId)`. If a matching, healthy `plaid_connections` record already exists for the user (`existingPlaidLinkOwner` returns `'owner'`), the exchange did succeed; just finish the operation. |
| `revocation_pending` | The Item was created and its token retained in `plaid_revocations/{operationId}` (`status: 'revocation_pending'`), but the connection was not saved. | This is self-healing: each deletion retry calls `recoverPendingPlaidLinks(uid)`, which removes the Item with the current keys and finishes the operation. It only acts when the record's `clientId`/`environment` match the running configuration. If the user is not deleting, run `recoverPendingPlaidLinks(uid)` yourself only after `deletionRequested` is true (it refuses otherwise); for a user who is staying, remove the Item in the Plaid dashboard, then `finishPlaidLinkOperation`. Repeated `BANK_LINK_RECOVERY_REQUIRED` means Plaid returned an error other than `ITEM_NOT_FOUND`/`INVALID_ACCESS_TOKEN`; check Plaid status and retry later. |
| `ownership_conflict` (recovery record `status: 'ownership_review'`) | The exchanged Item ID already belongs to a different `plaid_connections` record, or the stored token no longer matches. `quarantinePlaidLinkRecovery` parked it so no existing owner's Item is revoked by mistake. | Human review. Compare the conflicting `plaid_connections/{itemId}.uid` with this user; confirm with both parties which login owns the institution. If the Item is a duplicate for the same person, remove the duplicate in the Plaid dashboard and `finishPlaidLinkOperation`. If it belongs to someone else, escalate: do not remove the Item, do not merge records. |

### 3.2 Billing operations

| State | Meaning | Action |
| --- | --- | --- |
| `in_flight` | `beginCheckoutOperation` opened; Checkout creation is running. | Wait 30 minutes past `startedAt`, then treat as `customer_create_unknown`. |
| `customer_create_unknown` | Stripe may have created a customer before the request failed; the app does not know its ID. | In the Stripe dashboard search customers by `metadata.firebase_uid = {uid}` created around `startedAt`. If one exists with no subscription, delete it in Stripe; if it has an active subscription the user paid for, save its ID as `user_profiles/{uid}.stripeCustomerId` and reconcile (section 4). Then `finishCheckoutOperation(uid, id)`. |
| `customer_cleanup_required` (`customerId` present) | The customer exists but could not be saved to the profile or deleted. | If the profile has no `stripeCustomerId`, either delete the customer in Stripe (no subscription) or save its ID to the profile (subscription exists). If the profile already names a different customer, delete the orphan only after confirming it has no invoices or subscriptions. Then `finishCheckoutOperation(uid, id)`. |

### 3.3 Deletion marker without a deletion

`deletionRequested: true` is written by `deleteUserData` before any provider work, so an abandoned deletion leaves it set and the user is unable to link a bank or start Checkout. If the user confirms in writing that they want to keep the account, verify `linkOperations` and `billingOperations` are empty, then set `deletionRequested: false` on `account_deletions/{uid}` from the operator environment. Keep the document; never delete it.

## 4. Stripe customer/subscription mismatch

### Symptoms

Diagnostics show `entitlement.reason` of `invalid_subscription` or `subscription_expired` while the customer's Stripe dashboard shows an active subscription; or `billing.stripeSubscriptionId` is null, or names a subscription that belongs to a different customer than `billing.stripeCustomerId`.

### Procedure

1. Ask the user to click "Fix access" (or call `POST /api/subscriptions/fix-access`, `app/api/subscriptions/fix-access/route.ts`). It runs `reconcileUserSubscription(uid, stripe)` in `lib/stripe/subscription-sync.ts`: retrieves `profile.stripeSubscriptionId`, falls back to the customer's subscriptions whose price is one of the configured IDs (`configuredPriceIds`: `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`, `STRIPE_PRICE_ID_BASIC_MONTHLY`, `STRIPE_PRICE_ID_BASIC_YEARLY` and their `NEXT_PUBLIC_`/unsuffixed aliases), and writes the profile through `syncSubscriptionForUser` with a revision check so a concurrent webhook cannot be overwritten. A subscription that no longer exists is recorded as `stripeSubscriptionStatus: 'deleted'` by `markMissingSubscription`.
2. If fix-access returns 404 "No linked subscription found", the profile has no `stripeCustomerId`, or the customer in Stripe was created under another email. In the Stripe dashboard confirm the customer's `metadata.firebase_uid` equals this UID (set it if the customer is unmistakably this user), then set `user_profiles/{uid}.stripeCustomerId` to that customer ID from the operator environment and ask the user to run fix-access again.
3. If fix-access returns 503, `assertSubscriptionOwner` most likely threw "Subscription ownership mismatch": the subscription's `metadata.firebase_uid` names a different UID, or the profile's `stripeCustomerId` differs from the subscription's customer. Resolve the identity in Stripe first (which person paid), correct `metadata.firebase_uid` or the profile's customer ID accordingly, then rerun. Do not attach a subscription to a UID it was not purchased for.
4. Price not recognised (`entitlement.plan` stays `free` although a subscription is active): the subscription's price ID is not in the configured list. Legacy Basic prices must be configured under the `STRIPE_PRICE_ID_BASIC_*` names so they map to `basic`, never to `premium` (`subscriptionPlanForPrice`). See `docs/LEGACY_BASIC_PLAN_2026-09-16.md`.
5. Verify with diagnostics: `entitlement.reason` becomes `paid_active` and `billing.syncRevision` increments.

## 5. Plaid cursor reset for one bank

The `/transactions/sync` cursor lives at `plaid_connections/{itemId}.cursor` and is committed by `syncUserTransactionsIncremental` (`lib/plaid/sync-helper.ts`) only after every write for that page sequence succeeded. Each Item has its own cursor; resetting one bank never touches another.

Use this when a bank stopped receiving updates although Plaid shows the Item healthy, or after Plaid support advises a resync. Do not use it for `reauthenticationRequired: true` (the user must relink through Link update mode) or for `relink_required`/`revocation_required` records (section 2).

1. Pull diagnostics. Confirm the target `itemId`, `status: 'active'`, `currentProvider: true`, `leaseActive: false`. A live lease means a sync or disconnect is running; wait for `leaseActive` to clear (leases expire after 20 minutes) rather than editing under it.
2. From the operator environment, set `cursor: null` on `plaid_connections/{itemId}` (only that field, plus `updatedAt`). Do not touch `encryptedAccessToken`, `accountIds` or `status`.
3. Trigger a sync: ask the user to press Sync (`POST /api/plaid/sync-transactions`), wait for the next `SYNC_UPDATES_AVAILABLE` webhook, or wait for the scheduled function `syncAllUsersTransactions` (`functions/src/index.ts`, every 2 hours). The sync restarts from the beginning of the Item's history; `saveTransaction` is idempotent by transaction ID, modified transactions update in place through `updateImportedTransactionForAnalysis` (`lib/ai/analysis-jobs.ts`) without discarding user decisions, and removed ones are flagged `bank_removed` rather than deleted.
4. Confirm `bankConnections[].hasCursor: true` and a fresh `lastSync` in diagnostics. If `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` persists past the built-in retries, Plaid is still updating the Item; retry later.

## 6. Webhook replay

### Stripe

Handler: `app/api/stripe/webhook/route.ts`. Replaying is always safe: the handler ignores the event payload's state, re-retrieves the subscription and calls `refreshSubscriptionForUser`, which records `stripe_events/{event.id}` and skips events older than the stored `stripe_sync/state.eventCreated`. A response of 500 means the sync could not be persisted and Stripe should retry; 400 means the signature did not verify against `STRIPE_WEBHOOK_SECRET`.

1. Stripe dashboard → Developers → Webhooks → the production endpoint → Events → select the missed event → Resend. Alternatively `stripe events resend <evt_id>` with the CLI.
2. Check the endpoint's recent deliveries return 200 `{ "received": true }`.
3. Verify in diagnostics that `billing.lastWebhookEventId` is the resent event (or a newer one) and `entitlement` matches Stripe. If nothing changed and the entitlement is still wrong, run section 4.

### Plaid

Handler: `app/api/plaid/webhook/route.ts`. Signed deliveries are deduplicated by `processed_webhooks/plaid_{sha256}` keyed on `webhook_id` (or the verified body when Plaid omits one), and a delivery is marked processed only after `syncUserTransactionsIncremental` succeeds, so a failed sync stays retryable.

1. For Sandbox, fire a test webhook from the Plaid dashboard (Items → Fire webhook) or `/sandbox/item/fire_webhook`. Production Items cannot be replayed on demand; run the sync directly instead (section 5 step 3, without resetting the cursor).
2. `ITEM_LOGIN_REQUIRED` errors set `reauthenticationRequired: true` through `markPlaidConnectionLoginRequired`; the user must reconnect through Link update mode (`POST /api/plaid/create-link-token` with `itemId`). Replaying the error webhook does nothing further.
3. A webhook that answers 404 "User not found" refers to an Item with no `plaid_connections` record (or a legacy profile that could not be migrated). Check diagnostics for the user who owns that institution; if the Item is unknown to the app, remove it in the Plaid dashboard.

## 7. Hosting rollback compatibility

Firebase Hosting rollback restores a previous web release while Firestore rules, indexes and Functions stay at their deployed versions (`docs/PRODUCTION_CUTOVER_2026-09-16.md`). This change set is designed to tolerate that:

- New collections `rate_limits` and `support_audit` are additive and server-only. Previous releases never read or write them; documents left behind are harmless and `rate_limits` is purged by the TTL policy once enabled. Keep the deny-all rules deployed after a rollback; they protect data that a rolled-back app simply ignores.
- No composite index is required. The limiter uses single-document transactions; diagnostics use single-field equality queries (`plaid_connections.uid`, `analysis_tasks.userId`, `analysis_jobs.userId`) that Firestore indexes automatically.
- New environment variables are optional. Without `SUPPORT_ADMIN_UIDS` the support route is a 404; without `RATE_LIMIT_HASH_SECRET` window IDs are plain SHA-256. Changing or removing the secret renames every window, which merely restarts the counts. Setting these variables on a release that predates this change has no effect.
- Behaviour after rolling back to a release without this change: only the per-instance middleware limits and the old in-memory export throttle apply, and `/api/support/account/*` returns 404. No data written by the newer release affects the older code.
- Behaviour after rolling forward again: counts restart from the durable windows already stored; no migration step is required.
- The `admin` field added to `AuthenticatedUser` (`lib/firebase/api-auth.ts`) is read from the verified token's custom claims only; setting the claim on a staff account has no effect on releases that do not read it.
- If a rollback is performed while Firestore is degraded, remember that the newer release fails closed on costly routes (503 `RATE_LIMIT_UNAVAILABLE`), while the older release would have proceeded with in-memory limits only. That is the intended difference, not a regression to fix by rolling back.

## 8. Escalation checklist

Before escalating an account, attach: the redacted diagnostics JSON (never a raw Firestore export), the `support_audit` entry time, the section of this runbook followed, the provider dashboard evidence (Item ID or customer ID, not tokens), and the exact error code the user saw (`LEGACY_BANK_REVOCATION_REQUIRED`, `ACCOUNT_OPERATION_PENDING`, `BANK_LINK_RECOVERY_REQUIRED`, `ACCOUNT_OWNERSHIP_CONFLICT`, `RATE_LIMITED`, `RATE_LIMIT_UNAVAILABLE`).
