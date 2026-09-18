# Quarterly planning validation — September 16, 2026

## Scope and outcome

This staging batch removes the legacy quarter-profit × 4 tax formula, its unversioned rates, and unsupported safe-harbor/payment-status conclusions. It does not expand annual tax eligibility or implement Form 2210. Local automated checks are not evidence of deployment.

Authenticated quarterly summaries now use the exact annual `compute-1040` response. Annual figures describe saved records, which can cover only part of the year. A separate review state withholds installment recommendations, safe-harbor totals, “on track” and penalty-risk verdicts. Existing income/filing-status/depreciation/Social Security review responses remain actionable and contain no substitute tax total. Client-supplied transactions, profiles and tax amounts cannot override the owner’s saved annual calculation.

The public tool compares original regular-method installments from a **reviewed annual federal tax amount**, expected full-year withholding and explicit prior-return facts. It does not contain a second income-to-tax engine. Inputs are used in that calculator only; they are not written into a profile or represented as verified return facts. Changing an input clears the previous result.

## IRS reference rules

For an ordinary calendar-year regular-method case, the annual target generally compares 90% of current tax with 100% of qualifying prior-year tax. The prior-year multiplier becomes 110% when **prior-year AGI** exceeds $150,000, or $75,000 for current-year married filing separately. A prior return must cover 12 months; changed joint/separate returns require adjustments. The tool requires reviewed tax amounts, rather than assuming Form 1040 line 24 always equals the worksheet amount. [2026 Form 1040-ES, instructions and worksheet](https://www.irs.gov/pub/irs-pdf/f1040es.pdf).

Expected annual withholding reduces the target. The ordinary under $1,000 test uses forecast tax less withholding, not estimated payments already made. Payment timing matters independently: annual totals do not prove timely installments or penalty protection. The annualized-income method uses cumulative periods ending March 31, May 31, August 31 and December 31; calendar quarters multiplied by four do not implement that method. [2026 Publication 505, chapter 2 and worksheets 2-1/2-9](https://www.irs.gov/publications/p505).

## Implemented boundaries

- Published years 2024–2026 only; 2027 is rejected.
- Regular-method results require explicit reviewed amounts and scope confirmation. Missing, malformed, negative tax/withholding amounts and unknown prior-return availability produce review messages rather than zero.
- Prior-year AGI is an explicit separate input; negative AGI is permitted. Exactly $150,000 / $75,000 does not trigger 110%. Eligible zero prior tax remains zero instead of becoming “missing.”
- Prior-return comparison requires a full 12-month return, unchanged taxpayer(s) and filing status and full-year U.S. citizen/resident confirmation. Other facts remain review-blocked. No return or a short prior year uses the current-year method only after explicit selection and confirmation that the no-prior-tax exception does not exempt the taxpayer. Unknown exemption eligibility is review-blocked; no return does not mean prior tax was nonzero.
- Results show original regular installments, before any already-recorded payments. They never subtract YTD payments and redistribute the remainder across four past deadlines. Cent allocation preserves the annual total.
- Standard deadlines use the existing UTC calendar helper, including weekend/DC holiday handling. The 2026 dates are April 15, June 15, September 15 and January 15, 2027. No special-relief eligibility is inferred.
- The annual engine no longer emits a safe-harbor or quarterly recommendation from prior-year tax alone; it adds review guidance.
- Payment tracking preserves amounts/dates and editable user targets, labels actual payments “recorded,” and does not infer tax sufficiency. The old flat 8% penalty estimate is removed. An entered target remains a user target, not a server tax obligation.
- The generated imitation 1040-ES voucher endpoint is review-blocked, including when a caller supplies its own calculation. The UI links to the official IRS worksheet/vouchers instead. Authentication and plan gates remain enforced.

## Testable reference cases

| Synthetic facts | Expected result |
|---|---|
| Prior tax $10,000; prior AGI $150,000, Single | Prior target $10,000 |
| Same, AGI $150,000.01 | Prior target $11,000 |
| MFS prior AGI $75,000 / $75,000.01 | Prior target $10,000 / $11,000 |
| Current tax $8,000; prior target $10,000; withholding $2,000 | Annual installments total $5,200; original four installments $1,300 |
| Forecast tax less withholding $999.99 / $1,000 | Ordinary installment requirement $0 / 90% target less withholding |
| Explicit eligible prior tax $0 | Prior target $0; no missing-value fallback |
| No prior return; exemption eligibility unknown | Review required; no installment figure |
| IRS example: forecast $71,253; prior tax $42,581; prior AGI $180,000 | Targets $64,127.70 and $46,839.10; select lower (IRS example displays whole dollars) |
| Saved annual records / quarterly summary | Same federal income tax, SE and total tax; payment recommendation fields null |
| Existing Social Security or overlapping income review | Same 422 code/message; no annual or quarterly amount |
| Any unreviewed caller calculation passed to voucher endpoint | 422 review response; no PDF |
| Expired user target plus partial recorded payment | “Payment recorded”; no penalty or paid-in-full verdict |

## Verification and limitations

Focused tests cover the real annual/quarterly route handlers with mocked persistence/auth, reviewed-target arithmetic, UI request/change handlers, payment-record updates and legacy estimator restrictions. Deadline/helper and UI tests run under both `Pacific/Kiritimati` and `America/Los_Angeles`. The compiled smoke script additionally checks annual/quarterly parity, review-null fields, recorded-payment semantics and voucher restrictions. The coordinating task owns final full-suite/build/live validation counts.

Local handoff checks: 195 tests passed across eight focused/regression files; the 32 helper/UI tests also passed separately in each timezone above. TypeScript and `git diff --check` passed. Targeted lint had zero errors and 24 warnings. The updated compiled HTTP checks have not yet run against this batch; no deployment is asserted here.

Annualized income, first-income-after-Q1 schedules, withholding timing elections, actual installment allocation across payment dates, changed filing status, farming/fishing, nonresident/fiscal-year returns, section 1062 elections, disaster relief and Form 2210 penalties remain unsupported. A checked scope box is a user assertion. The annual engine’s existing complex-tax exclusions still apply. This batch offers a reviewed regular-method illustration and safer recordkeeping, not universal payment advice or tax-return certification.
