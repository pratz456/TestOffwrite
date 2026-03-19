# TaxBandits Migration Test Plan (Column Tax Removal)

This document covers verification for:
- Column Tax removal (no broken imports/routes/usages)
- TaxBandits redirect flow correctness
- Firestore session state + webhook status updates
- Error UX

## Prerequisites
- Dev server running: `npm run dev`
- User is authenticated
- TaxBandits redirect URL env var configured:
  - `TAXBANDITS_REDIRECT_BASE_URL` (preferred) or `TAXBANDITS_REDIRECT_URL`

## Manual Tests

### 1) Screen & copy
1. Navigate to `/protected/file-taxes`.
2. Verify:
   - Top banner says you are leaving WriteOff and will be redirected to TaxBandits (external partner / verify before submitting).
   - Tax year selector renders.
   - Schedule C summary preview renders when deductible categories exist.
   - Primary CTA is labeled `Continue to TaxBandits`.

### 2) Pre-redirect confirmation behavior
1. Click `Continue to TaxBandits`.
2. Verify a confirmation step is shown:
   - Explicit wording about leaving WriteOff
   - Cancel button returns to review state
3. Click Cancel.
4. Verify:
   - You return to the review UI
   - No redirect occurred

### 3) Redirect flow success path
1. Click `Continue to TaxBandits`.
2. Check the confirmation checkbox.
3. Click `Continue to TaxBandits` again (confirmation CTA).
4. Verify:
   - Browser navigates to TaxBandits (external navigation).
   - No Column Tax embed/module is loaded.

### 4) Firestore session state creation
1. While dev is running, trigger a redirect session as in test (3).
2. Verify in Firestore:
   - A document exists in `user_tax_filing_sessions/{sessionId}`
   - `provider === "taxbandits"`
   - `taxYear` matches the selected year
   - `status === "redirected"`
   - `redirectAttemptCount === 1`
   - Summary fields exist (totals/counts/line items)

### 5) Server error UX when redirect URL is not configured
1. Temporarily set `TAXBANDITS_REDIRECT_BASE_URL` / `TAXBANDITS_REDIRECT_URL` to empty (or remove).
2. Attempt redirect from `/protected/file-taxes`.
3. Verify:
   - User sees the error card with a clear message.
   - UI does not crash.

### 6) Status + webhook updates (if TaxBandits supports callbacks)
1. Create a session (as in manual test 3).
2. Simulate webhook by calling `POST /api/tax/taxbandits/webhook` with JSON like:
   - `sessionId` (or `externalRef`)
   - `status`
3. Verify Firestore session doc updates:
   - `status` changes to the normalized status
   - `lastUpdatedAt` changes

### 7) Status endpoint access control
1. Call `GET /api/tax/taxbandits/status?sessionId={sessionId}` while authenticated as the session owner.
2. Verify:
   - Response includes session status and metadata
3. Repeat with a different user.
4. Verify:
   - Response is `403 Unauthorized`.

## Automated Tests (Unit-Level with Vitest)
These tests should run in `vitest` with mocked dependencies (no real Firebase).

### A) Redirect URL builder
Test that:
- A valid base URL produces a redirect URL containing:
  - `provider=taxbandits`
  - `sessionId={...}`
  - `taxYear={...}`
- Existing query params are preserved.

### B) Aggregation -> summary mapping
Test that:
- `aggregateScheduleC(transactions, taxYear)` output is mapped into `TaxFilingSummary`
- Totals and counts are consistent
- Line items are correctly mapped.

### C) Session state creation logic
Test that:
- `createTaxFilingSession` sets:
  - `status === "redirected"`
  - `redirectAttemptCount === 1`

### D) Webhook normalization + update behavior
Test that:
- webhook normalization maps input statuses to canonical statuses
- session update happens when sessionId is present

## Automation Notes
- Current Vitest config excludes the existing DB integration test file; keep TaxBandits tests unit-only.
- Mock `adminDb` / Firestore layer when unit-testing the session helpers.

