# Staging validation — September 15, 2026

## Release candidate

- Final application commit: `eabaab83b53ebfc615d432b913651dc0e901ac8a` on `codex/staging-readiness`, including the `4ea9dba` dashboard/receipt follow-up.
- Final build: `jD5VDUIQnFFVmxofbvBzw`. The isolated HTTP/rules suite passed against this exact compiled artifact; all 1,110 compiled files matched by SHA-256. Backend handlers and security rules are unchanged by the follow-up client fixes.
- Firebase project: `writeoff-production-testing`.
- Testing site: https://writeoff-production-testing.web.app
- This batch has not been promoted to `writeoffapp.com`. The earlier production login and logo repairs remain separate.

## Completed checks

| Check | Result | What it establishes |
|---|---:|---|
| Application tests | 925 passed | Regression coverage of the final candidate; provider transport is mocked where applicable |
| Compiled HTTP smoke suite | 248 passed | Authentication boundaries for 126 discovered API operations, plus selected authenticated ownership, workflow and subscription cases |
| Firestore/Storage rules | 11 passed | Direct client access against real local Firebase emulators |
| Production build | Passed | Compilation, type checking and configured lint checks; existing lint warnings remain |
| OCR artifact check | Passed | Native worker/core files included and Tesseract remains external to the route bundle |
| Native OCR sample | Passed | Synthetic receipt read with 95% OCR confidence; this is one sample, not an accuracy benchmark |
| Resource mobile layout | Passed | Checklist and footer inspected at 390 × 844; checking items updates progress |
| Deployed Firebase smoke suite (v6) | 17 passed | Real synthetic users, sessions, profile/record persistence, receipt ownership, export gating and staging metadata |
| Deployed plan transitions (v4) | 5 passed | One persisted income record remains unchanged/readable through free, trial, expired, paid and past-due states; CSV gates correctly; backend unchanged through v6 |
| Deployed tax consistency cases | 11 passed | Supported filing labels, unsupported-status/year rejection, and selected JSON/PDF field parity; checked on the preceding revision with unchanged tax code |

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

- **Stripe:** test keys, prices and webhook configuration pending; real billing lifecycle remains untested.
- **Plaid:** Sandbox credentials pending; real linking, import, reconnect and sync remain untested.
- **OpenAI:** model discovery succeeds, but an actual completion returns HTTP 429, `credit_balance_exhausted` / `insufficient_quota`. The deployed assistant returns a safe 503 retry message. Replenish the app's API account before response-quality tests.
- **Google OAuth:** disabled in the testing Firebase project; fresh staging OAuth is untested.
- **Email actions:** actual verification-email and password-reset delivery/links remain unverified. Synthetic accounts were created through Admin Auth; this does not exercise inbox delivery.
- **Browser journeys:** email sign-in, onboarding without a bank, session/profile reload, receipt OCR/edit/save, and manual expense entry passed against deployed staging. Final transaction-button navigation, attachment refresh and stored calendar-display checks passed as recorded below. Physical camera/microphone permissions and devices remain separate checks.
- **Tax coverage:** matching JSON/PDF results is consistency evidence, not tax-law certification. See [the coverage matrix](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md) for unsupported cases and release exclusions. The calculator rejects 2027.
- **Remaining estimates:** the corrected dashboard inherits the shared engine's documented limitations; it does not expand supported taxpayer scenarios. Other legacy savings/quarterly tools still need reconciliation or explicit restrictions as described in the tax coverage matrix.
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

## Final authentication follow-up

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

The broader release remains in staging pending provider, email/OAuth, device and tax-coverage gates above. Production was not changed by this batch.
