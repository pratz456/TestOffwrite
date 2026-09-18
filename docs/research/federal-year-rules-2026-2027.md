# Federal individual and sole-proprietor year rules: 2026–2027

**Research/verification date:** 2026-09-15 (America/Los_Angeles); **figure re-audit:** 2026-09-18 — every 2025 and 2026 amount below and in `lib/tax-rules/` was re-read from the cited primary source (see the "Verified 2026-09-18" line in each section) and pinned in `tests/federal-figures-audit.test.ts`. No published value differed from the code. **Scope:** bounded research for a federal individual/sole-proprietor estimator; not a complete federal return specification or an audit of every provision of the Internal Revenue Code. Tax year means the reporting period under the applicable accounting method, not the following filing season. For example, cash-method income generally belongs to the year actually or constructively received, which can differ from the year the work was performed. [Publication 538, Cash Method](https://www.irs.gov/publications/p538).

## 1. Publication status and implementation priorities

| Item | Tax year 2026 | Tax year 2027, as of verification date |
| --- | --- | --- |
| Ordinary income brackets; basic/aged/blind/dependent standard deduction | Published in Rev. Proc. 2025-32 | Official annual amounts not published/located; leave unavailable |
| Social Security taxable maximum | Published: $184,500 | Official annual determination not published/located; leave unavailable |
| QBI threshold and phase-in endpoints | Published | Annual thresholds not published/located |
| QBI minimum deduction / active-QBI floor | Enacted: $400 / $1,000 | Inflation starts in 2027; adjusted amounts not published/located |
| CTC and refundable ACTC caps | Published: $2,200 / $1,700 per qualifying child | Inflation-adjusted caps not published/located |
| EITC amounts, thresholds, investment-income limit | Published | Annual amounts not published/located |
| SEP maximum contribution / compensation / minimum compensation | Published: $72,000 / $360,000 / $800 | Annual amounts not published/located |
| Fixed tax rates, Additional Medicare thresholds, general estimated-payment safe harbor | Enacted and applicable | Continue under enacted law; distinguish from annual indexed values |
| SALT statutory cap and phaseout start | $40,400 / $505,000 | $40,804 / $510,050, calculable from the enacted 101% rule; MFS rules below |
| Nonitemizer cash-charity deduction | Begins: $1,000 / $2,000 MFJ | Continues at enacted amounts |
| Scholarship-contribution credit | Not yet effective | Enacted to start January 1, 2027; requires qualifying contribution/state/organization |

The publication check used the [IRS annual inflation-adjustment index](https://www.irs.gov/newsroom/inflation-adjusted-tax-items-by-tax-year), [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [SSA's actual contribution-and-benefit-base table](https://www.ssa.gov/oact/COLA/cbb.html), and [IRS retirement COLA table](https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions). These official current-value tables reached 2026. Searches of IRS/SSA did not locate final 2027 determinations. SSA trustees' projections and private publishers' inflation calculations are not an official 2027 tax-year release. This is an as-of publication finding, not a prediction that 2027 values will equal 2026.

Verified 2026-09-18 against [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) (§§4.01, 4.03, 4.05, 4.06, 4.14, 4.24, 4.26, 4.29, 4.31), [Rev. Proc. 2024-40](https://www.irs.gov/pub/irs-drop/rp-24-40.pdf) (§§2.01, 2.03, 2.05, 2.06, 2.15, 2.25, 2.27, 2.30, 2.32), the [P.L. 119-21 enrolled text](https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm), [Notice 2024-80](https://www.irs.gov/pub/irs-drop/n-24-80.pdf), [Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf), [Rev. Proc. 2024-25](https://www.irs.gov/pub/irs-drop/rp-24-25.pdf), [Rev. Proc. 2025-19](https://www.irs.gov/pub/irs-drop/rp-25-19.pdf), [Notice 2025-05](https://www.irs.gov/pub/irs-drop/n-25-05.pdf), [Notice 2026-10](https://www.irs.gov/pub/irs-drop/n-26-10.pdf), the [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf), the [2025 Schedule SE instructions](https://www.irs.gov/instructions/i1040sse) and the [IRS quarterly interest-rate table](https://www.irs.gov/payments/quarterly-interest-rates). The only 2027 annual figure published since 2026-09-15 is the HSA pair in [Rev. Proc. 2026-24](https://www.irs.gov/pub/irs-drop/rp-26-24.pdf) ($4,500 self-only / $9,000 family), already recorded in `TAX_YEAR_2027_STATUS`; the 2027 brackets, deductions, credits, wage base and mileage rate remain unpublished, so 2027 stays unsupported. ssa.gov refused automated requests from the audit environment, so the wage bases were confirmed from the IRS sources named in §3 rather than from the SSA table directly.

Store year, verification date, source URL, effective dates and publication status with parameters. A 2027 request must not silently select 2026, an estimated inflation multiplier, or pre-P.L.119-21 sunset rules. Where the product permits planning scenarios, any assumed values must be separately supplied and clearly identified as assumptions.

**Known source conflict:** the generic [IRS QBI overview](https://www.irs.gov/newsroom/qualified-business-income-deduction) still included an end-of-2025 sunset statement when checked. P.L.119-21 replaced §199A(i), removing that sunset. The statute and year-specific guidance govern. Similarly, 2025 form instructions can supply continuing mechanics but do not establish 2026 or 2027 annual numbers.

## 2. Ordinary income tax and standard deductions

The following are **taxable-income upper boundaries** for each marginal band. Tax each slice of income at its rate; do not apply the highest reached rate to all income. QSS means a taxpayer who actually qualifies as a surviving spouse.

| Rate | Single | MFJ / QSS | Head of household | Married filing separately |
| --- | ---: | ---: | ---: | ---: |
| 10% | $12,400 | $24,800 | $17,700 | $12,400 |
| 12% | $50,400 | $100,800 | $67,450 | $50,400 |
| 22% | $105,700 | $211,400 | $105,700 | $105,700 |
| 24% | $201,775 | $403,550 | $201,750 | $201,775 |
| 32% | $256,225 | $512,450 | $256,200 | $256,225 |
| 35% | $640,600 | $768,700 | $640,600 | $384,350 |
| 37% | No ceiling | No ceiling | No ceiling | No ceiling |

| 2026 standard deduction | Amount |
| --- | ---: |
| Single / MFS | $16,100 |
| MFJ / QSS | $32,200 |
| Head of household | $24,150 |
| Additional amount for each aged/blind condition | $1,650 |
| Additional amount for each aged/blind condition, if unmarried and not QSS | $2,050 |
| Dependent basic-deduction floor | $1,350 |
| Dependent earned-income increment | $450 |

For a person claimable as a dependent, the basic deduction is limited to the lesser of the normal basic deduction and the greater of $1,350 or earned income plus $450. Apply separate aged/blind rules if relevant. Do not confuse the regular age-65 addition with the temporary $6,000 senior deduction below. An MFS taxpayer whose spouse itemizes cannot take the standard deduction. Nonresident/dual-status rules need separate handling.

Sources: [Rev. Proc. 2025-32 §§4.01, 4.14](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [IRS 2026 announcement](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill), [Publication 501, standard-deduction eligibility mechanics](https://www.irs.gov/publications/p501). All verified 2026-09-15; annual values apply only to 2026. P.L.119-21 §§70101–70103 make the seven rates and enhanced basic deduction permanent and terminate personal exemptions; the 2027 annual dollar boundaries remain unavailable.

Verified 2026-09-18 against Rev. Proc. 2025-32 §4.01 Tables 1–4 (all 24 bracket ceilings above; the printed cumulative tax at each joint boundary — $2,480, $11,600, $35,932, $82,048, $116,896, $206,583.50 — reproduces from the ceilings and rates) and §4.14(1)–(3) (basic, dependent $1,350 / $450, aged/blind $1,650 / $2,050). The 2025 counterparts in code were verified against Rev. Proc. 2024-40 §2.01 and §2.15(2)–(3) ($1,350 / $450; $1,600 / $2,000) and, for the basic deduction, against P.L. 119-21 §70102(b), which rewrote §63(c)(7) to $15,750 / $23,625 (joint $31,500) for tax years beginning after 2024, superseding the $15,000 / $22,500 / $30,000 in Rev. Proc. 2024-40 §2.15(1). The $6,000 senior deduction, its 6% rate and the $75,000 / $150,000 MAGI thresholds were read from P.L. 119-21 §70103 (new §63(f)(5)(C)).

**Required inputs:** actual filing status and eligibility, taxpayer/spouse date of birth and blindness, whether claimable as another person's dependent, dependent earned income, spouse itemization for MFS, all taxable income and adjustments, standard versus itemized deductions, capital gains/qualified dividends, and below-AGI deductions. Ordinary brackets alone do not compute preferential capital-gain tax, AMT, NIIT or a full Form 1040.

## 3. Self-employment tax and Additional Medicare Tax

For an ordinary domestic sole proprietor using the regular Schedule SE method, with no church income or other special adjustments:

~~~text
netSE = 0.9235 × aggregate net profit subject to Schedule SE
if netSE < 400: regular SE tax = 0
otherwise:
  remainingSSBase = max(0, annualSSBase − this person's Social Security wages/tips)
  socialSecuritySE = 0.124 × min(netSE, remainingSSBase)
  medicareSE = 0.029 × netSE
  regularSE = socialSecuritySE + medicareSE
deductiblePartSE = regularSE / 2
~~~

Use $184,500 for the 2026 annual base. Medicare has no wage ceiling. The $400 test concerns Schedule SE net earnings, not gross receipts or simply $400 of Schedule C profit. A regular business loss does not produce negative SE tax. Multiple businesses for one person must be combined according to Schedule SE; spouses each have their own Schedule SE and Social Security wage base. A spouse's wages do not consume the other spouse's Social Security ceiling. Do not reduce the SE tax base by the standard deduction, QBI, the owner's SEP contribution, or the deductible half of SE tax.

Sources: [SSA contribution-and-benefit base](https://www.ssa.gov/oact/COLA/cbb.html), [IRS Topic 554](https://www.irs.gov/taxtopics/tc554), [Schedule SE instructions](https://www.irs.gov/instructions/i1040sse), [IRS SE overview](https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes). Annual wage base is 2026 only; percentage mechanics continue for 2027 under current law, with its wage base unavailable. The currently posted final Schedule SE instructions are for 2025; do not reuse their $176,100 annual base.

Verified 2026-09-18 against the [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf) self-employment tax worksheet (line 3 × 92.35%, line 4 × 2.9%, line 5 "Social security tax maximum income $184,500", line 9 × 12.4%) and the [2025 Schedule SE instructions](https://www.irs.gov/instructions/i1040sse) ("For 2025, the maximum amount of self-employment income subject to social security tax is $176,100"). The SSA pages (`ssa.gov/oact/COLA/cbb.html`, the October 2025 COLA fact sheet) returned "Access Denied" to the audit environment, so the SSA table itself is cited but was not re-read; the IRS worksheet figures are the confirmation. The $400 Schedule SE floor and the 12.4% / 2.9% / 0.9% rates are statutory (§§1401, 1402(b), 3101(b)(2)).

### Additional Medicare Tax

| Filing status | Fixed threshold for 2026 and 2027 |
| --- | ---: |
| MFJ | $250,000 |
| MFS | $125,000 |
| Single / HOH / QSS | $200,000 |

The rate is 0.9%. First compute tax on Medicare wages over the applicable threshold, then reduce the threshold by Medicare wages (not below zero) and apply 0.9% to SE income above the remainder. MFJ combines both spouses' Medicare wages and relevant SE income. Self-employment losses do not offset wages for this tax; RRTA compensation is tested separately. Additional Medicare Tax is not part of the deductible one-half of regular SE tax. An employer's $200,000 withholding trigger is distinct from the taxpayer's filing-status liability threshold.

Sources: [IRS Topic 560](https://www.irs.gov/taxtopics/tc560), [IRS Additional Medicare Tax Q&A](https://www.irs.gov/businesses/small-businesses-self-employed/questions-and-answers-for-the-additional-medicare-tax). Verified 2026-09-15; fixed statutory rules apply to both years.

Verified 2026-09-18: the $200,000 / $250,000 / $125,000 thresholds and 0.9% rate are §1401(b)(2) and §3101(b)(2) amounts that P.L. 119-21 did not touch; the values in `lib/reports/calcSE.ts` and `lib/tax-rules/compute-1040.ts` match.

**Required inputs:** business profit/loss by owner, each person's W-2 Social Security wages/tips and Medicare wages separately (boxes 3/7 versus box 5), spouse's corresponding amounts, RRTA flags, and any special Schedule SE status. A single undifferentiated “W-2 income” field is insufficient. Church/clergy income, optional SE methods, statutory employees, totalization agreements, and community-property allocation require separate handling.

## 4. Qualified business income deduction (QBI / §199A)

For a straightforward qualified domestic business below the income threshold, the ordinary computation is the lesser of 20% of net QBI and 20% of taxable income before the QBI deduction less net capital gain (including qualified dividends). Include business-attributable deductions for the deductible part of SE tax, self-employed health insurance, and qualified retirement contributions in net QBI. The deduction reduces income tax, not SE tax or AGI. Deductible qualified tips under §224 cannot also generate QBI.

| Filing status | 2026 threshold | 2026 phase-in completion | Width enacted for 2026 onward |
| --- | ---: | ---: | ---: |
| MFJ | $403,500 | $553,500 | $150,000 |
| MFS | $201,775 | $276,775 | $75,000 |
| All other returns | $201,750 | $276,750 | $75,000 |

These thresholds are not the ordinary-rate bracket thresholds. Above the threshold, the W-2 wage/qualified-property limitation phases in. Once fully applicable, it generally caps the business component at the larger of 50% of business W-2 wages or 25% of those wages plus 2.5% of qualified property's unadjusted basis immediately after acquisition. A specified service trade or business (SSTB) also loses qualifying status across the phase-in range. Non-SSTB businesses do not universally lose QBI at the upper endpoint. Wage and property data must belong to the business; an owner's unrelated W-2 wages do not qualify as business wages for this limitation.

Beginning in 2026, an eligible taxpayer with at least **$1,000 aggregate active QBI** gets the greater of the ordinary computed deduction or **$400**. Active means material participation under §469(h). The $1,000 rule is eligibility for this minimum, not a universal floor below which all QBI deductions vanish. Passive businesses may qualify for the ordinary deduction but do not satisfy the new active minimum merely by existing. The $400 and $1,000 amounts begin inflation adjustment in 2027, so do not assume those exact values for 2027. Handle QBI losses/carryforwards, SSTBs and the minimum with the complete applicable instructions.

Sources: [P.L.119-21 §70105 and §70111](https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm), [Rev. Proc. 2025-32 §4.26](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [final 2025 Form 8995 instructions for continuing mechanics](https://www.irs.gov/instructions/i8995), [final 2025 Form 8995-A instructions](https://www.irs.gov/instructions/i8995a). The [2026 Form 8995 draft](https://www.irs.gov/pub/irs-dft/f8995--dft.pdf), [2026 instructions draft dated June 17, 2026](https://www.irs.gov/pub/irs-dft/i8995--dft.pdf), and [2026 Form 8995-A draft](https://www.irs.gov/pub/irs-dft/f8995a--dft.pdf) corroborate the new computation. They are **drafts, not final filing forms**. Verification date 2026-09-15. Apply the statute and issued annual parameters to estimates; verify final instructions before claiming filing-ready support.

Verified 2026-09-18 against Rev. Proc. 2025-32 §4.26 (threshold $403,500 / $201,775 / $201,750; phase-in completion $553,500 / $276,775 / $276,750), Rev. Proc. 2024-40 §2.27 for the 2025 code values ($394,600 / $197,300 / $197,300; completion $494,600 / $247,300 / $247,300) and P.L. 119-21 §70105 (the $75,000 / $150,000 phase-in range, the $400 minimum and $1,000 active-QBI floor, both effective for tax years beginning after 2025 and indexed after 2026). The engine still flags rather than calculates the active minimum, which the coverage matrix records as unmodeled.

**Required inputs:** each business's QBI and ownership, business-related adjustment allocation, material participation, SSTB classification, QBI loss carryforwards, qualified business W-2 wages and property basis, aggregation elections, taxable income before QBI (including other applicable below-AGI deductions and the §68 coordination), capital gains/qualified dividends, REIT/PTP income and losses, and cooperative involvement. Until modeled, above-threshold complex cases, K-1s, multiple-business loss netting and carryforwards must be identified as unsupported, not assigned zero without explanation.

## 5. Child Tax Credit (CTC), Additional CTC, and other dependents

2026 maximum CTC is $2,200 per qualifying child; maximum refundable ACTC is $1,700 per qualifying child. The credit for other dependents (ODC) remains $500 and is nonrefundable. The combined CTC/ODC phaseout starts above modified AGI of $400,000 for MFJ and $200,000 for all other statuses. Reduce the combined credit by $50 for each $1,000 **or fraction thereof** above that threshold. A dependent count alone does not establish eligibility.

CTC children generally must be under 17 at year end and meet relationship, residency, support, dependency, joint-return and citizenship/residency tests. P.L.119-21 requires a qualifying SSN for the child and taxpayer (at least one spouse on a joint return), issued by the return due date, subject to the exact statutory/IRS rules. Do not assume both spouses must have qualifying SSNs for CTC; EITC has different requirements.

The ordinary ACTC earned-income branch is capped by unused eligible child credit, the per-child refundable maximum, and 15% of earned income exceeding $2,500. At exactly $2,500, this branch is zero. Families with three or more qualifying children and bona fide Puerto Rico residents have an alternative payroll-tax calculation, so the simple 15% formula is not universal. Nonrefundable CTC/ODC must respect the Schedule 8812 credit-limit worksheet; do not use them as a direct offset against ordinary SE tax. ACTC is a refundable credit and must not be counted a second time as nonrefundable CTC.

Sources: [Rev. Proc. 2025-32 §4.05](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [P.L.119-21 §70104](https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm), [IRS CTC eligibility](https://www.irs.gov/credits-deductions/individuals/child-tax-credit), [Schedule 8812](https://www.irs.gov/pub/irs-pdf/f1040s8.pdf), [Schedule 8812 instructions](https://www.irs.gov/instructions/i1040s8). Final posted form/instructions are 2025 and supply continuing mechanics, not independent proof of 2027 caps. All verified 2026-09-15. 2027 adjusted CTC/ACTC caps remain unavailable; phaseout thresholds and enacted eligibility continue unless changed.

Verified 2026-09-18 against Rev. Proc. 2025-32 §4.05 ($2,200 maximum, $1,700 refundable), P.L. 119-21 §70104(a)(2) (the $2,200 that applies from 2025, indexed after 2025 and rounded down to the next $100) and Rev. Proc. 2024-40 §2.05 (the 2025 $1,700 refundable amount; the 2025 $2,200 maximum comes from the statute, since Rev. Proc. 2024-40 predates the increase). The $400,000 / $200,000 phaseout thresholds and $2,500 earned-income floor in `lib/tax-rules/credits.ts` are unindexed §24(b)(2) and §24(d)(1)(B)(i) amounts.

**Required inputs:** per-dependent birth date, relationship, months living together, support/joint-return/citizenship tests, required SSN eligibility and issue date, custody/release circumstances, MAGI exclusions, taxpayer/spouse identification eligibility, earned income, relevant nonrefundable credits and payroll taxes. Three-child ACTC, Form 2555, Puerto Rico and custody exceptions need explicit supported paths or referral.

## 6. Earned Income Tax Credit (EITC)

| 2026 parameter | No qualifying child | 1 child | 2 children | 3+ children |
| --- | ---: | ---: | ---: | ---: |
| Phase-in rate (enacted) | 7.65% | 34% | 40% | 45% |
| Earned income reaching maximum | $8,680 | $13,020 | $18,290 | $18,290 |
| Maximum credit | $664 | $4,427 | $7,316 | $8,231 |
| Phaseout rate (enacted) | 7.65% | 15.98% | 21.06% | 21.06% |
| MFJ phaseout starts | $18,140 | $31,160 | $31,160 | $31,160 |
| MFJ completed phaseout | $26,820 | $58,863 | $65,899 | $70,244 |
| Other eligible statuses phaseout starts | $10,860 | $23,890 | $23,890 | $23,890 |
| Other eligible statuses completed phaseout | $19,540 | $51,593 | $58,629 | $62,974 |

2026 investment-income disqualification occurs **above $12,200**. Phaseout uses AGI or earned income, whichever is greater. Exact return calculations use the IRS EIC table/worksheets and prescribed rounding, not just a smooth percentage formula. Self-employed taxpayers use EIC Worksheet B; earned income is not interchangeable with AGI, gross receipts, or the Schedule SE 92.35% tax base. For a simple ordinary sole proprietor the worksheet takes Schedule C net profit and the deductible part of SE tax into account; special methods and business losses require the worksheet.

Qualifying-child rules differ from CTC: the usual age tests are under 19, or a full-time student under 24, and younger than the taxpayer/spouse; permanent and total disability has an age exception. Residency/relationship/joint-return tests and valid SSNs matter. Childless filers generally need age 25–64 (either spouse on MFJ), a U.S. main home for more than half the year, and cannot be another taxpayer's dependent or qualifying child. MFJ generally requires qualifying SSNs for both spouses. MFS is generally ineligible, but certain separated spouses with qualifying children have a statutory exception; do not equate “all other statuses” in the dollar table with unconditional MFS eligibility. Prior credit disallowance and Form 8862 may matter.

Sources: [Rev. Proc. 2025-32 §4.06](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [26 U.S.C. §32, official House Code](https://usc-cdn.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section32), [IRS EITC eligibility](https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit/who-qualifies-for-the-earned-income-tax-credit-eitc), [Publication 596](https://www.irs.gov/publications/p596). Verified 2026-09-15. Publication 596 currently describes 2025 amounts; only continuing eligibility/worksheet mechanics were reused. No direct change to the basic EITC percentage schedule was identified in P.L.119-21 in this scoped review. The 2027 annual dollar parameters are unavailable.

Verified 2026-09-18 against Rev. Proc. 2025-32 §4.06 (every cell of the 2026 table above and the $12,200 investment-income limit) and Rev. Proc. 2024-40 §2.06 for the 2025 code values (maximum credit $649 / $4,328 / $7,152 / $8,046; joint phaseout $17,730 → $26,214, $30,470 → $57,554 / $64,430 / $68,675; other statuses $10,620 → $19,104, $23,350 → $50,434 / $57,310 / $61,555; investment income $11,950).

**Required inputs:** separate earned income and AGI, all relevant investment income, taxpayer/spouse age and dependency status, citizenship/residency, valid SSNs, qualifying children under EITC rules, separation status, U.S. residency duration, combat-pay/Medicaid-waiver elections and prior disallowances. Do not automatically award the maximum credit based on a child count and low profit.

## 7. Estimated payments and safe harbor

The general required annual payment is the smaller of 90% of current-year tax or 100% of prior-year tax; substitute 110% for the prior-year factor if prior-year AGI exceeds $150,000 ($75,000 if the current filing status is MFS). The prior-year return must cover 12 months. Use the worksheet definition of total tax after its specified credits/adjustments, not the prior return's balance due or refund.

Generally no estimated payment is required if current tax after withholding/refundable credits is less than $1,000, or withholding meets the required payment. A separate exception applies if the taxpayer had no prior-year liability, was a U.S. citizen/resident all year, and had a 12-month prior year. No tax data is not equivalent to zero prior liability. Safe harbor controls the underpayment penalty, not final tax owed.

For 2026, the ordinary calendar-year installment dates are **April 15, June 15, September 15, 2026, and January 15, 2027**. They correspond to unequal income periods: January–March, April–May, June–August and September–December. A full-year payment divided by four is appropriate only for the regular installment assumptions. Payment timing matters; a late catch-up estimated payment does not erase earlier underpayment. Annualized-income calculations can address uneven income. Withholding is ordinarily allocated throughout the year under the statutory rules, unlike the actual dates of estimated payments.

For 2027, the general statutory quarterly pattern and weekend/holiday adjustment continue. Confirm year-specific dates, disaster postponements and final forms before publishing a payment calendar. The fixed safe-harbor rules can support a prior-year-based planning calculation even while 2027 current-year tax amounts remain unavailable.

Sources: [Publication 505 (2026), Chapter 2 and Worksheet 2-1](https://www.irs.gov/publications/p505), [IRS estimated-tax FAQ](https://www.irs.gov/faqs/estimated-tax), [IRS underpayment penalty overview](https://www.irs.gov/payments/underpayment-of-estimated-tax-by-individuals-penalty). Verified 2026-09-15. Rules apply to 2026 and continue for 2027 under current law; annual parameters/dates must retain their own year.

Verified 2026-09-18 against the [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf): the 90% / 100% / 110% safe harbor with the $150,000 ($75,000 MFS) prior-AGI test, the $1,000 de minimis test and the printed due dates April 15, June 15, Sept. 15, 2026 and Jan. 15, 2027. `getEstimatedTaxDeadline` reproduces those dates, and for tax year 2027 produces April 15, June 15 and September 15, 2027 and January 18, 2028 (January 15, 2028 is a Saturday and January 17 is Martin Luther King Jr. Day; §7503) — a calendar derivation, since the 2027 Form 1040-ES does not exist yet. The Form 2210 underpayment rates hard-coded in `lib/tax-provider/quarterly-planner.ts` match the [IRS quarterly interest-rate table](https://www.irs.gov/payments/quarterly-interest-rates): 8% for every 2024 quarter, 7% for every 2025 quarter, and 7% / 6% / 7% / 7% for 2026 Q1–Q4 (IRB 2025-48, 2026-8, 2026-22, 2026-36); 2027 Q1 is unpublished and stays `null`.

**Required inputs:** prior-year tax and AGI with filing/12-month status, current projected total tax, credits, withholding already paid and expected, each estimated payment amount/date/tax-year allocation, prior overpayment applied, income timing, farming/fishing and disaster-relief status. Farmers/fishers, annualized income, changed marital filing status, short years and penalty waivers require dedicated handling.

## 8. SEP limits and self-employed contribution calculation

2026 SEP limits: $72,000 annual contribution, $360,000 compensation, $800 minimum compensation used in SEP eligibility. For a standard plan providing a 25% employer contribution, the sole proprietor's reduced self-employed rate is **20%**, applied to the business net profit less the deductible part of SE tax, before the proprietor's own contribution. A general plan percentage r converts to r/(1+r), so a 10% plan does not become a 10% self-employed contribution.

~~~text
regular maximum for an owner-only 25% SEP arrangement in 2026
  = min(72,000, 20% × max(0, business net profit − deductiblePartSE))
where deductiblePartSE = regular SE tax / 2
~~~

Do not halve the already-halved Schedule 1 deduction again. For lower plan rates also apply the compensation cap per the deduction worksheet. A valid deductible contribution is limited by actual eligible contributions and plan rules; the maximum is a planning limit, not an automatic deduction. The proprietor's contribution reduces AGI and attributable QBI, not Schedule C profit or SE tax. Contributions and plan establishment generally can occur by the employer return due date including extensions.

Sources: [IRS 2026 retirement COLA table](https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions), [Publication 560, self-employed rate/deduction worksheets and SEP rules](https://www.irs.gov/publications/p560), [IRS self-employed retirement plans](https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people). Verified 2026-09-15. 2027 annual limits are unavailable, although the rate-conversion mechanics continue.

Verified 2026-09-18 against [Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf) (§415(c)(1)(A) $72,000; §401(a)(17) compensation $360,000; §402(g) deferral $24,500; §414(v) catch-up $8,000) and [Notice 2024-80](https://www.irs.gov/pub/irs-drop/n-24-80.pdf) for the 2025 code value ($70,000; deferral $23,500; catch-up $7,500). The engine stores only the §415(c) limit (`sepContributionLimit`); the deferral and catch-up amounts are quoted to users in `lib/tax-assistant/knowledge.ts` and were checked there. HSA limits (not retirement, but published on the same cadence) were verified against [Rev. Proc. 2024-25](https://www.irs.gov/pub/irs-drop/rp-24-25.pdf) ($4,300 / $8,550) and [Rev. Proc. 2025-19](https://www.irs.gov/pub/irs-drop/rp-25-19.pdf) ($4,400 / $8,750); the $1,000 catch-up is §223(b)(3).

**Required inputs:** plan type, employer contribution percentage, owner net earnings and deductible SE portion attributable to the business, actual contributions and their designated year, other plans/related employers, and employee eligibility. Common-law employees, controlled groups, multiple employer plans, SARSEPs, Roth SEP treatment and excess contribution carryovers require separate handling. Do not apply ordinary IRA catch-up allowances to a standard SEP employer contribution.

## 9. Enacted P.L.119-21 changes relevant to 2026/2027 coverage

These are material coverage flags, not an exhaustive list or an instruction to enable benefits without their full eligibility tests.

| Provision | Applicability and established rule | Inputs / support implications |
| --- | --- | --- |
| Rates, standard deduction, personal exemptions; §§70101–70103 | Seven ordinary rates and enhanced standard deduction continue; personal exemption deduction remains terminated | Year-specific dollar values still needed |
| Senior deduction; §70103 | 2025–2028: up to $6,000 per qualifying person age 65+, phases out above MAGI $75,000 / $150,000 MFJ | DOB, MAGI, qualifying SSN and joint-return requirement if married; separate from aged standard deduction |
| CTC / QBI; §§70104–70105 | Permanent extensions; CTC SSN changes; QBI wider phase-in and active minimum begin 2026 | See sections 4–6 |
| SALT; §70120 | 2026 cap $40,400, MAGI phaseout start $505,000; 2027 cap $40,804, start $510,050. 30% phasedown; general floor $10,000. For MFS, use half the MAGI threshold, compute the applicable limitation and its floor, then halve that resulting limitation; see formula below | Itemized deductible taxes and MAGI; keep Schedule C business taxes separate from personal SALT |
| Qualified tips; §70201 | 2025–2028, up to $25,000, phaseout above MAGI $150,000 / $300,000 MFJ; sole-proprietor deduction also limited by relevant business net income | Qualifying occupation/tip type/reporting/SSN/filing requirements. Does not eliminate payroll/SE tax; exclude deducted tips from QBI |
| Qualified overtime; §70202 | 2025–2028, up to $12,500 / $25,000 MFJ, phaseout above MAGI $150,000 / $300,000 MFJ | Only qualifying FLSA overtime premium; self-employed “extra hours” do not establish eligibility |
| Personal car-loan interest; §70203 | 2025–2028, up to $10,000, phaseout above MAGI $100,000 / $200,000 MFJ | Qualified new vehicle/loan, personal use, U.S. final assembly, VIN and acquisition/loan dates; avoid duplicate business-interest deduction |
| Itemized limitations; §§70111, 70425 | 2026+: new §68 limitation on high-bracket itemized deduction benefit; 0.5% contribution-base floor for itemized charitable gifts | Full Schedule A/charity computation; QBI taxable-income definition disregards §68 |
| Nonitemizer cash charity; §70424 | 2026+: up to $1,000 / $2,000 MFJ for qualifying cash gifts | Actual qualifying contributions, recipient eligibility and substantiation; not a Schedule C expense |
| Child/dependent care; §§70404–70405 | 2026+: dependent-care assistance exclusion up to $7,500 / $3,750 MFS; credit percentage increases up to 50% with staged AGI reductions to 20% | Care expenses, work/student/spouse tests, provider details and employer benefits; existing flat 20%–35% model is stale |
| Scholarship contributions; §70411 | Starts January 1, 2027; nonrefundable credit up to $1,700 per individual for qualified cash contributions | State participation and official SGO qualification, state-credit coordination, carryforward/duplicate deduction rules; do not award automatically |
| Bonus depreciation / §179; §§70301, 70306 | Permanent 100% bonus framework for qualifying acquired/placed-in-service property after January 19, 2025; 2026 §179 limit $2,560,000 with phaseout starting $4,090,000 | Asset-specific eligibility, dates, elections, business use, recapture and income limitations; 2027 §179 annual amounts unavailable |
| Information reporting; §§70432–70433 | 2026 business-payee reporting threshold under §§6041/6041A becomes $2,000; inflation starts for calendar years after 2026. Third-party network Form 1099-K reporting generally restored to over $20,000 and more than 200 transactions | Reporting thresholds do not make unreported business receipts tax-free; merchant-card transactions have distinct reporting rules |
| Premium tax credit; §71305 | 2026+: excess advance PTC repayment caps removed | Marketplace Form 1095-A/reconciliation and self-employed health-insurance interaction; unsupported without a complete PTC module |
| Energy benefits; §§70501–70508 | Vehicle credits terminate for vehicles acquired after September 30, 2025; residential improvements/expenditures have end-of-2025 cutoffs; some other benefits terminate during 2026 | Acquisition/installation/construction dates and specific credit rules; do not reuse 2025 incentives in 2026/2027 suggestions |
| Excess business loss; §70601 | Limitation made permanent; 2026 threshold $256,000 / $512,000 MFJ | Large business losses cannot automatically offset all household income; coordinate other loss limits and carryovers |

**MFS SALT ordering:** For 2026, the limitation is `0.5 × max(10,000, 40,400 − 0.30 × max(0, MAGI − 252,500))`, equivalently `max(5,000, 20,200 − 0.15 × max(0, MAGI − 252,500))`. Do not apply a 30% reduction after halving the cap. The actual deduction cannot exceed eligible taxes paid and remains subject to other applicable itemized-deduction rules. [26 U.S.C. §164(b)(6)–(7)](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title26-section164&num=0&edition=prelim).

Primary sources: [P.L.119-21 enacted text](https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm), [IRS individual/worker provisions](https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers), [IRS Publication 505 (2026), What's New](https://www.irs.gov/publications/p505), [IRS charitable-contribution topic](https://www.irs.gov/taxtopics/tc506), [IRS scholarship credit overview](https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc), [IRS scholarship-credit guidance announcement](https://www.irs.gov/newsroom/treasury-irs-request-comments-on-implementation-of-the-new-federal-tax-credit-for-individual-contributions-to-scholarship-granting-organizations-under-the-one-big-beautiful-bill), [Rev. Proc. 2025-32 §§4.24, 4.31](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf). Verified 2026-09-15. The 2027 SALT amounts above are enacted-formula arithmetic (1.01 × 2026), not projected CPI adjustments.

Verified 2026-09-18 against the enrolled text of P.L. 119-21: §70102 (standard deduction $15,750 / $23,625), §70103 (senior deduction $6,000, 6%, $75,000 / $150,000, tax years before 2029), §70104 ($2,200 CTC), §70105 (QBI $75,000 / $150,000 phase-in; $400 / $1,000 minimum from 2026), §70120 (SALT $40,000 for 2025, $40,400 for 2026, 101% thereafter through 2029, $10,000 from 2030; MAGI thresholds $500,000 / $505,000 / 101%; 30% phase-down; $10,000 floor), §70201 (tips $25,000; $100 per $1,000 over $150,000 / $300,000; through 2028), §70202 (overtime $12,500 / $25,000; same phaseout), §70203 (vehicle loan interest $10,000; $200 per $1,000 or fraction over $100,000 / $200,000; loans after 2024-12-31; U.S. final assembly), §70301 (100% bonus depreciation for property acquired after January 19, 2025), §70306 (§179 $2,500,000 / $4,000,000, indexed from 2026 with a 2024 base year), §70424 (§170(p) $1,000 / $2,000 for tax years beginning after 2025) and §70433 (§6041(a) threshold $600 → $2,000 for payments after 2025, indexed after 2026 in $100 steps). The code constants in `lib/tax-rules/obbba-deductions.ts`, `lib/tax-rules/federal-year-rules.ts`, `lib/tax-rules/personal-deductions.ts`, `lib/ai/transaction-tax-policy.ts` and `lib/tax-assistant/knowledge.ts` match each of these. Rev. Proc. 2025-32 §4.24 ($2,560,000 / $4,090,000) and §4.31 ($256,000 / $512,000) were re-read for the 2026 §179 and §461(l) amounts.

## 10. Concrete reference scenarios

These are isolated rules checks, not assertions that every tax on a complete return has been calculated. Use decimal arithmetic. Monetary values shown to cents are calculation references; final Form 1040/EIC tax tables and whole-dollar rounding may differ from a continuous marginal-rate estimator. All scenarios are **2026** unless labeled otherwise, with valid eligibility and no unmentioned credits/income/adjustments.

| Scenario | Expected result / issue caught |
| --- | --- |
| Single, ordinary taxable income $50,400 | Marginal-band tax $5,800; $50,401 gives $5,800.22 in a continuous estimator. Reject tax-on-all-income at 22% |
| Single, ordinary taxable income $100,000 | $16,712 before credits/additional taxes |
| Dependent, single, earned income $2,000 | Basic standard deduction $2,450; with no earned income it is $1,350; normal basic cap still applies |
| Single, age 65, not blind | Regular standard deduction $18,150 ($16,100 + $2,050). Separate senior deduction needs its own eligibility/MAGI calculation |
| Sole proprietor profit $100,000, no wages | Net SE $92,350; Social Security $11,451.40; Medicare $2,678.15; regular SE $14,129.55; deductible part $7,064.775 before rounding |
| Same proprietor filing Single, also own SS/Medicare W-2 wages $180,000 | Remaining SS base $4,500; SS SE $558; regular SE $3,236.15; Additional Medicare $651.15 using the Single $200,000 threshold; deductible regular SE part $1,618.075, excluding Additional Medicare. [IRS Topic 560](https://www.irs.gov/taxtopics/tc560) |
| MFJ: spouse A wages $180,000, spouse B business profit $100,000 and no wages | B still owes full regular SE $14,129.55; joint Additional Medicare $201.15. A's wages cannot reduce B's SS base |
| Single, profit $100,000, standard deduction, no other inputs | AGI $92,935.225; pre-QBI taxable income $76,835.225; QBI deduction $15,367.045 (taxable-income cap controls); taxable income $61,468.18; continuous income-tax estimate $8,235.00; plus regular SE gives $22,364.55 before rounding/table effects |
| Owner-only 25% SEP plan, same $100,000 business and no wages | Maximum own contribution $18,587.045 before rounding: 20% × ($100,000 − $7,064.775). Reject $25,000 and 25% of 92.35%-adjusted earnings |
| Active QBI $1,000; pre-QBI taxable income $10,000; no other QBI items | Ordinary deduction $200; active minimum produces $400. With active QBI $999 and enough taxable income, ordinary deduction is $199.80, not zero |
| Non-SSTB, single pre-QBI taxable income $300,000, QBI $100,000, qualified business wages $50,000, UBIA zero | Fully applied wage limit $25,000; 20%-QBI amount $20,000 remains deductible before any other limitation. Do not zero all above-range QBI |
| One CTC child, single MAGI $200,001, ample income-tax liability | Maximum after phaseout $2,150, because any fraction of the first $1,000 triggers a $50 reduction |
| One CTC child, zero credit-limit income tax, earned income $10,000 | Ordinary ACTC branch $1,125; not the automatic $1,700 cap. Earned income $2,500 gives zero on this branch |
| Eligible childless filer age 30, earned income and AGI $9,000, no investments | EITC at maximum $664. At completed phaseout $19,540 credit is zero; investment income $12,201 disqualifies regardless of low earnings |
| Eligible MFJ with 3 EITC children, earned income and AGI $20,000 | EITC maximum $8,231, subject to exact table/eligibility checks |
| Prior-year tax $20,000, prior AGI $160,000; current-year tax $30,000; no credits/withholding | Required annual safe harbor min($27,000, $22,000) = $22,000; regular installments $5,500 each when timely. Remaining final tax still $8,000 |
| Same prior data, current tax $15,000 | Required annual payment $13,500 under 90% current-year branch; not always 110% of prior tax |
| Current tax after withholding/refundable credits $999 | General $1,000 estimated-payment test fails; at exactly $1,000 assess the safe-harbor rules |
| 2027 request requiring indexed federal values | Return an explicit unavailable/needs-published-parameters result; never label a 2026-number result as a verified 2027 estimate |

## 11. Release boundary

An estimator built from these rules still needs separate supported calculations or explicit exclusions for capital gains/qualified dividends, AMT, NIIT, taxable Social Security/retirement distributions, Marketplace PTC, itemization, household/employment taxes, complex credits, foreign/territorial status, trusts/estates, partnerships/S corporations, passive/at-risk/NOL/excess-business-loss limits, entity elections and state/local tax. Do not infer complete tax liability from gross receipts, expenses, filing status and a child count.

Before advertising 2027 calculation support, revisit the official annual IRS revenue procedure, SSA determination, retirement COLA release and final year-specific forms/instructions. Preserve the 2026 values as their own record. Before advertising filing-ready support for 2026, replace draft-form assumptions with final forms, follow their tables/rounding and validate the full supported return paths.
