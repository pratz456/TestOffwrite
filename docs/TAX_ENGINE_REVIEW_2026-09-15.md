# Tax engine review — September 15, 2026

## Conclusion and scope

The site is online and contains substantial product functionality. The inspected tax engine produces incorrect results in reproducible examples and is not ready to be presented as a validated tax-return calculator.

Reviewed local `codex/prelaunch-readiness` at `ad7b371`, based on `TestOffwrite/march-branch` at `7c9aecd`. The earlier onboarding fixes do not modify these tax calculations. The exact deployed Git revision remains unconfirmed, so these examples establish behavior of the inspected repository rather than proving a particular customer's production result.

The existing successful suite has 29 tests, including 11 focused on Schedule C and quarterly aggregation. Those tests cover date boundaries, duplicate transactions, pending transactions, confirmed deductions, refunds and cent rounding. They do not comprehensively test Form 1040, credits, retirement limits or tax-year-specific rules.

## Reproduced results

These examples called the real calculation functions locally with synthetic data. No customer records, external transactions, signup, payment or deployment was involved.

### 1. Child tax credit is double-counted

Input: 2025, single, age 35, $100,000 W-2 wages, one qualifying child, no other income or deductions, no tax payments. Earned Income Tax Credit is zero at this income.

Actual `compute1040` output:

- Child Tax Credit: $2,200.
- Additional Child Tax Credit: $1,700.
- Balance without a child: $13,449.
- Balance with a child: $9,549.
- Total child-related benefit: **$3,900**.

Expected child-credit benefit for this scenario: **$2,200**, with **$0** Additional Child Tax Credit because the regular credit is fully usable. The app understates the remaining balance by $1,700 due to this credit error. This comparison isolates the credit difference; it is not a certification of the remaining Form 1040 calculation.

Cause: `lib/tax-rules/credits.ts:218` computes the refundable amount independently of unused credit/tax liability. `lib/tax-rules/compute-1040.ts:252` then subtracts the full regular credit and adds the refundable amount to payments.

Source: [2025 IRS Schedule 8812](https://www.irs.gov/pub/irs-pdf/f1040s8.pdf), lines 14, 16a and 17. Part II stops when the credit on line 12 has already been fully used on line 14.

### 2. Changing the tax year does not change the main tax rules

Input: the same $100,000 single-filer W-2 scenario with no children, selecting 2024, 2025 and 2026.

Actual result for all three years: **$15,750 standard deduction** and **$13,449 calculated income tax**. `compute1040` accepts `taxYear` but always uses the 2025 deduction and bracket functions. Schedule SE also uses one fixed wage base despite accepting a year. The separate quarterly calculator contains 2023 bracket thresholds.

For example, the 2026 base standard deduction for a single filer is $16,100, so applying $15,750 for that year is incorrect.

Code: `lib/tax-rules/compute-1040.ts:169`, `lib/tax-rules/federal-brackets.ts:89`, `lib/reports/calcSE.ts`, and `lib/tax-provider/quarterly-estimates.ts:309`.

Sources: [IRS 2026 inflation adjustments](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill), [IRS 2023 thresholds](https://www.irs.gov/irb/2022-45_IRB).

### 3. Self-employed SEP-IRA maximum is overstated

Input: $100,000 sole-proprietor net profit, no W-2 wages, 2025.

- Actual `calculateSEPIRAMax(100000)`: **$23,233.81**.
- Result using the reduced self-employed rate: **$18,587.05**.
- Overstatement: **$4,646.76**.

Cause: `lib/tax-rules/credits.ts:291` multiplies profit after the half-SE-tax deduction by 25%, instead of using the reduced 20% rate for this self-employed contribution calculation. Other limit interactions still require separate validation.

Source: [IRS Publication 560](https://www.irs.gov/publications/p560), contribution limits and the self-employed rate worksheet.

### 4. Quarterly calculation silently ignores manual income

Input: `aggregateQuarterlyEstimatesForYear([], 2025, 'America/Los_Angeles', { filingStatus: 'single', manualGrossReceipts: 100000 })`.

Actual result: **$0 gross income and $0 suggested payment in every quarter**.

Cause: the helper declares `manualGrossReceipts`, health-insurance and retirement inputs but never uses them in its calculation. The quarterly API also does not fetch or pass manual gross receipts/1099 income. Exact payment allocation needs dated income and a defined estimation method, but silently dropping this income is a definite integration defect.

Code: `lib/tax-provider/quarterly-estimates.ts:354`, `app/api/tax/quarterly-estimates/route.ts:72`.

That route also hardcodes `paidAmount = 0`, despite a separate quarterly-payment storage feature. It cannot reliably tell the user their remaining payment from those records.

## Further issues identified by inspection

These need dedicated fixtures and correction before release:

- SALT deduction is capped at $10,000 in the main engine, despite the updated 2025 limit and income-based reduction. See [IRS Topic 503](https://www.irs.gov/taxtopics/tc503).
- The 1040 API sums manual gross receipts and 1099 forms without visible reconciliation between them; the same income represented in both sources may be counted twice.
- The main API sets Schedule C losses to zero. A supported loss scenario needs correct treatment or an explicit unsupported result.
- Depreciation reduces income in `compute1040`, while the calling API computes SE tax from profit before that depreciation adjustment.
- Additional Medicare Tax is included in `calcScheduleSE.totalSETax`, then separately calculated and added in `compute1040`. The helpers also use inconsistent filing-status strings.
- The organizer assumes all dependents qualify for child-based credits and all capital gains are long-term. It applies 85% taxability to all Social Security benefits rather than calculating the taxable portion.
- Several different federal/state calculation paths serve the dashboard, public calculators, assistant, quarterly estimates and exports. Consistency between those paths is not established.

## Recommended product direction

Make WriteOff a reliable weekly financial workflow for freelancers:

1. One calculation engine, explicitly selected by tax year and supported situation, used by every screen and export. Unsupported situations should request missing information or explain the limitation.
2. A home screen answering: **what needs review, what should I set aside, what is due next?** Numbers should show whether inputs are complete and when accounts last synced.
3. Extend the existing AI categorization into evidence-backed deduction review: transaction, business purpose, receipt, business-use percentage, explanation and user confirmation. AI suggestions should feed deterministic calculations after review.
4. Reconcile bank deposits, invoices, manual receipts and 1099 forms into one income ledger; track transfers, refunds, duplicates and pending transactions consistently.
5. Give a new user a first useful outcome quickly through bank linking or an import/manual path, with saved onboarding progress and recoverable failures.
6. Make accountant handoff dependable: a reconciled Schedule C summary, supporting documents, unresolved questions and export totals that match the dashboard.

The inspected filing screen opens external provider websites. That alone does not establish integrated filing, a data-transfer agreement, or filing included in the subscription.

## Release evidence required

- Reference scenarios covering tax years, filing statuses, mixed W-2/self-employment, credit eligibility and limits, losses, capital gains, withholding, payments and retirement deductions.
- IRS-form-based expected results and qualified tax-professional review of the supported calculation scope.
- End-to-end testing in the testing project: signup, verification, bank linking/import, review, dashboard, estimates, export, subscription and cancellation.
- Cross-screen reconciliation: identical input data must yield consistent totals everywhere.
- A small pilot with measured first-use activation, repeat use, import success and support burden before scaling acquisition.

This review added documentation only. It did not change the tax engine, push commits, merge pull requests, deploy, or start marketing campaigns.
