# Social Security taxable-benefit worksheet

Reviewed September 16, 2026. Implemented in local staging; deployment is managed separately.

## Supported calculation and sources

The new deterministic calculation follows the benefit worksheet rather than multiplying all benefits by85%. It uses net benefits, other income, tax-exempt interest, income-exclusion addbacks and permitted adjustments. Single/HOH and MFS apart-all-year use the $25,000/$34,000 thresholds; joint returns use $32,000/$44,000. MFS living together uses the separate rule and still applies the benefit cap. Student-loan interest is excluded from the worksheet adjustment deduction. [2026 IRS Publication505, Worksheet2-2](https://www.irs.gov/publications/p505).

Net benefits come from combined Box5 records. Joint returns include both spouses; benefits belonging to children are excluded. The currently published Pub915 is the2025 edition. Its worked examples and exception rules supplement the explicit2026 planning worksheet; this document does not claim a finalized2026 Form1040. Prior-year lump sums require election comparisons; workplace-covered traditional IRA contributions can require Pub590-A. [IRS Publication915, Worksheet1 and exceptions](https://www.irs.gov/publications/p915).

## Persisted inputs and integration

- Thirteen new flat string fields persist through the existing owner/year organizer API. Monetary fields require explicit numbers, including zero; eligibility answers are not guessed.
- `socialSecurityNetBenefits` is separate from legacy `amountSocialSecurity` (Box3). Additional amounts cover tax-exempt interest, excluded savings-bond interest, excluded employer adoption benefits and SSA/RRB federal withholding.
- Scope answers record resident treatment, prior-year lump sums, special IRA interaction, foreign/territory exclusions, complete return income, supported adjustments, separate-filer living arrangements and retirement review.
- Other income and allowed adjustments come from the shared federal snapshot. Student-loan interest and below-AGI deductions do not reduce benefit combined income. Organizer adjustment entries must reconcile with the deduction records actually used; conflicting or organizer-only entries produce actionable review, preserving saved data.
- The existing retirement input explicitly requests taxable1099-R Box2a. A nonzero amount additionally requires confirmation that basis, rollover and additional early-distribution tax treatment is resolved.
- JSON exposes the worksheet inputs/result, net and taxable benefits, and separate withholding totals. The same taxable amount enters annual income once. SSA/RRB withholding enters annual payments once and is included in quarterly payment-record displays, while the W2-only field remains separate.
- PDF output includes net benefits6a, taxable benefits6b, the MFS-apart indicator when applicable, tax-exempt interest2a, benefit withholding25b and total withholding25d. It remains the application's planning export, not an official IRS form.

## Numeric reference cases

The following first four cases reproduce the published examples. Other rows test worksheet boundaries.

| Case | Net benefits | Other income / facts | Taxable benefits |
|---|---:|---|---:|
| Pub915 example1, Single | $5,980 | $28,990 other income | $2,990 |
| Example2, Joint | $5,600 | $29,750 other income; $1,000 adjustment | $0 |
| Example3, Joint | $10,000 | $40,300 taxable income; $200 excluded bond interest | $6,275 |
| Example4, MFS together | $4,000 | $8,000 other income | $3,400 |
| Single at lower/upper threshold | $20,000 | $15,000 / $24,000 other income | $0 / $4,500 |
| Joint at lower/upper threshold | $20,000 | $22,000 / $34,000 other income | $0 / $6,000 |
| MFS apart / together | $20,000 | No other income | $0 / $8,500 |

## Review boundaries

Incomplete or contradictory facts, negative combined net benefits/repayment-credit cases, earlier-year lump sums, special IRA computations, foreign/treaty situations, inconsistent filing statuses, unmodeled business losses, capital/rental classification, and unresolved retirement treatment retain `SOCIAL_SECURITY_REVIEW_REQUIRED`. JSON/PDF return422 without a fabricated amount.2027 remains unsupported. An eligible zero-benefit result is a real zero, not a missing-input fallback.

The pure worksheet accepts a reviewed adjustment total for reference testing (including example2). The application's supported adjustment sources are narrower: it does not yet implement a traditional IRA deduction. This limitation is stated in the organizer rather than silently ignoring it.

## Validation

- `social-security-worksheet.test.ts`: published examples, thresholds, MFS branches, addbacks, cap, zero/invalid inputs and scope guard cases.
- `social-security-review.test.tsx`: real organizer save/read handlers, shared annual JSON/PDF and quarterly integration with synthetic auth/database transport; legacy guards, withholding, reconciliation and unsupported scenarios.
- `social-security-organizer-ui.test.tsx`: real controlled input handlers preserve separate persisted fields and require explicit answers.
- Related annual and quarterly regression suites, full TypeScript check and targeted lint are run for this batch; exact final counts are reported in the task handoff.
- A generated two-page2026 fixture was rendered and inspected: net/taxable benefits and separate withholding rows are legible, with no clipping or overlap.

These checks validate this scoped benefit path, not every tax return, live provider behavior or complete tax accuracy. Senior/standard deduction expansion is a separate coordinated change and must not alter the benefit combined-income calculation.
