# Embedded individual tax filing: provider and implementation research

Reviewed **September 16, 2026** against public provider documentation and IRS/FTC primary sources. This is an integration decision record, not a provider contract or determination of WriteOff's legal role. No provider account was created, credentials requested, contract accepted, taxpayer information transmitted, or return filed during this research.

## Recommendation

**Pursue Column Tax as the first embedded filing partner.** Its public documentation describes a complete hosted interview, initialization API, embedded interface and agency-status integration. That is a feasible way to let users finish a federal individual return and supported state returns inside WriteOff, with the provider handling the final review and filing experience. WriteOff can remain the recordkeeping and preparation workspace. This recommendation reflects documented integration clarity; it is not a claim that a partnership, production access or every taxpayer scenario is approved. [Column introduction](https://docs.columntax.com/docs/welcome)

The initial adapter deliberately sends no ledger, W-2, SSN or bank prefill. The application route is disabled by default and permits only explicitly approved staging sandbox fixtures. Production filing remains disabled. Public documentation alone is insufficient to enable it safely.

## Provider comparison

| Option | Evidence of a genuine individual-return integration | Access and material limits |
| --- | --- | --- |
| **Column Tax — preferred** | Public server initialization, embedded filing UI, and return-status endpoints. Its product includes federal/state filing, rather than only an information-return upload. [Integration quickstart](https://docs.columntax.com/docs/quick-start) | Column supplies sandbox credentials. Production credentials follow sandbox integration and provider QA. Pricing, commercial eligibility, complete year/form/state coverage and support obligations require partner confirmation. [API access](https://docs.columntax.com/docs/api-access) |
| **april — credible alternative** | Public product documentation offers SDK/API integration, hosted URLs, prefill, consented data queries and real-time events. [Developer offering](https://www.getapril.com/for-developers) | No current public session/authentication/webhook schema was verified. The official examples organization directs partners to request developer access. Do not invent an API from the marketing page. [Official examples organization](https://github.com/getapril-examples) |
| **TaxAct — no verified embedded 1040 API path** | Retail/professional tax software exists; the public affiliate program is referral distribution. [Affiliate program](https://www.taxact.com/alliance/affiliate-overview) | The September 8, 2026 professional license restricts consumer-facing automated platforms/API backends and requires human preparer review. Buying that license does not establish permission for this architecture. Any special partnership needs separate written terms. [Professional license](https://www.taxact.com/professional/legal-notice) |
| **1099/IRIS APIs — different product** | Information-return filing serves payers reporting forms such as 1099. IRS IRIS has portal and application-to-application access. [IRS IRIS](https://www.irs.gov/filing/e-file-information-returns-with-iris) | A 1099 API does not prepare or file the recipient's individual Form 1040 with Schedule C. A TCC for information returns is not an individual-return filing integration. |

TaxAct's public MCP offering explicitly excludes preparing/reviewing/filing an actual return. It cannot supply the missing transmission capability. [TaxAct MCP](https://www.taxact.com/taxes-online/taxact-mcp-server)

### april's published scope needs careful filtering

The current Filer scope lists Schedule C, vehicles, depreciation and **simplified** home office. It also excludes multiple-state filing, foreign income/addresses, nonresident returns, ITIN/ATIN users and other cases; state availability depends on approvals. A professional-assisted offering may differ and must be confirmed for the specific partnership. [april Filer coverage](https://www.getapril.com/legal-filer)

Its help center currently limits new filing to **tax year 2025** and does not offer prior-year filing. State-only filing is unavailable through the documented flow. These are provider restrictions, not universal IRS restrictions. [Year limitation, April 3, 2026](https://help.getapril.com/en/articles/13346286-can-i-file-a-return-for-a-previous-tax-year), [state-only limitation](https://help.getapril.com/en/articles/9156594-how-can-i-file-a-state-only-return)

## Verified Column public contract

### Server and session

| Operation | Documented contract |
| --- | --- |
| Environments | Sandbox API: `https://sandbox.columnapi.com`; production API: `https://prod.columnapi.com`. Sandbox is simulated; production can submit real returns. [Environments](https://docs.columntax.com/reference/environments) |
| Authentication | Server-only HTTP Basic authentication using client ID and client secret over HTTPS; JSON requests. [Authentication](https://docs.columntax.com/reference/authentication) |
| Initialize/resume | `POST /v1/exp/initialize_tax_filing`. Required input: `user_identifier`, `user.email`, `user_metadata`. Response includes matching identifier, authenticated `user_url` and `data_errors`. Nonempty errors can mean data was discarded even with HTTP 200. No `tax_year` request property is documented. [Initialize OpenAPI](https://docs.columntax.com/reference/express-initialize-tax-filing) |
| Security metadata | Six required fields: `password_changed_date`, `account_locked_date`, `cell_phone_changed_date`, `email_changed_date`, `passed_mfa_at_this_login`, `failed_login_attempts`. Dates use `YYYY-MM-DD`; descriptions permit null for a known never-occurring event. Unknown history is not a truthful null/zero. Schema/date nullability and unavailable-history handling need provider clarification. [Initialize schema](https://docs.columntax.com/reference/express-initialize-tax-filing) |
| Session handling | Obtain a fresh authenticated URL for each launch; do not persist it. The adapter also rejects redirects and mismatched identifiers, and strips provider error bodies. [User URLs](https://docs.columntax.com/reference/users-tokens) |
| Browser launch | Load the environment's `column-tax.js` and call `ColumnTax.openModule({userUrl, environment, onClose})`. Sandbox script: `https://app-sandbox.columnapi.com/column-tax.js`. Closing the interface is a navigation event, not filing evidence. [Launch guide](https://docs.columntax.com/docs/launch-ui-guide) |

**Prefill is accepted only on the first initialization for that user and tax year.** Later calls do not update those fields. Therefore, empty first initialization can also consume the opportunity to prefill later. Before production, choose and test either a provider-interview-only flow or a reviewed, immutable first-handoff snapshot with explicit handling of subsequent corrections. Do not silently send changing ledger totals on every launch. The guide also ties new returns to the provider's season rollover. [Create-user guide](https://docs.columntax.com/docs/create-user-guide)

The adapter currently permits only the documented exact module hosts `app-sandbox.columnapi.com` and `app.columnapi.com`, respectively. An unexpected `env.bz` or other host remains blocked until the provider documents its purpose and confirms the exact allowlist. Broad wildcard exceptions are not justified by the research.

### Return status and consent

`GET /v1/users/{user_identifier}/tax_returns` returns an array. Select the exact `tax_year`; an empty result is possible between seasons. Overall `status` is `not_started`, `started` or `submitted`. Each jurisdiction has `code` (`US` for federal, state/territory abbreviations otherwise) and independent `submission_status`: `not_submitted`, `submitted`, `accepted`, `retryable` or `rejected`. Unknown future values must not become accepted.

Disclosure/use-consent flags are separate. Status remains available without disclosure consent, while financial detail may not. Responses can include sensitive bank details, so the adapter exposes only year/status/jurisdictions. Missing amounts are never replaced by a zero refund. [Tax-return endpoint](https://docs.columntax.com/reference/tax-returns)

For a future richer dashboard, obtain and respect the provider's required consent before using or displaying return financial information. Separate federal/state progress and show correction actions for rejected returns. [Tax-hub guide](https://docs.columntax.com/docs/tax-hub-guide)

Agency acceptance is not confirmation that a refund arrived or a tax payment settled; Column says it does not observe those subsequent movements. [Provider FAQ](https://docs.columntax.com/docs/faqs)

### Webhooks: documented, not implemented in this batch

Column documents `user.user_status_changed`, `tax_return.submission_status_changed` and `user.user_event`. Payloads identify the user/year and, for jurisdiction events, the jurisdiction. Headers include `webhook-id`, `webhook-timestamp` and versioned `webhook-signature`; the provider arranges endpoint/secret setup. Verify raw-body HMAC signatures and timestamp tolerance, deduplicate IDs, and handle retry delivery. Its docs reference Svix verification libraries.

The public documentation contains older comments/examples that disagree about the optional `version` field and one event name. Obtain actual sandbox fixtures before coding a strict production event parser. [Column webhooks](https://docs.columntax.com/reference/webhook-events), [Svix verification](https://docs.svix.com/receiving/verifying-payloads/how)

Recommended application behavior: use verified events to trigger an authenticated status refresh, rather than allowing out-of-order events to overwrite a newer accepted/correction state. Do not interpret SDK closure, payment of provider fees, PDF generation or a local checkbox as agency submission.

## Tax year and coverage are release gates

As of this review, the IRS ATS calendar says testing for **filing season 2027 opens October 13, 2026**, with the individual 1040 scenario targeting **tax year 2026**. A 2026 planning calculation does not establish that a provider is currently accepting 2026 production filings. Tax year 2027 is a different future return year. [Current IRS ATS calendar](https://www.irs.gov/e-file-providers/modernized-e-file-mef-assurance-testing-system-ats)

Obtain a provider-approved matrix covering the offered year, federal forms and each state. For WriteOff's audience, ask explicitly about multiple Schedule C businesses, cash/accrual accounting, inventory, vehicle limits, Section 179/bonus depreciation, actual home office, QBI, carryovers, amendments, extensions, multistate/part-year/nonresident state returns and identity-document restrictions. Public marketing or a prefill field alone does not establish complete support.

## Direct IRS filing would be a separate substantial program

An independent provider application identifies the firm, principals, responsible officials and requested roles; suitability/fingerprint requirements may apply. The IRS advises allowing up to 45 days and issues an EFIN after acceptance. This is not an API-key signup. [Become an authorized provider](https://www.irs.gov/e-file-providers/become-an-authorized-e-file-provider)

IRS roles include ERO, Intermediate Service Provider, Software Developer, Transmitter and Online Provider; more than one can apply. EFINs/ETINs cannot simply be rented or borrowed. Whether WriteOff needs its own authorization in an embedded partnership depends on its actual duties and contractual model. Confirm that allocation with the provider and qualified counsel instead of assuming either universal exemption or universal EFIN requirements. [Publication 3112, November 2025](https://www.irs.gov/pub/irs-pdf/p3112.pdf)

For independently developed individual-return software, IRS guidance requires relevant EFIN/ETIN setup, a software ID for each year/package, applicable ATS scenarios, and registered A2A systems where used. New transmitters have communication testing. State testing has separate instructions. Passing selected scenarios is not certification of every tax calculation. Current Publication 1436 describes processing-year 2026 accepting tax years 2025, 2024 and 2023; a partner may offer a narrower set. [Publication 1436, October 2025](https://www.irs.gov/pub/irs-pdf/p1436.pdf)

### Review, signatures and data responsibilities

- **Signature:** The self-select PIN and practitioner/ERO authorization flows have distinct requirements. Form 8879 is used where the ERO is authorized to enter/generate the taxpayer PIN; it is not a generic app permission slip. The IRS requires the relevant signed authorization before transmission/release. The provider must determine the applicable signature method, identity checks and joint-return authorizations. [IRS electronic-signature guidance](https://www.irs.gov/e-file-providers/self-select-pin-method-for-forms-1040-and-4868-modernized-e-file-mef), [Form 8879 purpose](https://www.irs.gov/forms-pubs/about-form-8879)
- **Use/disclosure:** Section 7216 rules distinguish permitted exceptions from disclosures/uses requiring prescribed consent. Review the actual data flow, purposes, subcontractors and geography; a generic privacy checkbox is not proof of compliant return-information consent. The IRS information center links the regulations and revenue procedures. Its FAQ is marked historical and should not be the sole authority. [IRS information center](https://www.irs.gov/tax-professionals/section-7216-information-center)
- **Security:** The FTC identifies tax-preparation firms among covered financial institutions. Covered businesses need an appropriate written information-security program; service-provider outsourcing does not remove their responsibilities. Confirm applicable risk assessment, access/MFA, encryption, vendor oversight, retention and incident duties before real data is introduced. [FTC Safeguards Rule guide](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)

## Exact external steps still blocked

1. **Partner acceptance and terms:** Column approves the business/integration model, commercial pricing, liability/support allocation and data-processing terms. No quote, contract, SLA or partnership has been verified.
2. **Credentials and current contract:** Obtain sandbox credentials and confirm metadata semantics, module hosts, active tax year, actual response samples and webhook registration. Do not put client secrets in public Firebase/Next variables.
3. **Coverage/role review:** Agree the taxpayer/year/state matrix, signature ownership, consent wording, security responsibilities and any WriteOff IRS/state registration or software-ID obligations.
4. **Truthful security instrumentation:** Replace controlled fixtures with reliable, server-owned account-history and per-login MFA facts. Ordinary Firebase authentication alone does not establish every required history field.
5. **Prefill decision and reconciliation:** Design the one-time first handoff, reviewed income/expense mapping and correction flow. Do not use the current planning engine as an asserted complete return.
6. **Actual provider sandbox QA:** Exercise documented sample users, browser/mobile lifecycle, federal accepted/state retryable, nonretryable rejection, missing year, lost disclosure consent, failed initialization and webhook replay. Provider confirmation and QA precede production keys. [Column sample users](https://docs.columntax.com/reference/sample-users)
7. **Deliberate production launch:** Add a reviewed production route/configuration, monitoring, support/correction procedures and verified return access. The current sandbox gates must not be removed merely because mock tests pass.

## Implemented local evidence and limits

- `lib/tax-filing/column-client.ts`: exact documented minimal transport, strict security metadata, fixed API bases, environment-specific HTTPS module host, bounded timeout, no redirect/retry, sanitized failures, and status-only return normalization. No tax prefill or transmission method.
- `tests/column-client.test.ts`: **70 passing mocked transport/response tests**.
- `tests/filing-sandbox-routes.test.ts`: **62 passing route/configuration tests** cover authentication, entitlement, synthetic identity/environment, consent/year checks, metadata freshness and login/MFA binding, status-only access, no session-URL persistence and disabled legacy PIN collection.
- Legacy year-lock writes also reject client-supplied filing statuses/confirmation numbers. Historical reads are owner/year scoped and expose no verified filing status; existing conservative locks remain intact. A saved local lock cannot establish agency acceptance.
- `tests/embedded-filing-handlers.test.tsx` and `tests/column-browser.test.ts`: **32 passing handler/loader tests** cover consent, duplicate clicks, stale account/year requests, session URL validation, status refresh on close, loader failures and retries. These are simulated handlers/DOM, not actual provider-browser QA.
- The sandbox route requires a server-created staging fixture and a fresh metadata record bound to its authenticated login. It rejects production and ordinary accounts. The browser loads Column only after a successful explicitly consented sandbox request.
- These checks establish local behavior with mocked transport. They do **not** establish a live provider connection, IRS/state acceptance, production authorization, provider calculation accuracy or actual SDK compatibility. No keys or taxpayer data were used.

Focused validation: **164 tests passed across the four files above**, with zero ESLint errors. Six explicit-`any` warnings are confined to the small React/DOM test harnesses. No live provider tests were run.

**Practical outcome:** the code can be prepared for an embedded filing partnership now. Real filing requires the external steps above and the taxpayer's review/signature in the provider flow. There is no verified public API here that safely turns an AI estimate directly into an automatically submitted return.

## Remaining export audit completed in this batch

The legacy `/api/reports/profit-loss` route now produces an explicitly labeled **recorded cash-flow summary**. It reads complete owner-verified transactions, uses calendar-year/month dates, excludes pending records, and requires recorded USD currency for combined totals. Personal, transfer and unreviewed movements remain visible as cash movements; they are not asserted to be taxable business income or deductions. Its former income-tax/SE-tax/effective-rate estimates are null. Legacy numeric response aliases remain for compatibility, while the screen and paginated PDF use cash-flow labels and state their limits. Missing historical currency requires review; this change does not backfill an assumed currency.

The quarterly-voucher route continues returning `QUARTERLY_REVIEW_REQUIRED`, with no calculated payment, refund, completed document or transmission. It requires an explicit supported year and quarter, rejects conflicting year fields, and links the matching official IRS reference: [2024 Form 1040-ES](https://www.irs.gov/pub/irs-prior/f1040es--2024.pdf), [2025 Form 1040-ES](https://www.irs.gov/pub/irs-prior/f1040es--2025.pdf), [current 2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf), verified September 16, 2026. The unversioned current IRS URL must be rechecked when the filing year advances.

Validation: **36 cash-flow/voucher tests**, **5 actual cash-flow UI handler tests** and **13 updated rate-contract tests** pass. The existing **64 subscription-route** and **8 quarterly snapshot** checks also passed after the route changes. Regressions cover duplicate logical account/transaction references, invalid/missing currencies, amounts and dates; January boundaries in Los Angeles and UTC+14; independent JSON/PDF totals; long Unicode source names and pagination; owner/plan gates; and stale account/year responses, including A→B→A. A synthetic five-page PDF was generated at `/tmp/writeoff-cash-flow-export-review/recorded-cash-flow-long.pdf`; every page contains the preparer-review designation and footer. These are local synthetic tests, not evidence of a filed return.
