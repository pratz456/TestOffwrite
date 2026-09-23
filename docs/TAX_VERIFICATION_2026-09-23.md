# WriteOff tax and GPT verification — September 23, 2026

## Outcome

Audited the current development candidate against official tax sources, corrected calculation and display defects, and exercised real OpenAI requests through the transaction pipeline and tax-assistant route. The supported scenarios below passed their checks. This is **not** certification of every section of the tax code, every return, every state, or the deployed production site.

The work is on `codex/2027-tax-coverage`, in [draft PR #13](https://github.com/pratz456/TestOffwrite/pull/13). Its base is the newest upstream branch checked on September 23, `cursor/wisp-v1-2-b231` at `ac89342c4ccfced6cc7508b936efd125dd3eb916`. The existing 2027-readiness commit is `164dc60`. No production deployment, customer-record mutation, tax filing or payment was performed.

## Corrections

- Corrected Social Security wage-base coordination, the Schedule SE earnings minimum, Additional Medicare treatment and the half-SE adjustment in basic estimates. Missing or invalid income no longer fabricates a 25% rate.
- Removed the unsupported generic high-income QBI phaseout. Affected QBI, 2026 minimum-QBI, section 68 and joint-return wage-ownership cases now require review, without an annual numeric result.
- Added a saved-record boundary for HSA, retirement and self-employed health-insurance claims whose eligibility and limits are not supported. Pure calculation helper tests do not establish eligibility for an actual claim.
- Aligned displayed deductions, signed refunds, meal limits and cent rounding with the export aggregate. Unknown currencies, unapplied mixed-use percentages, deduction overrides and duplicate records do not produce plausible USD totals.
- Dashboard and Filing Hub show Schedule C line 31 profit. The breakdown displays adjustments actually applied and separates business profit from an allowed business loss. Reports uses an explicitly labeled average-rate income-tax approximation, with matching drilldowns and no combined-SE claim.
- Corrected transaction treatment for LLC formation, mixed office food, sales-tax remittance, platform fees, association lobbying portions, solo travel meals and employer federal taxes. Questions remain open when necessary facts are missing.
- Corrected the Georgia 2026 dependent exemption and selected assistant guidance. Published 2027 guidance stays separate from unsupported annual calculations.
- Made transaction detail put its next question first, with reasoning and supporting records expandable on phones. Ordinary supplies no longer receive an unrelated refund explanation. Reanalysis replaces the visible explanation immediately instead of retaining the previous question or estimate.

## Verification evidence

| Check | Result |
| --- | --- |
| Complete default Vitest suite | **5,493 passed; 44 opt-in checks skipped** across 212 passing files. The opt-in suites were run separately as described below. |
| Actual Firebase emulator security and Plaid-migration suites | **21/21 passed**, using a separate synthetic project and dedicated ports. |
| GPT-4-family connectivity | Successful responses from `gpt-4.1-mini-2025-04-14` and `gpt-4o-2024-08-06` with the configured server key. No key was placed in browser code or committed. |
| Transaction baseline through real `analyzeTransaction` | 153 corpus + 86 bank-descriptor cases; zero provider failures. Category agreement was 123/153 and 59/69 labeled descriptors. These figures measure agreement, not legal accuracy. |
| Targeted real-provider regression rerun | **14/14 passed** on `gpt-4.1-mini`, including the five defects discovered by manually inspecting the baseline answers and controls that should still qualify. |
| Tax assistant through the real API route | **20/20 passed** on `gpt-4o` after correcting grocery routing; covers 2026/2027 topics, citations, eligibility boundaries and refusal to invent a 2027 refund. Firebase context/auth were synthetic for this focused route test. |
| Isolated app + Firebase Functions + real OpenAI | **9 automatic-analysis cases passed**; manual retry, idempotent confirmation, unresolved meal exclusion and stale-input rejection also passed. This exercised the actual HTTP/persistence flow, with synthetic bank records. |
| Browser | Signed in to the refreshed synthetic localhost account; dashboard and detailed tax totals matched at $22,334.06. Manual analysis returned a persisted question/source-backed result on the phone layout. Changing a synthetic supplies purchase from business-only to mixed use immediately replaced the old $35 basic estimate with a business-use question, without reloading. The main summary and confirmation action fit the tested 390 × 844 viewport. |
| TypeScript / lint | TypeScript passed. Full lint had zero errors; warnings remain. Later scoped checks also had zero errors. |

The production build passed with TypeScript and lint validation enabled. The PR validation section records the final integrated result.

**Baseline caution:** the broad live suite's limited invariant checks passed, but manual answer review found unsafe approvals/category placement. Those findings were fixed and covered by deterministic tests plus the targeted live rerun. Do not summarize the baseline as perfect tax accuracy. A funded key and a successful request do not prove every route or every future model response is correct.

Evidence: [synthetic live scorecard](validation/tax-audit-live-2026-09-23.json), [calculation audit](TAX_CALCULATION_AUDIT_2026-09-23.md), [display/export audit](TAX_DISPLAY_EXPORT_AUDIT_2026-09-23.md), [legal-source audit](TAX_POLICY_SOURCE_AUDIT_2026-09-23.md), and [2027 publication ledger](research/2027-tax-readiness-2026-09-23.md). These reports link the primary IRS, enacted-law and state sources used.

## Remaining limits and release steps

- Full 2027 federal/state estimates remain unavailable while necessary annual figures are unpublished or unverified. Published HSA/ACA and statutory guidance do not make a complete 2027 return engine.
- Eligibility collection is still needed for the review-gated deductions and joint-spouse wage allocation. High-income QBI, minimum QBI and section 68 need their complete worksheets. Vehicle methods, losses and other complex cases retain documented scope limits.
- This does not independently certify AMT, NIIT, all credits, qualified-dividend characterization, every state/local/nonresident rule, NOLs or every personal deduction. Planning/preparer PDFs are not IRS-fileable returns; automatic filing remains disabled.
- Monthly Reports uses an average income-tax rate approximation, not the actual before/after change in a full return. The transaction explanation's basic tax-effect calculation is different and explicitly excludes QBI, credits and other personal deductions.
- The tested key came from the existing server configuration. Production revision metadata was inspected, but an attempted deployed-source key comparison timed out and its temporary archive was removed. The newly audited code is not live.
- Review and merge the stacked candidate, then follow the existing production preparation/migration/preflight process and deploy the coordinated app/rules/functions release. A production smoke test must follow the actual deployment. These local checks do not complete the release.
