# Tax-export validation — September 16, 2026

## Release boundary

These downloads are **planning records and preparer handoffs**, not complete IRS returns, official fillable forms, a filing authorization, or proof that a return was accepted. The work below is local staging code. No production deployment or real taxpayer/provider submission was performed by this audit.

## Corrected defects

- Schedule C: render reconciled receipts and confirmed expense contributions; preserve signed refunds and shared odd-cent meal rounding; include every confirmed transaction when the appendix is selected; honor summary-only requests. Do not invent an accounting method, business address, cost of goods sold, final profit or home-office deduction.
- Published Schedule C line references: Other expenses is 27a for 2024 and 27b for 2025. The 2026 planning export explicitly uses published 2025 references pending final 2026 form review.
- Schedule SE: use selected-year saved business receipts, confirmed expenses, supported depreciation and W-2 Social Security/Medicare wages, shared with the SE preview. Stop using the stale tax-summary cache or hardcoded 2024 limits. Separate regular SE tax and its half-tax deduction from the SE portion of Additional Medicare Tax.
- Form 4562: paginate all assets and preserve full descriptions, basis, business percentage, method and calculated amounts. Preserve existing review errors for unsupported elections/assets; do not imply all depreciation rules are modeled.
- Form 8829: preserve the existing requirement for reviewed rental/eligibility/income-limit context. Public settings alone do not establish it, so export remains unavailable with an actionable review response. A synthetic supported rental example demonstrates actual operating expenses, income limitation and carryover without the erroneous $1,500 actual-expense cap.
- Federal 1040 summary: print full saved taxpayer/spouse identities and outstanding warnings in a paginated appendix; remove the perjury/signature declaration, fake IRS branding and implied refund instructions. Keep shared annual calculation values and show missing/unsupported return facts prominently. Add private, non-cacheable responses.
- All three tax-calculation/export paths use complete, owner-verified transaction reads. Missing/invalid dates, malformed selected-year amounts, non-USD amounts, explicitly recorded mixed-use allocations and duplicate logical transaction identifiers require review. Query failures produce an error rather than a partial/zero PDF.
- Schedule C controls: income-only PDFs remain downloadable; generate CSV server-side from the same complete owner-verified inputs, reject read failures, and escape spreadsheet formulas while preserving numeric negative refunds. Preview is labeled as loaded records, not authoritative tax eligibility.
- Tax setup: load saved settings before editing; block partial-read failures/account-switch leakage; do not post saved assets again; persist saved-asset removals and retain rows when deletion fails. The wizard uses review prompts instead of declaring forms definitively unnecessary or using a year-independent contractor threshold.

## Numeric and integration evidence

Focused tests exercise real route handlers and PDF generation with synthetic persistence/auth:

- 70 $100 records, one -$20 refund and one $10.01 meal: confirmed expenses $6,985.01; recorded $100,000 receipts less those expenses $93,014.99. This is a subtotal, **not final Schedule C profit**.
- 2026 business profit $100,000 and same-taxpayer W-2 Social Security wages $180,000: net earnings $92,350; remaining wage base $4,500; Social Security tax $558; regular Medicare $2,678.15; regular SE tax $3,236.15; deductible half $1,618.08. The $651.15 SE Additional Medicare portion appears separately.
- Twelve supported $1,000 computer assets at 50% business use produce twelve complete records and $1,200 regular depreciation in the selected-year synthetic case.
- Reviewed rental-home-office fixture: $5,600 allocated indirect plus $400 direct plus $800 prior carryover; $1,000 supplied income limit gives $1,000 allowed and $5,800 carryover. The public route does not infer those missing facts.
- Tests verify 2024/2025/2026 selection, query failure, owner-scoped reads, malformed records, review 422s, no-PDF-on-review, Unicode identity preservation, warnings, complete pagination and text bounds.

Synthetic PDF artifacts are under `/tmp/writeoff-tax-export-audit`. All pages were rendered with Poppler and visually inspected; no real taxpayer data was used. Automated bounds checks accompany visual checks, rather than relying only on extracted PDF text.

## Remaining filing limitations

A confirmed expense is not a legal deductibility determination. Mixed business/personal use, entertainment/contribution classification, vehicle methods, inventory/COGS, returns/allowances, elections and complete income classification require preparer review. Transaction business-use percentages are not newly applied by this export work; an explicitly recorded allocation other than numeric 100% blocks affected confirmed-expense calculations rather than silently using the full amount. Missing allocation facts remain a review limitation. SE is a nonfarm one-taxpayer planning calculation; spouses, farm/church/railroad/optional-method/exemption cases and complete Form 8959 wage withholding need separate review. Home-office and depreciation support remains the documented narrow subset. The 1040 summary does not generate all supporting schedules, state returns, signatures, elections, penalty computations or an IRS-ready transmission.

## Primary references checked

- [2024 Schedule C](https://www.irs.gov/pub/irs-prior/f1040sc--2024.pdf) and [published 2025 Schedule C](https://www.irs.gov/pub/irs-pdf/f1040sc.pdf): income/expense/COGS/home-office fields and line 27 changes.
- [Schedule SE instructions](https://www.irs.gov/instructions/i1040sse) and [published Schedule SE](https://www.irs.gov/pub/irs-pdf/f1040sse.pdf): wage-base coordination, separate-spouse calculations, regular SE lines 12/13 and Additional Medicare separation.
- [SSA contribution and benefit bases](https://www.ssa.gov/oact/cola/cbb.html): 2024 $168,600; 2025 $176,100; 2026 $184,500.
- [Form 8829 instructions](https://www.irs.gov/instructions/i8829) and [Publication 587](https://www.irs.gov/publications/p587): eligibility, income limitation, actual-expense carryovers and separate simplified method.
- [Form 4562 instructions](https://www.irs.gov/instructions/i4562) and [Publication 946](https://www.irs.gov/publications/p946): depreciation elections, asset detail and MACRS tables.
- [Published Form 1040](https://www.irs.gov/pub/irs-pdf/f1040.pdf): return identity, payments, signature and supporting-schedule requirements.
- [1099-MISC/NEC instructions](https://www.irs.gov/instructions/i1099mec): year-specific reporting threshold and exceptions; the undated wizard must not imply a universal $600 threshold.
