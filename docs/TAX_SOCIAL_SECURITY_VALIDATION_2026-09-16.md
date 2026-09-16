# Social Security benefit review requirement

Reviewed September 16, 2026. Local staging change; not deployed by this task.

## Finding and decision

The organizer collects `hasSocialSecurity` and `amountSocialSecurity`, labeled as SSA-1099 Box 3. The shared federal snapshot previously included 85% of that amount as taxable income. Required facts are missing, so this change withholds the affected estimate instead of implementing an incomplete worksheet.

The IRS worksheet starts with **Box 5 net benefits**, not Box 3 gross benefits. It also considers other income, tax-exempt interest, adjustments and filing circumstances; 85% is a maximum, not an automatic taxable share. Married-separate living arrangements and prior-year lump sums require additional treatment. The currently published [Publication 915, Worksheet 1](https://www.irs.gov/publications/p915) and [Form 1040 instructions, lines 6a–6b](https://www.irs.gov/instructions/i1040gi), read for this review, are the 2025 editions. No finalized 2026 worksheet is claimed here.

For example, with complete ordinary-case facts, a single taxpayer with $20,000 of net benefits and no other income would not automatically have $17,000 taxable benefits. This application cannot establish those facts from its existing organizer. [IRS Topic 423](https://www.irs.gov/taxtopics/tc423) explains the income test and links the applicable worksheets.

## Implemented behavior

- The shared snapshot rejects declared benefits, nonzero stored amounts, contradictory flags/amounts, and malformed stored benefit values with `SOCIAL_SECURITY_REVIEW_REQUIRED`.
- Both the JSON federal estimate and Form 1040 export return actionable HTTP 422 without financial totals or a PDF. Calculation stops before calling the federal calculator.
- Benefits declared as Yes still require review when their amount is blank or zero. A missing/blank/No flag with no amount or an explicit zero preserves the existing no-benefits flow.
- Saved benefit records remain available. The organizer explains the limitation and links Publication 915; the dashboard review action opens the organizer. Existing Box 3 amounts are not silently reinterpreted as Box 5.
- This is a review requirement, not a completed benefits calculator or an automatic way to resolve that review. Keep supporting records; do not delete them to bypass it.

## Verification and limits

`tests/social-security-review.test.tsx` adds 24 cases. Real organizer save/read handlers feed the real JSON/PDF routes and shared calculation. Tests cover 2024–2026, a saved $20,000-only benefits case, missing/zero/contradictory/malformed amounts, all four supported filing statuses, high wages, owner/year isolation, unchanged no-benefits calculations and dashboard review navigation. A PDF-generation spy proves blocked cases never create a document; supported cases generate actual PDF bytes and matching JSON/PDF calculation results.

The focused seven-file run passed 130 tests. TypeScript passed; targeted lint had no errors and existing warnings remain. No provider or production writes were made.

Auth, entitlements and database transport are mocked. These tests do not validate live provider behavior, visual PDF layout, benefit taxability, every taxpayer scenario, or complete tax accuracy. Other unsupported investment, retirement, credit and filing scenarios remain as documented in the coverage matrix.
