# Platform smoke coverage — September 15, 2026

## Scope and environment

**The whole-platform change batch and the 247-check candidate remain local. These results do not mean those changes are live.** Separate production authentication/hosting hotfixes are tracked by the coordinating task.

This checks the local release candidate. The smoke runner performs no deployments. Production Firebase, banking, payments, OpenAI and email services are not used by the smoke runner; any separately authorized live-hosting work is outside these test results.

- Runtime: Node **20.20.2**, matching the repository's declared Node 20 engine.
- App: isolated copy without `.env` files, real Next.js **production build**, listening only on `127.0.0.1:3100`. The working checkout's development server is not interrupted.
- Firebase: real local Auth (`9099`), Firestore (`8180`) and Storage (`9299`) emulators using `demo-writeoff-security`; synthetic users and records only. Auth users are verified through the emulator Admin endpoint, then signed in for fresh ID tokens.
- HTTP: requests model a TLS reverse proxy with `x-forwarded-proto: https`; they send session cookies directly. These checks do not prove browser persistence of Secure cookies across production hosting/OAuth domains.
- Providers: credentials are cleared by the launcher. Stripe reconciliation, checkout, Plaid bank connections, AI output and delivered email are not exercised against live services.

## Automated HTTP coverage

`scripts/smoke-platform.mjs` discovers app page files and exported API methods, then makes actual HTTP requests against the compiled server. There are **42 page routes** and **126 API method/path combinations** in this snapshot. Dynamic routes use a representative blog article or a non-existent synthetic identifier.

- All 42 tested page routes render or redirect without a server error; response headers are checked on rendered pages. Protected-page shell rendering does not replace signed-in browser interaction testing.
- All 126 tested API method/path combinations reject an anonymous caller before sensitive work, except documented public endpoints such as session creation, logout, contact validation and signed webhooks.
- Twenty additional signed-in initial-data reads cover accounts, transaction pagination/status, categories, income, tax organizers/deductions/locks, Schedule C/SE, settings and Plaid connection state.
- Real Firebase ID-token and server-session-cookie access; forged tokens and cross-site cookie mutations are rejected.
- W-2 save/read/delete and owner isolation; supported-year calculation and unsupported-year rejection.
- Manual income save/read, mileage save/read/delete, home-office settings and asset round trips.
- Recorded quarterly payment survives an estimate change and remains private to its owner.
- Receipt bytes round-trip through local private Storage; another user and an anonymous caller cannot download them.
- Organizer and transaction ownership cannot be supplied or replaced by callers; profile writes cannot grant billing entitlements. Transaction classifications persist through business, personal and unreviewed states, including zero confidence. Receipt attachment and unlinking are verified by readback.
- Manual income/expense signs remain correct in profit-and-loss totals; PDF export returns a PDF.

### Plan checks

The product currently has Free and Premium; monthly and annual Premium have the same feature access. An active trial receives Premium features temporarily.

| Persisted plan state | Reports / CSV export | Saved transactions / mileage |
| --- | --- | --- |
| Free | Locked | Accessible |
| Active trial | Unlocked | Accessible |
| Expired trial | Locked | Accessible |
| Active Premium | Unlocked | Accessible |
| Premium canceled at period end, period still active | Unlocked | Accessible |
| Canceled Premium | Locked | Accessible |
| Past-due Premium | Locked | Accessible |
| Expired paid period | Locked | Accessible |
| Malformed or self-asserted paid status | Locked | Accessible |

Both successful and denied report/export requests reach the actual compiled route handlers. Forged plan flags in request bodies do not unlock reports. Free/trial access-status responses are checked against their persisted entitlements. Paid Stripe synchronization remains outside this HTTP suite because it requires a real or mocked Stripe response; the server feature guards are exercised with synthetic server-owned paid-subscription snapshots.

Bank-history range enforcement is covered separately by mocked-provider unit tests. HTTP smoke checks do not call Plaid or claim to validate a bank import.

## Defects found while testing

The smoke work exposed and drove fixes for:

- A production prerender failure from a shared query-reading component outside Suspense.
- Session cookies being written by login but rejected by routes expecting ID tokens.
- Client Firebase profile helpers used from server API routes.
- Organizer owner-field replacement through caller input.
- Paid feature routes missing server enforcement, plus inconsistent expiry/failure handling.
- Missing authentication becoming HTTP 500 in several Plaid handlers; an import-status failure becoming a misleading idle response.
- Profit-and-loss interpreting the app's income/expense signs in reverse.
- First-time home-office/tax-summary settings returning server errors rather than an empty state.
- Admin-backed transaction APIs accepting owner/amount/AI-field injection, and a legacy create path accepting a second owner alias.
- Receipt unlinking serializing undefined fields into an empty update, leaving the stored attachment unchanged.
- Manual, W-2 and mileage writes accepting invalid numeric/calendar/type values. Valid decimal input and W-2 zeros are preserved.

The input/empty-state regression file contains **41 passing tests**, and transaction-boundary regressions add **36 passing tests**. The existing real Firestore/Storage rules suite also passed **11 tests** under Node 20 during this run. Expected deny-test messages in the emulator log are not unexpected failures.

## Run the smoke suite

Use a separate source copy without `.env`, `.next`, `.git`, `.tax-research` or `node_modules`; link the installed dependencies. Build it under Node 20 with synthetic public Firebase configuration. Start Auth/Firestore/Storage emulators using the repository rules and the demo project above. Do not run archived integration scripts that reference production projects.

```sh
node scripts/smoke-start-server.mjs /absolute/path/to/isolated-built-copy 3100
node scripts/smoke-platform.mjs http://127.0.0.1:3100 all
```

The launcher refuses `.env` files, clears real provider credentials and configures only the local demo Firebase services. The runner refuses non-loopback destinations. JSON results are saved under `/tmp/writeoff-platform-smoke-all.json` by default; `WRITEOFF_SMOKE_REPORT` can choose another output file. Modes `public` and `authenticated` are available for focused reruns.

These are functional and access-control checks, not load testing, independent tax-law certification, or proof that every provider works in production. Unsupported depreciation/home-office situations require review and may intentionally block completed tax totals; a successful plan unlock does not establish calculation eligibility. Before a public launch, staging must still verify real hosting/session behavior, OAuth/email verification, bank linking and sync, payment lifecycle/webhooks, AI responses, storage IAM and mobile device behavior. Outstanding complex tax-engine limitations are recorded in the earlier tax review and prelaunch report.

## Final integrated result

The final integrated Next.js production build passed on Node **20.20.2** with lint/type checks enabled. The final HTTP smoke run at **2026-09-15 20:16:02 UTC** passed **247 of 247 checks**, with **zero failures**:

| Group | Checks |
| --- | ---: |
| Page routes | 42 |
| Anonymous API method/path boundaries | 126 |
| Unknown/blocked routing | 2 |
| Authenticated initial states, workflows and plan matrix | 77 |

The 77 authenticated checks include owner-only decryption of synthetic SSN/bank fields and direct verification that their stored Firestore values are encrypted. They also check nine plan states, correct P&L income/expense signs, actual PDF output, transaction ownership/clear-state persistence, receipt attachment/unlinking, and a deliberate `DEPRECIATION_REVIEW_REQUIRED` response for unsupported Section 179 facts.

The final source copy is `/tmp/writeoff-platform-build.141n0bb0`. Build log: `/tmp/writeoff-platform-build-final.log`. Full per-check results: `/tmp/writeoff-platform-smoke-all.json`. A SHA-256 source manifest is saved in `/tmp/writeoff-platform-source-manifest.json` to distinguish this tested candidate from subsequent edits. A comparison immediately after the final run found no differences in app, component, library, worker, Next configuration or package source files. These local temporary artifacts are not deployment outputs.

The broader Node 20 integration run passed **572 Vitest tests across 28 files**; the separate 11-test emulator suite is skipped by default and passed when explicitly enabled. Full-repository ESLint passed with **zero errors and 990 warnings**. The 77 regression tests added by this smoke work are included in the 572-test total. HTTP checks are additional checks, not hundreds of complete user journeys.

The old `tests/transaction-update.test.ts` remains excluded: it is a placeholder requiring a real transaction and imports a deprecated database API. Its intended persistence coverage is now exercised with real local HTTP/emulator classification writes and readback. Archived provider scripts that require production records, charges or external side effects were not run.
