# Focused workflows UX — September 16, 2026

## Presentation

- Transaction details uses one compact merchant/amount/date header. Saved category lives in Details; the Summary keeps the AI suggestion, unresolved deduction state, evidence access, and review action together. Long merchant names use two header lines; the complete name remains in Details.
- Swipe review removes a redundant full-viewport container, combines tax status with Add details, and places Change/Confirm together. Full reasoning and sources remain available through Why this category. Add details opens the Details tab directly, including after resolving the review queue.
- The public homepage has a shorter example and more concise workflow/pricing text. Plan pricing, access, and the absence of in-app filing remain accurate to the existing application configuration.
- The tax organizer shows personal facts first, with separate required eligibility and optional accountant-handoff sections. Income questions are grouped with unanswered counts. A labeled section picker replaces tiny unlabeled progress buttons. Blank answers remain distinct from No; the UI no longer claims that default answers mean a section is complete.
- Settings shows saved-value summaries grouped under Profile, Tax, and Account. Bank actions stay visible. Profession selection uses an add/remove picker; inputs and pickers have associated labels and readable text.

## Data and navigation

- Opening a requested transaction tab does not cancel an in-progress analysis. A successful analysis still returns to Summary; camera cleanup remains active when leaving Receipt or changing records.
- Settings saves the latest merged draft, serializes overlapping edits, retains unsaved state on failure, and ignores outdated completions after account changes/unmount.
- Navigation waits for pending Settings edits to save. Numeric clears persist explicitly, while untouched absent values stay absent. Existing profile values remain available on read/write round trips.

## Browser checks

Local preview uses isolated Firebase emulators and synthetic accounts. No real bank, payment, or tax-filing action was performed.

- Review fits within 320 × 740 with no vertical or horizontal overflow. Add details opens the Details tab directly.
- Transaction Summary fits at 320 × 740 and 390 × 844 with no page overflow for the demo record. Full reasoning, questions, record requirements and source links remain accessible in its analysis dialog.
- Homepage measured 1,597px tall at 390px wide, with no horizontal overflow.
- Organizer personal/income sections and Profile/Tax/Account Settings overviews checked at 390 × 844. Organizer Income needs a short scroll at 320 × 740; expanded long forms and evidence still scroll.

## Verification

- Full suite: **2,145 tests passed**, 11 emulator-only security tests skipped; 104 test files passed.
- Production build passed, including type checking. Changed components have no lint errors; existing repository warnings remain.
- Focused regressions cover tab deep links, in-flight analysis, camera cleanup, save serialization, navigation protection, failed save/load handling, account changes, legacy picker values, null/zero/undefined persistence, and preservation of optional organizer records.
- Browser verified a synthetic name edit immediately followed by Home navigation: the save completed before navigation, and the name remained stored when returning to Settings. The original demo name was restored afterward.

## Scope

This work simplifies preparation and verification. It does not implement autonomous return filing, expand tax coverage, change plan entitlements, or certify tax accuracy. Changes are local until separately deployed.
