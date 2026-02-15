# WORKFLOW_MAPS.md validation report

Validation of [WORKFLOW_MAPS.md](WORKFLOW_MAPS.md) sections 2–5 against the codebase: each atomic step was mapped to routes, components, API handlers, and Firestore usage. **Result:** One doc inaccuracy in Section 3 (transaction-loading helper name); no P0 code fixes. Recommended fix: update the Section 3 line in WORKFLOW_MAPS.md as noted below.

---

## Section 2: Plaid connection and first import

| Step | Expected (docs) | Actual (code) | Status | Evidence (file:function) | Fix |
|------|------------------|---------------|--------|---------------------------|-----|
| Route /protected/plaid exists | Page at /protected/plaid | Same | PASS | app/protected/plaid/page.tsx: default export | — |
| "Connect Bank" → /protected/plaid-link | Button navigates to plaid-link | Same | PASS | app/protected/plaid/page.tsx: onConnect → router.push('/protected/plaid-link') | — |
| POST create-link-token with Bearer | Client sends Authorization Bearer; API verifies | Same | PASS | components/plaid-link-screen.tsx: fetch with Bearer (line 156); app/api/plaid/create-link-token/route.ts: getUserFromReqOrThrow | — |
| linkTokenCreate → { link_token } | Plaid API returns link_token | Same | PASS | app/api/plaid/create-link-token/route.ts: client.linkTokenCreate, return link_token | — |
| onSuccess(public_token) → POST exchange-public-token | Client calls exchange with public_token | Same | PASS | components/plaid-link-screen.tsx: onPlaidSuccess, fetch exchange-public-token with body including public_token (lines 836-847) | — |
| itemPublicTokenExchange → access_token, item_id | Exchange route calls Plaid, gets token | Same | PASS | app/api/plaid/exchange-public-token/route.ts: itemPublicTokenExchange, then set user_profiles | — |
| Write user_profiles/{uid}: plaid_token, plaid_item_id | Firestore set on user_profiles doc | Same | PASS | app/api/plaid/exchange-public-token/route.ts: adminDb.doc(`user_profiles/${uid}`).set({ plaid_token, plaid_item_id, last_updated }, { merge: true }) | — |
| accountsGet → list accounts | Plaid accountsGet after exchange | Same | PASS | app/api/plaid/exchange-public-token/route.ts: plaidClient.accountsGet | — |
| Duplicate check → 409 | If any account_id exists under user_profiles/{uid}/accounts, return 409 | Same | PASS | app/api/plaid/exchange-public-token/route.ts: duplicate check loop, return NextResponse.json(..., 409) | — |
| Per account: write user_profiles/{uid}/accounts/{accountId} | Set account doc per Plaid account | Same | PASS | app/api/plaid/exchange-public-token/route.ts: accountRef.set(...) | — |
| fetchAllPlaidTransactions (offset pagination, options.account_ids) | Pagination uses offset; account_ids in options | Same | PASS | lib/plaid/pagination.ts: offset, count; app/api/plaid/exchange-public-token/route.ts: options: { account_ids: [accountId], ... } | — |
| Per tx: path user_profiles/.../transactions/{txId}, strip undefined | Firestore path and cleaned data before set | Same | PASS | app/api/plaid/exchange-public-token/route.ts: txRef at path; Object.fromEntries filter v !== undefined; txRef.set(cleanedData) | — |
| Response { accountId, imported } | JSON includes accountId, imported | Same | PASS | app/api/plaid/exchange-public-token/route.ts: return NextResponse.json({ ok: true, accountId: primaryAccountId, imported: totalImported, ... }) | — |
| Redirect → /protected/account-usage/{accountId}?imported={n} | Client redirects on success | Same | PASS | components/plaid-link-screen.tsx: router.push(`/protected/account-usage/${data.accountId}?imported=${data.imported}`) | — |

**Section 2 summary:** All steps PASS. No code or doc changes required.

---

## Section 3: Account classification and analysis

| Step | Expected (docs) | Actual (code) | Status | Evidence (file:function) | Fix |
|------|------------------|---------------|--------|---------------------------|-----|
| Route /protected/account-usage/[accountId] | Page exists | Same | PASS | app/protected/account-usage/[accountId]/page.tsx | — |
| User chooses Business / Personal / Mixed | Radio + optional percent | Same | PASS | usage state, percent state; body usageType, businessUsePercent | — |
| Save → PATCH /api/accounts/{accountId}/usage | PATCH with usageType, businessUsePercent? | Same | PASS | app/protected/account-usage/[accountId]/page.tsx: save(), fetch PATCH with body; app/api/accounts/[accountId]/usage/route.ts: PATCH, setAccountUsageServer | — |
| If Personal: mark-personal then redirect /protected | POST mark-personal, then router.push('/protected') | Same | PASS | app/protected/account-usage/[accountId]/page.tsx: fetch mark-personal, router.push('/protected') | — |
| If Business/Mixed: POST auto-analyze { accountId } | POST with JSON { accountId } | Same | PASS | app/protected/account-usage/[accountId]/page.tsx: fetch('/api/plaid/auto-analyze', { body: JSON.stringify({ accountId }) }) | — |
| Ensure account exists at user_profiles/{uid}/accounts/{accountId} | 404 if account doc missing | Same | PASS | app/api/plaid/auto-analyze/route.ts: accRef.get(), !accSnap.exists → 404 | — |
| jobId = uid_accountId; analysis_jobs/{jobId} | Deterministic job id and collection | Same | PASS | app/api/plaid/auto-analyze/route.ts: jobId = `${userId}_${accountId}`, jobRef = analysis_jobs.doc(jobId) | — |
| Load transactions (getTransactionsServer), batch AI | Doc says getTransactionsServer | Code uses getPendingTransactions (account subcollection) | FAIL | app/api/plaid/auto-analyze/route.ts: getPendingTransactions(userId, accountId); no getTransactionsServer | Update WORKFLOW_MAPS.md: replace "Load transactions (getTransactionsServer)" with "Load pending transactions (getPendingTransactions from user_profiles/{uid}/accounts/{accountId}/transactions)" |
| analyzeTransactionWithRetry; update transaction docs + job | AI analysis and doc updates | Same | PASS | app/api/plaid/auto-analyze/route.ts: analyzeTransactionWithRetry; job and transaction updates | — |
| Redirect plaid-link with analyzing=true or review-transactions | Redirect based on response | Same | PASS | app/protected/account-usage/[accountId]/page.tsx: if responseData.imported > 0 → review-transactions; else → plaid-link&accountId&analyzing=true | — |

**Section 3 summary:** One FAIL (doc inaccuracy: transaction loading helper name). No code change; fix by updating the doc.

---

## Section 4: Review transactions and corrections

| Step | Expected (docs) | Actual (code) | Status | Evidence (file:function) | Fix |
|------|------------------|---------------|--------|---------------------------|-----|
| screen=review-transactions on /protected | Screen state from query or setCurrentScreen | Same | PASS | app/protected/page.tsx: currentScreen, searchParams screen | — |
| transactions from useTransactions(uid), collectionGroup or API fallback | Hook uses collectionGroup with or(userId, user_id); fallback GET /api/transactions | Same | PASS | lib/firebase/hooks.ts: useTransactions, collectionGroup + or(where userId, where user_id), orderBy date; on error fallback fetch /api/transactions | — |
| User chooses Business / Personal / Keep AI → PUT /api/transactions/{id} | PUT with transactionId in URL, body updates | Same | PASS | components/review-transactions-screen.tsx: makeAuthenticatedRequest(`/api/transactions/${transactionId}`, { method: 'PUT', body: JSON.stringify(updateData) }) | — |
| updateTransactionServerWithUserId; collectionGroup find → doc.ref.update; strip undefined | Server finds by collectionGroup, updates with filtered data | Same | PASS | app/api/transactions/[id]/route.ts: updateTransactionServerWithUserId; lib/firebase/transactions-server.ts: collectionGroup query, Object.fromEntries filter undefined, doc.ref.update | — |
| If correction: getTransactionServer(uid, transactionId) | Single-transaction read for original analysis | Same | PASS | app/api/transactions/[id]/route.ts: getTransactionServer(user.uid, transactionId) | — |
| recordCorrection: strip undefined, user_corrections.set, updateLearningPatterns | Clean object; write user_corrections; update learning_patterns | Same | PASS | lib/ai/learning-engine.ts: JSON.parse(JSON.stringify(correction)); user_corrections.doc(id).set(cleanCorrection); updateLearningPatterns with cleanPatterns | — |

**Section 4 summary:** All steps PASS. No changes required.

---

## Section 5: Sync (incremental and full)

| Step | Expected (docs) | Actual (code) | Status | Evidence (file:function) | Fix |
|------|------------------|---------------|--------|---------------------------|-----|
| On visit: /protected, bankConnected → POST sync-transactions { incremental: true } once | useEffect with hasSyncedOnVisitRef, body userId + incremental: true | Same | PASS | app/protected/page.tsx: useEffect with bankConnected, user?.id, hasSyncedOnVisitRef; makeAuthenticatedRequest POST body JSON.stringify({ userId: user.id, incremental: true }) | — |
| Manual: PlaidScreen or BanksDetailScreen Sync → POST sync-transactions | Button triggers fetch to sync-transactions | Same | PASS | components/plaid-screen.tsx: fetch('/api/plaid/sync-transactions', ...); components/banks-detail-screen.tsx: fetch('/api/plaid/sync-transactions', ...) | — |
| POST body { userId, import_timeframe?, incremental? } | Route reads body; incremental decides path | Same | PASS | app/api/plaid/sync-transactions/route.ts: body = await req.json(), { userId = uid, import_timeframe = '2years', incremental = false } | — |
| incremental === true → syncUserTransactionsIncremental(uid) | Branch calls incremental helper | Same | PASS | app/api/plaid/sync-transactions/route.ts: incremental ? syncUserTransactionsIncremental(uid) : syncUserTransactions(...) | — |
| Get plaid_transactions_cursor from user profile | Read from userProfile | Same | PASS | lib/plaid/sync-helper.ts: cursor = userProfile.plaid_transactions_cursor | — |
| Loop transactionsSync({ cursor }) → added, modified, removed | Plaid transactionsSync with cursor | Same | PASS | lib/plaid/sync-helper.ts: client.transactionsSync({ access_token, cursor, options }) | — |
| Write new via createTransactionServer; update profile plaid_transactions_cursor, last_sync | createTransactionServer per tx; upsert profile | Same | PASS | lib/plaid/sync-helper.ts: createTransactionServer; upsertUserProfileServer with plaid_transactions_cursor, last_sync | — |
| Else: syncUserTransactions; getTransactionDateRange; fetchAllPlaidTransactions (no account_ids); createTransactionServer | Full sync: date range, fetch all, write per tx | Same | PASS | lib/plaid/sync-helper.ts: getTransactionDateRange; fetchAllPlaidTransactions without account_ids in options; createTransactionServer in loop | — |

**Section 5 summary:** All steps PASS. No changes required.

---

## Mismatches and breakpoints (as requested)

- **Bearer token:** All relevant API routes (create-link-token, exchange-public-token, sync-transactions, accounts usage, mark-personal, auto-analyze, transactions PUT) use `getUserFromReqOrThrow` or `getAuthenticatedUser` and require Bearer. Client sends Authorization in all cases checked. PASS.
- **account_ids in options:** Exchange and import pass `account_ids` inside `options` to fetchAllPlaidTransactions; pagination passes through. PASS.
- **Firestore path:** user_profiles (not users) used everywhere. PASS.
- **Redirect and query params:** account-usage redirect uses `data.accountId` and `data.imported`; account-usage page redirects use `accountId` and screen/analyzing. PASS.
- **Doc inaccuracy:** Section 3 states "Load transactions (getTransactionsServer)" but auto-analyze uses **getPendingTransactions** (queries `user_profiles/{uid}/accounts/{accountId}/transactions` for pending only). Fix: update WORKFLOW_MAPS.md text to "Load pending transactions (getPendingTransactions from account subcollection)".

---

## Fixes applied

- **WORKFLOW_MAPS.md Section 3:** Replaced "Load transactions (getTransactionsServer)" with "Load pending transactions (getPendingTransactions from user_profiles/{uid}/accounts/{accountId}/transactions)" in the ASCII block so the doc matches the implementation.

**Recommended doc fix (if not yet applied):** In WORKFLOW_MAPS.md Section 3, replace "Load transactions (getTransactionsServer)" with "Load pending transactions (getPendingTransactions from user_profiles/{uid}/accounts/{accountId}/transactions)".
