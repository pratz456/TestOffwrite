# WriteOff Privacy Policy Audit

Date: 2026-09-17. Version: 1.0. Scope: every user-facing statement on the two privacy pages in the codebase, checked against the data flows verified in `WISP_2026-09-17.md`, `SUBPROCESSORS_2026-09-17.md`, `DATA_RETENTION_AND_DELETION_2026-09-17.md`, and `SECTION_7216_CONSENT_REVIEW_2026-09-17.md`. Only statements that were factually wrong about what the code does were changed in page copy; everything else is a recommendation.

Pages audited:
- Public policy: `app/privacy/privacy-page-client.tsx` (route `/privacy`, linked from sign-up consents and the Notice at Collection); metadata in `app/privacy/page.tsx`.
- Signed-in copy: `app/protected/privacy/page.tsx` (route `/protected/privacy`; listed in `docs/ROUTES_AND_GATES.md`; no in-app link found, but the route is reachable). Its text is an older, different policy.
- Terms of Service: no `app/terms/**` route or any link to terms exists. The only "Terms of Service" text in the app refers to Plaid's terms (`components/plaid-link-screen.tsx`).

Verdicts: OK = accurate; FIXED = copy changed in this branch; REC = accurate or unverifiable but should change (not edited).

## 1. Public policy (`/privacy`)

| Statement (abridged) | Verdict | Basis |
|---|---|---|
| "Last updated: September 11, 2025" | FIXED → "Effective date: September 17, 2026 (version 2026-09-17)" | Copy changed today; version now equals `CONSENT_TERMS_VERSION` in `lib/onboarding/consents.ts` |
| Intro: explains what is collected, how used, choices | OK | |
| Personal Information: name, email, state, profession, filing status, income | OK | `lib/firebase/profiles.ts`. Incomplete: also entity type, business purpose, NAICS, EIN, home-office and vehicle facts, W-2 figures (REC: add EIN explicitly) |
| Financial Data: bank account and transaction data via Plaid | OK | `app/api/plaid/*`, `lib/plaid/connections.ts` |
| Receipt Data: receipt images and OCR-extracted details | OK | `lib/ocr/receipt-processor.ts`, `receipts` collection |
| User Corrections "for machine learning improvement" | FIXED → kept in your account to personalize suggestions; not used to train AI models | `learning_patterns/{uid}` is per user; no training code; OpenAI `store: false` |
| Tax Data: quarterly calculations, payment tracking, brackets | OK | `app/api/tax/quarterly-*`, `quarterly_payments` |
| Mobile Data: device information for PWA | OK | PWA install banner and cache policy exist (`lib/pwa/*`) |
| Voice Data "processed locally when possible" | FIXED → browser speech recognition converts speech to text; text sent to our AI provider; no audio stored | `components/voice-input.tsx` uses the Web Speech API and posts `{ text }` to `app/api/ai/parse-voice-command`, which calls OpenAI. The component is not mounted anywhere in the current tree (REC: remove the bullet if voice entry is not shipped) |
| Usage Analytics: usage patterns, feature interactions, performance | REC | Only true when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set; say so, and never load analytics on tax screens (§7216 review row 6) |
| Inferences: deduction analysis, insights, recommendations | OK | `deduction_score`, `ai_analysis` |
| Omitted category: tax organizer answers incl. SSNs, spouse and dependent details, bank routing/account for refunds; uploaded W-2/1099/statements | REC (high) | `app/api/tax/organizer/route.ts`, `app/api/tax/import-document/route.ts`. The most sensitive data class is not listed |
| Purposes list (analysis, OCR, quarterly estimates, insights, learning, forms, voice, PWA, Plaid, education, notifications, savings, support, improvement, legal) | OK with two RECs | "real-time federal tax brackets" and "IRS-backed information" are puffery; brackets are static tables updated by release. "To improve our services ... AI capabilities" must stay within per-user use unless a §7216 consent to use is obtained |
| Data Retention: retained while active or as needed; deletion on request | OK, REC | Accurate. Add: deleted data can persist in backups up to about 180 days (Google's commitment) and a few operational records (deletion marker, support audit, CPA questions, logs up to 30 days) are kept; see retention schedule |
| Third Parties: Plaid, Firebase, "OCR processing providers", "AI models", others | FIXED → Plaid; Google Firebase/Cloud; OpenAI (with `store: false` and no training); Stripe; Resend; Google Analytics when enabled; receipt OCR is in-house | No OCR vendor exists (Tesseract.js in process); Stripe, OpenAI and Resend were omitted; "AI models" did not identify the recipient |
| Security: "Bank-level encryption and secure connections" | REC | Unsubstantiated comparative claim (roadmap §4 claims policy). Replace with facts: TLS in transit, encryption at rest, AES-256-GCM for bank tokens and SSNs |
| Security: "Access controls and regular security reviews" | REC | Access controls exist; no review cadence exists yet (WISP G5). Say "access controls" only until reviews are scheduled |
| Security: "Partnerships with audited and compliant service providers" | REC | Vendor attestations not collected (WISP G11) |
| Security: "Secure processing of receipt images and OCR data" | OK | Size, type and byte checks; UID-scoped storage |
| Security: "Protected AI model training with user corrections" | FIXED → corrections stay within your account and are not used to train AI models | No training exists |
| "All data processing is done securely and in compliance with applicable privacy regulations" | REC (high) | Compliance assertion while MFA, §7216 consent, and Qualified Individual gaps are open; soften to "designed to comply" or remove |
| GLBA Privacy Rule: no sharing with non-affiliated third parties except as permitted by law; right to opt out | REC | Sharing with service providers is within the GLBA exceptions, so the sentence is defensible, but the "right to opt out" line is confusing when no sharing outside exceptions occurs. Counsel to restate as a GLBA initial privacy notice (16 CFR Part 313 content) |
| Data Processing & Compliance: Firebase link | OK | Link valid |
| Your Rights: view/export, delete, revoke bank access via Plaid; Data Rights in Settings or email | OK | `components/settings-screen.tsx` calls `/api/user/export` and `/api/user/delete`; bank disconnect exists |
| Children's Privacy: not directed to under 13 | OK | No age gate exists (REC: add a date-of-birth or age attestation if minors could sign up) |
| Changes: notify by updating date and, when appropriate, direct communication | OK | Consistent with the version bump today |
| Contact: writeoffapp@gmail.com | OK, REC | Consumer mailbox; move to a business domain |
| Metadata (`app/privacy/page.tsx`): "bank-level encryption, GLBA compliance, and secure Plaid integration" | REC (high) | "GLBA compliance" is a compliance claim not yet supported; see WISP gaps. Not edited because it is a status claim, not a description of code behavior |

## 2. Signed-in copy (`/protected/privacy`)

| Statement (abridged) | Verdict | Basis |
|---|---|---|
| "Last updated: {today's date}" rendered dynamically | FIXED → static effective date and version | Always showed the current date, misrepresenting when the text changed |
| Personal Information: name, email, "phone number", profession | FIXED → name, email, state, profession, filing status, income | No phone number field exists in the profile model or sign-up |
| Financial Information via Plaid; Transaction Data incl. receipts; Usage Data | OK | |
| How We Use: provide/improve; process transactions; reports; communicate; security/legal | OK | "Communicate ... product updates" matches the optional `communications` consent |
| "We do not sell or rent your personal information" | OK | No sale or rental exists in code |
| Share with "Trusted Service Providers (e.g., Plaid, Firebase, Supabase)" | FIXED → Plaid, Google Firebase/Cloud, OpenAI (storage disabled), Stripe, Resend | Supabase is not used (template remnants only); OpenAI and Stripe were omitted |
| Share with Legal Authorities if required | OK | |
| Data Security bullets (bank-level encryption; access controls and reviews; audited providers) | REC | Same as §1 |
| Your Rights: access/update/correct; delete; disconnect banks; opt out of marketing | OK | Profile edit, deletion, disconnect, and optional communications consent exist |
| Children's Privacy; Changes; Contact | OK | Same as §1 |
| The page as a whole | REC (high) | A second, divergent policy at a signed-in route. Make `/protected/privacy` render the same component as `/privacy` or redirect to it, so users see one policy |

## 3. Effective date, version, and consent alignment

- Both pages now show "Effective date: September 17, 2026 (version 2026-09-17)".
- `CONSENT_TERMS_VERSION = '2026-09-17'` (`lib/onboarding/consents.ts`); the stored consent record carries this version and `parseConsentRecord` rejects any other. Match confirmed.
- The version strings are hard-coded in the pages. REC: render `CONSENT_TERMS_VERSION` in both pages and add a test so the policy date cannot drift from the consent version.
- `app/help/help-page-client.tsx` also renders a dynamic "Last updated" date (outside the scope of allowed edits). REC: fix the same way.
- Existing accounts have no consent record (`docs/PRELAUNCH_READINESS.md`); when the re-acknowledgment prompt ships, show the policy version being accepted.

## 4. Recommendations not covered above

1. Terms of Service (counsel, high): none exists. Minimum content: description of the service (records and deduction analysis; no e-file; sandbox filing not offered), "general tax information, not tax advice" and no-preparer-signature disclaimers, user responsibility for reviewing every suggestion and for record retention, subscription and cancellation terms with self-serve downgrade and no data loss (H&R Block order lesson), no "free" or guarantee claims, acceptable use, limitation of liability, governing law. Link it from sign-up beside the privacy link.
2. GLBA privacy notice (counsel): decide whether the privacy page is the initial notice under 16 CFR Part 313 and whether the annual-notice exception applies after today's change.
3. §7216 (counsel/engineering): add the disclosure consent for OpenAI described in the §7216 review; the privacy page cannot serve as that consent (Rev. Proc. 2013-14 Example 1).
4. Notice at Collection (`components/onboarding/consent-checkboxes.tsx`, not edited): add receipts, uploaded tax documents, tax organizer answers including SSNs, and AI-vendor disclosure. State whether CCPA applies (revenue and volume thresholds unverified; GLBA-covered data is exempt from most CCPA duties, counsel).
5. Analytics: state plainly that Google Analytics is off unless a release enables it, and enable it only on public pages.
6. Retention: publish the retention schedule summary (backup window, retained operational records) on the page.
7. Security wording: replace comparative claims with the verified controls list and drop the compliance assertions until the WISP gaps (MFA, Qualified Individual, training, testing) are closed.
8. Contact and mailbox: use a business-domain address; the Gmail mailbox also receives CPA-question content.
9. Add an age attestation or DOB check to support the under-13 statement.
10. Future disclosures to add before launch of each feature: Column Tax filing hand-off; mobile background location; any new vendor (update `SUBPROCESSORS_2026-09-17.md` in the same change).

## 5. Verification of code changes

- Files changed: `app/privacy/privacy-page-client.tsx`, `app/protected/privacy/page.tsx` (copy only; no logic).
- Tests: `npx vitest run tests/onboarding-consents.test.ts tests/pwa-cache-privacy.test.ts tests/frontend-journeys.test.ts` → 3 files, 84 tests passed.
- Type check: `npx --no-install tsc --noEmit --incremental false -p tsconfig.json` → clean.
- ESLint on the two files: 0 errors; 12 pre-existing `react/no-unescaped-entities` warnings on untouched lines.

## Sources

- Rev. Proc. 2013-14 (privacy-policy click-through is not §7216 consent, Example 1): https://www.irs.gov/pub/irs-drop/rp-13-14.pdf
- FTC Gramm-Leach-Bliley Act page (Privacy Rule, 16 CFR Part 313; Safeguards Rule): https://www.ftc.gov/business-guidance/privacy-security/gramm-leach-bliley-act
- FTC Safeguards Rule compliance guide: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- FTC penalty-offense notices to tax preparation companies (analytics/pixels): https://www.ftc.gov/news-events/news/press-releases/2023/09/ftc-warns-tax-preparation-companies-about-misuse-consumer-data
- FTC H&R Block order (downgrade and data-loss practices): https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-order-hr-block-requiring-them-pay-7-million-overhaul-advertising-customer-service
- Google Cloud data deletion timeline: https://cloud.google.com/docs/security/deletion
- OpenAI API data usage: https://platform.openai.com/docs/models/how-we-use-your-data
- Internal: `docs/PRODUCT_ROADMAP_2026-09-17.md` §4 (claims policy); `docs/PRELAUNCH_READINESS.md`; `docs/research/reporting-state-compliance-2026.md` §4

## Facts verified in code

- `lib/onboarding/consents.ts`: `CONSENT_TERMS_VERSION = '2026-09-17'`.
- `components/onboarding/consent-checkboxes.tsx`: links to `/privacy` and Plaid's policy; Notice at Collection wording.
- `lib/firebase/profiles.ts`: profile fields (no phone number; `ein` present).
- `components/voice-input.tsx`, `app/api/ai/parse-voice-command/route.ts`: Web Speech API; text-only payload to OpenAI; component not imported anywhere.
- `lib/ocr/receipt-processor.ts`: Tesseract.js in process.
- `lib/ai/learning-engine.ts`, `lib/firebase/corrections.ts`: per-user learning only.
- `lib/openai/client.ts` and all six OpenAI call sites: `store: false`.
- `app/api/stripe/create-checkout/route.ts`: hosted Checkout; email and UID only.
- `app/api/cpa-question/route.ts`: Resend to `writeoffapp@gmail.com`.
- `lib/analytics/ga-measurement-id.ts`, `app/layout.tsx`: conditional analytics.
- `components/settings-screen.tsx`: export and delete actions; bank disconnect.
- `lib/utils.ts`, `components/tutorial/*`, `components/env-var-warning.tsx`: Supabase not in use.
- `app/help/help-page-client.tsx`: dynamic "Last updated" (not edited).
- Absent: `app/terms/**`, any terms link, age gate.
