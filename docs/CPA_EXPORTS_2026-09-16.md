# Data exports and preparer handoff

These files contain saved WriteOff records and planning summaries. They are not official filed returns, TXF files, e-file authorizations, or evidence that a return is complete.

## Formats and access

- `GET /api/transactions/export-csv?year=2026`: subscription-gated transaction CSV. Omitting the year includes all saved years. Signed amounts use positive outflow / negative inflow; neither direction determines taxable income. Recorded classification, pending status, currency, category, purpose, review notes, business-use fields and deduction adjustments remain visible. Formula-leading text is escaped for spreadsheets. Receipt links are private, owner-authenticated API paths.
- `POST /api/reports/generate-pdf` with `{ "year": 2026 }`: subscription-gated monthly cash summary loaded from the authenticated owner's saved records. Currency groups are separate, pending records are excluded from monthly amounts, and “marked outflows” explicitly are not filing deductions. Client-supplied financial totals are rejected.
- `POST /api/reports/export` with a supported `{ "type", "year" }`: planning form PDFs. Schedule SE uses live reconciled income/expenses, assets and W2 wages, rather than cached tax-summary settings. Missing or unsupported facts return review errors instead of a misleading PDF.
- `POST /api/user/export` with optional `{ "year": 2026 }`: owner archive on every plan. Response `data` contains `json` (datasets), `csv` (text), `readme` (text), and `summary` (counts, date range and limitations). The filing hub downloads the full JSON response; Settings downloads a JSON package plus CSV and README text files. A completed export is throttled for one hour per server instance; a failed export remains retryable.

## Archive datasets

The archive includes owner profile and account metadata; current and legacy transactions; receipt metadata; advisory AI analysis; saved gross receipts, 1099 income, W2 income, tax deductions and organizer; assets; settings; mileage trips; and quarterly payment records. Counts are recorded for every dataset, including zero counts.

Selected-year filtering applies to transactions, mileage, payment and year-stamped tax records. Profile, assets and settings are current all-year snapshots, because prior assets may have continuing relevance. Receipt metadata is limited to linked selected-year transactions; all-years archives also include unlinked receipt metadata. Invalid or missing dates/years block selected-year export with `EXPORT_REVIEW_REQUIRED`; all-years archives retain records for review.

All source reads must succeed. Current/legacy owner queries and owner-account nested records are combined by exact document path, with conflicting owners rejected. Different stored documents are preserved for preparer reconciliation; they are not silently merged. Repeated provider references block a monthly PDF summary. Failed or incomplete reads return 503, not an empty successful download. Source records are not changed by export.

## Deliberate exclusions and limitations

- Receipt image/PDF bytes are not bundled. Private links require authorized owner sign-in; they are not public accountant-sharing links.
- Authentication secrets, Plaid/Stripe credentials/identifiers, SSN ciphertexts, bank account/routing numbers, and legacy signing PIN fields are excluded. Transaction/account identifiers are replaced with stable export references. Necessary filing identity details must be supplied separately through a secure preparer workflow.
- Malformed saved AI JSON is marked unavailable, not treated as a filing fact. Categories and AI recommendations do not establish legal deductibility.
- Bank deposits, gross-receipt entries and 1099 records can overlap. Pending items, refunds, transfers, mixed-use percentages, meal limits, capital assets, missing currency, basis/carryovers and unsupported tax facts need reconciliation. No automatic transfer-to-income classification or refund claim is made by these data exports.
- Only records saved in the application are available. The archive is not a claim that every document or fact needed for filing has been collected.

## Focused validation

Tests cover signed amounts, zero/false preservation, calendar-year boundaries, CSV quoting/formula protection, private receipt paths, partial-use fields, multiple currencies, pending records, duplicate references, current/legacy/nested ownership, cross-owner rejection, incomplete-source failure, sensitive-field exclusion, dataset counts, selected-year parity, plan gates, server-only PDF data, live Schedule SE orchestration, archive retry and concurrent-request behavior. A two-page USD/EUR PDF sample is rendered and visually inspected locally; no taxpayer or provider data is used.
