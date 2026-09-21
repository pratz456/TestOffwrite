# WriteOff Access Control Policy

Date: 2026-09-21. Version: 1.0. Owner: Qualified Individual (WISP §2). Review: at least annually and after any material change; next review 2027-09-21. Companion to `docs/compliance/WISP_2026-09-17.md`. This policy describes controls that exist in the repository at commit 1405212 and in Firebase project `writeoff-23910` unless a paragraph is marked as a gap.

## 1. Purpose

Limit access to production systems and consumer data to the person or service that needs it, and make that limit enforceable in rules and server code rather than by convention.

Production is cloud-hosted on Google Cloud / Firebase. WriteOff has no on-premise server room and no corporate server network.

## 2. Roles

| Role | Who | What they can reach |
|---|---|---|
| Consumer | The Firebase Auth user for that account | Their own profile, transactions, receipts, and tax records. They cannot read another user's data, write server-owned fields (subscription, consent), or read bank access tokens. |
| Support administrator | A uid on the `SUPPORT_ADMIN_UIDS` allowlist that also carries the Firebase custom claim `admin: true`. Both are required. | Redacted account diagnostics only. Tokens, secrets, SSNs, amounts, passwords, and ciphertext are stripped before display. Every lookup is written to `support_audit`. Capped at 60 lookups per 10 minutes. |
| Production operator | A human principal on the Google Cloud project. Verified 2026-09-21: three human principals (one Owner, two Editors) and six service accounts. | Google Cloud and Firebase consoles, in the scope of the IAM role granted. |
| Service account | The six Google-managed and app service accounts on the project | Only the APIs their roles allow. Application secrets are environment values, not Firestore documents. |
| Release automation | GitHub Actions `workflow_dispatch` on `.github/workflows/deploy.yml` | Deploys one named commit after a person types `deploy:writeoff-23910:<release_commit>`. The release script refuses a dirty tree and refuses any Node major other than 22. |

There is no shared login. Each consumer has a unique Firebase uid. Each operator uses their own Google account.

## 3. How access is decided

Authorization is role-based.

- Consumers are scoped by `request.auth.uid` in `firestore.rules` and `storage.rules`. A transaction update from the client may change only the user-editable fields listed in the rules.
- `plaid_connections`, `account_deletions`, `rate_limits`, and `support_audit` deny all client reads and writes. The Admin SDK is the only writer.
- Receipt objects live at `receipts/{uid}/…`. Storage rules allow that uid only, and only jpeg, png, gif, webp, or pdf files up to 10 MB. Every other Storage path is denied.
- Every API route resolves the caller with `getAuthenticatedUser`, which checks a Firebase ID token or the `__session` cookie with revocation (`checkRevoked = true`). Email/password accounts must have a verified email before API access.
- Sign-in is email and password, or Google sign-in. The session cookie lasts 14 days, is httpOnly, Secure, and SameSite=Lax. Logout clears it.
- Support access is a separate role from project IAM. A project Editor cannot use the support tool unless they are also allowlisted and carry `admin: true`.

## 4. Granting and removing access

Consumers create their own accounts. No operator approves a consumer login.

A support administrator is added by putting their uid in `SUPPORT_ADMIN_UIDS` and setting the `admin` custom claim. Removing either one removes the access. The change ships through the normal release process.

A production operator is added or removed by the project Owner in Google Cloud IAM. Verified gap: the two Editor grants are broader than the jobs those people perform, and there is no written quarterly access review (WISP G5). Until that review exists, access changes are individual IAM edits, not a periodic recertification.

Deploy access is the ability to run the manual production workflow and to read the production environment secret. It is not granted by merging a pull request.

Revocation that the application performs itself: logout, revocation checks on each API call, and account deletion (`adminAuth.deleteUser` after bank and billing access are removed).

## 5. What this policy does not include

These are not controls WriteOff claims.

- Consumer multi-factor authentication. The app does not enroll a second factor. Bank sign-in inside Plaid Link is the bank's own authentication, not WriteOff MFA.
- Single sign-on, endpoint management, or a VPN. Operators sign in to Google and GitHub as themselves. Laptops are not centrally managed.
- A completed periodic access review. The requirement to do one is stated here; the first review has not been recorded.
- Phishing-resistant or any other multi-factor requirement enforced by WriteOff on operator consoles. Whether Google or GitHub two-step verification is turned on for a given operator account is an account setting outside this application, and it is not treated as an application control.

## 6. Logging

Support lookups are logged to `support_audit`. Google Cloud Admin Activity logs record administrative changes to the project and are retained on Google's `_Required` bucket. Firestore Data Access audit logs are not enabled (WISP G6). Application errors go to Cloud Logging.

## 7. Review

The Qualified Individual reviews this policy at least annually and after a new role, a new production system, or an access incident. The open items are WISP G5 (access review, Editor scope, training records) and G6 (Data Access logs).
