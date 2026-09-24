# Owner review: September 24, 2026

## Open the updated app

Use **http://127.0.0.1:3002/protected** on this computer. The preview is restricted to the configured verified owner account and uses its real saved records. Intentional edits and manual AI reviews are saved to that account. Bank syncing, billing, provider webhooks, account deletion and legacy bank migration are disabled in this preview.

Production remains on application commit `a219cbe`. The changes below are local review changes and have **not** been deployed. Do not deploy them until the owner has reviewed the app.

## Changes since the live release

- Withdrawn, pending and superseded bank records no longer influence AI merchant-history context. Confirmed user decisions are preserved.
- Removed an older profit/loss screen that substituted sample transactions for an empty account and ignored its period selector. Its existing URL now opens the authenticated, period-aware cash-flow report and requires report entitlement.
- Compact dashboard review notices show the next action first. Full calculation-blocking explanations remain under “Why review is needed.” The next-step list no longer repeats the long explanation.

## Verification

- 345 focused AI/context/profile/review/persistence tests passed; new indexed and legacy history regressions failed before the fix and passed afterward.
- 432 tax/year/context/export assertions passed. A fresh 14-case real GPT-4.1-mini evaluation passed with the configured production key, synthetic records and mocked Firebase. No customer data was modified by that evaluation.
- 304 security checks passed, including 19 actual Firestore/Storage emulator tests for account isolation and protected data. These overlap broader suites and must not be added to previous totals.
- 43 report/subscription and 101 dashboard/review-route tests passed for the local changes. TypeScript passed.
- The owner preview restored the authenticated account. The former profit/loss URL displayed actual backend records. Bank-sync and Stripe-checkout routes returned 403 as required by preview isolation.

Tax verification sources and supported scope are recorded in [the current source audit](validation/tax-year-release-check-2026-09-24.json). Selected 2025/2026 federal sole-proprietor/disregarded LLC cases are supported. Published 2027 parameters are tracked; complete 2027 estimates and transaction tax determinations remain blocked where annual values are unpublished. The product does not support every tax situation or automatic filing.

## Test these flows

1. Home: open the shorter review explanation; follow its income-reconciliation action. Your current overlapping income correctly blocks a tax total until clarified.
2. Transactions: open an existing purchase, inspect AI explanation and tax year, add a genuine business-purpose detail if needed, and rerun analysis. Confirm only decisions you agree with.
3. Refresh: reopen the transaction and confirm the intentional edit remains saved.
4. Reports: open `?screen=profit-loss-detail`, change annual/monthly period, and verify your own records. Cash flow is not taxable profit.
5. Use the live site for bank consent/MFA and paid checkout testing; those operations are deliberately blocked in this real-account preview.

## Honest readiness boundaries

Personal balances, transactions, estimates and suggestions are dynamic. Tax tables, reviewed guidance, categories and interface text are intentionally maintained constants. Stored profile/transaction changes trigger relevant analysis; stale results cannot overwrite newer facts. Selected persistence paths are tested, not every historical production record.

No system is unhackable. Reviewed cross-user and privilege boundaries passed, but comprehensive rules-level type/size constraints for owner-editable fields and stricter CSP remain hardening work. This is not an independent penetration-test certification.

Before broad acquisition, finish a real bank import/sync/webhook lifecycle, a new paid checkout and applicable settlement, and authorized production application-email delivery checks. Recovery/operational alert delivery were verified in the preceding release; see [production integration evidence](PRODUCTION_INTEGRATIONS_2026-09-24.md).
