# Staging validation — September 15–16, 2026

## Current staging release (v9)

- Final application commit: `f2ae741583420aaad9dc8d3ae332cb3dcc83dec6` on `codex/staging-readiness`, including the prior dashboard, receipt and session fixes.
- Final build: `pQwYV6tBKEjS7JFQTeTgL`. The isolated HTTP/rules suite passed against this exact compiled artifact; all 1,116 non-cache build files matched by SHA-256 across source, tested copy and packaged Firebase function.
- Firebase project: `writeoff-production-testing`.
- Testing site: https://writeoff-production-testing.web.app
- This batch has not been promoted to `writeoffapp.com`. The earlier production login and logo repairs remain separate.

## Completed checks

| Check | Result | What it establishes |
|---|---:|---|
| Application tests | 1,532 passed | Regression coverage of the final candidate; provider transport is mocked where applicable |
| Compiled HTTP smoke suite | 264 passed | Authentication boundaries for 128 discovered API operations, plus selected authenticated ownership, workflow and subscription cases |
| Firestore/Storage rules | 11 passed | Direct client access against real local Firebase emulators |
| Additional compiled export checks (v9) | 18 passed | PDF/CSV signatures and totals, signed refunds, meal rounding, formula escaping, strict date/mixed-use/duplicate review and expired-plan gates |
| Production build | Passed | Compilation, type checking and configured lint checks; existing lint warnings remain |
| OCR artifact check | Passed | Native worker/core files included and Tesseract remains external to the route bundle |
| Native OCR sample | Passed | Synthetic receipt read with 95% OCR confidence; this is one sample, not an accuracy benchmark |
| Resource mobile layout | Passed | Checklist and footer inspected at 390 × 844; checking items updates progress |
| Deployed Firebase smoke suite (v9) | 17 passed | Real synthetic users, sessions, profile/record persistence, receipt ownership, export gating and staging metadata; passed after adding the missing owner-query index |
| Deployed export/filing checks (v9) | 9 groups passed | Real CSV/PDF contribution parity, live SE inputs, owner archive datasets/privacy, mixed-use review, access controls and disabled filing/status/PIN writes |
| Deployed plan transitions (v4) | 5 passed | Historical evidence: one persisted income record remains unchanged/readable through free, trial, expired, paid and past-due states; current v9 plan gates are covered separately |
| Deployed tax follow-up (v8) | 15 passed | Personal/senior deductions, SSA withholding and JSON/PDF/quarterly parity, invalid facts/years/credits review, and Free export gates |
| Real Auth action SDK/API integration | 11 passed | Verification, signed-out reset, old/new password behavior and reused-code rejection |
| Google/browser and actual mail delivery | Verified | Google session reload; fresh verification/reset messages in approved Inbox; delivered links valid; verification completes |

The HTTP/rules runs use an isolated copy, `demo-writeoff-security`, loopback emulators and synthetic records. Environment files and payment/bank/AI credentials are excluded. They do not contact production providers. All test servers and emulators were stopped after completion.

### Subscription access

The HTTP suite covers free, active/expired trial, active paid, cancel-at-period-end, canceled, past-due, expired and malformed subscription snapshots. The tested owner record/list/detail reads remain available across plan states; protected reports/CSV unlock only when persisted entitlement permits them. Requests cannot unlock features by submitting their own plan flags. These fixture checks do not validate real Stripe checkout or webhook delivery.

A separate deployed probe preserved the same existing synthetic income record through free → trial → expired → active → past_due. List and detail stayed HTTP 200 with unchanged record fields. CSV returned 403/200/403/200/403 respectively, and allowed exports contained the saved income. The original nine entitlement fields were restored exactly. This establishes retention for that record type and fixture, not every possible data type or a real Stripe lifecycle.

## Failures found through deployment testing and addressed

- Firebase Hosting's internal request URL caused valid browser session creation to fail the origin check. The application now recognizes configured application origins, rejects cross-site mutations and does not trust caller-provided forwarding headers.
- Firebase frameworks initializes a named Admin app. Receipt Storage now uses that same app instead of requesting an absent default app.
- Tesseract was bundled with an invalid worker path. The build now preserves its native package and includes its worker/core files; staging deployment checks the artifact before upload.
- The original 256 MiB function exceeded its memory limit. Staging now requests 1 GiB with at most two instances.
- Confirmed receipt dates are normalized for the save API; an ISO date is no longer mistaken for a shorter hyphenated date.
- Attaching a receipt verifies transaction ownership and preserves bank details. Editing a matched receipt retains the attachment choice.
- Onboarding filing-status labels are normalized; unsupported statuses return review-required responses and withhold affected dashboard estimates.
- The PDF uses its selected tax year in the digital-asset question.
- The staging sitemap is rendered dynamically for the Firebase adapter. The testing site sends `X-Robots-Tag: noindex, nofollow` and disables production analytics.
- Receipt attachment controls fit narrow screens, and the install banner is hidden during printing.
- Transactions' Receipt and Add buttons now open the working receipt/manual-entry workflows. Removed dialogs that closed without saving and a client write denied by the security rules.
- Detail, paginated-list and creation responses preserve receipt metadata, so a refresh does not hide a saved attachment.
- Dashboard/list/detail dates, chart grouping and list filters use the stored calendar day. September 2 and January 1 remain correct in Los Angeles and UTC+14.
- Firebase Functions intercepts `/robots.txt`; staging therefore publishes a generated static Hosting asset after the framework build. No duplicate `public/robots.txt` is added to Next.
- Dashboard tax cards now use the shared federal calculation endpoint. Personal, unreviewed, pending and prior-year entries cannot become current-year tax deductions through separate dashboard arithmetic. Loading, invalid responses, failures and review requirements withhold amounts; late responses cannot replace newer user/data results.
- Replaced local combined-rate/quarterly estimates with annual federal tax and balance/refund figures from the shared snapshot. Scope, year and calculation warnings are visible. Cash-flow charts identify cash inflows/outflows instead of implying tax income/deductions.
- Both manual-entry forms use the local calendar for default/reset dates. Tests cover Los Angeles evenings, December 31 and UTC+14, while retaining explicitly selected dates.
- Receipt View opens an accessible inline preview with loading/error states. Both the image and original link use validated private API paths, including supported legacy paths. Arbitrary external URLs and traversal are rejected; unsupported old links show recovery guidance. Reopening resets the image attempt.
- Browser session exchanges retry transient failures once. A background renewal failure preserves only an already established same-account identity; first sign-in, explicit rejection, revoked credentials and unverified users remain blocked. Automatic recovery is bounded, and sign-out/account changes/disposal cancel pending work. The server's verification and 14-day cookie policy are unchanged.

## External services and remaining release gates

- **In-app filing:** a disabled, synthetic-only Column sandbox adapter is implemented. Partner credentials, coverage/role confirmation, actual provider QA, security/consent integration and a separately reviewed production launch remain required. See [export and filing status](EXPORT_FILING_STATUS_2026-09-16.md).
- **Stripe:** test keys, prices and webhook configuration pending; real billing lifecycle remains untested.
- **Plaid:** Sandbox credentials pending; real linking, import, reconnect and sync remain untested.
- **OpenAI:** actual completion returns HTTP 429, `credit_balance_exhausted` / `insufficient_quota`. The deployed assistant returns a safe 503 retry message. The user chose to keep AI unavailable; paid response-quality tests are deferred.
- **Google OAuth:** completed staging Google login is now verified. Admin confirms the Google provider and verified email; the protected browser session survived a full reload. The previous popup-observation limitation is resolved by the resulting account/session evidence. See [auth validation](AUTH_PROVIDER_VALIDATION_2026-09-16.md).
- **Email actions:** original messages were found in Spam after correcting the Gmail search. Fresh approved verification and reset messages reached Inbox; the delivered verification link completed and the delivered reset link opened the correct form. Separate real SDK/API checks establish reset completion, old/new password behavior and reused-code rejection. Browser password submission and universal inbox placement are not claimed.
- **Browser journeys:** email sign-in, onboarding without a bank, session/profile reload, receipt OCR/edit/save, and manual expense entry passed against deployed staging. Final transaction-button navigation, attachment refresh and stored calendar-display checks passed as recorded below. Physical camera/microphone permissions and devices remain separate checks.
- **Tax coverage:** matching JSON/PDF results is consistency evidence, not tax-law certification. See [the coverage matrix](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md) for unsupported cases and release exclusions. The calculator rejects 2027.
- **Remaining estimates:** the corrected dashboard inherits the shared engine's documented limitations. The September 16 quarterly batch shares annual totals and requires reviewed payment facts; legacy savings helpers and broader annual eligibility gaps remain as described in the tax coverage matrix.
- **Runtime maintenance:** Firebase warns that Node 20 is deprecated and decommissions October 30, 2026. Upgrade and validate the runtime before that deadline.

## Baseline deployed verification

The baseline application batch (`66301e0`) deployed successfully on September 15 at 11:08 p.m. Pacific (September 16, 06:08 UTC):

- Hosting release: `sites/writeoff-production-testing/releases/1789538908238000`.
- Hosting version: `f76ccbdf7583a649`.
- Server revision: `ssrwriteoffproductionte-00011-jel`, ACTIVE, 1024 MiB.
- Deployed build: `iFW4_8TVozH2LKIWX42yy`. This is a rebuild of the same application commit checked by the isolated suite.
- Real smoke run completed at `2026-09-16T06:09:01.272Z`: **17 passed, 0 failed**.
- Final deployed OCR probe returned HTTP 200 and read the synthetic September 2 receipt as $25 with 95% confidence.
- Browser reload retained the synthetic user's session/profile. A fresh sign-out/email-password sign-in also returned to the existing dashboard. Dashboard/list/detail showed September 15 and September 2 correctly.
- The transaction Receipt button opened Upload Receipt; Add opened the manual-entry form.
- A saved attachment retained its filename and View control after full reload. Direct browser navigation to its private image URL displayed the 640 × 400 synthetic receipt using the session cookie. Clicking View did not expose a new tab in the in-app browser, so popup behavior in ordinary browsers remains a separate check.

Local evidence: `/tmp/writeoff-staging-deployment-v4.json`, `/tmp/writeoff-staging-smoke-results.json`, `/tmp/writeoff-staging-real-smoke-v4.log`, `/tmp/writeoff-staging-ocr-probe-v4.json`, `/tmp/writeoff-staging-tax-v3-evidence.json`, `/tmp/writeoff-staging-plan-retention-v4.json`, and `/tmp/writeoff-staging-http-kmph9wlg/http-smoke-results.json`. These contain synthetic results; credentials are held separately and are not committed.

The first staging deployments found real session, receipt and metadata-route failures that local tests did not reveal. Counts above must not be presented as proof that the entire platform or every taxpayer scenario is ready for public launch. The broader batch remains in staging.

## Follow-up deployed verification

The `4ea9dba` follow-up passed 900 application tests and its production build, then deployed at `2026-09-16T06:40:13.011Z`:

- Hosting release: `sites/writeoff-production-testing/releases/1789540813011000`.
- Hosting version: `0ea14ac8ca4e7553`; server revision `ssrwriteoffproductionte-00013-sis`, ACTIVE, 1024 MiB.
- Build: `TODSpggeBkQt5wcD5Hb_x`.
- Deployed smoke suite: **17 passed, 0 failed** at `2026-09-16T07:38:23.744Z`.
- Browser dashboard showed $0 profit, confirmed expenses, federal tax and balance, matching the six API values saved in `/tmp/writeoff-staging-dashboard-parity-v5.json`. The former −$68 misclassification is gone, and calculation warnings remain visible.
- Header refresh worked without a linked bank, displaying loading and then the server result.
- Receipt View opened the inline dialog; its private image rendered at its original 640 × 400 resolution. The preview and dashboard were visually legible at the actual 869 px viewport. A requested 390 px override did not take effect in this later browser session, so this is not a completed phone-width dashboard check.
- Local-date defaults passed both timezone test runs; a final deployed form check was interrupted by the browser-session issue below.

After prolonged browser idle/host time jumps, the browser returned to login with the generic secure-session error. Staging server logs showed only successful HTTP 200 session exchanges in the inspected period, and a fresh controlled sign-in/session probe also returned 200. The original browser failure was not isolated; a new browser tab also hit a navigation timeout. Code review separately confirmed that the old observer discarded a working same-account login after any renewal timeout/network error. Commit `eabaab8` fixes that behavior and cancellation races, with 88 focused regressions and independent review. No server expiry or revoked-token protection was relaxed.

Follow-up evidence: `/tmp/writeoff-staging-deployment-v5.json`, `/tmp/writeoff-staging-real-smoke-v5.log`, `/tmp/writeoff-staging-tests-v5.log`, and `/tmp/writeoff-staging-dashboard-parity-v5.json`.

## Previous authentication follow-up (v6)

Commit `eabaab8` passed **925 application tests**, its production build, **248 isolated HTTP checks** and **11 security-rule checks**, with no failures. The isolated suite checked the exact deployed build `jD5VDUIQnFFVmxofbvBzw`; all 1,110 compiled files matched by SHA-256. Its demo services were stopped afterward.

Staging deployment completed at `2026-09-16T11:39:57.665Z`:

- Hosting release: `sites/writeoff-production-testing/releases/1789558797665000`.
- Hosting version: `73c5534d92dcb311`; server revision `ssrwriteoffproductionte-00015-ham`, ACTIVE, 1024 MiB.
- Public login HTML returned HTTP 200, included the final build ID and retained `noindex, nofollow`.
- Post-release real Firebase smoke suite: **17 passed, 0 failed** at `2026-09-16T11:40:37.955Z`.
- Browser reload restored the synthetic account; sign-out reached the login form; a fresh email/password sign-in reached its existing dashboard. A subsequent full reload retained the account and saved records.
- Transactions → Add opened the manual-entry form, whose date input contained `2026-09-16`, matching the current Los Angeles calendar day. Timezone-boundary behavior remains covered by unit tests.
- Dashboard cards and scope warnings remained visible, with the expected $0 amounts for this synthetic fixture. The actual viewport was 869 × 895 with no horizontal overflow. The 390 × 844 override still did not apply, so final phone-width dashboard verification remains incomplete; the temporary override was reset.

The fresh browser pass closes the immediate post-deployment sign-in check. It does not establish the root cause of the earlier idle/network failure or prove every suspension condition. Initial-authentication rejection and transient-renewal behavior also have focused regression coverage; server authentication protections are unchanged.

Final evidence: `/tmp/writeoff-staging-deployment-v6.json`, `/tmp/writeoff-staging-tests-v6.log`, `/tmp/writeoff-final-auth-smoke-v6-evidence.json`, `/tmp/writeoff-final-auth-smoke-v6-http-results.json`, `/tmp/writeoff-staging-real-smoke-v6.log`, `/tmp/writeoff-staging-smoke-results-v6.json`, and `/tmp/writeoff-staging-browser-v6.json`.

The broader release remains in staging pending the remaining provider, device and tax-coverage gates above. Email/OAuth follow-up results supersede the earlier pending status. Production was not changed by this batch.

## Email actions and quarterly tax follow-up (v7)

Application commit `e15e7c8` passed **1,021 application tests**, a production build, **249 compiled HTTP checks** and **11 security-rule checks**. The ordinary unit run skipped the 11 emulator-only rules checks; they passed separately against actual local emulators. Existing lint warnings remain. All 1,110 non-cache build files matched across source, isolated tests and Firebase packaging, including 507 JavaScript files and 146 tracing manifests.

Released to staging at `2026-09-16T12:14:56.612Z`:

- Hosting release: `sites/writeoff-production-testing/releases/1789560896612000`.
- Hosting version: `7f353bd8fb1038a8`; server revision `ssrwriteoffproductionte-00017-kuh`, ACTIVE, 1024 MiB.
- Build: `3fYR2wdW7qSOn4hnwI2Pu`; login returned HTTP 200 with matching build and `noindex, nofollow`.
- Real staging smoke: **17 passed, 0 failed**. New live tax probe: **7 passed, 0 failed**. Free accounts could not export protected PDFs/vouchers; trial normal PDF worked. Shared annual/quarterly figures matched. An unsupported voucher returned actionable 422 instead of a fabricated form. Saving Social Security benefits yielded matching review responses across annual/PDF/quarterly routes, with no tax total; clearing only the synthetic declaration restored its original result.
- Auth action SDK/API checks: **11 passed** using the new helpers against actual Firebase. The synthetic account was deleted afterward. Deployed browser verification succeeded, a reused link showed recovery guidance, and the reset form validated the correct separate synthetic account. No new password was entered through browser automation. The browser fixture’s emailVerified flag was independently confirmed, then that exact synthetic account was deleted. The approved mail-delivery fixture was subsequently used for actual delivery checks and deleted after v8 verification; existing Google/production accounts were untouched.
- The browser payment illustration returned $5,200 annually and four $1,300 original installments for reviewed synthetic $8,000 tax, $2,000 withholding, $10,000 prior tax and $100,000 prior AGI. Selecting unavailable prior return without ruling out the no-prior-tax exception cleared figures and required review. Desktop inspection at 1280 × 720 showed no horizontal overflow; no new phone-width claim is made.
- At the time of the v7 report, Google login and inbox delivery had not been observed. The v8 follow-up verified the completed Google account/session and found the delivered messages; see the current auth validation above. AI remains unavailable at the user’s request.

The changes repair signed-out password resets, replace the 85% Social Security shortcut with review requirements, and remove conflicting quarterly formulas and unsupported penalty/payment conclusions. The public payment tool requires reviewed annual figures and explicit regular-method/prior-year facts; it is not a complete tax return engine. See [auth evidence](AUTH_PROVIDER_VALIDATION_2026-09-16.md), [quarterly scope](TAX_QUARTERLY_VALIDATION_2026-09-16.md), and [Social Security scope](TAX_SOCIAL_SECURITY_VALIDATION_2026-09-16.md).

Local sanitized evidence: `/tmp/writeoff-staging-deployment-v7.json`, `/tmp/writeoff-staging-validation-v7.json`, `/tmp/writeoff-staging-tests-v7.log`, `/tmp/writeoff-staging-smoke-results-v7.json`, `/tmp/writeoff-staging-tax-v7-evidence.json`, `/tmp/writeoff-staging-action-api-v7.json`, and `/tmp/writeoff-staging-browser-v7.json`. Temporary test services were stopped. Production was not changed by this batch.


## Google, mail and personal deduction follow-up (v8)

Application commit `49cc7551d494f05456349bd742fd70508ecd639a` passes **1,233 application tests**, its production build, **259 compiled HTTP checks** and **11 security-rule tests**. Eleven emulator-only tests are intentionally skipped in the ordinary run and passed separately against local emulators. Build `k8rMRLkl0UPdv9rQVgkfB` has all 1,110 non-cache files identical by SHA-256 across source, isolated tests and the Firebase package, including 507 JavaScript files and 146 tracing manifests. No environment files were copied into the isolated suite; all its services were stopped afterward. Existing lint warnings remain.

- Completed Google login and session reload verified in staging. Onboarding can recover a missing email from the same signed-in Firebase identity without resetting typed answers; failed recovery offers a retry. Post-deployment screenshots show the correct email after reload. The browser text inspector omitted this disabled field value, so its earlier apparent blank state was not reliable evidence of a visual defect. Google sign-in preserves the supported persistence selected by Firebase initialization.
- Original approved verification/reset messages were found in Spam. Fresh messages reached Inbox after marking the expected verification conversation not spam. The actual delivered verification link completed and Admin confirmed verification; the actual delivered reset link opened the correct fixture form. No browser password submission is claimed. Mailbox-specific delivery does not guarantee inbox placement for all recipients.
- Added reviewed ordinary Social Security worksheet calculations and SSA/RRB withholding, standard-deduction age/blindness/dependency facts, MFS spouse itemization, and the enhanced 2025–2026 senior deduction including per-person MAGI phaseout. The senior deduction stays below AGI and is applied before the QBI income cap.
- Annual JSON, PDF, dashboard and quarterly consumers share these results. The organizer keeps separate 2024–2026 records and preserves edits on failed year-change saves/loads. Unsupported or unanswered facts return explicit review guidance instead of guessed totals.
- A generic dependent count no longer awards child credits. Any positive potential EITC requires review until the missing eligibility facts are collected. Existing pure arithmetic helper tests do not establish eligibility.
- Removed unsupported filing/refund guarantees. The planning PDF is not an official or e-file-ready return; its 2026 export identifies the published 2025 layout it uses.
- AI remains unavailable at the user’s request. Stripe/Plaid test access and the remaining documented tax scenarios are still outside this completed batch. Production has not been changed.

### Deployed v8 release

- Hosting release: `sites/writeoff-production-testing/releases/1789580748825000`, September 16 at `2026-09-16T17:45:48.825Z`.
- Hosting version: `316ac58fc960b320`; server revision `ssrwriteoffproductionte-00019-qon`, ACTIVE, 1024 MiB.
- Public login returns HTTP 200 with build `k8rMRLkl0UPdv9rQVgkfB` and `noindex, nofollow`.
- Real staging smoke: **17 passed, 0 failed**. The isolated compiled suite and actual staging smoke use different synthetic records.
- Browser Google session restored after reopening/reloading `/protected`; the onboarding email is visibly present in the screenshot. No personal profile answers were entered or saved.
- The separate approved mail account was deleted after its delivered verification/reset checks; the Google account was not changed.

The paced real tax probe passed **15/15** checks: missing/year-stale personal facts; 2027 rejection; ordinary annual/quarterly consistency; January 1/January 2 senior eligibility boundaries; per-spouse joint phaseout; age/blindness additions; dependent standard deduction; MFS spouse itemization; supported SSA withholding and PDF consistency; generic-dependent and positive-EITC review; and Free PDF/voucher gates. Single, joint and Social Security PDFs were rendered and visually inspected.

The initial unpaced tax run reached 6 passing cases and then hit HTTP 429 rate limits before 9 remaining assertions. Its artifact is preserved separately; these were request-rate failures, not demonstrated arithmetic mismatches. The repeated run paced requests, retained all rate-limit protections, and passed all 15 without 429 retries.

Final local evidence: `/tmp/writeoff-staging-deployment-v8.json`, `/tmp/writeoff-staging-validation-v8.json`, `/tmp/writeoff-staging-tests-v8.log`, `/tmp/writeoff-staging-smoke-results-v8.json`, `/tmp/writeoff-staging-tax-v8-evidence.json`, `/tmp/writeoff-staging-tax-v8-rate-limited-attempt.json`, `/tmp/writeoff-staging-auth-delivery-v8.json`, and `/tmp/writeoff-staging-browser-v8.json`. These reports contain selected synthetic evidence, not provider secrets or production taxpayer records.

All current v8 temporary fixtures were cleaned: the real-tax probe removed its 12 tracked document paths and Auth owner; the general smoke removed its 3 exact synthetic Auth accounts, 6 owned Firestore documents and 1 receipt object. The approved mail account was also deleted. Current smoke/mail credential files were removed. Older fixtures and the real Google/production accounts were not changed. Cleanup evidence: `/tmp/writeoff-staging-smoke-cleanup-v8.json` and `/tmp/writeoff-staging-mail-cleanup-v8.json`.

## Export and filing preparation follow-up (v9)

Application commit `f2ae741583420aaad9dc8d3ae332cb3dcc83dec6` passed **1,532 application tests**, standalone type checking, its production build, **264 compiled HTTP checks**, **11 security-rule checks** and **18 additional compiled export checks**. The ordinary unit run skipped only the 11 emulator-only checks, which passed separately. Build `pQwYV6tBKEjS7JFQTeTgL` has 1,116 identical non-cache files across source, isolated tests and Firebase packaging, including 511 JavaScript files and 147 tracing manifests. Test services were stopped and emulator fixtures removed. No GitHub Actions run exists for this branch; these are local/compiled and deployed checks, not a claim of hosted CI execution.

- Released `2026-09-16T18:35:42.243Z`: Hosting release `sites/writeoff-production-testing/releases/1789583742243000`, version `ba514658306bfe26`; function revision `ssrwriteoffproductionte-00021-tug`, ACTIVE, 1024 MiB. Public login returns the exact build and `noindex, nofollow`.
- The first deployed general smoke passed 16/17: the new complete-owner CSV reader returned 503 because staging lacked the `transactions.userId` ascending collection-group index. Its current-owner query returned `FAILED_PRECONDITION`; the legacy `user_id` query already worked. The failure was preserved as evidence.
- A targeted update added only the missing staging group index and preserved existing collection indexes. Both exact owner queries subsequently returned 200; the same-account CSV returned the expected signed income. A fresh complete smoke run then passed **17/17**. No app rebuild or production index change was needed. A hosting-only deployment does not apply Firestore index definitions; deployed query readiness is a release check.
- The separate paced export probe passed **9/9 groups**. Its $100,000 synthetic receipts, $100 supply expense, $20 refund and $200 meal yielded $180 confirmed expense contributions consistently across Schedule C PDF/CSV. The SE loader included the separate supported depreciation and recorded W2 wage cap, producing the same live JSON/PDF results rather than stale settings. These examples establish implementation consistency, not universal tax-law accuracy.
- Raw CSV retained declared mixed-use facts; affected tax totals returned review requirements. The owner archive included all tested dataset counts, excluded credential/PIN/SSN ciphertexts and other-owner data, and remained available on a Free plan. Receipt metadata is included; receipt binaries are not.
- Disabled filing returned unavailable/503. Legacy PIN and client-supplied filing-status writes returned 409, and no verified filing status or provider session was fabricated. No bank, payment, AI, mail or filing-provider calls occurred in the export probe.
- The three downloaded Schedule C/SE pages were rendered and inspected. Financial content is legible and complete; the Schedule C reference footnote has a cosmetic final-word overflow onto an otherwise empty second page. Prior synthetic layout checks cover the other worksheet examples; actual provider-browser filing has not been tested.
- Initial and repeated general-smoke fixtures were both cleaned: each removed three exact Auth accounts, six owned documents and one receipt object. The export probe separately removed 22 tracked documents and two Auth accounts. Current credential/ownership manifests were removed. Existing Google and production accounts were untouched.

The application now offers more reliable preparer records and bounded worksheets, not a complete fileable federal/state return. The Column integration is disabled and limited to approved synthetic staging fixtures; actual provider credentials/QA, coverage/roles, consent/security instrumentation, first-prefill design and a separate production launch remain outstanding. AI remains unavailable by user choice, and Stripe/Plaid test access is still pending. See [release scope](EXPORT_FILING_STATUS_2026-09-16.md), [data-export details](CPA_EXPORTS_2026-09-16.md) and [filing integration research](EMBEDDED_FILING_RESEARCH_2026-09-16.md).

Sanitized local evidence: `/tmp/writeoff-staging-validation-v9.json`, `/tmp/writeoff-staging-deployment-v9.json`, `/tmp/writeoff-staging-tests-v9.log`, `/tmp/writeoff-staging-smoke-results-v9.json`, `/tmp/writeoff-staging-smoke-results-v9-index-missing-attempt.json`, `/tmp/writeoff-staging-index-repair-v9.json`, `/tmp/writeoff-staging-index-check-v9.json`, `/tmp/writeoff-staging-csv-recheck-v9.json`, `/tmp/writeoff-staging-exports-v9-evidence.json`, `/tmp/writeoff-staging-smoke-cleanup-v9.json`, `/tmp/writeoff-staging-smoke-cleanup-v9-index-missing-attempt.json`, and `/tmp/writeoff-staging-http-v9-_101log5/prepared.json`.
