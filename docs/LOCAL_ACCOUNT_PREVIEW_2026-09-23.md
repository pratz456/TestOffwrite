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
