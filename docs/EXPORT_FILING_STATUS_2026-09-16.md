# Export and filing release status — September 16, 2026

## What this release provides

WriteOff exports saved records and bounded planning worksheets for review by a preparer. It does not yet produce a complete, fileable federal/state return. No return has been submitted through this work.

| Output | Result and scope |
| --- | --- |
| Transaction CSV | Preserves signed cash amounts, year, currency, review/pending state, business-use fields, notes and private receipt metadata. Does not certify tax classification. |
| Owner records archive | Includes saved income, W2/1099, organizer, deductions, assets/settings, mileage, payments and transaction datasets, with a manifest and embedded CSV/README. Available on every plan. |
| Schedule C PDF/CSV | Reconciled receipts and confirmed expense records, full appendices and year-specific reference labels. Missing business/COGS/election facts remain explicit. |
| Schedule SE worksheet | Uses current income, expenses, supported depreciation and recorded W2 wage amounts. Additional Medicare planning is separate from regular SE tax. |
| Form 1040 planning PDF | Shares the federal snapshot and strict transaction inputs with the annual JSON estimate. Identity and scope notes are included; it is not an IRS form or complete return. |
| Home office / depreciation | Missing eligibility, elections or asset details require review. These are not offered as filing-ready forms. Existing setup records must load successfully before changes can be saved. |
| Monthly and cash-flow reports | Describe recorded cash movements; do not invent a tax saving or refund. Unknown currency and unsupported aggregation require review. |
| Estimated-tax vouchers | Unsupported voucher generation stays blocked. The user can open the official IRS document for the selected supported year. |
| In-app filing | Column Tax sandbox transport, authenticated routes and browser launcher are implemented. Disabled by default; no provider credentials or production filing are enabled. |

All-year raw archives preserve records for reconciliation. A selected-year tax summary cannot silently discard invalid dates, amounts or ambiguous transactions. Paid reports remain server-gated; downloading one's owner archive does not require a paid plan.

New manual-entry and user-confirmed receipt forms explicitly display USD and persist the declared currency. Old records are not backfilled with a guessed currency. Attaching a receipt preserves the existing bank transaction's fields.

## Filing activation

The old local PIN collector is disabled. Historical authorization records are preserved as references, without a claim that the return was signed or filed. The old client-writable submitted/accepted status route is also disabled. Local records cannot establish IRS acceptance.

The Column connection sends only a controlled synthetic account's email, an opaque identifier and verified security metadata after explicit sandbox consent. It sends no tax or financial prefill. It validates the provider's actual return year before exposing a short-lived session URL, never stores that URL, and reads independent jurisdiction statuses. Closing the filing interface does not imply submission or acceptance.

Current server gates require:

- Staging project `writeoff-production-testing`, `WRITEOFF_ENV=staging`.
- `COLUMN_TAX_MODE=sandbox` and explicit sandbox approval.
- Server-only client ID/secret and a provider-confirmed supported filing year.
- A controlled synthetic account plus fresh server-owned security metadata bound to the verified login and MFA status.
- Persisted export entitlement and explicit data-sharing consent.

Production mode and ordinary taxpayer accounts are blocked. No webhook, production transmission, tax-data prefill or real provider QA is claimed. The one-time first-prefill behavior must be resolved before any real user is initialized.

**External next step:** obtain Column partner acceptance/sandbox access, confirm commercial terms, year/form/state coverage and roles, then complete actual provider QA and security/consent integration. [Provider research and primary sources](EMBEDDED_FILING_RESEARCH_2026-09-16.md) records the concrete steps. No vendor message, account enrollment or contract was sent/accepted.

## Remaining limits

Receipt image/PDF binaries are not bundled, and private links are not accountant-sharing links. There is no TXF import, state return or comprehensive return-preparation certification. Filing identity details, documents not stored in WriteOff and unsupported facts must be supplied separately. [Data export details](CPA_EXPORTS_2026-09-16.md) and [tax coverage matrix](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md) define the limits; 2027 remains unsupported.

AI remains unavailable by the user's choice. Stripe test-mode and Plaid Sandbox verification remain separate external gates. This batch is for staging only.

## Validation

Combined application/build, deployed staging and artifact checks are recorded below after completion. Mocked provider tests validate our adapter's behavior; they do not establish an operational provider connection or IRS/state acceptance.
