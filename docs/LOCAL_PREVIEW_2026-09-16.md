# Local product walkthrough — September 16, 2026

## Open the app

Open **http://localhost:3000**. The visible browser is signed into a populated demo account. This is an isolated development preview with synthetic records and local Firebase emulators. It does not use production accounts, bank connections, payments or AI credentials.

All local accounts use **`LocalDemo2026!`**. These credentials work only in this demo.

| Account | What to try |
| --- | --- |
| `new@writeoff.example` | Fresh onboarding: profile, business details, then manual entry or optional bank setup. |
| `demo@writeoff.example` | Returning user with trial access, sample income/expenses and saved tax-organizer declarations. |
| `free@writeoff.example` | Expired trial: recent records remain visible, premium exports are locked, owner records archive remains available. |

Sign out in the navigation menu before switching accounts. Accounts are preverified fixtures; this walkthrough does not test real email delivery or Google sign-in.

## Walkthrough in order

1. **Home and welcome:** revised copy describes records, receipts and preparer exports. Current service limitations are stated instead of promising unavailable AI or automatic filing.
2. **New-user onboarding:** sign in with the new account, fill out the two profile steps, choose manual entry, and open the dashboard. An empty account is prompted to add records. Tax estimates stay unavailable until required facts have been supplied.
3. **Returning-user dashboard:** use the populated demo. Add Income and Add Expense are prominent. The federal estimate separates receipts, confirmed expense contributions, profit, tax and balance. The sample contains a refund, a partially deductible meal, a personal purchase, a review item and a pending item.
4. **Transactions:** search, filter and open saved records. Explicit income is labelled Income; a bank credit alone does not establish business income. Pending purchases are labelled Pending. Record counts replace speculative tax-savings claims. Adding an expense through the real form persists it and updates the dashboard.
5. **Income and tax review:** income entry keeps records separate from a tax calculation. Tax Preview shows the supported annual federal estimate and missing-scope warnings. The income-tax-rate label does not imply that it includes self-employment tax.
6. **File Taxes:** the hub presents records and estimates, preparer PDF exports and the owner JSON archive. It explicitly says that in-app filing is unavailable. These downloads are supporting records and worksheets, not complete federal/state returns.
7. **Free-plan behavior:** switch to the free account. Recent records and estimates remain visible; premium Schedule C/report exports show an upgrade gate. The owner archive stays available without a subscription.

The populated demo currently includes a $25 printing-supplies expense added through the UI. With the other fixtures, the annual snapshot contains $100,000 receipts, $350.01 expense contributions and $99,649.99 business profit. A restart seeds the original eight records, without that extra $25 expense.

## Improvements made during this walkthrough

- Added a reproducible local-emulator launcher that excludes environment files and provider credentials. Emulator mode requires the exact demo project, development mode, dummy configuration and a loopback browser host.
- Made onboarding and empty-dashboard guidance work for users entering records manually.
- Removed unsupported marketing, automatic-analysis and flat-rate tax-savings claims from the surfaces reviewed.
- Fixed a manual expense refund being counted again as business income. Income now requires explicit income/revenue classification; old custom-category inflows need review.
- Corrected transaction income/pending labels and removed automatic bank polling from the transactions page.
- Corrected dashboard record counts and category totals: pending records are separate, refunds subtract from posted expense amounts, and unconfirmed currency prevents a misleading USD total. The category card states that it shows recorded amounts before tax limits.
- Fixed the filing hub's false “No confirmed expenses” message caused by reading a count that the API does not return.
- Removed the guessed tax rate, tax savings, automatic 100%-deductible label and unsupported CPA-response promise from transaction details. Notes and classification saves no longer trigger AI requests; AI requires an explicit click and known service-unavailable responses point users to manual review.

## Is it ready to sell?

**Suitable for an invited beta focused on manual record keeping and preparer handoff. A broad paid launch is not yet ready.**

Before charging a wider audience, finish Stripe test-mode checkout/subscription/webhook/refund verification, clean up signup's mandatory bank/AI acknowledgments for manual-only users, and validate the promised support and onboarding experience. Test Plaid Sandbox before advertising connected-bank workflows. AI stays unavailable by the owner's instruction. Current signup consent checkboxes are not a substitute for a persisted consent record.

Exports do not include receipt image/PDF binaries, a state return, TXF imports or every federal tax scenario. 2027 is unsupported. Embedded filing requires partner access, complete provider QA and the necessary consent/security integration. The existing disabled adapter is not operational filing. See [export and filing status](EXPORT_FILING_STATUS_2026-09-16.md) and [tax coverage](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md).

## Verification and release boundary

The local browser walkthrough covered normal email/password sign-in, two-step onboarding, persistence after reload, a populated dashboard, saving a manual expense, transaction review, tax preview, filing/export controls and the expired-plan premium gate. A Schedule C button request returned HTTP 200, but the browser automation's download event timed out; do not treat that event as a confirmed saved file. Direct export-byte checks are reported separately.

All four direct local API checks passed: annual totals reconcile; Schedule C returns a parseable 5,196-byte PDF with matching amounts and refund detail; a free-plan premium CSV request returns `403 SUBSCRIPTION_REQUIRED`; and the free owner archive returns all eight owned fixture records with the correct signs. Evidence is in `/tmp/writeoff-local-demo-final-api-evidence.json`. The new-account profile was reset after the walkthrough, preserving its verified local Auth fixture, so onboarding can be tried again.

The final ordinary test run passed **1,624 tests across 81 files**. The 11 emulator-only security-rule tests were skipped in this run; their earlier separate staging validation remains documented, and this change does not modify the rules. Standalone TypeScript checking, launcher syntax and diff checks passed. Changed production-source lint had no errors; existing warnings remain. Nine focused transaction-detail cases cover unavailable AI, explicit successful analysis, duplicate-click suppression, manual saves and receipt unlinking. The actual local browser also showed the unavailable-AI guidance with both retry buttons disabled and manual editing still available.

Test logs: `/tmp/writeoff-local-preview-final-tests.log`, `/tmp/writeoff-local-preview-final-types.log`, `/tmp/writeoff-local-preview-final-lint.log`.

### Follow-up: analysis console error

The reported stack referenced the older detail handler attempting AI without a configured key. The isolated local preview now disables transaction analysis on initial render and after reload, explains that AI is off, and keeps manual editing available. The server authenticates first, then returns `503 AI_UNAVAILABLE` for absent or blank keys before reading transaction input, consuming analysis quota or calling profile/database/provider services. Configured nonlocal AI behavior is unchanged.

Fresh-browser verification showed both analysis buttons disabled and notes editable. Direct local HTTP checks returned 401 without authentication and the expected structured 503 for the demo user. The first probe during a development-route rebuild briefly returned 404; it passed after compilation settled. The final suite passed **1,634 tests**, with the same 11 emulator-only tests skipped; TypeScript passed. Evidence: `/tmp/writeoff-ai-unavailable-tests.log` and `/tmp/writeoff-local-ai-unavailable-evidence.json`. This follow-up is also local only.

The prior staging release is application commit `f2ae741583420aaad9dc8d3ae332cb3dcc83dec6`. **The additional changes described here are local source changes; they have not been deployed to staging or production.** Production readiness is not established by a passing local test suite.

## Run it again

From the repository, with Node 20, Java 21 and installed dependencies:

```sh
node scripts/local-demo.mjs
```

The launcher refuses occupied ports, starts loopback-only services, seeds synthetic fixtures and prints its temporary log directory. Keep its process running while reviewing the app. Ctrl+C stops the app and emulators. A restart creates new fixtures in a new temporary directory. If editing code after startup, restart the launcher to include the edits; its isolated source copy is intentional.
