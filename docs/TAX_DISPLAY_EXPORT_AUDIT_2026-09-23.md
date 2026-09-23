# Tax display and export audit

Reviewed September 23, 2026 on `codex/2027-tax-coverage`, starting from `164dc60`. This is a local source and synthetic-test audit, not a production verification or a certification of a complete return engine.

## Scope

- Reachable dashboard, tax preview/filing hub, categories, deduction details, AI insights, transaction detail and swipe review paths.
- Shared federal snapshot and its Form 1040 planning PDF; Schedule C CSV/PDF and supporting SE, 4562 and 8829 export paths; raw preparer CSV.
- Displayed amounts, confirmation/status scope, signed refunds, meals, mixed-use/override handling, tax year, credit/payment reconciliation and unavailable calculations.

## Fixed findings

| Issue | Correction |
| --- | --- |
| Categories and AI insights summed absolute transaction amounts. Refunds increased deductions; meals used 100%; pending/unconfirmed records counted. Deduction details excluded negative refunds. | All three screens use `lib/tax/display-deductions.ts`: server-confirmed, posted, not removed/superseded, same signed per-record cent and meal rules as confirmed Schedule C aggregation. Refunds reduce the result. |
| Categories/deduction details assumed a 25% tax rate without a profile and called raw amount × rate “savings.” | Removed the invented tax-savings metric. Show confirmed contribution and recorded outflow separately; direct full tax interpretation to Tax Preview. |
| AI insights searched negative bank inflows for deduction opportunities and treated repeated transactions as distinct recurring subscriptions. | Opportunities require positive posted USD outflows still awaiting review, exclude confirmed personal spending, and are labeled spending to review. Subscription count is labeled transactions that may relate to subscriptions. |
| Unknown currency, mixed business use, duplicate references or unapplied overrides could yield a plausible full deduction. | Display totals become unavailable with a review explanation. The tax export reader also rejects unknown currency and unapplied overrides; existing mixed-use validation remains. Raw records remain exportable with review information. |
| Tax Preview showed claimed health-insurance/HSA/student-loan inputs even when the engine limited them; SIMPLE contributions were omitted. | `Form1040Result.appliedAdjustments` carries the amounts actually applied. The preview uses these values and includes SIMPLE. The shared snapshot also preserves the raw SIMPLE input. |
| Saved HSA, retirement and self-employed health-insurance amounts could reduce annual tax without the facts establishing eligibility. | The saved-record federal snapshot now returns `TAX_CALCULATION_SCOPE_REVIEW_REQUIRED` before applying any nonzero claim. This includes legacy profile fallbacks and separate Solo 401(k) components. Annual JSON, Form 1040 PDF and both quarterly routes withhold numeric estimates. Existing Social Security review/reconciliation errors retain precedence. |
| Preview Schedule C income used pre-asset profit instead of the allowed amount; other income components were hidden. | Show engine `scheduleCAllowed` and the interest, dividends, retirement, rental and other ordinary income components used in total income. |
| Preview omitted nonrefundable credits, refundable credits and Additional Medicare tax from its breakdown. Effective-rate explanation described income tax only. | Show the missing components; explain total modeled federal tax divided by total income. Display cents when present instead of independently rounding every line to whole dollars. |
| High-income QBI and other unsupported material cases now return review errors from the core engine. | Shared review-code navigation points to Tax Preview; the preview explains the missing supported calculation and preparer review without implying a nonexistent input form resolves it. |
| Raw preparer CSV omitted the camel-case `businessUsePercent` field. | Preserve it alongside the other recorded allocation fields, explicitly marked not applied. |
| Dashboard cash-flow chart summed currencies as USD, included pending/removed/superseded records and treated a positive amount with legacy `type: income` as an inflow. | Shared `cash-flow-summary.ts` nets posted signed cents in the selected calendar year, requires known USD, rejects duplicate/invalid records, and displays a review message instead of a chart when blocked. |
| Transaction details, swipe review and recent activity labeled every raw amount with `$`. | Shared `amount-display.ts` labels the recorded ISO currency or explicitly says currency unknown; invalid amounts require review. |
| Public calculators could throw new QBI/scope errors during render and silently parse `100junk` as $100; the SE calculator hid valid zero tax. | Both UI boundaries render a review message with no result; SE guards joint wage ownership; numeric inputs must parse completely and zero SE tax is displayed. |
| Dashboard advisory used unavailable savings as zero, telling confirmed accounts to start adding records. | It now uses the confirmed record count. The redundant savings request and artificial projection fallback are removed. |
| Unused exported `TaxSavingsChart` would call the removed default-rate path. | Retained its export as a short honest compatibility notice. It no longer invents daily tax savings or crashes when no profile is supplied. |

The shared display helper is also available to dashboard/API/cache callers. Parent-task changes wire those consumers and correct the core rate/KPI formulas separately.

## Numeric evidence

The same synthetic records now produce the same confirmed contributions in the display helper, Schedule C aggregation and Schedule C CSV:

| Record | Signed recorded amount | Confirmed contribution |
| --- | ---: | ---: |
| Office expense | $100.00 | $100.00 |
| Office refund | -$20.00 | -$20.00 |
| Meal | $10.01 | $5.01 |
| Meal refund | -$1.01 | -$0.51 |
| Total | $89.00 | $84.50 |

The shared helper also checks a December 31 timestamp with a negative UTC offset remains in its recorded calendar tax year, while the next January 1 is excluded from that year's total.

## Follow-up guard review

- Fixed a joint-return ownership bypass: zero W-2 Box 1 no longer skips review when Social Security wages/tips or Medicare wages are positive. The normalized snapshot, direct engine, SE loader and profile-rate helper consider these boxes; API/PDF/quarterly tests verify no amounts are returned. A second W-2 with missing Medicare wages cannot hide a known positive Box 5.
- Dashboard and Filing Hub now show Schedule C line 31 profit after assets/home office, rather than the pre-asset subtotal. This remains distinct from a limited business loss allowed into Form 1040 income.
- Saved HSA/retirement/health-insurance claims now stop at the shared snapshot boundary. This is an eligibility safeguard, not an implementation of Form 8889, retirement contribution limits or Form 7206. The direct `compute1040` helpers remain conditional arithmetic; their unit tests do not establish that saved payments qualify.

### Saved adjustment scope evidence

Official sources reviewed September 23, 2026 explain why a payment total alone is insufficient:

- [IRS Publication 969](https://www.irs.gov/publications/p969): HSA eligibility and contribution limits depend on coverage, eligible months, age, Medicare and other/employer contributions.
- [IRS Publication 560](https://www.irs.gov/publications/p560): retirement contributions and deductible amounts have plan and earned-income limits; other plan participation and contribution types require review.
- [IRS Form 7206 instructions](https://www.irs.gov/instructions/i7206): self-employed health-insurance eligibility depends on coverage months, employer-subsidized coverage eligibility and applicable premium-tax-credit coordination.

The guard applies no guessed eligibility and accepts no new self-certification flag. Recording amounts is still available. Users with affected claims need preparer review outside this incomplete calculation until the required facts and worksheets are implemented; changing a recorded amount solely to bypass review is not a valid workflow. Ordinary supported annual cases with zero affected claims remain available. Student-loan treatment is unchanged.

## Validation

Focused tests passed locally:

- `tests/display-deductions.test.ts`: 19 tests; includes a real `compute1040` result showing applied health insurance/HSA/student-loan limits and SIMPLE in the adjustment sum.
- `tests/tax-snapshot-ui-handlers.test.ts`: 40 tests; actual component request/state handlers, applied amount and component display, unsupported QBI state, review navigation and state/federal separation.
- `tests/tax-export-pdfs.test.ts`: 39 tests; real PDF generation/text/bounds, supported/unsupported years, signed CSV, currency/override/mixed-use gates, owner/read failures.
- `tests/public-tax-calculator-ui.test.tsx`: 6 tests for joint wage/QBI review, valid zero SE tax and malformed input.
- `tests/dashboard-tax-snapshot.test.tsx` plus `tests/dashboard-filing-status-render.test.tsx`: 27 tests for shared snapshot values, scope/review states and record-only advisory/insights behavior.
- `tests/cash-flow-summary.test.ts`: 8 tests for cash-direction, date/year, duplicate, status and currency regression cases.
- `tests/transaction-export.test.ts`: 17 tests; signed raw records, source fields, currency separation, CSV escaping and private receipt references.

Command: `npx vitest run tests/display-deductions.test.ts tests/tax-snapshot-ui-handlers.test.ts tests/tax-export-pdfs.test.ts tests/transaction-export.test.ts`. The first combined run passed 113 tests; the subsequently added applied-adjustments case passed with all 18 display-helper tests, giving 114 focused cases at that point. Subsequent boundary additions passed: 19 display cases, 27 dashboard cases, and 6 public-calculator UI cases; the parent final run is authoritative for the complete suite. Parent task owns full-suite/type/build verification.

Saved-adjustment follow-up: `npx vitest run tests/compute-1040-api.test.ts tests/w2-tax-contract-integration.test.ts tests/social-security-review.test.tsx tests/above-the-line-limits.test.ts` passed **126 tests across 4 files**. Cases cover six persisted deduction fields across annual/PDF/quarterly routes with exact error-only payloads, four legacy profile fields, opposite-signed Solo 401(k) components, unchanged zero-claim results, and Social Security gate precedence. Existing conditional math tests remain green. `git diff --check` was clean.

## Limits and remaining scope

- Confirmed transaction contributions are **before** profile-specific vehicle, asset, de-minimis and home-office adjustments. They are labeled accordingly and must not be presented as final Schedule C deductions or tax savings. The full snapshot/export calculation handles supported asset and home-office adjustments. Vehicle/mileage methods still require their separate supported path and review; this record summary does not infer or apply them.
- Record confirmation is not proof that an expense legally qualifies. Missing eligibility and return facts still require review. The engine has additional supported-scope limits documented by the parent audit.
- 2027 record summaries do not enable a 2027 federal calculator. Annual tax calculation/export paths continue to reject unsupported years; no 2026 tax table is reused as a 2027 table.
- Form 1040 and Schedule C PDFs remain planning/preparer documents marked not for filing. This audit does not establish IRS e-file capability or coverage of every return.
- `components/dashboard.tsx` and `components/summary-screen.tsx` had no application imports in the repository search (the legacy dashboard has tests). They were not used to claim live coverage. The active dashboard is `components/dashboard-screen.tsx`.
- Tests use synthetic data and mocked owner/provider boundaries. No customer transactions were modified, no paid API calls were made, and no deployment or live browser verification was performed for this subtask.
