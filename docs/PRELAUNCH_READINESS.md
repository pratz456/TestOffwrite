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
- Audit analytics delivery: the layout loads Google Analytics, but the current browser policy does not allow its script origin. Resolve consent/data-handling behavior before expanding analytics.
- Instrument signup start/completion, verification, profile completion, bank-link start/success, import completion, first reviewed expense, return usage and trial conversion. Keep financial details and credentials out of event payloads.
- Define activation as **a user reviewing their first imported or manually entered expense**; distinguish activation from account creation.

**Done when:** a test journey appears accurately in the funnel and all launch claims match tested product behavior.

### 5. Run a focused GTM pilot, then scale what works

Working hypothesis: start with one freelancer segment that has frequent business expenses. Confirm the segment through founder interviews and pilot use before expanding.

- Prepare a pilot invitation, onboarding guide and feedback questions.
- Recruit a small initial cohort through owner-approved outreach and partnerships.
- Review activation, time to first useful result, week-one return usage, import failures and support demand.
- Test a small number of acquisition messages and channels with trackable links.
- Consider paid acquisition only after retention and conversion are measurable; establish an explicit spend budget and success criteria first.

**Done when:** a repeatable channel produces users who activate and return, with evidence supporting the next increase in acquisition effort.

GTM materials and experiments are planned here; outreach, ad spend and launch publishing have not occurred.
