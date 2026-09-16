# Federal tax coverage and release references

Reviewed September 16, 2026. This describes the local staging implementation; it is not evidence of deployment or complete-return certification. Earlier broad platform counts do not validate tax eligibility or every taxpayer situation.

## Intended initial scope

Recordkeeping, receipt review and accountant handoff can serve a wider audience than the calculator. Federal planning estimates should initially be limited to screened simple cases: a single, nondependent adult under 65, ordinary wages and/or one domestic positive-profit Schedule C business, confirmed expenses, reconciled income, a base standard deduction, and below-threshold QBI without carryovers or special deductions/credits. The current app does **not** enforce this entire screen; the exclusions below remain release gates for broader tax claims.

Published annual parameter sets exist for 2024, 2025 and 2026. The calculator rejects 2027. Do not represent all 2027 annual amounts or final filing forms as known. Bracket calculations are planning amounts; IRS tax-table rounding and complete returns are not certified.

## Income reconciliation implemented in this batch

- Posted transactions in the selected year count when explicitly categorized `income`/`revenue`, or entered as income in the manual account. A negative bank amount alone is insufficient: the database normalizer derives `type: income` from the amount sign, including transfers and refunds.
- Transaction identifiers deduplicate repeated reads. Unclassified bank credits are excluded with a calculation warning; they are not silently classified as taxable business receipts.
- Gross receipts, income transactions and 1099 forms are alternative evidence that can overlap. Without a verified link, mixed sources return HTTP 422 `INCOME_RECONCILIATION_REQUIRED`; no guessed total is produced. Multiple unlinked 1099 forms also require review, since a NEC and K can report overlapping earnings.
- New platform-summary imports store the generated receipt's ID on the associated 1099. The tax snapshot counts the receipt once when its linked document has the same amount and import provenance. Missing links or gross/net mismatches require review. Historical imports are not automatically matched by name or amount.
- Standalone business NEC/K amounts can be used. MISC, INT, DIV and B forms, and gross receipts explicitly entered as rental/investment income, require classification review rather than automatic Schedule C treatment.
- Profile income projections are not added as another income source. Detailed W-2 documents take precedence over legacy profile withholding. Detailed retirement contributions take precedence over the corresponding aggregate profile amount.
- The JSON 1040 estimate and Form1040 PDF now call the same federal snapshot. Schedule C export and Schedule SE auto use the same business-income reconciliation policy. Quarterly summaries and reminders now consume the annual federal response; they withhold payment recommendations pending separate full-year/payment review.
- The four supported filing-status labels saved by onboarding are normalized to the engine keys before federal calculations; the PDF selects the same status. Unsupported or invalid nonempty labels return actionable HTTP 422 `FILING_STATUS_REVIEW_REQUIRED`. Qualifying widow(er)/surviving spouse is explicitly review-blocked, not treated as Single. Legacy profiles without a status retain the existing Single default and require profile review; this is not an eligibility determination.
- The dashboard tax cards use the shared federal endpoint and its review/error states; they no longer derive Schedule C profit or quarterly tax from sign-based cash flow. Other profile-based savings helpers use filing-status normalization; savings, monthly-deduction and profit/loss endpoints return the same 422 for invalid statuses. Existing simplified formulas and 2025 default parameters in those other helpers are unchanged and remain planning limitations. Call sites without any profile still use their existing generic rate assumption.

There is no payment-matching/reconciliation UI yet. The 422 is an explicit review requirement, not a claim that records have been reconciled. Existing overlapping records need a reviewed matching workflow before broad tax-estimate rollout. Do not advise deleting supporting records merely to bypass this gate.

The IRS requires reporting taxable business income even without an information return. Information returns must be reconciled with underlying records, not automatically added to the receipts they describe. Sources: [IRS gig economy tax center](https://www.irs.gov/businesses/gig-economy-tax-center), [understanding Form 1099-K](https://www.irs.gov/businesses/understanding-your-form-1099-k).

## Reference matrix

These are specific cases, not an exhaustive tax-code review. Tests use synthetic records, real calculation/route handlers and mocked persistence/provider transport. The platform-import regression mocks AI extraction; it does not validate OCR accuracy.

| Case | Expected result | Coverage |
|---|---|---|
| 2026 single, $100,000 ordinary wages, no credits/adjustments | Standard deduction $16,100; taxable income $83,900; bracket tax $13,170 | Existing calculator and route tests |
| $100,000 Schedule C profit; W-2 Social Security wages $184,500 | Social Security portion of SE tax $0; regular Medicare/SE tax $2,678.15; rounded half-SE deduction $1,339.08 | Actual W-2 POST → calculation, SE/reminders and PDF input tests |
| Same profit, single, Medicare wages $210,000 | Additional Medicare Tax $921.15 | Actual save → calculator regression |
| Manual/classified transaction-only business income $100,000 | Gross receipts $100,000 | Shared snapshot route regression |
| One platform import creates $100,000 receipt and linked $100,000 1099 | Gross receipts $100,000, not $200,000 | Actual import route with mocked extraction → calculation regression |
| Unlinked receipt and 1099 may overlap | Actionable 422; no tax total/PDF | JSON/PDF response equivalence regression |
| Organizer interest and dependent count supplied | JSON and PDF receive the same federal inputs/results | Consistency test only; does not validate dependent eligibility |
| Onboarding saves Single, Married Filing Jointly/Separately, or Head of Household | Canonical filing status, corresponding 2026 base deduction, matching JSON/PDF inputs and PDF checkbox | Actual onboarding mapper → tax route/PDF regression; eligibility not certified |
| Qualifying Widower or invalid persisted filing-status value | Actionable 422 before calculating tax | JSON/PDF, SE auto and both quarterly-route regressions |
| Legacy profile-based savings helper receives an onboarding label or invalid value | Label equals canonical rate; invalid value withholds the estimate | Helper/API regressions; simplified rate assumptions remain |
| Dashboard receives shared federal snapshot, review-required response or failure | Displays shared year-specific amounts and warnings; review/error states withhold amounts instead of substituting zero | Real-component-to-route regressions; deployed synthetic dashboard/API parity |
| Standalone SEP example: $100,000 profit, no W-2, 25% plan rate | Reduced self-employed rate 20%; $18,587.05 maximum using unrounded half-SE in the standalone helper | Existing regression; end-to-end cents rounding can differ by $0.01 |
| Organizer reports Social Security benefits, including $20,000 with no other recorded income | Review-required 422; no estimate/PDF based on incomplete benefit facts | Organizer-to-JSON/PDF regressions; prior 85% shortcut removed, full Pub. 915 calculation not implemented |

Annual deduction/bracket source: [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf). SE arithmetic: [2026 Form1040-ES, page9 worksheet](https://www.irs.gov/pub/irs-pdf/f1040es.pdf). Additional Medicare: [IRS Topic560](https://www.irs.gov/taxtopics/tc560). SEP: [Publication560 reduced-rate worksheet](https://www.irs.gov/publications/p560). Social Security: [Publication915](https://www.irs.gov/publications/p915).

## Remaining unsupported scenarios and release gaps

1. **Unlinked overlapping income:** no reconciliation UI or historical payment provenance. Linked imports do not yet provide file-level idempotency across repeated uploads. Bank deposits can be net of fees; a matching deposit total does not prove gross receipts.
2. **Social Security, investments and retirement:** declared or ambiguous Social Security benefits now block federal estimates and Form1040 export with `SOCIAL_SECURITY_REVIEW_REQUIRED`; saved records remain available. Required net-benefit and other worksheet facts are not collected, so benefit taxability is not calculated. Organizer gains are still assumed long-term; qualified-dividend character, capital-loss limits, retirement basis/penalties and rental/passive-activity treatment remain unmodeled. [Benefit review validation](TAX_SOCIAL_SECURITY_VALIDATION_2026-09-16.md), [Publication915](https://www.irs.gov/publications/p915), [Topic409](https://www.irs.gov/taxtopics/tc409).
3. **Dependents and credits:** a dependent count does not establish child age, residency, support, SSN or EITC eligibility; exact EITC tables and all ACTC alternatives are not covered. [Child Tax Credit requirements](https://www.irs.gov/credits-deductions/individuals/child-tax-credit).
4. **Filing status and household facts:** age/blindness/dependent standard deductions, married-separate spouse itemization/community property, and separate spouse SE wage bases are not fully handled. Married W-2 amounts must not be assumed to belong to the self-employed spouse.
5. **Losses and complex QBI:** business losses are clamped in the planning engine. Carryovers, high-income wage/property/SSTB limitations and the 2026 minimum active-business deduction need additional facts and validated implementation. [Form8995 instructions](https://www.irs.gov/instructions/i8995), [2026 Publication505](https://www.irs.gov/publications/p505).
6. **Deduction eligibility:** health-insurance, HSA, retirement and student-loan inputs do not establish every limit, phaseout, coverage test or allowable deduction. New federal deductions and alternative minimum/net-investment-income taxes are not comprehensively covered.
7. **Home office:** allocation alone is not an allowable deduction. The pure helper supports only a narrowly specified eligible rental-home actual-expense case. The existing UI does not collect the required facts, so final Form8829 export remains review-blocked. [Form8829 instructions](https://www.irs.gov/instructions/i8829).
8. **Assets:** first-year nonlisted 5/7-year MACRS half-year calculations only. Section179, bonus depreciation, vehicles, prior-year history, straight-line and mid-quarter cases return review-required responses. Eligibility/elections must be established; a vehicle photograph or claimed weight is insufficient. [Publication946](https://www.irs.gov/publications/p946).
9. **Quarterly planning:** authenticated summaries now share the annual calculation and withhold installment/penalty verdicts. The public tool illustrates original regular-method installments using reviewed annual tax, withholding, prior-year AGI and explicit eligibility facts; missing exemption facts require review. It does not calculate an annual return, current payment balance, annualized income or Form2210 penalties. Unsupported generated vouchers are blocked. Payment timing, changed filing status, special rules and relief still need separate review. [Quarterly validation](TAX_QUARTERLY_VALIDATION_2026-09-16.md), [2026 Publication505](https://www.irs.gov/publications/p505).
10. **Other taxes/payments:** 1099 withholding and all Additional Medicare withholding reconciliation are not fully integrated. State estimates are separate, simplified and not validated by selected year; local taxes and disaster relief are not covered.
11. **Presentation and filing:** matching PDF/JSON totals is not proof of an official, complete or e-file-ready IRS return. Provider/OCR accuracy and real staging journeys require separate validation.

## Focused verification

Run `tests/business-income-reconciliation.test.ts`, `tests/w2-tax-contract-integration.test.ts`, `tests/schedule-c-export-year.test.tsx`, `tests/compute-1040-api.test.ts`, `tests/tax-calculator-regressions.test.ts` and `tests/tax-consumer-handlers.test.ts`. The final batch count and deployment status must come from the integrated release run, not this document.
