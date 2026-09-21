# Daily workspace UX — September 16, 2026

## What changed

- Mobile navigation now keeps Home, Transactions and Taxes in one compact row. The More menu groups records, additional tax tools and account settings. Desktop uses the same destination catalog and promotes Taxes and the AI assistant.
- The authenticated workspace uses system typography, neutral backgrounds, lighter borders and a restrained blue accent.
- Transactions opens directly into search and four status filters, followed by readable rows. Additional date/category/amount/sort controls expand on demand. Manual entry and receipt upload share an Add menu.
- Home shows Add Income and Add Expense, with secondary actions in an accessible menu instead of a horizontal strip.
- Tax overview leads with the estimated federal balance/refund, three supporting values and a next step. Calculation limits, missing information, state details and the full Form 1040 breakdown remain available through labeled disclosures.
- Filing uses Prepare, Review and Export tabs. Export shows the JSON archive and three worksheet downloads together; contents, exclusions and filing availability expand separately. The app still explicitly states that it does not submit returns.
- Shared navigation respects unsaved transaction-detail edits. Users can stay, save or discard and continue to the selected destination. Effect cleanup removes obsolete navigation listeners.

Existing calculation logic, API routes, export validation and subscription gates were preserved.

## Verification

- Full Vitest run: **2,086 passed**, 11 emulator-only security tests skipped; 101 test files passed, one skipped.
- Production build: passed, including type checking. Existing repository lint warnings remain; no blocking lint errors.
- Five additional navigation-guard regressions cover dirty/clean navigation, the latest requested destination after staying, reverted drafts and unmount cleanup.
- Browser checks used isolated local Firebase emulators and synthetic demo records, without changing production records.
- At 390 × 844, the default tax overview and compact Export tab fit within the app viewport without vertical scrolling. At 320 × 740, all three PDF actions remain above the fold; explanations may require scrolling.
- Transactions and tax/filing screens were checked for horizontal overflow at 320 and 390 pixels. Desktop navigation and the transaction table were checked at 1280 × 900. No horizontal overflow was found in the checked layouts.
- Verified transaction search, review filtering, expandable filters, filing tabs, mobile menu dismissal and focus restoration, Home's secondary actions, and unchanged synthetic federal estimate values.

## Delivery and limits

Available in the running localhost preview. This batch is committed locally on `codex/staging-readiness`; it is not deployed to production. This is a UX improvement to the daily workspace, not a claim that every secondary form fits on one screen or that tax filing/provider integrations are complete. Long record lists and expanded explanations still scroll.
