# AI-native transaction review — verified locally September 16, 2026

## Delivered behavior

- Newly posted transactions enter a durable AI queue. Pending bank entries wait for posting. Credits, refunds, transfers and zero-value entries are no longer excluded merely because their amount is not positive. Existing records can use explicit catch-up or manual analysis.
- AI saves a separate structured suggestion: transaction kind, category, explanation, relevant tax year, official source links, missing-fact questions and records to keep. It does not silently replace a user's saved classification.
- Swipe right confirms the saved suggestion. Swipe left opens correction. Later defers the card without confirming it. Failed and stale saves retain the card.
- Known categories can be confirmed while tax eligibility remains unresolved. The review screen separates completed category review from missing tax details.
- The review endpoint checks the authenticated owner, current transaction and business-profile fingerprints. Confirmation is atomic and repeat requests are idempotent.
- Unsupported tax methods and unresolved deductions remain out of confirmed Schedule C, quarterly and dashboard totals. Detail edits reconcile the server-owned review state; CSV exports identify unresolved tax treatment.

## Actual provider and browser verification

The saved server OpenAI configuration successfully called `gpt-4o-mini`. These were real provider responses, using synthetic data in the local `demo-writeoff-security` Firebase emulators, not mocked successful responses or production taxpayer data.

The final automatic-analysis matrix passed all nine cases:

| Synthetic record | Saved result |
| --- | --- |
| Printer paper and pens | Supplies and small tools; eligibility requires further review in this run |
| Client meal | Business meals; meal conditions remain unresolved |
| Unspecified Amazon purchase | Other; asks what was purchased and its purpose |
| 7,000-pound SUV purchase | Vehicle category; business use and placed-in-service facts requested; no automatic Section 179 write-off |
| Family groceries | Personal, nondeductible |
| Customer invoice payment | Business income, not an expense deduction |
| Printer-paper refund | Refund; asks for the original purchase and tax year |
| Transfer between own accounts | Transfer, not an expense deduction |
| 2027 design software | Software category; tax determination blocked because this packet does not verify 2027 treatment |

Every case was inserted as pending, verified to have no analysis task, then posted and automatically analyzed through the Firestore trigger and local worker. The test also verified saved official sources, no silent tax approval, category confirmation, idempotent duplicate confirmation, stale-input rejection with HTTP 409, and an actual manual provider retry for an expired/free-plan user.

Browser checks verified manual analysis, source-linked explanations, missing-fact questions, correction controls, Later and confirmation. A synthetic $63.25 client meal was categorized and confirmed in the UI while `is_deductible` remained null and `tax_review_required` stayed true. The live local federal snapshot remained: $100,000 receipts, $350.01 confirmed deductions, $99,649.99 Schedule C profit and $22,257.85 federal estimate. Category confirmation did not add an unverified meal deduction.

Evidence on this workstation:

- `/tmp/writeoff-ai-native-smoke.json` — final real-provider matrix and assertion results.
- `/tmp/writeoff-ai-review-tax-snapshot.json` — local tax snapshot after UI confirmation.
- `/tmp/writeoff-ai-native-full-tests.log` — 2,012 tests passed; 11 emulator security tests skipped in the normal suite.
- `/tmp/writeoff-ai-native-build.log` — successful production build with type checking.

The dedicated analysis Functions TypeScript build passed. Changed-file ESLint reported zero errors (existing and loose-type warnings remain). The destructive security test suite was not run against the active walkthrough database. No Firestore security rules changed in this batch.

Reproduce the live provider checks with an already running, explicitly funded local demo:

```sh
node scripts/local-ai-review-smoke.mjs --run-funded-provider-tests
```

The script is fixed to loopback ports and the demo Firebase project. It creates isolated synthetic users and bank records, and uses the server's existing provider configuration without reading or printing the API key.

## Deployment and tax limits

This batch is local staging source and localhost preview work. It has not been pushed or deployed to `writeoffapp.com`. The worker bridge still allows the staging project and the exact local emulator configuration; production promotion needs its reviewed project/origin configuration and deployment.

The tax packet covers selected 2025/2026 federal sole-proprietor/disregarded LLC transaction rules. It is not comprehensive federal/state tax law, complete return preparation, 2027 coverage, or a guarantee that every model interpretation is correct. Meals, vehicles, assets, travel and home offices require fuller eligibility/method review. See [tax grounding and source scope](TRANSACTION_AI_TAX_GROUNDING_2026-09-16.md).

Real Plaid bank import delivery, Stripe payment testing and production worker delivery are not established by these local synthetic tests. The new review flow does not itself file a return.
