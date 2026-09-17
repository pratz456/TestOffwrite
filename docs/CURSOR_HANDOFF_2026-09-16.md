# WriteOff — Cursor takeover and production release handoff

Prepared September 16, 2026 Pacific / September 17 UTC. This is a handoff from existing source, commits and recorded evidence, not a new test run or production audit.

## 1. Start here

**Open `/Users/pratz/Documents/ChatGPT/WriteOff/staging` in Cursor. Continue `codex/staging-readiness`.** The sibling `source/` checkout is older and must not be used as the release candidate.

| Item | Current handoff state |
|---|---|
| Canonical repository | `https://github.com/pratz456/TestOffwrite.git` |
| Working branch | `codex/staging-readiness`, pushed to origin |
| App code deployed to staging | `6993d3b` — bank OAuth and safe account deletion |
| Documentation baseline before this handoff | `603a5ed923a56e7d41dacb3f12de807becddd866` |
| Staging | `https://writeoff-production-testing.web.app` |
| Staging Firebase project | `writeoff-production-testing` |
| Staging SSR | `ssrwriteoffproductionte`, `us-central1`, ACTIVE revision `ssrwriteoffproductionte-00034-saf` |
| Staging runtime | Node 22, 1024 MiB; both automatic-analysis workers and updated Firestore rules deployed |
| Last staging Cloud Build | `de0bbdfc-80a1-4037-83fa-3f192a2f6b11`, SUCCESS |
| Production | `https://writeoffapp.com`, Firebase project `writeoff-23910`, SSR `ssrwriteoff23910` |
| Production release state | **Not promoted to the new staging release or replacement Plaid account.** Earlier live login/logo repairs remain separate. |
| Hosting provider | Firebase Hosting + its Next.js SSR backend. Vercel projects were found, but this domain is not currently hosted there. |
| Runtime/toolchain | `.nvmrc` = `22.23.2`; application and both Functions codebases declare Node 22 |
| Latest user instruction | **Stop further testing.** Do not restart broad suites, provider experiments or audit loops simply to take over. |

The last source inspection found a clean staging worktree. This handoff adds documentation only. The commit containing this document can therefore be newer than both the application release and documentation baseline above.

### User decisions to preserve

- Pre-launch priority is a useful core product and onboarding, followed by GTM.
- AI should classify imported transactions automatically; users verify suggestions in swipe review. Existing transactions need catch-up/manual analysis.
- Compact, Apple-style UI; useful summaries first, details on demand, little scrolling on mobile.
- Use only the **new Plaid account** for future integration: Sandbox on staging, approved production credentials on production. Do not put Sandbox on the live domain.
- User is completing the Plaid security questionnaire. Do not fill it out or submit claims for them.
- Legacy Basic stays **$7.99/month**, with extended history; Premium is required for reports and paid exports. Preserve customer price.
- Owner data archive remains available on every plan.
- OpenAI funding was later restored. Earlier instructions to keep AI off were superseded by requests to enable and verify it.
- No claim that all tax law is supported, exports are complete returns, or in-app filing is operational.
- Prior production publishing authorization exists, but the production prerequisites below remain incomplete. The handoff does not authorize fabricated migration evidence or unsafe deployment.

### Read these records in this order

1. This document for the integrated status.
2. [Production cutover](PRODUCTION_CUTOVER_2026-09-16.md).
3. [Plaid replacement](PLAID_ACCOUNT_REPLACEMENT_2026-09-16.md) and [OAuth evidence](PLAID_OAUTH_VALIDATION.md).
4. [Tax coverage matrix](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md).
5. [Export/filing boundaries](EXPORT_FILING_STATUS_2026-09-16.md).

Older milestone reports contain historical statements such as “local only,” “AI unavailable,” “Node 20,” or “workers restricted to staging.” They should not override this handoff: the integrated code is deployed to staging, AI has produced funded results, Node 22 is active there, and worker source supports the exact production project/origin pair. **That does not mean the production deployment happened.**

## 2. Architecture and environment map

- Next.js App Router / React / TypeScript, Firebase Auth, Firestore and Storage.
- Firebase Hosting deploys the full-stack app through an SSR backend. Do not deploy just a static export.
- Plaid supplies banking; Stripe supplies subscriptions; OpenAI supplies AI; Tesseract supplies receipt OCR.
- `functions-analysis/` contains the two Firestore-triggered analysis bridge functions.
- `functions/` contains the scheduled bank sync, now configured to select private current-provider connections.
- `firebase.staging.json` targets staging and the analysis codebase. It does **not** deploy the default scheduled-sync codebase.
- `firebase.json` targets production and includes both `default` and `analysis` Functions codebases, plus Firestore/Storage configuration.
- `.firebaserc` still defaults to **production**. Always specify the intended project and config explicitly.
- Existing `npm run deploy`, `deploy:firebase`, and old convenience/rule scripts do not implement the whole new production migration. Do not treat them as a one-command rollout.

### Existing worktrees

| Path | Purpose / last recorded state |
|---|---|
| `/Users/pratz/Documents/ChatGPT/WriteOff/staging` | Current integrated candidate, branch `codex/staging-readiness` |
| `/Users/pratz/Documents/ChatGPT/WriteOff/source` | Older `codex/prelaunch-readiness`, last observed `60e1ef4` |
| `/private/tmp/writeoff-auth-hotfix` | Earlier isolated production login/logo branch, last observed `1584bd6`; not the new release candidate |
| `/Users/pratz/Documents/ChatGPT/WriteOff/gtm` | Separate GTM working materials and historical send logs, not the application checkout |

### Provider accounts

- GitHub identity previously verified: `pratz456`.
- Stripe account previously verified through authenticated dashboard: **`acct_1STnF2ExP8AN1raw`**.
- Replacement Plaid team: **Pratham Shah**; verified admin `shahpratham99@gmail.com`; public client ID **`6aab263acbddc2000d721272`**. The production preflight pins this ID.
- New Plaid production application was submitted September 16. At the last dashboard observation it was under review, with a security questionnaire outstanding and a provider estimate of 2–3 business days. This is not a promised approval/launch time.
- Existing CLI authentication may be reusable on this machine; Codex browser sessions/tool handles are not guaranteed to transfer to Cursor. Check access without exposing credentials.

## 3. Login, onboarding and receipt fixes

### Authentication

- Fixed live `Firebase: Error (auth/internal-error)` causes: login CSP now permits the required Google script and Firebase auth-helper iframe.
- Initialized ordinary Firebase email/password auth independently from Google popup/redirect helper startup; Google helpers load for Google flows.
- Validated post-login return paths against external/open redirects.
- Repaired session origin handling behind Firebase Hosting, token/session refresh, transient renewal recovery and authenticated reloads.
- Google identity linking requires verified email/provider identity rather than trusting a client email string.
- Repaired verification and password-reset action pages, used/expired-link handling, resend/cooldown and signed-out reset flow.
- Staging Google session/reload and actual approved-inbox verification/reset message delivery were observed. SDK/API checks separately verified password change and old/reused-code rejection. Do not claim an independently completed browser reset-password submission.
- Live bundle/session restoration was verified for the earlier hotfix; these facts do not certify every provider/browser on the later unpromoted candidate.

Entry points: `lib/firebase/{client,auth,auth-context,browser-session,api-auth,auth-errors}.ts[x]`, `app/auth/`, session API routes. Records: [login hotfix](LOGIN_HOTFIX_2026-09-15.md), [auth validation](AUTH_PROVIDER_VALIDATION_2026-09-16.md).

### Onboarding and records

- Simplified work/profile setup with validation, retained progress and retry handling.
- Manual-entry users can reach a useful dashboard without a bank import.
- Corrected calendar-date parsing, amount/refund/income direction and explicit USD entry for new manual/receipt records.
- Bank onboarding accurately handles asynchronous imports and banks with no activity yet.
- Receipt previews, owner-checked private download paths, browser reload behavior and OCR runtime packaging were repaired.
- Replaced the broken logo reference with a bundled asset; earlier live logo fix is separate from the staging redesign.

## 4. UI/UX changes

The application was reorganized around **review → understand totals → prepare records**, with optional detail progressively disclosed.

- Transaction **Summary / Details / Receipt** tabs replace a long stack. Summary keeps merchant, amount, date, suggestion, concise reasoning, unresolved tax state and review action together; full explanation/questions/evidence/sources use a focused dialog.
- Swipe review confirms a saved suggestion, opens correction, or defers. Failed saves retain the card instead of silently discarding it.
- Less repeated explanatory copy and repeated full-height cards across dashboard, transaction detail, tax/filing hub, reports, income and settings screens.
- Persistent draft/unsaved-change handling for edits and assistant input; settings no longer lose edits during unrelated state updates.
- Mobile Home / Transactions / Taxes navigation with grouped secondary destinations; transaction search and status filters lead the list. Filing hub uses Prepare / Review / Export tabs, and the public homepage is shortened to a hero/example, three-step workflow, pricing and collapsed FAQ.
- Organizer distinguishes unanswered from No. Settings groups Profile / Tax / Account. Income/deduction year changes reject stale responses, and failed record deletion keeps the record visible.
- Tax screens distinguish recorded cash movement, reviewed business expenses and bounded estimates.
- Removed unsupported flat tax-saving rates, automatic 100%-deductible claims, guaranteed savings and unsupported CPA-response promises from reviewed surfaces.
- Existing subscribers encountering a locked feature go to **Manage billing**, preventing duplicate subscriptions.
- Readable local transaction dates, including the previously raw review date.

### Exact dashboard whitespace fix

Commit `8991f63` removed `h-full` from `ActionItemsBanner`, `AnalyticsPanel`, `OptimizationCard` and `TopCategoriesCard`. The optional-insights grid uses `items-start`/`min-w-0`, with the optimization content in the left stack. This addressed the screenshot where a short purple action card stretched to the height of its much taller neighbor.

Source entry points: `components/dashboard-screen.tsx`, `components/transaction-detail-screen.tsx`, `components/review-transactions-screen.tsx`, dashboard card components, `components/settings-screen.tsx`, tax organizer/filing/report screens and protected navigation.

Design records: [compact mobile](COMPACT_MOBILE_UX_2026-09-16.md), [workspace](WORKSPACE_UX_2026-09-16.md), [focused workflows](FOCUSED_WORKFLOWS_UX_2026-09-16.md), [simplified review](SIMPLIFIED_REVIEW_UX_2026-09-16.md). Their local-only release paragraphs are historical.

Recorded synthetic layouts at 320×740 and 390×844 fit default transaction/review summaries without page overflow; inspected desktop layouts had no horizontal overflow. Expanded long evidence/forms/lists still scroll. Do not promise every real transaction or accessibility zoom level fits a single screen. Development overlays default off (`NEXT_PUBLIC_SHOW_DEVTOOLS=true` is an explicit opt-in).

## 5. AI: key routing, automatic analysis and review

### One server-side OpenAI configuration

All active OpenAI features use `lib/openai/client.ts` and server-only `OPENAI_API_KEY`. No public/legacy key fallback; official OpenAI endpoint is fixed, ambient SDK organization/project/base-URL variables cannot silently reroute calls, and request-body logging is disabled.

| Feature | Default model |
|---|---|
| Transaction classification and voice parsing | `gpt-4o-mini` |
| Tax assistant and document image extraction | `gpt-4o` |

`OPENAI_MODEL` is an optional server-wide override. Requests specify `store:false`, which does not establish a universal provider-retention guarantee. Analysis records the actual returned model ID.

Earlier `credit_balance_exhausted` failures are superseded by successful funded requests. The live key was compared privately with the intended server key, and later hosted Sandbox imports completed all three analyses using `gpt-4o-mini-2024-07-18`. `/api/ai/status` only reports configuration; it is not proof of provider credit or health.

The working key was already present in the earlier live app. The unified routing and new durable analysis/review behavior are part of the staging candidate; the old production implementation can still skip model calls through merchant/transaction heuristics until promotion.

Receipt OCR remains Tesseract and arithmetic remains deterministic code. `lib/openai/analysis.ts` is an obsolete-semantic legacy module; do not wire it back into active routes.

### Durable transaction pipeline

```text
Owned bank/manual/receipt/statement record
  → posted valid transaction
  → durable Firestore analysis task
  → queueBankTransactionAnalysis / processBankTransactionAnalysis
  → authenticated internal worker
  → OpenAI + server tax policy validation
  → saved suggestion and explanation
  → user confirms category / resolves missing tax facts
  → eligible confirmed contribution enters tax outputs
```

- Pending bank records wait for posting. Posted income/refunds/transfers/credits/zero amounts are also classified; amount sign alone does not prove business income or deductibility.
- Existing transactions have catch-up and manual analysis; legacy results without structured suggestions can be upgraded.
- Deterministic task IDs, leases, bounded retries, revision checks and recovery replace unreliable work continuing after an HTTP response.
- Provider/configuration/funding/invalid-output failures pause visibly instead of uncontrolled retrying.
- Repeated events do not blindly duplicate jobs. Exactly-once external model billing is not guaranteed after a process interruption.
- Financial changes invalidate stale AI suggestions and enqueue a new revision. User bookkeeping category is separate from the bank category.
- Document-statement imports now write canonical owned account/transaction paths with signed direction and queue analysis; they accept supported USD images, not arbitrary statement formats/PDFs. Batches are bounded to 400 records.
- AI access is separate from Premium report/export access.

Paths: `lib/ai/{analyzeTransaction,analysis-jobs,analysis-persistence,transaction-tax-policy}.ts`, `functions-analysis/src/{index,bridge}.ts`, `app/api/internal/analysis-worker/route.ts`, `app/api/ai/analyze-transaction/route.ts`, `app/api/plaid/auto-analyze/route.ts`.

### User decisions and tax grounding

- Server-owned `ai_suggestion` stores category/kind, conditional tax decision, explanation, missing questions, evidence to retain, source references, tax year, model/policy version and input/profile fingerprints.
- Swipe-right confirmation is authenticated, owner checked, atomic/idempotent and stale-input protected. Clients cannot inject their own AI legal reasoning into confirmation.
- Confirming category can leave `tax_review_required:true` and `is_deductible:null`. Such records do not inflate confirmed tax totals.
- Model source IDs resolve to server-controlled official references; arbitrary model-authored authority URLs are not trusted.
- Reviewed transaction policy covers selected **2025/2026 U.S. federal sole-proprietor/disregarded single-member LLC** situations.
- Unknown business use and complex meals/travel/vehicles/home-office/asset conditions remain questions. No photo or merchant name alone establishes eligibility.
- Unsupported entity/year can still receive bookkeeping classification without an asserted legal deduction.

Paths: `lib/transactions/{ai-review-contract,review,review-presentation,tax-decision}.ts`, `app/api/transactions/[id]/review/route.ts`, `components/ai-tax-explanation.tsx`.

### Text/photo tax assistant

Text/photo questions route to reviewed topic/fact IDs and source-backed conditional guidance. Photos cannot establish ownership, vehicle weight, purchase cost, business use or tax elections. Unsupported conclusions become clarification.

An official Title 26 index contains **2,161 entries**, including repealed/reserved/renumbered entries. It is **not a comprehensive legal review or live retrieval system for every section**. The assistant's 2027 selector is advisory context; the calculator does not support 2027.

Records: [OpenAI routing](OPENAI_KEY_ROUTING_2026-09-16.md), [worker](AI_TRANSACTION_WORKER_2026-09-16.md), [AI-native review](AI_NATIVE_REVIEW_2026-09-16.md), [tax grounding](TRANSACTION_AI_TAX_GROUNDING_2026-09-16.md), [assistant foundation](TAX_ASSISTANT_FOUNDATION.md).

## 6. Tax engine: corrected behavior and boundaries

### Implemented corrections

- Published federal parameter sets for **2024–2026**; unsupported 2027 calculation rejects explicitly.
- Shared federal snapshot aligns annual JSON, planning PDF, dashboard and quarterly summaries.
- Reconciles confirmed business receipts, information returns and supported deductions. Credits/refunds are not automatically business income.
- Provenance-linked duplicates are counted once; unlinked overlapping income sources require reconciliation rather than a guessed total.
- Coordinates W-2 wages with the self-employment Social Security wage base; regular SE tax and Additional Medicare remain distinct.
- Normalizes supported filing status; unsupported/incomplete taxpayer facts block final estimates.
- Adds reviewed age/blind/dependent/MFS standard deduction facts and senior-deduction eligibility/phaseout ordering.
- Adds supported Social Security benefit worksheet and separate withholding handling with annual/PDF parity.
- Quarterly summaries require reviewed facts; the regular-method illustration uses explicit current/prior-year/withholding/AGI inputs.
- Removed invented flat penalties and imitation estimated-tax vouchers; supported-year official IRS document links remain.

Primary source map: `lib/tax-rules/`, `lib/tax-provider/`, `app/api/tax/{compute-1040,form-1040,schedule-se/auto,quarterly-estimates}/route.ts`, `components/tax-organizer-screen.tsx`.

### Known gaps — preserve the review gates

- No complete income matching/reconciliation UI or historical import provenance. Repeated file imports lack whole-file idempotency.
- Taxpayer-scope intake is not fully enforced throughout the product.
- Complex dependents/EITC/ACTC, investment/retirement characterization, carryovers/losses, complex QBI, AMT, NIIT and new tips/overtime/vehicle-interest deductions are incomplete or unsupported.
- Foreign/nonresident/community-property cases and complex spouse allocations are unsupported.
- Home-office UI lacks all required facts; final Form 8829 output remains blocked.
- Depreciation supports a bounded first-year, nonlisted 5/7-year MACRS half-year subset. Section 179, bonus, vehicles, prior-year assets and other conventions/elections require review.
- Other information-return withholding and some Additional Medicare facts remain incomplete.
- State estimates are simplified and not established as comprehensive current-year state-return calculations.
- No full annualized quarterly method, Form 2210, disaster-relief or payment-date allocation support.
- Some 2026 planning layouts explicitly reference published 2025 forms pending finalized-form review.

**Do not remove 422/review-required responses by substituting zero, guessing business use or making the model decide missing legal facts.** This is bounded planning and preparer support, not a complete autonomous tax-return engine.

Detailed scope: [coverage matrix](TAX_COVERAGE_REFERENCE_MATRIX_2026-09-15.md), [engine review](TAX_ENGINE_REVIEW_2026-09-15.md), personal-deduction, Social Security and quarterly validation records.

## 7. Exports and filing

### Delivered exports

| Output | Delivered scope |
|---|---|
| Transaction CSV | Signed amounts, currency, dates, review/pending state, business-use data, notes; spreadsheet formula escaping |
| Owner archive | All-plan access; manifest/CSV/README plus owned profile/account/transaction, income/W-2/1099, organizer/deduction, asset, mileage/payment and receipt metadata datasets |
| Schedule C PDF/CSV | Reconciled receipts and confirmed contributions, signed refunds, shared meal rounding, full appendices; PDF includes business/receipt sections absent from contribution CSV |
| Schedule SE worksheet | Current reconciled income/expense/depreciation and recorded W-2 wages rather than stale cached totals |
| Form 1040 planning PDF | Shared federal snapshot and scope/identity notes; no fake IRS branding, signature, refund or filing claims |
| Reports | Recorded cash flow and bounded reviewed summaries; unsupported tax-saving aliases removed/null |

- Reads are complete and owner scoped; failures return errors rather than silently successful empty exports.
- Sensitive credentials, provider identifiers, SSN ciphertexts, routing/account details and signing PINs are excluded as appropriate; stable export references replace internal identifiers.
- Invalid dates, ambiguous/mixed-use/currency inputs and logical duplicates can block a selected-year tax report for review.
- Receipt **bytes are not bundled**. Private owner-authenticated receipt URLs are not accountant-sharing links.
- No TXF, comprehensive state return, official complete fileable return or e-file authorization.
- A small Schedule C example had a cosmetic trailing-word extra page; not claimed resolved.
- Staging export owner queries required a collection-group index repair. **Hosting-only deploy does not install production indexes.**

Paths: `lib/reports/`, `lib/schedule-c/`, `app/api/user/export/route.ts`, `app/api/transactions/export-csv/route.ts`, `app/api/reports/`, `app/api/tax/schedule-c/export/route.ts`.

### Embedded filing — separate project, keep disabled

A gated **Column Tax Sandbox adapter** exists in `lib/tax-filing/`, `app/api/tax/filing/route.ts` and `components/embedded-filing-card.tsx`.

- It is disabled by default and rejects production/ordinary taxpayer use.
- No partner acceptance, working provider credentials, actual provider QA, production filing or taxpayer submission occurred.
- Controlled Sandbox path requires consent, entitlement and fresh server-owned login/MFA security metadata; it sends minimal identity/security metadata and **no financial prefill**.
- Short-lived launch URLs are not persisted; closing the UI is not submission/acceptance.
- Old local PIN collection and client-writable filed/accepted status were disabled.
- Need partner/commercial onboarding, verified year/form/state scope, security/consent design, first-initialization prefill strategy, signed idempotent webhook handling and actual provider validation before enabling.

Set **`COLUMN_TAX_MODE=disabled`** for this production rollout. A launch of expense organization does not depend on turning on filing.

Records: [CPA exports](CPA_EXPORTS_2026-09-16.md), [export validation](TAX_EXPORT_VALIDATION_2026-09-16.md), [filing status](EXPORT_FILING_STATUS_2026-09-16.md), [filing research](EMBEDDED_FILING_RESEARCH_2026-09-16.md).

## 8. Stripe plans and subscription behavior

| Plan/state | History request | Reports / paid exports |
|---|---|---|
| Free / expired | Up to 90 days for new bank imports | Locked; owner archive still available |
| Active trial | Up to 730 days | Eligible while trial remains valid |
| Legacy Basic, $7.99/month | Up to 730 days | Locked; Premium required |
| Premium, $14.99/month or $150/year | Up to 730 days | Unlocked while entitlement is valid |

These are requested history windows, subject to provider availability, not guaranteed history. Downgrades do not delete previously saved records.

- Server-persisted entitlement controls UI and API access; clients cannot unlock by submitting plan flags.
- Basic is distinct, not accidentally treated as Premium.
- Existing subscriptions route to billing management and prevent duplicate Checkout.
- Cancel-at-period-end preserves eligible access until expiry; payment-required/immediately canceled states remove paid access. Cancellation does not restart a trial.
- Card and ACH Checkout supported. New subscriptions unlock only after a paid invoice; pending/failed ACH settlement stays locked.
- Signed webhook handling reconciles provider state and handles retry/order issues.
- Authenticated test-mode monthly/annual purchases, declines, portal, duplicate prevention, cancel/reactivate, Basic gates and ACH settlement cases were already exercised. Do not rerun them just for takeover.
- Live ACH dashboard enablement was separately recorded; this does not mean the new application billing code is deployed to production.

Paths: `lib/subscriptions/{entitlements,history-window}.ts`, `lib/stripe/{subscription-sync,checkout-operations,cancel-subscription}.ts`, `app/api/stripe/`, `app/api/subscriptions/verify-stripe/route.ts`, `app/stripe/success/page.tsx`.

Records: [billing QA](billing-qa-2026-09-16.md), [Basic policy](LEGACY_BASIC_PLAN_2026-09-16.md), [ACH](STRIPE_BANK_PAYMENTS_2026-09-16.md).

## 9. Plaid replacement and migration

### Implemented

- Explicit `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`; no old `functions.config().plaid` fallback or silent Sandbox default.
- Server-only `plaid_connections/{itemId}` with AES-256-GCM encrypted access tokens and UID/Item binding. Dedicated stable `PLAID_TOKEN_ENCRYPTION_KEY` must survive restarts/releases.
- Per-bank cursors, leases, ownership checks, retry-safe import persistence and pagination mutation handling.
- Legacy profile/account token fields migrate privately before client reads. Foreign/old-provider tokens are never sent using new-provider credentials.
- Incremental updates preserve user decisions; removed records remain recorded but excluded from filing contributions, and restored records are reanalyzed appropriately.
- ES256 Plaid signature/hash/age verification and success-only webhook receipt marking; exact-Item dispatch.
- Same-provider login repair uses update mode and a fresh healthy `item/get` response before clearing repair state.
- Per-bank sync/repair/disconnect, keeping other banks and historical records intact.
- Server-owned bankConnected projection prevents forged client connection state.
- OAuth uses the registered callback and original Link token, bound to tab/user/origin and expiring after 30 minutes. It never stores bank access tokens in sessionStorage.
- Both callback URLs registered: `https://writeoffapp.com/plaid/oauth` and `https://writeoff-production-testing.web.app/plaid/oauth`.
- New provider consent wording describes business accounting/tax preparation and financial management.

### Already exercised on staging

New-account authentic Sandbox Link/import; exactly three synthetic records; three completed OpenAI analyses with IRS references; genuine signed callback; duplicate-free incremental sync; empty second bank; actual login repair; isolated per-bank disconnect.

### Not yet established

- Successful OAuth institution popup/redirect round-trip: Link reached the institution handoff, but the available browser did not expose a popup or callback return. Safely canceled. Do not label this a passed OAuth import.
- New-account production approval/credentials or a real production bank connection.
- Automatic transfer of old-provider Items. Items/tokens belong to their originating account/environment and cannot simply be reused.

### Cleanup completed

Unused **staging** `createLinkToken` and `ssrwriteoff23910` services were retired after reference/traffic inspection; old staging Plaid secret versions were disabled and private recovery material retained. Old Plaid key entries were removed from the local hotfix environment. **Existing production and historical provider-issued keys have not all been revoked.** Retire them only through the coordinated migration/revocation work.

At shutdown both synthetic test banks were disconnected and their encrypted credentials removed; isolated QA account/history remains. No real customer confirmations changed.

Paths: `lib/plaid/`, `app/api/plaid/`, `app/plaid/oauth/page.tsx`, `components/{plaid-link-screen,banks-detail-screen}.tsx`, `functions/src/index.ts`.

## 10. Security, privacy and deletion

- Private receipt uploads/downloads enforce authenticated ownership, size/signature/type limits, explicit bucket selection and safe response headers; metadata failure cleans up the new object.
- Cross-site cookie mutations are rejected; Firebase Hosting's legitimate proxy origin is recognized without trusting caller-controlled forwarding headers.
- Firestore `affectedKeys()` protects field additions/deletions; clients cannot create trial/subscription privileges or forge bank fields.
- Analysis status/progress is owner scoped; task, bank-token, recovery and deletion-operation stores are server-only.
- PWA caches public static assets only; private API/auth/protected/RSC requests are NetworkOnly. Known legacy sensitive caches are purged on activation.
- This is a focused improvement, not full security certification. Some broader schema limits, upload abuse/scanning and scale-related controls remain follow-up work.

### Account deletion

- Durable private `account_deletions/{uid}` gate blocks new bank-link and Stripe checkout operations while deleting.
- Bank exchange and customer creation are recorded before the provider call; unresolved/ambiguous operations cannot silently expire into a false success.
- Revoke owned banks and confirm Stripe closure before erasing identity/data; failures preserve recovery state and remain actionable.
- Old-provider disconnect keeps encrypted recovery as `revocation_required`; support must establish old-provider revocation. Do not erase the token to make the warning disappear.
- Never revoke a conflicting other-owner Item based on a failed exchange.
- Delete only owned receipt prefix and scoped records; Firebase Auth is last. Durable tombstone remains private.

**Open issue:** final hosted synthetic account-deletion smoke failed at its receipt-upload prerequisite (`SYNTHETIC_RECEIPT_UPLOAD_FAILED`) **before any DELETE-account request**. Root cause is not established. It neither proves deletion failed nor proves hosted deletion works. The user stopped further testing; preserve this as unfinished, without re-running the whole suite.

Paths: `lib/firebase/{delete-user-data,delete-helpers}.ts`, `lib/plaid/{delete-item,link-operations}.ts`, `lib/stripe/{cancel-subscription,checkout-operations}.ts`, `app/api/user/delete/route.ts`, `firestore.rules`, `storage.rules`.

## 11. Existing validation evidence — do not repeat by default

| Evidence | Recorded result / limit |
|---|---|
| Latest integrated application suite | **2,643 passed** |
| Latest opt-in security-rule suite | **14 passed separately** |
| TypeScript | Passed |
| Lint | Zero errors; **887 existing warnings** |
| Node 22 build/runtime | Isolated build/OCR/HTTP checks passed; final hosted staging runtime observed ACTIVE on Node 22 |
| Staging bank/AI integration | Authentic synthetic provider flows described above passed |
| Stripe test integration | Card/ACH/plan/portal/lifecycle cases described above passed |
| Earlier compiled export release | 264 HTTP checks, 11 rule checks, 18 additional export checks; 17 deployed smoke checks and nine deployed export groups |
| Auth | Google session, actual inbox delivery, action SDK/API and reload evidence recorded |
| Genuine OAuth callback | Unverified |
| Hosted full account deletion | Not attempted after receipt-upload prerequisite failure |
| New production rollout | Not performed |

Counts are from distinct milestones and **must not be added together** as a unique coverage total. Mocks, isolated emulators and synthetic provider tests have different scopes. Passing tests do not establish universal tax correctness, every browser/bank or production migration safety.

Local evidence may be temporary: `/tmp/writeoff-production-ready-final-tests.log`, `/tmp/writeoff-production-ready-final-types.log`, `/tmp/writeoff-production-ready-final-lint.log`, `/tmp/writeoff-node22-oauth-release.log`, `/tmp/writeoff-node22-{build,tests,codegen,smoke}.log`. Preserve useful sanitized evidence before OS temp cleanup; avoid publishing raw credentials or financial records.

## 12. Exact production work remaining, in priority order

### A. External Plaid gate — user/provider

1. User finishes security questionnaire; Plaid approves production Transactions access.
2. Obtain the replacement team's production credentials through a secure server secret/configuration flow. Do not paste keys into chat or commit them.
3. Confirm registered production OAuth callback and webhook destination. Sandbox success alone cannot certify production institution availability.

### B. Existing-user migration — Cursor engineering work

Last **read-only aggregate** production inventory:

- 40 profiles.
- **11 profiles with nonempty legacy bank tokens and 11 with nonempty Item IDs.**
- 25 saved account documents.
- Zero new private `plaid_connections` documents.
- Account-specific filtered aggregates could not run due to query prerequisites; no production index mutation was done.

These counts are not verified account correspondence, record quality or absence of duplicates. No tokens/transactions/amounts were exported in that inventory.

Required work:

1. Preserve a private recoverable backup and existing encryption material.
2. Establish exact legacy profile/account mapping and any unusually large (>400-account) migration cases.
3. Define and implement historical-overlap reconciliation. New Plaid IDs can represent old purchases; relink must not double-count expenses or overwrite confirmations. A matching/reconciliation workflow is still needed, not just a flag in a manifest.
4. Arrange migration of legacy public tokens to the encrypted private store and mark old-provider connections for relink; never silently discard tax records.
5. Coordinate app/rules/scheduler rollout. New rules block legacy token-bearing profile reads; old clients do not do the new migration handshake. Rules-first or app-first in isolation can respectively interrupt access or leave private stores exposed. Choose a controlled maintenance window or implement a verified compatibility sequence.
6. Ensure old-provider revocation/recovery can be completed before retiring old secret access. A replacement account cannot revoke old-account Items with its own key.
7. Document actual evidence for legacy migration, historical-overlap reconciliation and old-client compatibility. Do not mark unresolved items complete to satisfy preflight.

Production Firestore rules were not readable by the gcloud identity in the earlier audit (403). Resolve legitimate read access through the authorized Firebase identity; do not assume staging rules are already live.

### C. Production configuration and secrets — Cursor/operator

| Setting/group | Required production value or action |
|---|---|
| `WRITEOFF_ENV`, `NEXT_PUBLIC_APP_ENV` | `production` |
| Firebase public/admin project/app/bucket/auth settings | Actual `writeoff-23910` configuration; project number `930596534802`; correct existing bucket |
| `NEXT_PUBLIC_SITE_URL` | `https://writeoffapp.com` |
| `PLAID_CLIENT_ID` | Replacement public ID `6aab263acbddc2000d721272` |
| `PLAID_ENV`, `PLAID_SECRET` | `production`, approved replacement-account production secret |
| `PLAID_REDIRECT_URI` | `https://writeoffapp.com/plaid/oauth` |
| `PLAID_WEBHOOK_URL` if set | `https://writeoffapp.com/api/plaid/webhook` |
| `PLAID_TOKEN_ENCRYPTION_KEY` | Dedicated stable 64-hex key, separate from SSN key; provision before profile migration |
| `SSN_ENCRYPTION_KEY` | **Preserve the existing production value. Do not rotate casually and strand saved taxpayer identifiers.** |
| `ANALYSIS_WORKER_ORIGIN` | `https://writeoffapp.com` |
| `ANALYSIS_WORKER_SECRET` | At least 32 characters; identical between SSR and bound analysis Functions secret |
| `CLOUD_FUNCTION_SECRET` | At least 32 characters; identical between SSR and default scheduler secret |
| `OPENAI_API_KEY` | Intended funded server-only key; no NEXT_PUBLIC alias |
| Stripe keys/webhook | Correct account's live secret/publishable keys and live signing secret, never test values |
| Stripe prices | Preserve legacy Basic mapping/price; map Premium monthly/yearly and agreeing public aliases; verify ownership/currency/interval/amount |
| `COLUMN_TAX_MODE` | `disabled` |
| Test/emulator/reset switches | Off/absent in production |

Bound Functions secrets require Secret Manager/runtime IAM access; putting matching text in an SSR env file alone does not bind a function secret. Keep keys out of browser bundles/logs/Git.

### D. Prepare an isolated release — do not deploy the staging directory

Use `scripts/prepare-production-release.mjs` after configuration and migration evidence are genuinely ready. It exports a clean exact commit, excludes ignored staging/build artifacts, writes private production env/manifests and nonsecret Functions routing files, and records digests. It does not build, contact providers or deploy.

Example only; replace paths with actual secure files and a new output directory:

```sh
node scripts/prepare-production-release.mjs \
  --source /Users/pratz/Documents/ChatGPT/WriteOff/staging \
  --output /absolute/path/to/new-production-release \
  --env-file /absolute/private/path/production.env \
  --migration-review /absolute/private/path/completed-migration-review.json
```

The review JSON must identify `schemaVersion:1`, project, exact 40-character source commit, reviewer, ISO review time, and completed `legacyProfileMigration`, `historicalOverlapReconciliation`, `oldClientCompatibility`, each with actual evidence. No production review artifact has been fabricated/completed in this task.

Inside the prepared directory, use Node 22 and install/build the app and both Functions packages. The explicit static guard is:

```sh
node scripts/production-preflight.mjs --project writeoff-23910 --config firebase.json
```

It also runs as production Hosting/Functions predeploy. It rejects mixed env files, wrong project/origin/provider, Sandbox/test credentials, missing secrets, price aliases, enabled filing/test switches and missing/changed review manifests. **A pass is static consistency, not provider approval or migration proof.** Do not remove it to make an old deploy command succeed.

### E. Coordinated deployment and operational handover

- Deploy the prepared application, reviewed Firestore rules/indexes and Storage rules as required by the coordinated rollout plan.
- Deploy **both analysis functions and the revised default scheduled-sync function**. Hosting-only deploy is insufficient. The old production scheduler still uses the prior release until replaced.
- Production SSR source requests 1 GiB / 1 CPU / 60-second timeout / concurrency 80 / min 0 / max 2 in `us-central1`. This is bounded launch configuration, not a load/throughput guarantee.
- Record source commit, Hosting release, SSR revision, function revisions and previous compatible rollback configuration. A Hosting-only rollback can be incompatible with migrated data/rules; plan rollback as an app/rules/worker/data compatibility operation.
- Use already-collected evidence. User canceled additional broad tests; do not restart them. When closing an actual unresolved defect or releasing new configuration, keep necessary verification narrowly tied to that change and report any remaining unknowns plainly.
- Resolve/record the genuine OAuth completion gap and receipt-upload/deletion uncertainty before describing those flows as confirmed. Do not silently convert them to passes.
- Establish error/queue/webhook/AI-cost monitoring and a support path for failed provider recovery. No complete load test, universal bank matrix or security certification was completed.

### F. Repair automated promotion before relying on CI

`.github/workflows/deploy.yml` currently triggers on `main`/`master`, while the earlier repo default was `march-branch` and this work lives on `codex/staging-readiness`. It selects Hosting plus changed rules/storage, lacks the new full environment/review preparation, and does not promote both Functions codebases. New preflight intentionally prevents an unprepared deployment.

Choose the intended release branch deliberately, provision secure configuration and reviewed migration artifacts, and update the workflow around the isolated-release process. Do not blindly merge to a deployment-triggering branch expecting a complete safe rollout.

## 13. Local preview and access handover

### Isolated demo

From the staging checkout with Node 22, Java 21 and dependencies installed:

```sh
node scripts/local-demo.mjs
```

It creates a temporary isolated code copy, binds loopback emulators/app, seeds synthetic accounts and opens app port 3000. It refuses occupied ports. Restart to copy subsequent source edits. Ctrl+C stops its processes. It does not let a real production Google account access production data.

Demo accounts are `new@writeoff.example` (onboarding), `demo@writeoff.example` (populated) and `free@writeoff.example` (locked paid features). The fixture-only password is recorded in `LOCAL_PREVIEW_2026-09-16.md`; these identities are not real production users.

Optional funded AI while Firebase/banking/payments remain isolated:

```sh
node scripts/local-demo.mjs --ai-env-file /absolute/private/path/server.env
```

Only OpenAI settings are imported by this option; it enables analysis Functions/Eventarc and can generate billable model requests.

### Real-data local preview

The user's last separate real-data local preview was `http://127.0.0.1:3002/protected?screen=income-tracking`. Do not assume its process is still running, its code automatically tracks staging, or that port 3000's demo is interchangeable. `NEXT_PUBLIC_AUTO_SYNC_ON_VISIT=false` was added to suppress automatic sync in that preview; **it is not a read-only mode**. Explicit save/sync/analyze actions can change real records or incur costs.

The user authorized a small real transaction rerun without altering confirmations. Continue to preserve confirmed decisions; do not bulk reclassify customer records during takeover.

### Private local material (not portable configuration)

- `staging/.env.local`: current staging configuration, private/ignored. Never use it as production env or print it.
- `functions-analysis/.env.writeoff-production-testing`: nonsecret staging worker routing, ignored.
- `/tmp/writeoff-plaid-sandbox-credentials.env`, `/tmp/writeoff-staging-before-plaid.env`, `/tmp/writeoff-staging-legacy-plaid-archive`: private temporary credential/recovery material; do not commit or erase recovery indiscriminately.
- `/tmp/writeoff-plaid-sandbox-qa.cjs` and matching JSON: scoped fixture helper/state, **not a production migration tool**. Do not rerun initialization/reset/provider operations. Synthetic banks have already been disconnected.
- Local Node 22 fallback used: `/Users/pratz/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`. Prefer normal `.nvmrc` tooling; cache paths are temporary.

## 14. GTM handoff and launch claims

This codebase task focused on the product. A separate local GTM workspace exists at `/Users/pratz/Documents/ChatGPT/WriteOff/gtm`; its README records earlier outreach/content activity, including 30 emails, three LinkedIn invitations, one company-page post and zero confirmed bookings at its last update. These are **historical records from that task**, not freshly verified here. Read current send/suppression logs before any future outreach to avoid duplicates; this handoff itself sends no messages and does not authorize new spending.

The GTM website handoff recorded a production GA4 property/measurement-ID mismatch, unverified conversion collection, Search Console setup work and financial-content claim corrections. Do not interpret “no data” as proof of no traffic or blindly replace a tag without establishing ownership.

After product cutover:

1. Pilot with a narrow freelancer/sole-proprietor audience matching supported scope.
2. Measure signup → verified profile → first import/manual record → first useful review → return use → subscription. Keep financial content out of analytics.
3. Present value as AI-assisted bookkeeping, evidence-backed expense review and preparer handoff with scoped federal planning.
4. Do not advertise complete automatic tax filing, universal tax accuracy, 2027 calculator support, all state returns or guaranteed deductions/savings.
5. Treat in-app filing and expanded tax scope as separate milestones. Product expansion should add missing facts/reconciliation flows, not just more model prose.

**Current readiness assessment:** substantial working staging product and provider integration, suitable for focused evaluation. Not yet a completed production migration or a comprehensive tax-filing platform. Resolve the explicit production work above before calling the new release live-ready.

## 15. Commit roadmap

| Commits | Main changes |
|---|---|
| `ad7b371`, `d14516d`, `7b8f189` | Provider/onboarding fixes, sourced photo guidance, federal estimate and privacy/security foundations |
| `ac9223e`, `9194145`, `1584bd6` | Separate live auth CSP/startup and bundled-logo hotfixes |
| `eb6cbd1` through `eabaab8` | Isolated staging, sessions, receipts/OCR, calendar/manual records, dashboard tax snapshot |
| `e15e7c8`, `49cc755` | Email actions/quarterly facts, verified identity and expanded supported deductions |
| `f2ae741` | Repaired preparer exports and disabled/gated filing adapter |
| `d7d33f5`, `531810b` | Isolated local preview and clear unavailable-AI handling |
| `7a6a88a`, `3afd3d1`, `3ebe477` | Durable analysis, grounded swipe review, unified OpenAI credentials and queued imports |
| `f598234`, `0f7e858`, `d734b17`, `74d0ace`, `8991f63` | Compact mobile/workspace/tax UX, draft preservation and dashboard stretch correction |
| `e06d2eb`, `0cc038c` | Basic policy, settled-payment/ACH access, subscriber billing navigation |
| `d000913`, `36f9106`, `3a23912` | New Plaid encrypted multibank flow, restored analysis/pending imports, history/date copy |
| `bf74772` | Node 22 runtime/toolchain |
| `6ebcdc5` | Isolated production preparation, guards and production worker routing |
| `6993d3b` | OAuth return + deletion operation safety; **last deployed staging app code** |
| `603a5ed` | Final release evidence and unresolved production prerequisites |

## 16. Suggested first Cursor instruction

> Continue WriteOff from `/Users/pratz/Documents/ChatGPT/WriteOff/staging`, branch `codex/staging-readiness`. Read `docs/CURSOR_HANDOFF_2026-09-16.md` and `docs/PRODUCTION_CUTOVER_2026-09-16.md` before changing anything. The latest app code is deployed only to staging; do not deploy the old `source/` checkout or staging secrets to production. I have stopped additional broad testing. Use the recorded evidence, preserve existing confirmations/history and Basic pricing, and focus on completing the remaining production migration, configuration and release work. I am handling Plaid's security questionnaire. New-account production approval/keys, 11 legacy bank-profile migration/history reconciliation, coordinated rules/app/scheduler rollout, production secrets and CI promotion are still outstanding. Keep Column Tax disabled and unsupported tax cases gated. Report concrete blockers and completed work without claiming unverified OAuth/deletion flows or complete tax-filing support.
