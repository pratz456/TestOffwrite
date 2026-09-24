# Production connections and verification: September 24, 2026

## Release identity

- Application source: `37ca4d8e2042a2f5ca6581ade753bd32706e9ac9`, branch `codex/2027-tax-coverage`, repository `pratz456/TestOffwrite`.
- Target: `https://writeoffapp.com`, Firebase project `writeoff-23910`.
- Deployment status: **released and independently verified** at 18:34 UTC. Hosting version `600d6bb0a16476d8`, SSR revision `ssrwriteoff23910-00433-cad`, build `SYh0j7cxMWksGiyPZTS3o`.
- Corrected automatic page reloads during service-worker updates and network recovery. Updates now offer an explicit Refresh action. The final live check preserved bank consent while the actual update prompt appeared, then successfully applied an explicit refresh and reopened the saved review session. Bank consent and institution authentication remain with the owner.
- Vercel is not the active hosting path. Deployment uses the committed prepare/preflight/coordinated-deploy scripts and Node 22.

## Integration behavior

| Connection | Configuration and behavior | Verification boundary |
| --- | --- | --- |
| Firebase | Production Auth, Firestore, Storage, Hosting, SSR, analysis workers and scheduled bank sync. Google/email providers and production domains are configured. | Existing real-account session, profile, dashboard and 257-record transaction list loaded. This pass did not create a new account or send verification/reset emails. |
| OpenAI | One shared server key; transaction analysis uses GPT-4.1-mini, assistant/document paths GPT-4o, voice parsing GPT-4o-mini. Secrets stay server-side. | Candidate-key probes passed. A real live transaction analysis returned 200 in 5.4 seconds and asked for missing business-purpose facts. Deployed source requires a model call before success. This is connectivity/workflow evidence, not certification of every tax result. |
| Plaid | New approved production account, Transactions product, production OAuth return/webhook, encrypted private credentials and requested extended history. | Production Link-token creation passed. New institution login, MFA/OAuth completion, exchange, imported transactions and genuine webhook delivery remain to be observed end to end. |
| Stripe | Live prices, signature-verified webhook, settlement-aware plan access, duplicate-checkout protection and owner-linked billing portal. | Existing live Premium subscription matches saved access and paid invoice. Portal monthly $14.99/yearly $149.99 choices were verified. No new purchase, cancellation or plan change was submitted. A signed unhandled-event probe passed; it is not genuine Stripe delivery. |
| Resend | Existing server key and verified `writeoffapp.com` sender domain. Valid support requests now wait for a provider message ID before reporting success. | Provider configuration and error-handling tests passed. No new production email was sent during this pass. |

Basic keeps its existing price and extended-history access. Paid reports and exports require Premium. Pending asynchronous payment does not grant Premium access or replace a settled existing plan.

## Bank history and recovery

The completed credential migration moved legacy bank secrets to encrypted server-only records. Same-scope before/after verification preserved accounts, transactions and saved tax decisions. No legacy credential is sent to the replacement Plaid account.

Owners with old bank history use `/plaid/reconnect` to connect a replacement Item and review imported history. New records remain private until account mapping and explicit duplicate/distinct/defer decisions. Duplicate replacements are excluded on their first write; existing confirmed records are preserved. Deferred items remain outside tax totals. Activation requires historical retrieval completion and resolved decisions; persistent account/date boundaries protect later backfills and corrections.

See [guided reconnect](PLAID_GUIDED_RECONNECT.md). Deployment does not mean an owner has completed bank authentication or history review.

## Validation

- Exact release source default suite: **6,051 passed**, 234 files; **45 opt-in tests skipped** in five files.
- Separately executed: **19 Firestore/Storage emulator tests** and **59 reconnect security assertions**. No rule change followed those checks.
- TypeScript passed. The deployment itself builds the application and both Functions codebases before release.
- Firebase adapter regression coverage: 13 tests plus five independent lifecycle checks. The version-pinned, integrity-checked package fixes expired-cache reuse, concurrent cold initialization and deletion of apps still serving requests.
- Actual Firebase CLI staging and fresh Node 22 generated-package `npm install` and `npm ci`, with lifecycle scripts disabled, preserve the patched module. Source, packed and installed bytes match. See [adapter maintenance](../vendor/firebase-frameworks/README.md).
- Released source independently matches the live archive, compiled files and Hosting assets. All seven functions are ACTIVE, both schedules enabled, 47 composite indexes READY, rules match and worker secrets are enabled. Only the current revision receives traffic and retains a Hosting tag.
- All 13 public/authentication/signature smoke probes passed after the final deployment at 18:35 UTC. Overlapping authenticated Settings and Subscriptions loads succeeded; no deleted-app errors appeared in the bounded post-release logs. These checks do not substitute for fresh login or complete bank/payment lifecycles.

The PWA correction passed 116 focused tests, including 12 lifecycle tests; generated service-worker and compiled browser output also passed independent checks. Production worker activation is message-triggered only, and automatic registration/online reloads are absent. Already-open older documents require one fresh load to receive these changes.

Private release reviews, backups, provider checks, source/archive hashes and sanitized verification records are retained outside the repository. No keys, customer identifiers or raw financial records are committed.

## Remaining live checks

1. Complete a real bank Link/MFA flow through the verified guided reconnect screen, review account mapping and imports, then verify subsequent sync, automatic AI processing and a provider-delivered webhook.
2. Observe a genuine Stripe checkout/payment and webhook lifecycle for a new purchase when the owner elects to make one. Existing paid subscription and portal verification do not substitute for this.
3. Verify production support-email delivery to the authorized destination and fresh signup/verification/reset delivery when authorized.
4. Verify a new post-release background import/analysis workload. Function readiness and unit tests do not establish that every job has run in production.

Automatic filing remains disabled. Exports/preparer packages are review records, not IRS-fileable returns. Missing tax facts and ambiguous income overlaps continue to block incomplete estimates; 2027 annual figures that are not published remain pending.

## Operations and rollback

SSR `minInstances` stays zero for compatibility with the current Firebase Hosting pinned-revision deployment. A cold start can still add latency. The adapter fix retains authentication checks and the existing session policy.

After any reconnect session activates, ordinary rollback to the old importer is unsafe because that code does not enforce the new historical boundary. Prefer a compatible forward fix. If rollback is unavoidable, quiesce sync/webhook/import/analysis writers, fence every reconnect Item or backport reconnect-aware handling, preserve cursors and all subsequent customer writes, and retain the exact encryption key and recovery data. Do not rerun the completed credential migration or restore an old database snapshot over new records.

## Final deployment verification

Independent verification establishes the released identity above, with fresh source, environment, assets and routing checks plus retained evidence for unchanged rules, workers, indexes and secret configuration. The released archive has all 46 expected environment values and exact private environment bytes; credentials are not reproduced here. The Cloud Build succeeded, and the generated SSR package and uploaded dependency lock/tarball preserve the auth patch. This is not direct inspection of the running container filesystem.

Real account profile, plan and bank-history review session load successfully. The initial refresh interruption was traced to global PWA reload handlers and corrected in this release. A fresh document successfully reached bank consent, preserved that screen while an update waited, and restored the same review after an explicitly chosen Refresh. No browser warnings/errors were observed. No production consent, bank authentication or history activation was performed by the agent; the consent screen is the owner handoff.
