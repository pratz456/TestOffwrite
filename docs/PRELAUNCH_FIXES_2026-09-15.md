# Pre-launch fixes — September 15, 2026

This is the second local implementation batch on `codex/prelaunch-readiness`, following the sourced photo-assistant foundation. It has not been pushed or deployed. Three agents handled tax calculations, onboarding and Firebase security; integration work connected payment records and calculation consumers.

## User-visible fixes

### Onboarding and verification

- Profile completion now sends the dashboard screen key expected by the embedded app. The standalone route maps that key to a valid destination. Previously a complete URL could be inserted into another URL or used as a screen name, producing a blank screen.
- Failed profile reads offer Retry instead of treating the user as a new profile and exposing an overwrite path.
- Saves preserve zero and decimal values, reject invalid percentages and dimensions, omit skipped business fields, retain drafts on failure, and guard duplicate submissions.
- Signup waits for the verification flow. Verification refreshes the Firebase token and requires successful server-session creation before continuing. Sequential checks recover from transient errors; manual retry and a resend cooldown are available.

### Federal calculation corrections

Published 2024, 2025 and 2026 parameters are now selected by tax year. Unverified years return an explicit error at the updated calculation APIs. Existing legacy helper calls without a year retain their documented 2025 default.

Reference scenarios now give:

| Scenario | Before | After |
| --- | --- | --- |
| Single, 2025, wage income 100,000, one qualifying child, enough income-tax liability | Combined CTC/ACTC benefit 3,900 | Combined benefit 2,200; ACTC zero |
| Sole proprietor, 2025, profit 100,000, no W-2 wages, standard SEP scenario | SEP maximum 23,233.81 | SEP maximum 18,587.05 |
| Single, wage income 100,000, basic deduction, no children | Same ordinary tax for every year | 2024: 13,841; 2025: 13,449; 2026: 13,170 |

Amounts are dollars; these isolate tested formula behavior, not certification of a complete return.

Additional changes include year-specific Social Security wage bases, EITC and capital-gain parameters; SALT caps and phaseouts; long-term capital-gain stacking; and separate treatment of Additional Medicare Tax. Regular Schedule SE and its half-tax deduction now exclude Additional Medicare Tax. W-2 Social Security wages reduce the same taxpayer's available wage base, and the 1040 flow uses Box 5 Medicare wages when available.

The main 1040 and PDF flows apply depreciation before computing Schedule SE. They read the same owner-scoped quarterly-payment records that the tracking screen writes. Main 1040 calculations use W-2 withholding in preference to duplicating it with profile totals, and a failed profile/transaction load no longer becomes a calculation based on zeros.

Calculation limitations are displayed near tax figures in the preview, filing hub and Form 8879 screen, and carried into the PDF warning list. These notices describe remaining gaps instead of implying that successful calculation means a filing-ready return.

### Payment records and deadlines

- Calculation, reminders and export paths now read `user_profiles/{uid}/quarterly_payments/Q{quarter}_{year}` and its `paidAmount`, matching the payment tracker. The old consumers queried a different top-level collection and `amount` field.
- Payment-tracker GET no longer creates records. Missing estimates remain unpaid/unknown instead of being labeled paid because zero equals zero.
- Payment additions and estimate updates use Firestore transactions, preventing concurrent saves from losing or overwriting paid totals. Dates, quarters, years and finite amounts are validated.
- Standard individual federal estimated-tax dates handle weekends, DC Emancipation Day and the January federal holiday interaction. Special disaster relief and individual exceptions remain outside this helper.
- The quarterly projection no longer calls one-quarter of income an IRS safe-harbor amount or infers payments from any merchant name containing “irs.” It uses explicitly recorded payments.

### Receipt and account-data security

- Receipt upload verifies the transaction belongs to the authenticated user. Receipt links support verified Firebase session cookies as well as bearer ID tokens, with an origin check for cookie-based uploads.
- Uploads bound the actual request stream, file count, size, MIME type and file signature. New receipt bytes go to private Cloud Storage; Firestore holds metadata with a flat receipt ID. This avoids oversized Firestore documents and broken multi-segment URLs.
- Downloads check the owner, send private/no-store and nosniff headers, and preserve compatible legacy reads. Stored owner fields govern analysis-job access; a matching ID prefix is not enough to read another owner's existing job.
- Firestore rules restrict analysis jobs/status reads, close transaction update add/remove-field bypasses, and prevent client-created profiles from granting subscription entitlements. Legitimate server trial/subscription writers continue using Admin access.
- Storage rules enforce owner paths and supported file types/sizes for creates and replacements.
- The service worker caches only explicitly public build/brand assets. Private APIs, authenticated pages and account-sensitive navigation use the network. An activation hook clears this app's known legacy API/page/image caches while preserving unrelated caches.

## Validation

Automated checks use synthetic data and mocked providers, plus a separate opt-in suite against real local Firestore and Storage emulators under `demo-writeoff-security`. The emulator suite defaults to skipped during ordinary tests and makes no network requests or initializes no Firebase apps in that state.

Onboarding desktop/mobile checks exercised mocked versions of the actual components: invalid-input blocking, retained draft after save failure, successful retry, resend failure/recovery, cooldown and manual verification. No live account signup, email, bank connection, receipt upload or signing was performed.

The complete batch passed `npm run ci` in an isolated checkout at code commit `7b8f189`, excluding concurrent landing-page edits: **232 tests passed across 16 files**, the opt-in 11-test emulator suite was skipped in this ordinary run, lint had **zero errors** (1,031 warnings remain), and the production build succeeded. The **11 emulator tests passed separately** against local demo services. TypeScript and the mocked desktop/mobile onboarding and tax-consumer handler checks also passed.

Generated production artifacts were inspected and executed with synthetic cache state: 187 precache entries contained no API, protected or auth routes; compiled private request matchers selected NetworkOnly; the imported custom worker deleted 14 known legacy sensitive cache names while preserving unrelated/public/precache storage. All three current/legacy/process receipt routes appeared in the built route manifest.

No Firebase rules, code, hosting configuration or source commits have been published. These checks establish local code/build behavior, not production end-to-end verification or complete tax-law accuracy.

## Remaining work and limits

This batch corrects specific defects; it does not validate every tax situation or every endpoint. Remaining work includes:

- Full child/dependent eligibility, the alternate ACTC methods, exact EITC table matching, age/blind/dependent standard deductions and complex QBI rules. These cannot be inferred from an organizer's simple dependent count.
- Business-loss limits and treatment, Social Security benefit taxation, capital-gain source classification, and reconciliation of income represented in banks, manual entries and 1099s.
- The separate transaction-based quarterly projection still has legacy estimation formulas and undated manual-income limitations. The public calculators retain their explicitly labeled 2025 scope. More consolidation is required before all screens can be treated as one validated calculation engine.
- Full safe-harbor treatment using prior-year AGI, prior-return eligibility, withholding and installment timing. The payment tracker's existing approximate penalty display is not a validated Form 2210 calculation.
- State-specific year rules and special deadline relief.
- Real staging verification of Firebase session handling, bucket configuration/permissions, receipt compatibility, offline-update behavior, banking, subscriptions and mobile input.
- Idempotent user retry semantics for recording payments: transactions protect concurrent writes but a deliberately repeated successful POST still records another payment.

The existing audit remains a record of the pre-fix baseline. Use this report and the new regression tests to distinguish corrected issues from outstanding work.

## Primary references

- [IRS 2026 adjustments, Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf)
- [IRS Schedule 8812 instructions](https://www.irs.gov/instructions/i1040s8)
- [IRS Publication 560: retirement plans](https://www.irs.gov/publications/p560)
- [Social Security annual contribution and benefit bases](https://www.ssa.gov/oact/COLA/cbb.html)
- [IRS Schedule SE instructions](https://www.irs.gov/instructions/i1040sse)
- [IRS Additional Medicare Tax](https://www.irs.gov/taxtopics/tc560)
- [IRS Publication 505: withholding and estimated tax](https://www.irs.gov/publications/p505)

Year-specific source links are also embedded in the rules registry and the earlier research reports.
