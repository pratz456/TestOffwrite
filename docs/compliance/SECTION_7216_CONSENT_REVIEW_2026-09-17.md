# WriteOff IRC §7216 / §6713 Consent Review

Date: 2026-09-17. Version: 1.0. Prepared from the code at commit cec95bf, Treas. Reg. §§301.7216-1 through -3, and Rev. Proc. 2013-14. This is an analysis for counsel, not a legal opinion; items marked "counsel" need a decision before launch.

## 1. Is WriteOff a "tax return preparer", and is user data "tax return information"?

- §301.7216-1(b)(2)(i) defines a preparer to include any person who develops software used to prepare or file a return, any Authorized IRS e-file Provider, and any person providing auxiliary services in connection with return preparation. WriteOff categorizes business expenses, computes Schedule C figures, produces Schedule C and Form 1040 exports (`app/api/tax/schedule-c/export`, `app/api/tax/form-1040`) and a preparer handoff archive. That is software used to prepare a return; WriteOff should be treated as a tax return preparer even though it does not sign or e-file today. (Regulation text verified only through the excerpt in `docs/research/reporting-state-compliance-2026.md` §4.3 because ecfr.gov blocked automated retrieval: unverified in this pass.)
- §301.7216-1(b)(3) treats as tax return information everything furnished in any form in connection with return preparation, including registration data for DIY software (Example 1 cited in the research file). Conservative reading adopted here: the user's identity, profile, bank transactions, receipts, organizer answers, imports, and AI outputs are all tax return information once they enter WriteOff.
- Consequences: any disclosure or use outside preparing the user's own return needs either a regulatory exception (§301.7216-2) or a §301.7216-3 consent. Penalties: §7216 misdemeanor (up to one year, $1,000 per violation); §6713 civil penalty $250 per disclosure or use, up to $10,000 per year (amounts as stated in Rev. Proc. 2013-14; later adjustments unverified). Rev. Proc. 2013-14 format rules apply because users file Form 1040 series returns.

## 2. Data use by data use

| # | Use / disclosure (verified in code) | Exception analysis | Consent needed? |
|---|---|---|---|
| 1 | Analysis prompts to OpenAI (`analyzeTransaction.ts`): profile facts, transaction fields, learning and taxpayer context; `store: false`; identifiers partially redacted | §301.7216-2(d)(1) permits disclosure to another preparer in the U.S. for auxiliary services "so long as the services provided are not substantive determinations or advice affecting the tax liability"; "a substantive determination involves an analysis, interpretation, or application of the law." The model is asked to suggest categories and possible tax treatments; WriteOff's `groundTransactionAnalysis` then applies its own policy and the user confirms. Whether the model's suggestion is itself an "analysis or application of the law" is the open question. §301.7216-2(d)(2) (contractors) covers programming, maintenance, repair, testing, or procurement of software, not inference services. OpenAI's processing location is unverified; if outside the U.S., (d)(1) is unavailable and consent is mandatory | Likely yes (counsel). Recommended: obtain a consent to disclose in the preparation/auxiliary-services context (Rev. Proc. 2013-14 §5.04(1)(b)), which may lawfully be a condition of service. Also give OpenAI the §301.7216-2(d)(2) written notice if relying on the contractor exception (counsel to check whether OpenAI's business terms already acknowledge §§7216/6713) |
| 2 | W-2 / 1099 / platform-summary images to OpenAI vision (`import-document/route.ts`) and statement/receipt images (`import-bank-statement/route.ts`) | Same analysis as row 1, plus: the whole image includes the SSN/TIN, address, and employer EIN. §301.7216-3(a)(3)(i)(C) requires a consent to identify the specific information disclosed; §301.7216-3(b)(4) bars SSN disclosure to a preparer outside the U.S. absent an adequate data protection safeguard and special language (Rev. Proc. 2013-14 §5.04(1)(e), §5.07) | Yes unless SSNs are masked before upload. Engineering fix preferred: redact SSN/TIN regions (OCR-locate then blank) before the vision call, and name the disclosure in the consent. Implemented for `import-document` in this branch: local OCR first, SSN/ITIN/EIN-shaped numbers replaced with `[redacted-id]`, only the text is sent; the whole image goes out solely under the signed §4 consent (`consents.document_import`) plus a per-document authorization. `import-bank-statement` still sends whole images |
| 3 | Plaid: `client_user_id` (UID) sent; bank data received | Plaid is a data source and auxiliary contractor; WriteOff discloses only the UID and the fact of the connection, for the purpose of preparing the user's records. Fits §301.7216-2(d)(1)/(d)(2). The `bank_data` checkbox is the user's authorization to access their bank data (a separate Plaid requirement), not a §7216 consent | No §7216 consent; keep the existing checkbox and Plaid policy link |
| 4 | Google Cloud / Firebase hosting and storage | Contractor for hosting the preparation software (§301.7216-2(d)(2)); processing in `us-central1` | No consent; issue or confirm the (d)(2) written notice (Google's Cloud terms are standard form: counsel) |
| 5 | Stripe: email, UID, product metadata; card entered on Stripe's page | §301.7216-2(l) permits use and disclosure of information the taxpayer provides to pay for tax preparation services, to the extent necessary to process or collect payment | No consent |
| 6 | Google Analytics on protected pages (only if `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set) | A use of tax return information (page paths and titles reveal tax activity) for analytics and a disclosure to Google for Google's own purposes. No §301.7216-2 exception covers it. The FTC's September 2023 penalty-offense notices name pixels and SDKs on tax-prep sites. Rev. Proc. 2013-14 Example 1 shows a privacy-policy click-through is not consent | Yes, and such consent could not be a condition of service (§5.04(1)(a)/(c) language). Recommended instead: never load analytics on `/protected/**`; leave the variable unset until the tag is scoped to public pages |
| 7 | Support staff diagnostics (`lib/support/account-diagnostics.ts`) by allowlisted admins | Use by officers or employees of the same preparer for services that assist preparation, including support (§301.7216-2(c)(2)). Diagnostics exclude tokens, SSNs, amounts and secrets; lookups are logged | No consent for employees. Non-employee support contractors need the (d)(2) written notice and a contract |
| 8 | "Ask a CPA" (`cpa-question/route.ts`): merchant, amount, date, category, question, and the user's email sent through Resend to `writeoffapp@gmail.com` | Resend and Gmail are transmission contractors (d)(2). The person who answers: if a WriteOff employee, same-firm use; if an outside CPA, that is a disclosure to a second preparer for "advice affecting the tax liability", which §301.7216-2(d)(1) says requires §301.7216-3 consent first | Depends on who answers (counsel). If outside CPAs answer, add a per-question or standing consent to disclose (§5.04(1)(b) context) naming the recipient |
| 9 | Per-user learning (`learning_patterns/{uid}`, `user_corrections`) | Use of the taxpayer's own information to prepare the taxpayer's own records; also §301.7216-2(c)(1) permits using it to update the taxpayer's software | No consent while patterns stay per user. Cross-user model training or product tuning on identifiable corrections would be a "use" requiring a consent to use (§5.04(1)(c)); anonymized statistical compilations are separately limited by §301.7216-2(o). The privacy page's "AI model training" wording is inaccurate and is corrected in this branch |
| 10 | Optional `communications` checkbox (account and product updates) | §301.7216-2(n) allows a list of names, emails, entity type and form number to be used to offer tax information and the preparer's own tax preparation services. Product updates about WriteOff's tax service fit. Offering other products (bookkeeping, insurance, banking) or sharing the list would not | No consent for tax-service updates. Any cross-sell needs a §5.04(1)(c) consent to use; the current checkbox is not one |
| 11 | Future: Column Tax / Aiwyn embedded filing (sandbox only today) | §301.7216-2(d)(1) expressly permits disclosure to a second preparer to transfer information to, and compute the tax liability on, a return by a processing service, and to an Authorized IRS e-file Provider for filing | No §7216 consent for the filing hand-off itself; Column's own terms and the IRS e-file rules govern; update the privacy page and subprocessor register before enabling |
| 12 | Future: mobile background location (roadmap) | Location used to substantiate mileage for the user's own return is preparation use. Any other use (marketing, sharing) needs consent | No consent for substantiation use; re-review at build time |

## 3. What the current checkboxes cover and where they fall short

Source: `components/onboarding/consent-checkboxes.tsx`; stored by `lib/onboarding/consents.ts` with `CONSENT_TERMS_VERSION = '2026-09-17'`, `source`, `accepted_at`; the server (`POST /api/database/profiles`) validates the record with `parseConsentRecord` and refuses profile setup unless both required boxes are true.

- `bank_data` (required): "I authorize WriteOff to access and use my account and transaction data via Plaid to analyze potential tax deductions and generate reports." This is an authorization to obtain bank data and use it for the core service. It is adequate for its purpose and is not a §7216 consent (none is needed for that use).
- `ai_review` (required): "I understand that WriteOff uses automated (AI) analysis to suggest categories and possible tax treatments for my review, and that I confirm each one." This is an acknowledgment of automated processing. It does not name OpenAI or any recipient, does not identify the information disclosed, has no duration, carries none of the Rev. Proc. 2013-14 §5.04(1) mandatory statements or the TIGTA statement, is not on a screen that "pertains solely" to the consent, is not signed by typing a name or PIN (§6), and is not dated by the taxpayer. If consent is required for row 1 or row 2, this checkbox does not provide it.
- `communications` (optional): a marketing preference, not a §7216 consent to use.
- Notice at Collection (`NoticeAtCollection`): names name, email, password, bank transactions, employer/workstyle answers and state; it does not mention receipts, uploaded tax documents, the tax organizer (SSNs), or disclosure to an AI vendor. A notice is not a consent in any case.
- Accounts created before 2026-09-17 have no stored record (`docs/PRELAUNCH_READINESS.md`); a re-acknowledgment prompt is required for them and would be the natural place to collect the consent below.

Because the required boxes are a condition of using WriteOff, only the §5.04(1)(b) form of disclosure consent (preparation or auxiliary-services context) can be used for the OpenAI disclosure; that form explicitly allows the preparer to decline service when the consent is refused. A consent to use for marketing or analytics (§5.04(1)(a)/(c)) can never be required.

## 4. Proposed consent text (for counsel review; wired to the document-image fallback)

Format requirements to build into the screen (Rev. Proc. 2013-14 §5.03, §5.04, §6): its own screen whose text pertains solely to this consent (navigation aside); font at least the app's normal body size with sufficient contrast; the user affirmatively checks a box, types their full name as the electronic signature (the field must not be pre-filled), and the date is displayed; a printer-friendly copy is offered and a copy is stored with the profile (version, name typed, timestamp, IP is optional); no blank spaces completed later; not an opt-out. Store it as a new consent key (for example `openai_disclosure`) with its own version rather than reusing `ai_review`.

Status: the text below is reproduced verbatim as `DOCUMENT_IMPORT_CONSENT_TEXT` in `lib/onboarding/document-import-consent.ts` (version `2026-09-17`) and collected by `components/document-image-consent.tsx` only when the W-2/1099/platform-summary importer needs to send a whole image (row 2). It is stored as the optional `document_import` key of the profile consent record with the typed name, timestamp and text version (`lib/onboarding/consents.ts`), is never asked for at sign-up, and can be withdrawn in Settings > Data & Privacy. It is not yet collected for the transaction-analysis disclosure in row 1, which still rests on the `ai_review` acknowledgment. A counsel revision of the wording must change the version constant so earlier signatures stop authorizing the disclosure. Note (b) below does not apply to this use: the consent covers exactly the case in which the whole image, SSN included, is disclosed, so the SSN sentence stays.

```
CONSENT TO DISCLOSURE OF TAX RETURN INFORMATION

Federal law requires this consent form be provided to you. Unless authorized
by law, we cannot disclose your tax return information to third parties for
purposes other than those related to the preparation and filing of your tax
return without your consent. If you consent to the disclosure of your tax
return information, Federal law may not protect your tax return information
from further use or distribution.

You are not required to complete this form. Because our ability to disclose
your tax return information to another tax return preparer affects the tax
return preparation service(s) that we provide to you and its (their) cost, we
may decline to provide you with tax return preparation services or change the
terms (including the cost) of the tax return preparation services that we
provide to you if you do not sign this form. If you agree to the disclosure of
your tax return information, your consent is valid for the amount of time that
you specify. If you do not specify the duration of your consent, your consent
is valid for one year from the date of signature.

WriteOff uses OpenAI, L.L.C. (San Francisco, California) as a service provider
to help categorize your business transactions and suggest possible tax
treatments for your review, and to read tax documents and bank statements you
choose to upload. To do this, WriteOff discloses to OpenAI: your profession,
business type, state, income ranges, home-office and vehicle-use facts, and
travel pattern; the merchant, amount, date, location, category, payment
channel and your notes for each transaction analyzed; your past confirmed
categorizations for the same merchant; and the full content of any W-2, 1099,
platform summary, bank or credit card statement, or receipt image you upload
for extraction, which may include your Social Security number, taxpayer
identification number, address, account numbers and employer identification
number if they appear on the document. OpenAI processes this information only
to return results to WriteOff and does not use it to train its models.
WriteOff does not disclose your name, email address, or bank login credentials
to OpenAI.

Duration: this consent is valid until you delete your WriteOff account or
withdraw it in Settings, whichever is earlier.

I, [type your full name], authorize WriteOff to disclose the tax return
information described above to OpenAI, L.L.C. for the purpose of assisting in
the preparation of my records and tax return.

Signature (type your full name): ____________________   Date: [today's date]

If you believe your tax return information has been disclosed or used
improperly in a manner unauthorized by law or without your permission, you may
contact the Treasury Inspector General for Tax Administration (TIGTA) by
telephone at 1-800-366-4484, or by email at complaints@tigta.treas.gov.
```

Notes for counsel: (a) the paragraph describing OpenAI's processing must be kept accurate against `SUBPROCESSORS_2026-09-17.md` and OpenAI's current terms, and the contracting entity name and address must be confirmed from the executed agreement; (b) if engineering masks SSNs before upload, delete the SSN sentence rather than leave it; (c) if OpenAI processes outside the U.S., add the §5.04(1)(e) statement and confirm an adequate data protection safeguard, or do not disclose; (d) a parallel consent naming the outside CPA is needed for row 8 if outside CPAs answer; (e) a §5.04(1)(c) consent to use would be needed before any cross-user training, cross-sell, or analytics on tax screens, and none of those may be required to use the app.

## 5. Summary of gaps and owners

| Gap | Owner | Action |
|---|---|---|
| No §7216-compliant consent for the OpenAI disclosure; `ai_review` is an acknowledgment only | Counsel (decide), Engineering (build screen and storage) | Adopt §4 text or a counsel-revised version; collect from new and existing users |
| Whole W-2/1099/statement images (with SSNs) sent to OpenAI | Engineering | W-2/1099/platform summaries: done in this branch (local OCR, `[redacted-id]` text, image only under the signed §4 consent). Statement/receipt images (`import-bank-statement`): still whole; mask or gate behind the same consent |
| OpenAI processing location and §§7216/6713 written notice unconfirmed | Operator + Counsel | Confirm U.S. processing; issue (d)(2) notice or confirm terms |
| "Ask a CPA" recipient undefined | Operator + Counsel | Decide employee vs. outside CPA; add consent if outside |
| Analytics could load on tax screens | Engineering | Scope the tag to public routes; keep unset in production until then |
| Privacy copy claims model training on corrections | Engineering (copy) | Corrected in this branch; do not start cross-user training without a consent to use |
| Notice at Collection omits receipts, tax documents, organizer SSNs, AI vendor | Engineering (copy) + Counsel | Expand the notice text |
| No consent record retained after account deletion | Engineering + Counsel | Keep a minimal receipt (see retention schedule) |

## Sources

- Rev. Proc. 2013-14 (mandatory consent language, format, electronic signature): https://www.irs.gov/pub/irs-drop/rp-13-14.pdf
- Treas. Reg. §301.7216-1 (definitions): https://www.ecfr.gov/current/title-26/section-301.7216-1 (automated retrieval blocked; unverified in this pass)
- Treas. Reg. §301.7216-2 (permitted disclosures and uses; text retrieved via the eCFR API on 2026-09-17): https://www.ecfr.gov/current/title-26/section-301.7216-2
- Treas. Reg. §301.7216-3 (consent requirements; content restated in Rev. Proc. 2013-14 §3): https://www.ecfr.gov/current/title-26/section-301.7216-3 (automated retrieval blocked; unverified in this pass)
- FTC penalty-offense notices to tax preparation companies (Sept 2023): https://www.ftc.gov/news-events/news/press-releases/2023/09/ftc-warns-tax-preparation-companies-about-misuse-consumer-data
- OpenAI API data usage: https://platform.openai.com/docs/models/how-we-use-your-data
- Prior internal research: `docs/research/reporting-state-compliance-2026.md` §4.3

## Facts verified in code

- `components/onboarding/consent-checkboxes.tsx`: exact checkbox wording; `NoticeAtCollection` text; Plaid policy link.
- `lib/onboarding/consents.ts`: `CONSENT_TERMS_VERSION = '2026-09-17'`; required `bank_data`, `ai_review`; optional `communications`; strict record parsing.
- `lib/ai/analyzeTransaction.ts` (`contextData`), `lib/ai/transaction-tax-policy.ts` (`redactTaxIdentifiers`, `groundTransactionAnalysis`), `lib/openai/client.ts`: fields sent, redaction scope, model names, `store: false`.
- `app/api/tax/import-document/route.ts`, `app/api/tax/import-bank-statement/route.ts`: whole-image upload; prompt asks for employer EIN.
- `app/api/plaid/create-link-token/route.ts`: only `client_user_id` and app name sent to Plaid.
- `app/api/stripe/create-checkout/route.ts`: email and UID metadata only.
- `lib/analytics/ga-measurement-id.ts`, `app/layout.tsx`, `middleware.ts`: analytics conditional and site-wide when enabled.
- `lib/support/access.ts`, `lib/support/account-diagnostics.ts`: same-firm support access with redaction and audit.
- `app/api/cpa-question/route.ts`: fields emailed and recipient mailbox.
- `lib/ai/learning-engine.ts`, `lib/firebase/corrections.ts`: per-user `learning_patterns` and `user_corrections`; no cross-user training code.
- `app/api/tax/schedule-c/export/route.ts`, `app/api/tax/form-1040/route.ts`, `app/api/tax/form-4562`, `app/api/tax/compute-1040`: return-preparation outputs.
- `lib/tax-filing/config.ts`, `app/api/tax/filing/route.ts`: Column integration sandbox-only.
