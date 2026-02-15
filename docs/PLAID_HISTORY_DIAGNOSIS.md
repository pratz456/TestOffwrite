# Plaid History Diagnosis

Diagnosis guide for "Requested date range > Plaid returned range" (e.g., requested ~181 days, Plaid returned only ~89 days).

---

## Code Map

| Flow | File Paths |
|------|------------|
| Initial import (transactionsGet) | `lib/plaid/pagination.ts` (`fetchAllPlaidTransactions`), `app/api/plaid/exchange-public-token/route.ts`, `app/api/plaid/import-transactions/route.ts` |
| Incremental sync (transactionsSync) | `lib/plaid/sync-helper.ts` (`syncUserTransactionsIncremental`) |
| Date range helpers | `lib/subscriptions/historical-access.ts` (`getTransactionDateRange`), `lib/plaid/sync-helper.ts` (`syncUserTransactions`) |
| Plaid client | `lib/plaid/client.ts`, `lib/plaid/debug.ts` |
| Firestore writes | `lib/firebase/transactions-server.ts` (`createTransactionServer`, `updateTransactionFromPlaidServer`), `lib/firebase/profiles-server.ts` (`upsertUserProfileServer`) |
| Post-fetch filtering | `lib/plaid/pagination.ts` (no date filtering; only concat), `lib/plaid/sync-helper.ts` (filters pending txns only) |

---

## All Possible Causes (Checklist)

### 1. Plaid/Institution Limitation

- [ ] Bank truly does not have older data (most common)
- [ ] Plaid Sandbox has limited test data (typically 30–40 days)
- [ ] Account was connected recently; Plaid starts tracking from connection date
- [ ] Institution limits historical data via Plaid API

**Evidence:** When `total_transactions === fetched` AND `earliest_tx_date > requested_start_date`, Plaid has returned everything it has.

### 2. Request Bug

- [ ] Wrong `start_date` or `end_date` passed to Plaid
- [ ] `account_ids` passed at top level instead of inside `options`
- [ ] Timezone conversion issues (dates shifted)

### 3. Pagination Bug

- [ ] Offset/count logic incorrect
- [ ] Loop exits early (e.g., `transactions.length < PAGE_SIZE` misinterpreted)
- [ ] `total_transactions` not used correctly for `hasMore`

### 4. Filtering/Storage Bug

- [ ] Post-fetch date filtering dropping older transactions
- [ ] Dedupe removing older records incorrectly
- [ ] Doc ID collisions overwriting across accounts
- [ ] Only storing transactions for a single account

### 5. Account/Item State

- [ ] Item requires reauth (`item.status` indicates error)
- [ ] Multiple accounts but only one selected
- [ ] Wrong item for current user

### 6. Endpoint Strategy Mismatch

- [ ] Using `transactionsSync` (cursor, no date range) when expecting `transactionsGet` (date range)
- [ ] Using `transactionsGet` for incremental sync instead of `transactionsSync`

---

## Evidence from This Codebase

### Request Payload Structure (transactionsGet)

- `start_date`, `end_date`: YYYY-MM-DD strings
- `options.account_ids`: Array of Plaid account IDs (inside `options`)
- `options.count`, `options.offset`: Pagination (set by `lib/plaid/pagination.ts`)
- Verified: `account_ids` are passed inside `options` in exchange-public-token, import-transactions, and pagination.

### Key Files

- `lib/plaid/pagination.ts`: `fetchAllPlaidTransactions`; offset pagination; logs `earliestTxDate`, `latestTxDate`, `plaidTotalTransactions`, `isPlaidLimitation`.
- `app/api/plaid/exchange-public-token/route.ts`: Initial connect; stores `plaid_connected_at`, `plaid_requested_start_date`, `plaid_earliest_returned_tx_date`, `plaid_imported_count` in `user_profiles/{uid}`.
- `app/api/plaid/import-transactions/route.ts`: Manual re-import; stores same metadata.
- `app/api/plaid/items/route.ts`: GET returns `plaid_*` metadata for banks page.
- `components/banks-detail-screen.tsx`: Banner when `plaid_earliest_returned_tx_date > plaid_requested_start_date`.

---

## Conclusion (How to Determine)

1. Run with `DEBUG_PLAID=true` in `.env.local`.
2. Connect a bank and perform an initial import.
3. Capture logs: request payload (`start_date`, `end_date`, `options.account_ids`), response `total_transactions`, `fetched` count, `min(tx.date)`, `max(tx.date)`.
4. **If** `total_transactions === fetched` **and** `earliest_tx_date > requested_start_date`:
   - **Conclusion:** Plaid/institution limitation likely. Bank does not have older data; no app bug.

---

## Fixes Applied (Diff Summary)

| Phase | Change |
|-------|--------|
| 2 | Extended `logPlaidRequest` for item_id, institution_id; added `logPlaidRequest` in exchange-public-token and import-transactions; added DEBUG_PLAID full payload log in pagination.ts. |
| 3 | Added DEBUG_PLAID structured summary in pagination (minTxDate, maxTxDate, fetchedCount, plaidTotalTransactions, isPlaidLimitation); stored `plaid_connected_at`, `plaid_requested_start_date`, `plaid_earliest_returned_tx_date`, `plaid_imported_count` in user_profiles on exchange and import. |
| 4 | Audit confirmed: no post-fetch date filtering; doc IDs = transaction_id; pagination loop correct. No code changes. |
| 5 | Added item.status/error logging in exchange (after itemGet) and sync-helper (itemGet when DEBUG_PLAID); added log for multiple accounts/single import in import-transactions. |
| 6 | Added plaid_* fields to UserProfile; extended /api/plaid/items GET; added limited-history banner on banks-detail-screen. |

---

## Manual Verification Steps

1. Set `DEBUG_PLAID=true` in `.env.local`.
2. Connect a bank (Plaid Link) and complete exchange.
3. Check server logs for `[DEBUG_PLAID]` entries: request payload, item status, fetch summary.
4. Inspect Firestore `user_profiles/{uid}` for `plaid_connected_at`, `plaid_requested_start_date`, `plaid_earliest_returned_tx_date`, `plaid_imported_count`.
5. Open banks page; verify banner shows when `plaid_earliest_returned_tx_date > plaid_requested_start_date`.
6. Confirm "Bank provided transactions from X onward" message displays.
