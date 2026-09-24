# Compact interface refresh — September 24, 2026

## Source and scope

Built on `d29d74c` in `codex/cursor-latest-preview-20260924`, which includes the merged Cursor updates from `7561b66`. This extends the compact dashboard design across the existing application. It is a local review release, not a production deployment.

## What changed

- Stable card padding, restrained borders and shadows, and consistent page widths. Static cards no longer lift on hover.
- Compact transaction, income, category, mileage, receipt, document-import and review screens. Desktop layouts put related sections beside each other; phone layouts retain a single reading order.
- Tax overview, organizer, deductions, quarterly planning, calendar, state planning, filing and export worksheets use aligned headers and shorter controls. Optional explanations expand on demand; review warnings remain available.
- Tax overview now links directly to asset setup when depreciation blocks an estimate. Saved-record navigation remains useful while the estimate is unavailable.
- Settings opens the tax profile first and groups other saved sections into a desktop grid. Billing puts subscription status beside plan information. Bank pages use compact layouts and retain the local preview's live-site handoff.
- Sign-in and sign-up have smaller headers and less outer padding. Removed the nested full-height wrapper around sign-up.
- The assistant's empty state puts the composer immediately after its starter questions; active conversations retain their scrolling message area.
- Public tools, help, contact, blog, About and legal pages use smaller gaps. Dead tutorial links and nonfunctional promotional tiles were removed. Duplicate stale About/privacy material now links to the canonical pages.

## Verification

- Full automated suite: **6,153 passed; 49 skipped** across 242 passing test files and six skipped files. Skipped tests require live providers or emulators.
- TypeScript: passed. Production build using the repository's offline CI configuration: passed.
- Scoped lint: zero errors; existing warnings remain.
- Browser review used the signed-in local owner preview. Checked transaction list/detail, income empty state, tax review-required state, filing/export tabs, settings disclosures, billing, organizer, receipt upload, assistant, public tools and Help tabs.
- Desktop and 390px phone checks found no horizontal overflow on the inspected screens. The sample transaction's AI explanation, missing-fact prompt and confirmation action fit above the phone viewport fold.
- Legal body text was preserved in the canonical policy pages. Source review found no changes to tax formulas, provider calls, persistence contracts or plan-access checks in this pass.

## Boundaries

This is a presentation and navigation release. No real transaction confirmation, tax fact, bank connection, payment or account setting was changed during browser verification. Existing records that need review still need review; this release does not certify a return, provider availability or overall production readiness. The local preview continues to hand bank and billing operations to the live application.
