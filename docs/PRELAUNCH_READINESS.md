# WriteOff pre-launch readiness

Updated September 15, 2026. Priority confirmed by the owner: **pre-launch; fix the core product and onboarding first**, then start go-to-market work.

## Verified access and deployment map

| Service | Verified state |
| --- | --- |
| GitHub | Authenticated as `pratz456`; both WriteOff repositories accessible. |
| Active codebase | `pratz456/TestOffwrite`, default branch `march-branch`, inspected at `7c9aecd`. The deployed package dependencies match this repository; deployed calculator routes are absent from the older repository. The deployment does not record a Git commit, so an exact revision match is unconfirmed. |
| Older repository | `pratz456/WriteOffAppWebsite`; last push February 10, 2026. |
| Production Firebase | `writeoff-23910`; Hosting, Next.js SSR function `ssrwriteoff23910`, scheduled function `syncAllUsersTransactions`, Auth and Firestore configuration. |
| Testing Firebase | `writeoff-production-testing` is accessible. Test app configuration, credentials and data isolation still need verification. |
| Public domain | `writeoffapp.com` resolves to `199.36.158.100`; `www` aliases `writeoff-23910.web.app`. HTTPS responds successfully through Firebase/Google infrastructure. |
| Latest Hosting release | September 1, 2026, 16:58:30 UTC; version `17c086c1c0be1937`. |
| Vercel | Authenticated as `shahpratham99-9827`. Four older WriteOff projects in the available team, no domains listed. Current domain DNS points to Firebase. |

Source: authenticated GitHub/Firebase/Vercel CLI and API reads, DNS, HTTP headers, and a comparison with the deployed SSR source archive. The temporary source archive was deleted after inspection. No production release or data changes were made in this pass.

## First fixes prepared locally

- Incorporate the existing error-page Link fix from PR #5 and default-branch CI fix from PR #6, preserving their authorship.
- Permit the Plaid Link iframe, Firebase Auth helper iframe, and Google API script in the browser policy. Previously only Stripe frames were allowed, despite using both Plaid Link and Firebase Google sign-in.
- Validate post-login redirect destinations so external URLs, JavaScript URLs, and backslash/control-character variants fall back to `/protected`.
- Add password-manager hints, a named password visibility control, and an announced login error message.
- Exclude generated Next.js types and PWA output from linting; a first build generated a type reference that broke subsequent lint runs.
- Add regression coverage for provider loading policy and post-login navigation.

Provider references: [Plaid web SDK CSP requirements](https://plaid.com/docs/link/web/#csp-directives) and [Firebase Auth redirect behavior](https://firebase.google.com/docs/auth/web/redirect-best-practices). Installed Firebase Auth code also loads `https://apis.google.com/js/api.js`.

## Validation of the first fixes

- `npm run ci` passed: lint, **29 tests across 5 files**, and the full production build.
- Lint still reports **1,059 warnings** in the existing codebase; this is not a clean-code or full security certification.
- Checks ran on the installed Node.js **24.18.0**. The repository declares Node **20**; repeat on that version or complete a separately tested runtime upgrade before release.
- The local development login page rendered, and the password visibility control changed its accessible name from “Show password” to “Hide password” when clicked.
- The production-mode local preview redirects plain HTTP to HTTPS; browser inspection used the development server. No complete user signup, Plaid import or Stripe payment was performed.
- A live login request with a redirect query returned HTTP 200. This is a smoke check, not an end-to-end onboarding test.

## Existing work to reconcile

Open pull requests at inspection:

- [#5: Error-page Link](https://github.com/pratz456/TestOffwrite/pull/5) — incorporated locally.
- [#6: CI on march-branch](https://github.com/pratz456/TestOffwrite/pull/6) — incorporated locally.
- [#7: Scope analysis job reads to the owner](https://github.com/pratz456/TestOffwrite/pull/7) — review with Firestore emulator isolation tests.
- [#8: Partner filing copy](https://github.com/pratz456/TestOffwrite/pull/8) — reconcile with actual filing capabilities.
- [#9: Login SSR/query-string behavior](https://github.com/pratz456/TestOffwrite/pull/9) — review before overlapping login routing changes. One production request with `redirect=/protected` returned HTTP 200 in under one second; this does not rule out intermittent hangs.

## Implementation order and acceptance criteria

### 1. Establish a repeatable development and release baseline

- Run lint, tests, and production build from a clean checkout using the repository's Node version; align runtime versions as a separate dependency upgrade.
- Inventory required environment variable **names** and verify test values without copying production customer data into development.
- Make the testing Firebase project usable for Auth, Firestore rules, Storage, Plaid Sandbox, and Stripe test-mode flows.
- Record repository, commit and build ID with each deployment; document rollback to the previous Hosting release.

**Done when:** a fresh checkout can reproduce checks and a testing deployment from a known commit.

### 2. Make onboarding reach a useful result

Target path: landing page → signup → email verification or Google sign-in → minimal work profile → connect a bank or add an expense → review the first suggested deduction.

- Resolve competing signup redirects and verification/session handling.
- Explain required profile fields, save progress, support retry, and keep optional information out of the initial path.
- Verify Plaid cancellation, reconnect, account selection and asynchronous import states.
- Provide an actionable empty dashboard and a clear completion state after the first reviewed expense.
- Verify mobile layouts, keyboard access, password managers, expired sessions and slow-network behavior.
- Sign-up acknowledgments (Plaid data use, AI suggestions for review, optional communications) are now recorded per account (2026-09-17). The sign-up form and the Google path both end in a consent record on `user_profiles/{uid}.consents` (`lib/onboarding/consents.ts`, `CONSENT_TERMS_VERSION`), written only through `POST /api/database/profiles`, which validates the shape and stamps `consents_recorded_at`; `firestore.rules` rejects client writes to both fields. Profile setup shows the acknowledgments step first whenever the profile has no record of the current terms, so Google sign-ins acknowledge the same terms before any answer is saved. Boxes checked on the sign-up form are carried to setup in `localStorage`, bound to the sign-up email, for seven days. Accounts created before this date have no record; if a re-acknowledgment campaign is needed, bump `CONSENT_TERMS_VERSION` and add a dashboard prompt (setup only runs for new profiles).

**Done when:** a new test user can complete that path without intervention, and cancellation/failure paths recover without losing progress.

### 3. Make backend operations reliable

- Test access isolation between two users across profile, accounts, transactions, receipts, exports and analysis jobs.
- Reconcile ID tokens, server sessions, sign-out and email verification enforcement.
- Verify webhook signatures, duplicate delivery handling, idempotent imports, pagination/cursors, scheduled sync authentication and retry behavior.
- Verify subscription state against Stripe events and ensure test/live environments cannot be confused.
- Add structured error reporting and bounded retries for slow or failed AI analysis; preserve user corrections.
- Validate tax calculations and export outputs against authoritative requirements before representing the product as filing-ready.

**Done when:** core flows pass integration tests in the testing project; failures are visible and recoverable; repeat imports and webhooks do not duplicate data.

### 4. Prepare an honest, measurable launch

- Match landing-page, pricing, trial and filing claims to implemented behavior; substantiate testimonials and savings figures before launch.
- Audit analytics delivery: the Google tag is now opt-in through `NEXT_PUBLIC_GA_MEASUREMENT_ID` (see "Analytics tag ownership and browser policy" below). Resolve consent/data-handling behavior before setting it in production.
- Instrument signup start/completion, verification, profile completion, bank-link start/success, import completion, first reviewed expense, return usage and trial conversion. Keep financial details and credentials out of event payloads.
- Define activation as **a user reviewing their first imported or manually entered expense**; distinguish activation from account creation.

**Done when:** a test journey appears accurately in the funnel and all launch claims match tested product behavior.

#### Analytics tag ownership and browser policy (2026-09-17)

Two GA4 measurement IDs exist in the repository history and neither has been chosen:

| Where | ID | Status |
| --- | --- | --- |
| `app/layout.tsx` gtag.js (hard-coded until 2026-09-17) | `G-1P3GNBHB9J` | Removed from source. The layout now reads `NEXT_PUBLIC_GA_MEASUREMENT_ID`. |
| `lib/firebase/client.ts` `measurementId` fallback (`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`) | `G-LE26KP7E9N` | Unchanged. The active client never calls `getAnalytics`, so this value only travels in the Firebase config. The legacy `lib/firebase/firebase/` client, which hardcoded production project, API key and this measurement ID as fallbacks and initialized Firebase Analytics, was deleted on 2026-09-17 (it had no importers). |

Current behavior, enforced by `tests/middleware.test.ts`:

- `lib/analytics/ga-measurement-id.ts` is the single decision point. `gaMeasurementId()` returns the validated `G-…` value from `NEXT_PUBLIC_GA_MEASUREMENT_ID`, or `null` when the variable is unset, malformed, or `NEXT_PUBLIC_APP_ENV=staging`.
- `app/layout.tsx` renders the gtag.js `<Script>` tags only when that value is non-null. Unset means no tag, no `dataLayer`, no request to Google.
- `middleware.ts` adds the Google tag origins (`https://*.googletagmanager.com` to `script-src`; `https://*.google-analytics.com https://*.googletagmanager.com` to `img-src`; `https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com` to `connect-src`) under the same condition, so the CSP never admits analytics origins for a build that renders no tag.
- `firebase.json` is untouched. Its static `Content-Security-Policy` headers for `/auth/**` and `/login` cannot be conditional on a build variable and still omit the Google origins. Browsers enforce every CSP header they receive, so the tag stays blocked on those two paths even after the variable is set, which is the intended state until consent handling is decided.

Resolution steps, in order:

1. In the Google Analytics admin, identify the property and data stream behind each ID and confirm who owns the property. Record the owner here.
2. Decide which stream the web app reports to. If it is the Firebase-linked stream, set `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` and `NEXT_PUBLIC_GA_MEASUREMENT_ID` to the same value; if it is the standalone stream, set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and plan a separate change to drop the fallback ID from `lib/firebase/client.ts`.
3. Settle consent and data-handling behavior for analytics (what loads before consent, what is sent) before any production value is set. Keep financial details and credentials out of event payloads.
4. Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` in the production build environment only. The value is inlined at build time for both the layout and the middleware, so a redeploy is required after changing it. Leave it unset for staging; staging is excluded regardless.
5. If analytics should also run on `/auth/**` and `/login`, add the same three origin groups to both `firebase.json` CSP values in the same deploy that sets the variable. Otherwise leave `firebase.json` as is and note that the auth pages are intentionally excluded.
6. Verify after deploy: the response CSP contains the Google origins, the page loads exactly one gtag.js script with the chosen ID, and the staging smoke check (`scripts/smoke-staging.mjs`) still finds no gtag script on the testing site.

### 5. Run a focused GTM pilot, then scale what works

Working hypothesis: start with one freelancer segment that has frequent business expenses. Confirm the segment through founder interviews and pilot use before expanding.

- Prepare a pilot invitation, onboarding guide and feedback questions.
- Recruit a small initial cohort through owner-approved outreach and partnerships.
- Review activation, time to first useful result, week-one return usage, import failures and support demand.
- Test a small number of acquisition messages and channels with trackable links.
- Consider paid acquisition only after retention and conversion are measurable; establish an explicit spend budget and success criteria first.

**Done when:** a repeatable channel produces users who activate and return, with evidence supporting the next increase in acquisition effort.

GTM materials and experiments are planned here; outreach, ad spend and launch publishing have not occurred.
