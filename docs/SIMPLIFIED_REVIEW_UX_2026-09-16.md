# Simplified preparation and review UX — September 16, 2026

## User-visible changes

- Transaction details now has Summary, Details, and Receipt tabs. The default summary presents the amount, category, brief AI explanation, unresolved-tax state, and review action together. Full reasoning, requested facts, record requirements, and official sources open in a focused dialog. The same dialog serves the swipe-review queue.
- Business purpose stays in the primary Details form. Additional notes and supporting fields expand only when needed. Drafts survive tab changes. Successful reanalysis returns to Summary.
- Home uses one federal balance/refund summary, one next action, three recent transactions, and an expandable insights/checklist section.
- Public homepage is reduced to a compact hero/example, three-step workflow, pricing, and collapsed FAQs. Welcome offers clear account choices. No AI availability or autonomous filing claims were invented.
- Onboarding separates About you, Your work, and optional Details. Profession selection no longer requires a nested scrolling list. Required-field validation and the saved profile payload remain intact.
- Income and deductions show concise totals and grouped records/inputs. Optional guidance expands on demand. Entered deduction amounts are not presented as approved tax deductions.
- The tax assistant has a compact header/year selector, short starter labels, and a smaller composer. Answers keep the core guidance and follow-up questions visible; sources and photo observations expand separately. The 2027 planning limitation remains visible.
- Development previews no longer cover product controls with floating debugging buttons. Query devtools can be enabled with NEXT_PUBLIC_SHOW_DEVTOOLS=true in development.

## Reliability fixes discovered during the UX pass

- Failed income reads show Retry instead of looking like empty records; failed deletes retain the record.
- Income entry defaults follow the selected year. Late responses from a previous year are ignored.
- Deductions clear stale values when changing years or loading a year without saved values. Save remains disabled until that year's data is successfully loaded.
- Leaving Receipt cancels pending camera permission and stops active capture, including programmatic tab changes and transaction changes.
- Touch gestures originating inside the analysis dialog cannot swipe/confirm the underlying transaction.
- Reanalysis errors remain visible inside an open analysis dialog.
- Native onboarding pickers avoid a custom-select keyboard focus error; required values remain unselected until supplied.

## Validation

- Full Vitest suite: 2,112 passed; 11 emulator-only security tests skipped. Production build passed, including type checking.
- Focused checks cover profile identity/validation, year switching and stale responses, failed saves/deletes, context autosave, camera lifecycle, review gestures, provider failures, tax snapshots, source-link validation, and subscription behavior.
- Browser verification used synthetic data and isolated local Firebase emulators. Transaction Summary fits without vertical or horizontal scrolling at 390 × 844 and 320 × 740 for the demo transaction. Supporting content remains accessible through tabs/dialogs.
- Verified Home, public homepage/navigation, income, deductions, all three onboarding steps and native picker keyboard selection, assistant starter/year notice, transaction details/receipt tabs, and draft persistence in the local preview.

## Scope

This batch changes presentation and the specific reliability issues above. Tax calculations, plan entitlements, backend export contracts, and AI provider configuration remain unchanged. Automatic tax-return filing is not implemented. Longer records, optional forms, and full evidence can still scroll; they no longer all occupy the default transaction view.
