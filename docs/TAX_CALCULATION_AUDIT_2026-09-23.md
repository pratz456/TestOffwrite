# Federal calculation audit, September 23, 2026

## Scope and outcome

This audit traced the ordinary federal brackets, regular self-employment tax, Additional Medicare tax, the simplified profile/KPI rate helpers, annual QBI threshold handling, and Schedule C deductions passed to the state estimator. It is a calculation and boundary review, not certification of a complete tax return, all credits, or every state. No live customer records or provider calls were used.

Confirmed defects corrected:

1. `calculateEffectiveTaxRate` and `calcCombinedSERate` previously used an uncapped 15.3% of 92.35% of profit. They now reuse regular Schedule SE calculation, including its Social Security ceiling, remaining same-owner wage base where provided, and net-earnings minimum. Combined tax includes separate Additional Medicare tax; that tax is excluded from the half-SE deduction.
2. `getMarginalTaxRate` previously selected a bracket from gross business income. It now uses income after the modeled half-SE adjustment and standard deduction, including W-2 income separately.
3. Missing, malformed, nonfinite or negative profile income no longer silently supplies a generic 25% rate. `TaxRateReviewRequiredError` requires profile review. Explicit zero remains valid, W-2-only inputs are supported, and the display wrapper returns an unavailable rate instead of crashing.
4. `compute1040` previously assigned a generic linear QBI phaseout above the annual threshold, without business type, business wages or qualified-property data. Positive QBI above the threshold now raises `QBIReviewRequiredError`; it does not publish a fabricated deduction or an assumed zero. Threshold equality remains supported. API/UI handlers must preserve the review-required result.
5. The state-estimator call now receives Schedule C line 31 after depreciation, de minimis expenses and home-office deduction. It previously omitted the latter two adjustments.
6. Affected 2026 active-business minimum-QBI and section 68 itemized-deduction cases now require review instead of publishing a known incomplete tax amount. The scope error also prevents a joint return's unidentified W-2 wages from being assigned to the wrong self-employed spouse's wage base.
7. The public 1099 calculator now applies the same above-threshold QBI, 2026 minimum-QBI and joint wage-ownership boundaries. Its previous omission of all above-threshold QBI could overstate a final total. Public callers must render these typed errors as review-required states without numeric totals; UI verification is recorded by the parent task.
8. Basic profile rates no longer subtract health-insurance, retirement or HSA claims without verified eligibility and annual limits. Positive claims, including legacy field aliases, now return `TAX_RATE_REVIEW_REQUIRED` and direct the user to deduction review in Tax Organizer. Zero or absent claims preserve the basic calculation.

The strict unsupported-year boundary remains: full 2027 calculations do not borrow 2026 figures. Selected 2027 guidance is handled separately.

## Primary sources checked live

| Source | Checked against implementation |
| --- | --- |
| [SSA contribution and benefit bases](https://www.ssa.gov/oact/cola/cbb.html) | 2024 $168,600, 2025 $176,100, 2026 $184,500 Social Security base; 12.4% self-employment Social Security and uncapped 2.9% regular Medicare. |
| [2025 Schedule SE](https://www.irs.gov/pub/irs-pdf/f1040sse.pdf) and [instructions](https://www.irs.gov/instructions/i1040sse) | Net-profit adjustment, $400 net-earnings minimum, wage-base coordination and separate spouse calculations. |
| [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf) | 2026 ordinary planning rates and standard deductions; SE worksheet uses 92.35%, the remaining $184,500 wage base and half of regular SE tax. |
| [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) | 2026 bracket and deduction amounts, §4.26 QBI thresholds ($201,750 single/HOH, $201,775 MFS, $403,500 joint), and §4.31 excess-business-loss threshold ($256,000/$512,000 joint). |
| [Rev. Proc. 2024-40](https://www.irs.gov/pub/irs-drop/rp-24-40.pdf) | 2025 ordinary brackets and QBI threshold baseline. The registry separately reflects later enacted 2025 standard-deduction changes. |
| [Form 8959 instructions](https://www.irs.gov/instructions/i8959) | 0.9% Additional Medicare, filing-status thresholds, wage and self-employment coordination, and joint wage aggregation for this distinct tax. |
| [Form 8995 instructions](https://www.irs.gov/instructions/i8995) and [Form 8995-A instructions](https://www.irs.gov/instructions/i8995a) | QBI reductions, taxable-income/net-capital-gain cap, and the need for SSTB, business-W-2 and UBIA information above the threshold. |
| [Form 461 instructions](https://www.irs.gov/instructions/i461) | Business-loss limitation scope and carryforward treatment. |
| [P.L. 119-21 §§70105 and 70111](https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm) | $400 minimum-QBI eligibility requires at least $1,000 active QBI with material participation; §68 applies the 2/37 reduction after other itemized limits, ignoring that reduction for QBI. |

## Independent worked regression cases

| 2026 case | Expected result |
| --- | --- |
| Single, $300,000 profit, no W-2, basic profile/KPI helper | Net earnings $277,050; regular SE $30,912.45; half-SE deduction $15,456.23; Additional Medicare $693.45; ordinary income tax $62,724.57; combined modeled tax $94,330.47. QBI and credits are outside this basic helper. |
| $400 profit | Net earnings below $400; no regular SE liability. |
| $500 profit | Regular SE $70.65; no ordinary income tax under the basic standard-deduction assumptions. |
| Single, $100,000 profit plus same-owner W-2 Social Security wages $180,000 | Remaining SS base $4,500; regular SE $3,236.15; half-SE deduction $1,618.08. |
| Single, $60,000 profit, no adjustments except half-SE | Ordinary marginal bracket is 12%, not the 22% bracket selected from gross profit. |
| Single, zero business profit and $100,000 W-2 wages | Ordinary tax $13,170; effective ordinary income-tax rate 13.17%. No invented 25% fallback. |
| Positive QBI at each filing status's 2026 taxable-income threshold, then one cent above | Threshold remains inclusive; one cent above requires Form 8995-A review. |
| Pennsylvania, $50,000 initial business profit minus $1,000 depreciation, $2,000 de minimis expense and $1,500 home office | State calculation receives $45,500 business income; modeled PA tax $1,396.85. |
| 2026 positive QBI at least $1,000 with the ordinary deduction below $400 | Review required until the active-business eligibility rules are supported. |
| 2026 single itemizer at the §68 comparison boundary ($640,600), then one cent above | Exact boundary remains available; a positive reduction requires review. Prior-year treatment remains separate. |
| Joint return with both W-2 wages and business profit, without spouse ownership | Calculation withheld pending wage ownership and separate Schedule SE support. |

Tests added in `tests/federal-calculation-audit.test.ts`; existing unsupported-year tests now distinguish missing income from an explicit zero. Targeted validation also includes `tax-calculator-regressions`, `schedule-se-regressions`, and `tax-rate-filing-status`. The parent task records the final suite result after integration.

## Remaining material scope limits

- The manual/imported W-2 aggregate has no taxpayer-versus-spouse identity field. Regular Social Security wage-base coordination requires wages belonging to the self-employed owner. The annual engine and profile helpers now withhold joint mixed-wage/business calculations; the parent task propagates that boundary to route/export callers. Combined Medicare wages follow different rules. The audit did not invent ownership from available records.
- Basic profile/KPI rate helpers are planning approximations, not complete returns or guaranteed expense savings. They omit QBI and credits. Profile health-insurance, retirement and HSA claims now require review rather than being applied without eligibility facts; the annual workflow handles deduction limits where modeled.
- The annual engine does not implement the 2026 active-business QBI minimum or §68 reduction and now review-blocks affected cases. HSA coverage-month/age/employer contribution eligibility is not fully collected. The saved-record annual boundary now withholds totals when HSA, retirement or self-employed health-insurance deductions are claimed until eligibility and applicable limits are supported. Pure helper tests assume eligible inputs; they do not establish eligibility. No correctness claim should describe this as full-return coverage.
- Loss handling requires saved at-risk, material-participation and profit-motive declarations. The model does not aggregate multiple business losses, compute the complete NOL carryforward or all state-specific adjustments.
- Tax-table rounding, qualified-dividend characterization, complex credits, AMT, NIIT, special business structures and full multi-state returns were not independently certified by this bounded audit.

## Validation record

Targeted runs passed: the new federal audit (29 tests), annual calculator regressions (45), Schedule SE regressions (8), supported-year handling (10), filing-status rate handling (13), OBBBA deductions (38), business losses (22), and state estimates (38). The parent task records full-suite and type-check results after all agents' changes are integrated.

Follow-up integration run passed 105 tests across W-2 save/JSON/PDF contracts (26), Form 1040 API (26), above-the-line limits (4), dependent/EITC review (31), and public calculators (18). These assert the new QBI/scope 422 responses have no annual numeric results, preserve W-2 Box 3/5 math, and keep currency validation explicit in transaction fixtures.
