# Personal deduction validation — September 16, 2026

## Scope

WriteOff calculates standard deductions for reviewed age, blindness and dependency facts for 2024–2026, plus the enhanced senior deduction for 2025–2026. The organizer persists these declarations by year, and the shared annual engine supplies the API, dashboard, quarterly summary and PDF. These supported calculations do not certify a complete return.

The supported ordinary case is a full calendar-year return for living U.S. citizens/residents, with no territorial standard-deduction allocation, nonresident/dual-status special rules or disaster-loss increase. Other cases receive an actionable review error. The existing four filing statuses are supported; qualifying surviving spouse is not silently mapped to another status. No 2027 inflation parameters are inferred. Although the senior provision is enacted for 2025–2028, this engine only accepts published supported tax years.

## Rules and sources

The base deduction comes from the existing versioned federal parameters. Additional amounts are counted separately for age and blindness. January 1 birthdays qualify using the IRS day-before-birthday rule. For dependents, the basic amount is the lesser of the filing-status base and the greater of the annual minimum or reviewed earned income plus $450; age/blind additions follow that limit. An MFS spouse who itemizes makes the taxpayer’s standard deduction zero. A separate spouse’s age/blindness counts only after explicit confirmation of no gross income, no filed return and no dependency claim eligibility. [Publication 501, standard deduction tables and examples](https://www.irs.gov/publications/p501).

| Year | Dependent minimum | Married age/blind amount per box | Single/HOH amount per box |
|---|---:|---:|---:|
| 2024 | $1,300 | $1,550 | $1,950 |
| 2025 | $1,350 | $1,600 | $2,000 |
| 2026 | $1,350 | $1,650 | $2,050 |

Sources: [2024 Rev. Proc. 2023-34, section 3.15](https://www.irs.gov/pub/irs-drop/rp-23-34.pdf), [2025 IRS standard-deduction guidance](https://www.irs.gov/taxtopics/tc551), and [2026 Rev. Proc. 2025-32, section 4.14](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf).

The enhanced senior deduction requires age eligibility and a Social Security number valid for employment issued by the return due date, including extensions. Each qualifying spouse is tested separately; married taxpayers must file jointly. Itemization does not disqualify an otherwise eligible senior. [Publication 554, enhanced deduction for seniors](https://www.irs.gov/publications/p554).

Schedule 1-A adds excluded Puerto Rico income, Form 2555 lines 45 and 50, and Form 4563 line 15 to AGI. The reduction is 6% of MAGI above $75,000, or $150,000 jointly, applied to each person’s $6,000 amount. Two eligible spouses therefore both phase out at $250,000 MAGI. [2025 Schedule 1-A, Parts I and V](https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf). The 2026 age cutoff, amount and thresholds are also stated in [2026 Publication 505](https://www.irs.gov/publications/p505).

## Integration contract

- `calculateStandardDeduction({ taxYear, filingStatus, organizer })` returns the allowed `standardDeduction`, base/age-blind breakdown, dependency flag and MFS exclusion explanation. The engine compares this result against separately supplied itemized deductions and preserves a correctly calculated zero standard deduction.
- `calculateEnhancedSeniorDeduction({ taxYear, filingStatus, agi, organizer })` returns `deduction` plus per-person eligibility/phaseout details. The engine uses final AGI, including taxable Social Security; the senior deduction remains below AGI and does not reduce Social Security combined income.
- The senior amount also reduces taxable income **before** the QBI income limitation. The 2025 Form 8995 instructions compute this income from AGI less standard/itemized and Schedule 1-A deductions. [Form 8995 instructions, line 11](https://www.irs.gov/instructions/i8995).
- Annual, quarterly and PDF routes map `PersonalDeductionReviewRequiredError` to HTTP 422 with code `PERSONAL_DEDUCTION_REVIEW_REQUIRED`. Dashboard and preview consumers preserve the organizer guidance without substituting zero for missing facts.
- The organizer saves `personalDeductionFacts` as one text answer containing a JSON object with `version: 1`, the selected numeric `taxYear`, and text answers. Existing `dateOfBirth` and `spouseDoB` fields supply dates. Invalid JSON, nontext answers, unsupported versions and year mismatch require review. No actual SSN is stored in this new field.
- `PersonalDeductionFields` is controlled by the organizer’s `answers` and `onChange`. All Yes/No selections begin unanswered. Old-year answers are cleared from the visible form and are not transferred automatically. The organizer save request persists the complete field.
- `tests/fixtures/personal-deductions.ts` exports explicit **synthetic reviewed facts for tests only**. These must never become application defaults for existing or new users.

## Reference cases

| Case | Expected |
|---|---|
| 2026 single, under 65, not blind/dependent | Standard $16,100 |
| 2026 single, age 65 and blind | Standard $20,200 |
| 2026 joint, both 65 and blind | Standard $38,800 |
| 2025 blind dependent, earned income $2,900 | Standard $5,350 |
| 2026 dependent with no earned income | Standard $1,350 |
| 2026 MFS, spouse itemizes | Standard $0 |
| 2026 DOB January 1, 1962 / January 2, 1962 | Age eligible / not eligible |
| 2026 eligible single senior, MAGI $75,000 / $100,000 / $175,000 | Senior $6,000 / $4,500 / $0 |
| 2026 two eligible joint seniors, MAGI $200,000 | Senior $6,000 total |
| Senior AGI $70,000 plus four addbacks totaling $20,000 | MAGI $90,000; deduction $5,100 |
| Prior-year answers or unknown SSN/addbacks | Review response, no invented amount |

## Remaining boundaries

An eligibility declaration is not independent document verification. This helper does not decide whether a dependent actually satisfies relationship/support/residency tests, compute dependent credits or kiddie tax, validate itemized expenses, calculate foreign exclusions, or prepare territorial returns. The earned-income worksheet amount must include the correct work income, taxable scholarships and business-loss treatment; it is not guessed from bank deposits. Positive foreign/territory addback arithmetic does not establish eligibility for the rest of the annual engine.

Deployment and evidence apply to the staging site only. Full-suite, compiled HTTP and browser results are documented separately in the staging validation reports. No production rollout or complete-return coverage is implied.

## Organizer and PDF integration checks

The organizer mounts the personal-deduction questions once and supports 2024–2026 records separately. A year change saves edited answers to the original year before reading another record. Failed saves or reads preserve the current answers and show an error; an initial failed lookup cannot be saved over with blank defaults. The complete empty organizer has 66 answer keys, within the persistence limit of 80. Identity and refund details are labeled optional preparer handoff records; WriteOff does not submit returns or promise IRS refund timing.

The PDF uses the same snapshot as JSON. Its 2025+ planning layout shows the senior amount below AGI on line 13b and includes it with standard/itemized and QBI deductions in line 14. The 2024 layout has no senior line. These labels follow the published [2025 Form 1040, lines 12e–15](https://www.irs.gov/pub/irs-pdf/f1040.pdf); the 2026 export explicitly identifies its 2025 form layout and is not an official IRS form. Personal-deduction and dependent-credit review errors return JSON422 before PDF creation.

Focused integration checks cover failed/successful year changes, account-change stale responses, full organizer persistence, senior deduction amounts for all three supported years, QBI cap/total parity, and PDF review responses. A synthetic 2026 PDF with $60,000 wages, $18,150 standard deduction and $6,000 senior deduction was rendered and visually checked on both pages. This verifies layout and the supported examples, not completeness of a tax return or deployment.

## Final evidence status

The six focused annual/API/dashboard/quarterly/preview test files passed **72 tests** after explicit current-year synthetic declarations were added. Cases retain missing/stale-fact review errors and a separate dependent-parent review case. The real shared snapshot preserves $50,000 Social Security combined income, $17,000 taxable benefits and $57,000 AGI while applying the $6,000 senior deduction below AGI. Another fixture verifies the senior deduction reduces the Form 8995 taxable-income cap to a $2,604.82 QBI deduction.

Independent review found that date-of-birth integration could activate a $664 no-child EITC refund for a $10,000 wage fixture without full credit-eligibility facts. Annual routes now require review whenever a potential positive EITC remains unverified; dependency answers alone do not prove valid SSNs, a U.S. main home for more than half the year, or the absence of qualifying-child status. The low-level credit arithmetic remains available for explicitly assumed calculation tests. [Publication 596, rules 2 and 11–14](https://www.irs.gov/publications/p596).

The deployed staging probe passed **15/15 checks** against `https://writeoff-production-testing.web.app`, app commit `49cc7551d494f05456349bd742fd70508ecd639a`, build `k8rMRLkl0UPdv9rQVgkfB`, revision `ssrwriteoffproductionte-00019-qon` (released September 16, 2026, at 17:45:48 UTC). It used actual profile, W-2 and organizer save/read requests and real deployed tax routes. Its synthetic Auth owner and every tracked Firestore document were removed after the run. No production, AI, bank, payment-provider or email-send requests were made.

| Deployed check | Verified result |
|---|---|
| Missing/stale personal declarations | Annual, PDF and both quarterly entrypoints return actionable 422 without totals |
| Unsupported 2027 | Annual, PDF and quarterly reject the year |
| Ordinary under-65 wages $100,000 | Standard $16,100; annual and quarterly federal tax both $13,170; no invented installment recommendation |
| Single DOB January 1, 1962, AGI $100,000 | Standard $18,150; senior $4,500; taxable income $77,350; tax $11,729 |
| DOB January 2, 1962 | Under 65 for 2026; standard $16,100 and no senior amount |
| Joint, two eligible seniors, AGI $200,000 | Standard $35,500; senior $6,000 total ($3,000 each) |
| Single age 65 and blind | Standard $20,200 plus eligible $6,000 senior amount |
| Adult blind dependent, $30,000 interest and no earned income | Standard $3,400 ($1,350 minimum plus $2,050 blindness addition) |
| MFS spouse itemizes | Standard $0, standard not selected, senior $0 |
| Reviewed $40,000 taxable retirement income and $20,000 net Social Security | Taxable benefits $17,000; AGI $57,000; senior $6,000; tax $3,694; withholding $1,200; balance $2,494 |
| Generic dependent parent and potential positive EITC | All annual/PDF/quarterly paths require credit review without invented credits or refunds |
| Free-plan PDF and voucher | Both return the subscription gate before calculation |

The single-senior, joint-senior and Social Security PDF amounts matched JSON. All six pages were rendered and visually inspected; deduction and withholding rows were legible and the 2026 planning-summary scope notice was present. This is example-based evidence, not validation of every tax scenario or an official IRS return.

Sanitized evidence is stored at `/tmp/writeoff-staging-tax-v8-evidence.json`; the runner is `/tmp/writeoff-staging-tax-v8-probe.mjs`. An initial unpaced attempt passed six checks before the shared staging rate limiter returned HTTP 429 for the remaining requests. That attempt was cleaned up and preserved at `/tmp/writeoff-staging-tax-v8-rate-limited-attempt.json`. The final run spaced API requests 2.2 seconds apart and completed all checks without a rate-limit retry. Application rate limits were unchanged.
