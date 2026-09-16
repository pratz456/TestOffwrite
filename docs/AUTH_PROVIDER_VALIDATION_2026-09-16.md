# Staging identity and AI provider checks

Target: `writeoff-production-testing` only. Production `writeoff-23910` is separate.

## Google sign-in configuration

Google was not configured in the testing project. Firebase CLI 15.30.1 provisioned Google sign-in using `firebase.staging-auth.json`; email/password remains enabled. The support email is the existing WriteOff account, and the OAuth brand is **WriteOff Staging**. No anonymous provider or additional application permissions were requested.

Read-back on September 16, 2026 returned an enabled Google provider with a client ID and secret present. A Firebase `accounts:createAuthUri` request returned HTTP 200 and a Google OAuth URL with a client ID/state. This establishes provider configuration, not a completed user login.

The deployed Continue with Google button launched its sign-in flow, but the in-app browser did not expose the popup as an automation-accessible tab. A user check in an ordinary browser was requested; completion remains unverified until its result is recorded.

Deploy this configuration with Firebase CLI 15.30.1 or a compatible newer release and an explicit testing target:

```sh
firebase deploy --only auth --config firebase.staging-auth.json --project writeoff-production-testing
```

[Firebase provider configuration documentation](https://firebase.google.com/docs/auth/configure-providers-cli).

## Verification and password-reset email delivery

The user authorized test emails to the WriteOff Gmail inbox. A distinct staging account using a plus-address was created; existing production/account credentials were not changed. Firebase accepted one verification email and one password-reset email. The approved inbox and Spam were searched; delivery and link completion are still pending.

The Firebase-hosted action handler remains configured. A custom action handler applies to other email modes too, so configuring only verification/reset would leave account-recovery modes incomplete. App-owned verification/reset pages are validated separately. The reset page now validates the action code and resets the password while signed out; it no longer attempts to change the currently signed-in account’s password. Purpose checks, expired/reused links, confirmation, retry and stale-request handling have focused coverage. A real staging API/SDK integration passed 11 checks using the actual new helpers: verification changed emailVerified, reset worked signed out, the old password failed, the new password signed in and reused codes failed. Its separate synthetic account was deleted afterward. These checks do not prove inbox delivery or a completed browser password reset.

Credentials and one-time codes must stay outside the repository and reports. Local sanitized evidence: `/tmp/writeoff-staging-google-config-v7.json`, `/tmp/writeoff-staging-google-handshake-v7.json`, `/tmp/writeoff-staging-email-evidence-v7.json`, and `/tmp/writeoff-staging-action-api-v7.json`.

## AI availability

A minimal staging completion request returned HTTP 429, `credit_balance_exhausted` / `insufficient_quota`, on September 16. The user chose to **keep AI unavailable for now**. No credit purchase was made; further paid response-quality checks are deferred. Existing deterministic tax/recordkeeping tests do not establish AI response accuracy.

Local sanitized evidence: `/tmp/writeoff-staging-ai-status-v7.json`.
