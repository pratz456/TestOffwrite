# Automatic analysis refresh after profile changes

Relevant saved profile changes now automatically refresh existing transaction suggestions. Confirmed bookkeeping categories, deductions and review decisions remain unchanged. The new AI result is a suggestion for the user to review.

## Behavior

- Profile writes are compared using a shared tax/business field list. Name, email, subscription and sync metadata do not trigger analysis.
- The profile event queues a private, durable job using the latest saved profile. Replayed and out-of-order events coalesce. Work scans one account and at most 25 transaction records per delivery, then persists a continuation generation.
- Eligible posted records are compared with the current normalized profile hash. Completed analyses for older profile facts are requeued; current analyses are skipped. Pending and superseded records remain excluded.
- Refresh invalidates only AI-owned suggestions, explanations and estimates. User classifications and receipts stay intact. Both automatic and manual commits check that the profile and transaction still match the inputs used for analysis.
- Settings acknowledges relevant edits. Detail and swipe review hide old AI content while work runs; real-time updates and a pending-only read fallback show the persisted result without a browser reload. The fallback never calls OpenAI.
- The coordinator is server-only and included in account cleanup. Per-account analysis jobs own progress counts; the coordinator records durable scan progress without a retry-sensitive enqueue counter.

## Validation

- Full default test suite: **5,536 passed; 44 opt-in checks skipped**. Includes 20 new coordinator cases and 10 new worker cases for pagination, idempotency, profile races, lease recovery, preservation and retry behavior.
- TypeScript, the production app build and the separate analysis Functions build passed. Scoped lint had zero errors; warnings remain.
- Fresh Firebase Functions/emulator + funded OpenAI test: initial analyses of two synthetic transactions, followed by automatic reanalysis after a profile edit. Both new suggestions were saved with changed profile hashes using `gpt-4.1-mini-2025-04-14`. A confirmed decision stayed identical, an unreviewed decision stayed unconfirmed, a pending purchase was excluded, and cosmetic edits did not schedule model work.
- Browser Settings save displayed the automatic refresh acknowledgment after a synthetic profession change; transaction detail then displayed the newly persisted AI question.
- Four real emulator permission checks rejected owner and anonymous reads/writes of the refresh coordinator.
- Reproducible funded-provider test: `node scripts/local-profile-refresh-smoke.mjs --run-funded-provider-tests`, after starting the isolated demo with all four analysis functions loaded.
- Synthetic evidence: `docs/validation/profile-refresh-live-2026-09-23.json`.

## Release and scope

This is implemented on `codex/2027-tax-coverage` and the isolated localhost demo. It has not been deployed to production. The coordinated release must deploy the app, rules and analysis codebase, including the new `queueProfileAnalysisRefresh` and `processProfileAnalysisRefresh` Functions alongside the existing bank-analysis functions.

Refresh is asynchronous and needs a configured provider with available credit. Existing failed analyses can still be retried manually. A profile refresh does not automatically revise a user's confirmed tax decision or turn an unsupported tax calculation into a supported one. Tax rules, reviewed guidance and calculation formulas remain governed by the existing source and eligibility boundaries.
