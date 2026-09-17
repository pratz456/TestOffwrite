# WriteOff Subprocessors and Service Providers

Date: 2026-09-17. Version: 1.0. Owner: Qualified Individual (WISP §2). Supports 16 CFR 314.4(f) (service provider oversight) and Treas. Reg. §301.7216-2(d) (disclosures to contractors and other preparers). Lists every third party that receives user data because of what the code at commit cec95bf does, plus two planned ones. "Data categories" describes what WriteOff actually transmits, not what the vendor could theoretically collect. Agreement links are the vendors' published terms; whether each has been accepted under WriteOff's account is unverified and must be recorded in the operator appendix (WISP gap G11).

Not a subprocessor: Supabase. Template code references it (`lib/utils.ts`, `components/tutorial/*`, `components/env-var-warning.tsx`), no client is instantiated, and no data flows to it. The older privacy page copy that named it is corrected in this branch.

## 1. Active in production

### 1.1 Google Cloud / Firebase (Google LLC)

- Services: Firebase Authentication, Cloud Firestore, Cloud Storage for Firebase, Firebase Hosting, Cloud Run (Next.js SSR service `ssrwriteoff23910`), Cloud Functions (`functions`: scheduled bank sync; `functions-analysis`: analysis worker), Cloud Logging, Secret Manager (per the cutover runbook). Region `us-central1` for the SSR service and functions (`firebase.json`, `functions-analysis/src/index.ts`); Firestore and Storage locations are set in the console and were not verified from the repository.
- Purpose: hosting, identity, primary data store, file storage, logs.
- Data categories: everything in the WISP data inventory (identity, profile including EIN, consent record, encrypted Plaid tokens, transactions, AI outputs, receipts, tax organizer including encrypted SSNs and plaintext dependent details, W-2/1099 imports, billing status, support audit, rate-limit hashes, logs with UIDs).
- Role under §7216: contractor providing hosting for tax return preparation software (auxiliary services); Google personnel do not access content in the ordinary course.
- Terms: Google Cloud Data Processing Addendum https://cloud.google.com/terms/data-processing-addendum ; Firebase Data Processing and Security Terms https://firebase.google.com/terms/data-processing-terms ; Firebase Privacy and Security https://firebase.google.com/support/privacy ; Google Cloud subprocessors https://cloud.google.com/terms/subprocessors ; deletion commitments https://cloud.google.com/docs/security/deletion
- Oversight: SOC 2 / ISO 27001 reports available through the Google Cloud compliance portal (not retrieved); review annually.

### 1.2 Plaid Inc.

- Purpose: bank account and transaction aggregation. Users authenticate with their bank inside Plaid Link; WriteOff never receives bank credentials.
- Data WriteOff sends to Plaid: `client_user_id` (the Firebase UID), `client_name: 'WriteOff'`, country `US`, requested product `transactions` with a history window, the encrypted-then-decrypted access token for sync and removal calls, and webhook acknowledgements. No name, email, or phone is sent in the Link token request.
- Data WriteOff receives: accounts (institution, name, mask, type), transactions (merchant, amount, date, city/state/address, MCC, personal-finance category, payment channel, counterparties, merchant entity id, recurrence), balances, item webhooks.
- Role under §7216: data source and auxiliary contractor; WriteOff does not disclose tax return information to Plaid beyond the UID and the connection itself.
- Terms: Plaid legal hub (End User Privacy Policy, developer terms) https://plaid.com/legal/ ; end-user policy anchor https://plaid.com/legal/#end-user-privacy-policy (linked from the sign-up consent checkbox).
- Oversight: production access requires Plaid's own application review (`docs/PRELAUNCH_READINESS.md`). Legacy connections under an old client id remain encrypted until manually revoked.

### 1.3 Stripe, Inc.

- Purpose: subscription billing (checkout, customer portal, webhooks).
- Data WriteOff sends: customer `email` from the profile, `metadata.firebase_uid`, subscription metadata `feature: 'historical_transactions'` and `payment_policy: 'settled_invoice'`, idempotency keys. Card details are entered on Stripe-hosted Checkout and never touch WriteOff.
- Data WriteOff receives: customer id, subscription id and status, invoice/payment events via signed webhooks (`processed_webhooks` prevents replay).
- Role under §7216: payment processor; receives no tax return information (email and UID only). Product-tier metadata reveals that the user bought historical-transaction access, which is not return information.
- Terms: Stripe Data Processing Agreement https://stripe.com/legal/dpa ; Stripe Privacy Policy https://stripe.com/privacy
- Oversight: Stripe is PCI DSS Level 1 (per Stripe; not independently verified here). On account deletion WriteOff cancels subscriptions and deletes the customer; Stripe retains records under its legal obligations.

### 1.4 OpenAI, L.L.C. (API)

- Purpose: (a) transaction analysis suggestions (`lib/ai/analyzeTransaction.ts`, chat completions, model `gpt-4o-mini` per `lib/openai/client.ts`); (b) extraction of W-2, 1099, and platform-summary images (`app/api/tax/import-document/route.ts`, `gpt-4o` vision); (c) extraction of bank/credit-card statement and receipt images (`app/api/tax/import-bank-statement/route.ts`, vision); (d) voice command parsing (`app/api/ai/parse-voice-command`, `gpt-4o-mini`: the transcribed spoken expense text); (e) general tax guidance chat (`app/api/ai/tax-assistant`, `gpt-4o`: the user's typed question and up to 12 recent messages, no profile data read from Firestore); (f) `lib/openai/analysis.ts` batch analysis helpers.
- Settings: all six call sites set `store: false`. OpenAI states API data is not used for training and abuse-monitoring logs are kept up to 30 days; Zero Data Retention requires OpenAI approval and is not evidenced in the repository (unverified). Processing location: not specified in the code; OpenAI data residency options are unverified.
- Fields sent for transaction analysis (`contextData`):
  - `profile`: `profession`, `age`, `birth_year`, `annual_income`, `reported_income`, `state`, `entity_type`, `office_location`, `work_travel`, `reported_travel_pattern`, `business_purpose`, `home_office_sqft`, `vehicle_business_use_pct`, `w2_income`, `business_income`.
  - `learning_context`: per-user merchant, category, MCC and amount preferences derived from past corrections, with a confidence score.
  - `taxpayer_context`: `identity` (professions, entity, filing state, work location, travel pattern, years in business, has-W-2 and has-business-income flags), `methods` (home office and vehicle methods), `prior_merchant_decisions` (decision, confirmations, usual category, last business purpose), `recurrence`, `open_questions`.
  - `tx`: `merchant` (redacted), `saved_category`, `saved_transaction_kind`, `business_use_percentage`, `amount_usd`, `date_iso`, `authorized_date`, `time_24h`, `city`, `state`, `address`, `mcc`, `category`, `payment_channel`, `account_usage_type`, `counterparties`, `merchant_entity_id`, `is_recurring`, `note` (redacted), `business_purpose` (redacted), `client_project` (redacted), `documentation_status`, `meeting_notes` (redacted), `travel_destination`, `equipment_details`, `mileage_details`, `attendees` (not redacted).
  - Not sent: name, email, UID, SSN, EIN, bank account numbers, Plaid tokens. `redactTaxIdentifiers` replaces only delimited patterns (`###-##-####` or `### ## ####`, and `##-#######`) with `[redacted-id]`; unformatted 9-digit numbers are not caught, and `attendees`, `travel_destination`, `equipment_details` and `counterparties` pass through unredacted.
- Fields sent for document import: the entire uploaded image (base64) plus a prompt asking for employer EIN, wages and withholding boxes, payer name and amounts. A W-2 or 1099 image contains the taxpayer's SSN/TIN and address; the code does not mask them before upload. The statement/receipt importer sends whole statement images, which contain account numbers and every transaction on the page.
- Role under §7216: OpenAI is a contractor performing auxiliary services and therefore a "tax return preparer" (§301.7216-2(d)(2)); see `docs/compliance/SECTION_7216_CONSENT_REVIEW_2026-09-17.md` for whether consent is required.
- Terms: OpenAI API data usage https://platform.openai.com/docs/models/how-we-use-your-data ; OpenAI Data Processing Addendum https://openai.com/policies/data-processing-addendum/ and Business Terms https://openai.com/policies/business-terms/ (both returned HTTP 403 to automated retrieval on 2026-09-17; confirm manually).

### 1.5 Resend, Inc.

- Purpose: transactional email for the "ask a CPA" feature (`app/api/cpa-question/route.ts`) when `RESEND_API_KEY` is set; otherwise the message is only logged.
- Data sent: an email to the operator mailbox `writeoffapp@gmail.com` containing the user's email address, merchant name, amount, date, category, and the user's question. Because the mailbox is a consumer Gmail account, Google (as email provider) also holds this content under consumer terms rather than a business DPA (recommendation: move to a Workspace mailbox or a ticketing tool).
- Role under §7216: the transaction details and question are tax return information; Resend and the mailbox provider are contractors receiving it (see §7216 review).
- Terms: Resend DPA https://resend.com/legal/dpa ; Privacy Policy https://resend.com/legal/privacy-policy

### 1.6 Tesseract.js (not a vendor)

Receipt OCR attached to individual transactions runs in-process on the server (`lib/ocr/receipt-processor.ts`); no third party receives the image for this path. Listed to correct the impression that "OCR processing providers" exist.

## 2. Conditional

### 2.1 Google Analytics 4 (Google LLC)

- Loads only when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set at build time and the environment is not staging (`lib/analytics/ga-measurement-id.ts`); `middleware.ts` adds the Google tag origins to the CSP under the same condition. The tag is injected in the root layout, so when enabled it runs on every page including `/protected/**`.
- Data sent when enabled: page URL and title, referrer, client id cookie, device and browser data, approximate location, and engagement events; no custom events with tax values were found. Page paths and titles on protected screens can themselves reveal tax activity.
- Role under §7216 / FTC: analytics on screens carrying tax return information is the pattern the FTC's 2023 penalty-offense notices targeted; the roadmap's claims policy forbids third-party pixels on those screens. Until analytics is scoped to marketing pages only, leave the variable unset in production.
- Terms: Google Analytics Terms of Service https://marketingplatform.google.com/about/analytics/terms/us/ ; Google Ads Data Processing Terms (apply to GA) https://business.safety.google/adsprocessorterms/

## 3. Planned (not receiving data today)

### 3.1 Column Tax / Aiwyn (embedded filing)

- The tree contains a sandbox-only integration (`lib/tax-filing/column-client.ts`, `lib/tax-filing/config.ts`, `app/api/tax/filing/route.ts`) gated by `COLUMN_TAX_MODE=sandbox`, `COLUMN_TAX_SANDBOX_APPROVED=true`, an approved sandbox identity, and fresh security verification metadata; "No IRS or state return is filed." When production filing is enabled, Column becomes a second tax return preparer and e-file provider receiving the return data; disclosure to it for computing and transmitting the return is permitted under §301.7216-2(d)(1) without consent, but the privacy page, this register, and the WISP must be updated first.
- Terms: to be collected at contracting (unverified whether the embedded API remains open to new partners; see `docs/research/reporting-state-compliance-2026.md` §2.5).

### 3.2 Apple Inc. and Expo (mobile app)

- `docs/MOBILE_APP_PLAN_2026-09-17.md` describes a future Expo-built app with background location for mileage, receipt capture, and calendar integration. No mobile code sends data today. When built: Apple receives App Store account and crash/analytics data per its developer terms and requires an App Privacy label; Expo receives build artifacts and, if EAS Update or push notifications are used, device push tokens. Background location is a new data class (geolocation is "personal information" under Florida's breach statute) requiring privacy-page and consent updates before launch.
- Terms: Apple developer privacy details https://developer.apple.com/app-store/app-privacy-details/ ; Apple privacy policy https://www.apple.com/legal/privacy/en-ww/ ; Expo privacy https://expo.dev/privacy ; Expo terms https://expo.dev/terms

## 4. Oversight checklist (annual, §314.4(f))

1. Confirm the executed DPA or processing terms for each vendor in §1 and record the date and account owner.
2. Confirm each vendor's security attestation (SOC 2 Type II or ISO 27001) is current.
3. Re-check the data categories above against the code (search for `fetch(`, `stripe.`, `plaidClient.`, `openai.` call sites) and update this register in the same change that adds a vendor.
4. For contractors receiving tax return information (Google, OpenAI, Resend, future Column), issue the §301.7216-2(d)(2) written notice of §§7216/6713 applicability where the vendor's standard terms do not already acknowledge it (counsel).
5. Confirm OpenAI Zero Data Retention or Modified Abuse Monitoring status and processing region.
6. Confirm `NEXT_PUBLIC_GA_MEASUREMENT_ID` is unset in the production build unless analytics has been scoped to public pages.

## Sources

- FTC Safeguards Rule compliance guide (service provider oversight, §314.4(f)): https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- Treas. Reg. §301.7216-2 (contractor and preparer-to-preparer disclosures): https://www.ecfr.gov/current/title-26/section-301.7216-2
- FTC penalty-offense notices to tax preparation companies (Sept 2023): https://www.ftc.gov/news-events/news/press-releases/2023/09/ftc-warns-tax-preparation-companies-about-misuse-consumer-data
- Vendor terms: linked inline above (Google Cloud, Firebase, Plaid, Stripe, OpenAI, Resend, Google Analytics, Apple, Expo).
- Florida Stat. §501.171 (geolocation as personal information): http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html
- Prior internal research: `docs/research/reporting-state-compliance-2026.md` §2.5, §4.3

## Facts verified in code

- `firebase.json`, `functions-analysis/src/index.ts`, `.firebaserc`: project `writeoff-23910`, region `us-central1`.
- `functions/src/index.ts`: scheduled sync calls the SSR service with `CLOUD_FUNCTION_SECRET`; selects routing metadata only.
- `app/api/plaid/create-link-token/route.ts`: `client_user_id: uid`, `client_name: 'WriteOff'`, US, `transactions` product; no name/email/phone.
- `lib/plaid/connections.ts`, `lib/plaid/delete-item.ts`: token encryption; `itemRemove`.
- `app/api/stripe/create-checkout/route.ts`, `app/api/stripe/create-portal-session/route.ts`, `app/api/stripe/webhook/route.ts`, `lib/stripe/cancel-subscription.ts`: email + `firebase_uid` metadata; hosted checkout; customer deletion.
- `lib/ai/analyzeTransaction.ts` lines 477–526: `contextData` fields; `redactTaxIdentifiers` applied to five free-text fields only. `lib/ai/taxpayer-context.ts`: `taxpayerContextForModel` shape. `lib/ai/learning-engine.ts`: `getLearningContext` shape.
- `lib/openai/client.ts`, `app/api/tax/import-document/route.ts`, `app/api/tax/import-bank-statement/route.ts`: `store: false`; whole-image upload; EIN extraction prompt.
- `lib/ocr/receipt-processor.ts`: Tesseract.js in-process OCR.
- `app/api/cpa-question/route.ts`: Resend payload and recipient.
- `lib/analytics/ga-measurement-id.ts`, `middleware.ts`, `app/layout.tsx`: GA conditional load in the root layout.
- `lib/tax-filing/config.ts`, `app/api/tax/filing/route.ts`: sandbox-only Column integration.
- `lib/utils.ts`, `components/env-var-warning.tsx`, `app/api/categories/route.ts`: Supabase references are inert.
- Absent: mobile code, Zero Data Retention configuration, executed DPAs.
