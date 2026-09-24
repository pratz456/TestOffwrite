# Guided deduction eligibility

Implemented on `codex/2027-tax-coverage`; this document is implementation and test evidence, not production deployment evidence.

## User-visible changes

Tax Organizer now offers collapsed, year-specific questions for HSA contributions, self-employed health insurance, retirement contributions, and joint-return wage ownership. Answers start unanswered. Monthly shortcuts change only the selected fact, and saving a different year never silently carries eligibility forward.

Complete supported facts flow into the shared annual JSON, quarterly, and preparer-PDF calculation. Amounts saved in Organizer must reconcile with existing deduction/profile records. Conflicts, excess amounts, and missing facts produce actionable review messages rather than a fabricated deduction or refund.

## Supported calculations and sources

- **HSA:** first-of-month eligibility, self/family coverage, holder age 55 catch-up, Medicare exclusions, employer/payroll contribution offsets, and one contributing holder. Married users are instructed to select family coverage when either spouse had it and confirm allocation. Employer-only contributions are checked even with a zero personal claim. [Form 8889 instructions](https://www.irs.gov/instructions/i8889)
- **Health insurance:** one sole-proprietor business, eligible covered people, non-Marketplace medical/dental/vision premiums, monthly employer-plan access, and the income ceiling after the SE-tax and retirement deductions. Access for any part of a month excludes the month, including qualifying employer access through spouse, dependent or child under 27. [Form 7206 instructions](https://www.irs.gov/instructions/i7206), [worksheet](https://www.irs.gov/pub/irs-pdf/f7206.pdf)
- **Retirement:** 2025–26 traditional owner-only SEP, Solo 401(k), and standard SIMPLE contributions. Uses reduced self-employed employer rates, annual/deferral limits, the Solo 401(k) low-income half-remainder calculation, and SIMPLE Schedule SE earnings. Employee/employer components must reconcile to the claim. [Publication 560, chapters 3 and 5](https://www.irs.gov/publications/p560)
- **Joint wages:** exactly one self-employed spouse; both spouses' Box 1, Boxes 3+7 and Box 5 totals reconcile against current records. Only the business owner's Social Security wages reduce that person's SE wage base; Medicare wages remain combined. Annual JSON/PDF and standalone Schedule SE share this assignment. [Schedule SE instructions](https://www.irs.gov/instructions/i1040sse)

Sources reviewed September 23, 2026. Existing year rules provide published annual amounts; unpublished 2027 annual-return parameters remain blocked.

## Boundaries retained

HSA distributions/prior excess/testing periods and shared spouse contributions, Marketplace credits, long-term-care premiums, Form 2555 exclusions, multiple businesses or plans, employee coverage, Roth/catch-up/enhanced SIMPLE contributions, and two self-employed spouses remain specific review cases. Other existing income, credit, QBI and return-completeness gates remain active. This does not authorize e-filing or promise a complete return.

The standalone Schedule SE response no longer derives an apparent AGI from unreviewed adjustment claims; those fields are null. Use the annual snapshot for supported AGI and allowed deductions.

## Verification

Focused tests cover worksheet boundaries, zero-claim excess/reconciliation bypasses, incomplete answers, year mismatch, organizer persistence validation, legacy record guards, and matching JSON/PDF/SE results. Integration also covers quarterly calculations, Social Security benefit adjustments, and existing tax review boundaries. Final counts and type-check status are recorded in the parent implementation report.
