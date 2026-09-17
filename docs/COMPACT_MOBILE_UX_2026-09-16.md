# Compact mobile review — September 16, 2026

## What changed

- Transaction details now show the merchant, amount, date, AI category and review
  action together. Full reasoning and tax sources expand on demand. Receipt,
  business context and manual tax treatment are compact disclosure rows.
- Removed duplicate analysis buttons, the always-visible provider configuration
  notice, repeated classification prompts and standalone preparer/planning cards.
  Original bank details, receipts and the Tax Preview link remain available.
- Swipe review keeps the decision buttons close to the recommendation. Correction
  replaces the recommendation instead of extending an already long page.
- Review links from transaction details open that exact record, including a
  previously confirmed category that needs correcting.
- Dashboard prioritizes the next useful action, presents four totals in a 2-by-2
  mobile grid and moves recent activity above optional charts and checklists.
  When only tax facts remain missing, Add details opens the affected record.
- Navigation resets the app's scrolling pane; mobile layout uses the dynamic
  viewport height. Main controls retain at least 44px touch targets.

## Related behavior fixes

- Back no longer performs two navigations.
- Rapid changes across multiple context fields are merged and saved in order.
- Failed saves and background refreshes preserve the user's unsaved draft.
- All context fields participate in unsaved-change handling. Review and Tax
  Preview links also respect that guard.
- Saving notes does not silently approve a deduction. Excluding a deduction does
  not relabel a business expense as a personal purchase.
- Closing the receipt section stops an active camera preview.

## Verification

- Full suite: **2,081 tests passed**, **11 security-emulator tests skipped**.
- Production build passed. Changed UI files have zero ESLint errors; existing
  warnings remain.
- Browser checks used isolated local demo data. The collapsed transaction screen
  fit within 390x844, including supporting-section controls. At 360x740, review
  buttons remained visible without scrolling; the correction form was usable.
- Desktop transaction layout checked at 1280x900; no horizontal overflow.
- Expanded tax guidance exposed the original explanation, questions, documents
  and official source links.
- Focused category review and confirmation worked in the browser; missing tax
  facts stayed unresolved. Two rapidly edited context fields survived reload,
  and their synthetic test values were cleared afterward.

Expanded documents, notes, long merchant names or larger accessibility text can
still require scrolling. The layout prioritizes the core decision instead of
shrinking all information onto one screen.

Changes are local and committed for the localhost walkthrough. This pass did not
deploy production, change subscription rules or certify tax filing readiness.
