# WriteOff product and engineering roadmap — September 17, 2026

Synthesized from three code audits (tax engine/exports, onboarding/AI review, platform/security/operations), a competitor scan, and the primary-source tax research in `docs/research/`. Everything below preserves the current guardrails: review-gated deductions, confirmed-only tax totals, no filing or refund claims, Basic pricing retained, embedded filing disabled.

## 1. Where the product stands

| Area | State | Evidence |
|---|---|---|
| Federal engine (2024–2026) | Verified against Rev. Proc. 2024-40 / 2025-32, SSA and P.L. 119-21 for brackets, standard deductions, wage base, CTC/ACTC, EITC, LTCG thresholds, SALT, QBI | `tests/tax-year-status.test.ts`, `docs/research/federal-parameters-2025-2027.md` |
| 2027 | Not published by IRS/SSA; app reports pending items and statutory knowns instead of guessing | `TAX_YEAR_2027_STATUS` in `lib/tax-rules/federal-year-rules.ts` |
| Above-the-line limits | SE health insurance and student-loan interest now clamped to statute | `tests/above-the-line-limits.test.ts` |
| Mileage | Date-aware IRS rates incl. the July 1, 2026 mid-year increase to 76¢ | `lib/tax-rules/mileage-rates.ts` |
| Per-transaction AI | Taxpayer context (methods, gaps, confirmed merchant history, recurrence) now informs suggestions; a prior-decision conflict gate asks before reversing the user's own choices | `lib/ai/taxpayer-context.ts`, `tests/taxpayer-context.test.ts` |
| Rollout safety | Manual exact-commit release, source-tree digest verification, coordinated-deploy token, secrets withheld from install scripts, read-only migration inventory | `scripts/deploy-production-release.mjs`, `scripts/production-migration-inventory.mjs` |
| Mobile | Expo scaffold with automatic trip detection and receipt capture; not yet built for a device | `mobile/`, `docs/MOBILE_APP_PLAN_2026-09-17.md` |
| Full unit suite | 2,696 passed after this batch | one run, tied to the engine changes |

## 2. Competitive position

| Competitor | Their edge | Their weakness (from reviews and BBB/Trustpilot) | WriteOff response |
|---|---|---|---|
| Keeper ($199/$399 yr; $20/mo tracking) | Bank-linked AI write-off finder, pro-signed filing, quarterly support | Surprise renewals after trials, unreachable support, filing errors on complex returns, "finds every deduction" overclaim | Transparent billing (Stripe portal, no dark patterns), explicit review gates, honest copy; add pro-review partnership rather than in-house filing first |
| FlyFin ($84–$348 yr) | CPA files, quarterly calculator, audit insurance | Slow CPA replies, mobile-only, trial-to-annual charge complaints | Web + iOS parity, deadline-aware quarterly planner built on reviewed facts |
| TurboTax Premium (~$129 + $64/state) | Polished interview, imports, Intuit Assist, expert ladder | Price ladder, upsell friction, FTC "free" litigation history | Year-round records that export cleanly to any filer; never market "free" unless free for everyone |
| FreeTaxUSA ($0 fed / $15.99 state) | Cheapest full Schedule C filing | No tracking, manual entry | Position as the year-round front end whose exports drop into FreeTaxUSA/TurboTax/a preparer |
| QuickBooks Solopreneur ($20/mo) | Invoicing, categorization, embedded filing | No quarterly estimates, generic categories | Tax-first categorization with IRS-grounded explanations |
| Found / Hurdlr | Banking + tax set-aside; GPS mileage | Requires their bank / mobile-first only | Mobile trip detection (shipped in scaffold) plus any bank via Plaid |

Positioning: the honest, review-first tax records platform for freelancers — AI that shows its evidence, totals that only include what you confirmed, and exports a preparer or filing product can rely on.

## 3. Roadmap

### Tier 0 — before charging (blocking)
1. Plaid production approval and secret; run the read-only inventory; complete the human overlap reconciliation for the 11 legacy profiles; fill the release review with real evidence. Owner: operator + engineering.
2. Coordinated production deploy via `npm run production:deploy` after Secret Manager, rules/indexes and rollback evidence are recorded.
3. Rotate the two accounts whose password hashes were in the previously tracked `users.json`; scrub git history before the repository is shared.
4. Observability: Cloud Logging alerts for SSR 5xx, Stripe/Plaid webhook failures, scheduled-sync failures, analysis-worker pauses, OpenAI spend.
5. Backups: Firestore PITR + documented restore drill; key escrow for `PLAID_TOKEN_ENCRYPTION_KEY` and `SSN_ENCRYPTION_KEY`.

### Tier 1 — first 90 days after launch (trust and completeness)
1. **Quarterly planner** on reviewed facts: Pub 505 regular-method installments, recorded payments, safe-harbor comparison (90/100/110), Form 2210 rate table (7% / 6% / 7% / 7% for 2026 quarters), no annualized method until facts exist.
2. **Income reconciliation UI** for overlapping 1099/receipt/bank sources (currently a 422 with no workflow).
3. **Capital-gain character**: collect short/long-term split in the organizer; stop assuming long-term.
4. **Business losses**: model Schedule C losses against other income with at-risk/hobby-loss review questions instead of clamping to $0.
5. **Home office**: collect exclusive/regular-use, method, and expense facts; unlock Form 8829 for the simplified method first ($5/sq ft, 300 sq ft cap).
6. **Depreciation**: first-year §179 for clearly eligible equipment under $2,500 de minimis vs capitalize flow; vehicles stay gated.
7. **OBBBA deductions**: organizer intake for qualified tips (self-employed net-income cap, SSTB exclusion), personal vehicle-loan interest, senior deduction facts; overtime flagged as generally unavailable to contractors.
8. **State**: replace the generic bracket toy with a year-labeled state module for the top freelancer states, starting with no-tax states and Ohio's business income deduction; show "informational" until validated.
9. **Durable rate limiting** (Upstash/Firestore counters) and an admin/support console for stuck deletions, legacy-bank revocation, and Stripe mismatches.
10. **Calendar-matched business purpose** on web (Google Calendar) and iOS (EventKit) to answer the most common review question automatically.

### Tier 2 — differentiation
1. iOS app to TestFlight: reverse-geocoded trips, vehicle attribution, push reminders, Face ID, Sign in with Apple.
2. Prior-return upload analysis (1040/Schedule C PDF → variance report vs current records) with strict PII handling.
3. Audit support records packet: per-deduction evidence bundle (receipt, purpose, attendees, mileage log) exportable per Pub 583/463 retention rules. Call it "audit support" or "records"; "audit defense/representation" is reserved for credentialed practitioners (Circular 230).
4. Preparer handoff: shareable, expiring accountant links and a CPA review marketplace (partner, not in-house filing).
5. Embedded filing (Column Tax or similar) only after partner acceptance, ATS testing and a separate consent/security review — remains `COLUMN_TAX_MODE=disabled` until then.
6. FinanceKit import for Apple Card users; email receipt ingestion.

## 4. Claims policy (marketing and in-app)

Allowed: "tracks", "suggests", "flags for your review", "records your preparer can use", "planning estimate", "supported situations".
Not allowed until the capability exists and is validated: "finds every deduction", "maximize", "guaranteed savings/refund", "file your taxes", "e-file", "audit protection/defense", "accurate for all states", "2027 estimates", "SEC/FINRA compliant", and any use of "free" that is not free for everyone (16 CFR 251; FTC v. Intuit and H&R Block history).

Data use: §7216 regulations treat tax software developers as tax return preparers for disclosure purposes. Any marketing or analytics use of return information needs Rev. Proc. 2013-14-style consent; keep marketing pixels and third-party SDKs off pages that carry tax data, and maintain a written information security program under the FTC Safeguards Rule. Details and sources: `docs/research/reporting-state-compliance-2026.md` §4.

Other research-driven specifics to encode when the related features ship: 2026 §179 limits $2,560,000 / $4,090,000 and §280F auto caps $20,300 / $12,300 (Rev. Proc. 2025-32, 2026-15); 100% bonus for property acquired after Jan 19, 2025; excess business loss threshold $256,000 / $512,000 (2026); Q2 2026 underpayment rate 6% versus 7% in other 2025–2026 quarters; 2026 IRS special per diem $319/$225 high-low (Notice 2025-54); Ohio Business Income Deduction ($250,000 at 0%, 3% above) and NYC UBT / MCTMT as the first state-local rules that make a federal-only estimate materially wrong.

## 5. Known gaps still open after this batch

Closed on 2026-09-17 (same-day follow-up batch; each item names its regression test):

- ~~Client-side Schedule C on the File Taxes screen bypasses income reconciliation~~ — `components/file-taxes-screen.tsx` now reads `/api/tax/compute-1040` through the shared dashboard snapshot loader and renders the 422 review message with a deep link (`reviewTargetForCode`); no client-side profit is computed. `tests/tax-snapshot-ui-handlers.test.ts`.
- ~~Filing hub hardcodes `quarterlyPaid: 0` and `income1099: 0`~~ — wired to `payments.estimatedPayments` and the new `income.income1099` (1099-documented receipts from `reconcileBusinessIncome`); the calculation-warnings banner renders with every refund/balance figure. `tests/tax-snapshot-ui-handlers.test.ts`, `tests/compute-1040-api.test.ts`, `tests/business-income-reconciliation.test.ts`.
- ~~Form 1040 planning PDF collects warnings but does not print them~~ — a numbered "Review notes" block prints on page 2 (truncated with a pointer when long) and the full list in the appendix. `tests/tax-export-pdfs.test.ts`.
- ~~Learning engine `suggestClassification` is dead code~~ — removed; merchant lookups accept `merchant`, `merchant_name` or `name`. `tests/learning-engine-contract.test.ts` fails if any module reintroduces the identifier.
- ~~`firestore.rules` lets clients set `is_deductible` directly~~ — confirmed-only aggregation requires `review_status === 'confirmed'` or a legacy pre-cutoff record (documented in `docs/TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md`); the server stamps `review_status`; rules keep `is_deductible` client-editable only until a review is recorded. `tests/schedule-c-aggregate.test.ts`, skipped-by-default case in `tests/security-rules.emulator.test.ts`.
- ~~CSP omits the GA/GTM origins used by `app/layout.tsx`~~ — the tag and its CSP origins are both conditional on `NEXT_PUBLIC_GA_MEASUREMENT_ID` (unset → no tag, no origins); ownership of the two measurement IDs is still an operator decision, recorded with steps in `docs/PRELAUNCH_READINESS.md`. `tests/middleware.test.ts`.
- Accessibility quick wins from the UX audit — receipt-match selects labeled, File Taxes back button named, login fallback announced as a status, and sign-up acknowledgments now required on the Google path with a server-validated consent record on the profile (`lib/onboarding/consents.ts`, `docs/PRELAUNCH_READINESS.md` §2). `tests/onboarding-consents.test.ts`, `tests/frontend-journeys.test.ts`, `tests/platform-auth-access.test.ts`.

Still open:

- Node 20 → 22 already in repo; production SSR still on Node 20 until cutover.
- `firebase.json` static CSP for `/auth/**` and `/login` still omits the Google tag origins; add them in the same deploy that sets the analytics variable, if analytics should run there (see `docs/PRELAUNCH_READINESS.md`).
- Accounts created before 2026-09-17 have no stored consent record; a re-acknowledgment prompt outside profile setup is needed before any terms change relies on `CONSENT_TERMS_VERSION`.
- `app/auth/error/page.tsx` still uses an unannounced `Loading...` Suspense fallback; the other auth pages use `role="status"`.
