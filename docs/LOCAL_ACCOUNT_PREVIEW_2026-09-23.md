# Real-account local preview

The explicit `local-account-preview` mode lets an owner try the current app against their existing production Firebase account before the coordinated hosting/Functions release. It is a development-only, loopback-bound app, and it is **not read-only**: intentional transaction edits and manual AI reviews are saved to the real account.

## Boundaries

- Explicit `WRITEOFF_LOCAL_ACCOUNT_PREVIEW=true`, matching server/public mode markers, production Firebase project, loopback HTTP site origin, no emulator hosts, disabled automatic bank sync and an explicit account email are required. Invalid configuration fails closed.
- Normal Firebase authentication and revocation checks still run. Protected server APIs additionally require the configured verified email. This is an API restriction, not a separate Firebase authentication tenant.
- Profile reads skip the legacy bank migration and bank-status projection. The preview blocks bank, billing, provider webhook, subscription-reconciliation and account-deletion routes before handlers execute.
- Plan access uses the saved profile without creating a trial, changing entitlements or contacting Stripe. This does not establish a fresh provider subscription status.
- The UI identifies real account data and explains that edits are saved. Existing consent acknowledgments remain required.
- No banking or billing credentials are needed for this preview. Server OpenAI configuration remains private; credentials and account validation evidence are kept outside the repository.

## Validation

198 focused tests passed across six files, including preview configuration, migration non-mutation, request blocking, verified account restriction, saved-plan evaluation and ordinary production behavior. TypeScript passed. Live local HTTP checks returned 403 for bank sync and Stripe checkout. A real owner session restored and displayed its existing transactions; the user completed the acknowledgment screen.

## Limitation

Production automatic-analysis workers still call the deployed production origin. Manual analysis in this preview uses the latest local server code, but the preview alone does not deploy the latest bank-import or profile-refresh workers. Release the application, rules and analysis Functions together through the existing production process to activate those workflows on the live site.

## Real-account walkthrough follow-up

An owner-authorized walkthrough found that legacy imports omitted transaction currency. Following the owner's explicit confirmation of USD amounts, the missing currency fields were backed up privately and restored without changing amounts, dates or user classifications. Manual analysis then completed on three existing transactions. Account identity, record-level evidence and backup files remain outside the repository.

The walkthrough also exposed a purpose-confirmation defect: explanatory AI rationale could be shown as a proposed business fact, and saving a purpose could record a deduction. The shared helper now accepts only dedicated purpose proposals, rejects copied rationale, offers an empty answer field for missing facts, and saves only `business_purpose`. Existing classification and unresolved tax-review state are preserved. The detail and swipe interfaces no longer describe purpose entry as deduction confirmation.

After these changes, the complete suite passed **5,856 tests**, with 45 opt-in checks skipped. The new guard subset passed 198 checks, the purpose/review regression subset passed 216 checks, and TypeScript passed. Subset counts overlap the full suite and must not be added to it.

## Bank-screen preview correction (September 24)

Earlier real-data localhost setups allowed explicit bank actions; this restricted preview does not. The UI now checks the public preview mode before mounting any Plaid hook, OAuth resume effect or analysis monitor. It displays a fixed live bank-management link and a Back action instead of attempting a known-blocked Link-token request. The server-side 403 boundary is unchanged. New production bank connections and history review happen on the live site; saved records become available in the owner preview after refresh.

129 focused preview, OAuth and analysis-progress tests passed, including three new cases for normal, OAuth-resume and analysis-query entry. TypeScript passed. A fresh local browser load displayed the handoff notice without console errors. This UI correction does not enable local bank/billing operations or constitute a new production deployment.

### Real Plaid and Stripe actions from the preview

Bank management, reconnect and Link entry screens now hand off to fixed live WriteOff URLs in a new tab, preserving a reconnect session when supplied. Stripe upgrade, subscription and payment actions similarly open the live plans or Payment settings screen before any local provider call. The user completes bank consent/MFA or any payment change on the live origin with the same account. No credential, authentication token or Stripe session is passed between origins. Account deletion remains disabled in the preview.

Saved transactions already use Firestore listeners. Saved subscription access refreshes when the local app regains focus. Users can also refresh after completing bank-history review. This is a functional handoff from localhost to production provider flows; it does not run production provider callbacks on localhost.

Additional validation: 122 bank/reconnect/preview checks and 127 billing/plan/preview checks passed (overlapping groups, not additive). Combined TypeScript passed. The local billing button opened the fixed live Payment settings URL, and the live portal successfully displayed the existing owner's Stripe subscription and payment-management controls. The live Plaid reconnect reached the unchecked consent step; no new bank access or payment was accepted by the agent. These changes are local only pending owner review.
