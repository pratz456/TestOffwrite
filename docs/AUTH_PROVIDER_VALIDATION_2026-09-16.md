# Staging identity and AI provider checks

Target: `writeoff-production-testing` only. Production `writeoff-23910` is separate.

## Google sign-in configuration

Google was not configured in the testing project. Firebase CLI 15.30.1 provisioned Google sign-in using `firebase.staging-auth.json`; email/password remains enabled. The support email is the existing WriteOff account, and the OAuth brand is **WriteOff Staging**. No anonymous provider or additional application permissions were requested.

Read-back on September 16, 2026 returned an enabled Google provider with a client ID and secret present. A Firebase `accounts:createAuthUri` request returned HTTP 200 and a Google OAuth URL with a client ID/state. The initial checks established provider configuration; the completed login was subsequently verified below.

Google login is now verified in staging. Firebase Admin confirms a Google-linked, email-verified account created and signed in on September 16 at 11:56:13 UTC. The protected onboarding screen loaded and a full browser reload restored the signed-in session. The earlier report missed this completed result because the popup itself was not automation-accessible. No additional OAuth configuration change was necessary. A separate onboarding defect left the read-only email blank after identity hydration; the new profile identity helper retrieves the same signed-in account email and preserves typed answers. Post-deployment UI verification is recorded in the release report.

Deploy this configuration with Firebase CLI 15.30.1 or a compatible newer release and an explicit testing target:

```sh
firebase deploy --only auth --config firebase.staging-auth.json --project writeoff-production-testing
```

[Firebase provider configuration documentation](https://firebase.google.com/docs/auth/configure-providers-cli).

## Verification and password-reset email delivery

The user authorized test emails to the WriteOff Gmail inbox. A distinct staging account using a plus-address was created; existing production/account credentials were not changed. The original verification and reset messages were delivered to Spam. The earlier recipient-based Gmail search missed them; a project-name query located both. Gmail reported similarity to previously flagged spam, while message details showed the expected Firebase sender, a firebaseapp.com signature and TLS. Only the expected verification conversation was marked not spam. One fresh verification email and one fresh reset email were then sent through the actual Web SDK. Both appeared in Inbox. The actual delivered verification link succeeded and Admin confirmed emailVerified=true. The actual delivered reset link opened the correct separate synthetic account and a valid reset form. No password was entered through browser automation. These results establish delivery to the approved mailbox, not guaranteed inbox placement for every recipient.

The Firebase-hosted action handler remains configured. A custom action handler applies to other email modes too, so configuring only verification/reset would leave account-recovery modes incomplete. App-owned verification/reset pages are validated separately. The reset page now validates the action code and resets the password while signed out; it no longer attempts to change the currently signed-in account’s password. Purpose checks, expired/reused links, confirmation, retry and stale-request handling have focused coverage. A real staging API/SDK integration passed 11 checks using the actual new helpers: verification changed emailVerified, reset worked signed out, the old password failed, the new password signed in and reused codes failed. Its separate synthetic account was deleted afterward. After deployment, a generated synthetic verification link displayed “Email confirmed,” and reusing it displayed the expired/already-used recovery state. A generated reset link loaded the correct synthetic account, password and confirmation fields; no new credential was entered in the browser. The SDK/API reset checks establish password-change behavior separately from the delivered-link browser check; a completed browser password submission is not claimed.

Credentials and one-time codes must stay outside the repository and reports. Local sanitized evidence: `/tmp/writeoff-staging-google-config-v7.json`, `/tmp/writeoff-staging-google-handshake-v7.json`, `/tmp/writeoff-staging-email-evidence-v7.json`, and `/tmp/writeoff-staging-action-api-v7.json`, and `/tmp/writeoff-staging-auth-delivery-v8.json`. The v8 delivery evidence supersedes the earlier unsuccessful search result.

## AI availability

A minimal staging completion request returned HTTP 429, `credit_balance_exhausted` / `insufficient_quota`, on September 16. The user chose to **keep AI unavailable for now**. No credit purchase was made; further paid response-quality checks are deferred. Existing deterministic tax/recordkeeping tests do not establish AI response accuracy.

Local sanitized evidence: `/tmp/writeoff-staging-ai-status-v7.json`.
