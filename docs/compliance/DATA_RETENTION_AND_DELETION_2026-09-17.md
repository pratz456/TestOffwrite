# WriteOff Data Retention and Deletion Schedule

Date: 2026-09-17. Version: 1.0. Owner: Qualified Individual (WISP §2) with counsel. Implements 16 CFR 314.4(c)(6) (secure disposal no later than two years after last use unless a business need or legal requirement applies) and describes what the code does today. Nothing here is a guarantee to users beyond what `lib/firebase/delete-user-data.ts` and the vendor terms actually provide.

Principles: the user is the record keeper for their own tax substantiation; WriteOff keeps user data only while the account exists (plus backup windows) and keeps a small set of operational records afterward; deletion is all-or-nothing and refuses to finish when a step fails, so that no account is left half-erased.

## 1. Retention schedule by data class

| Class | Contents | Retained while | Disposal | Basis and notes |
|---|---|---|---|---|
| Tax records (user-controlled) | Bank transactions and categorizations, business-purpose notes, mileage trips, assets and depreciation, W-2/1099/platform imports, gross receipts, deductions, tax organizer answers, quarterly payments | Account active | Deleted with the account (§2) | The user must keep records that support income and deductions: generally 3 years from filing (IRC §6501(a)); 6 years if income is understated by more than 25%; 7 years for worthless-securities or bad-debt deductions; 4 years for employment taxes; asset records until the limitations period expires for the year of disposition (Pub 583). Travel, vehicle and gift substantiation must satisfy §274(d) elements (Pub 463). WriteOff should tell users to export before deleting and to keep the export at least 7 years |
| Receipts | Images in Cloud Storage `receipts/{uid}/…`, OCR text and metadata in Firestore `receipts` | Account active | Prefix delete of `receipts/{uid}/` and collection delete at account deletion | Documentary evidence is required for lodging and any expense of $75 or more (Pub 463 ch. 5); users should export receipt images before deletion. No dedicated user-facing single-receipt delete route was found in `app/api/receipts` (unverified whether the UI offers one) |
| Bank access tokens | `plaid_connections/{itemId}.encryptedAccessToken` (AES-256-GCM) | Until the user disconnects the bank or deletes the account | `disconnectPlaidItem` calls Plaid `/item/remove`, then clears the token and marks the connection `disconnected`; account deletion repeats this for every connection | Connections created under a previous Plaid client id or environment cannot be revoked by the current credentials; they stay encrypted with status `revocation_required` and block deletion until support revokes them manually (`docs/SUPPORT_RUNBOOK_2026-09-17.md`) |
| Bank transaction data | `user_profiles/{uid}/accounts/*/transactions/*`, `transactions` | Account active | Deleted with the account | Disconnecting a bank stops sync and removes the token but keeps already-imported transactions (`deletedCounts` is always 0 in `delete-item.ts`) so the user's records remain usable |
| AI analysis outputs | `deduction_score` and `ai_analysis` on transactions; `analysis_jobs`, `analysis_tasks`, `analysis_status`; `learning_patterns/{uid}`; `user_corrections` | Account active | Deleted with the account | OpenAI receives prompts with `store: false`; OpenAI keeps abuse-monitoring logs up to 30 days and does not train on API data (OpenAI policy) |
| Consent records | `user_profiles.consents` (version `2026-09-17`, source, accepted_at, booleans) | Account active | Deleted with the profile tree | After deletion WriteOff has no proof that consent was given. Recommendation (counsel): keep a minimal consent receipt (UID hash, version, timestamp) for 3 years after deletion |
| Support access audit | `support_audit` entries: admin UID, target UID, timestamp | Indefinitely (no purge in code) | None today | Proposed: retain 3 years, then purge by Firestore TTL policy; needed to demonstrate §314.4(c)(8) monitoring |
| Support requests to a CPA | `cpa_questions` documents (merchant, amount, date, category, question, user email); copy emailed via Resend to the operator mailbox | Indefinitely | Not removed by account deletion (WISP gap G9) | Add `cpa_questions` to the owned-collection list and purge mailbox copies on a schedule |
| Deletion marker | `account_deletions/{uid}`: `deletionRequested` flag and in-flight bank/billing operation leases | Permanently | Never deleted (support runbook forbids it) | Prevents already-issued tokens from re-creating bank or billing access after the profile is erased. Contains the UID and lease ids only |
| Rate-limit counters | `rate_limits` documents keyed by hashed UID or IP | Indefinitely (no expiry logic) | None today | Proposed: Firestore TTL of 24 hours after window end |
| Webhook replay markers | `processed_webhooks` | Indefinitely unless `user_id` is set | Documents carrying the user's id are deleted with the account | Markers without `user_id` remain |
| Billing records | Stripe customer id and subscription status on `user_profiles`; full records at Stripe | Account active (WriteOff); Stripe's own retention | `cancelUserStripeSubscriptions` cancels subscriptions and deletes the Stripe customer | Stripe retains payment records to meet its legal obligations after customer deletion (Stripe Privacy Policy; specific period unverified) |
| Authentication records | Firebase Auth user (email, password hash, provider link, custom claims) | Account active | `adminAuth.deleteUser(uid)` at the end of deletion | Sign-in metadata disappears with the user. Google Cloud Admin Activity audit logs are kept 400 days (`_Required` bucket) |
| Operational logs | Cloud Logging entries from `console.*` and `lib/error-logger.ts` (may include `userId`, endpoint, error text) | 30 days (`_Default` bucket) | Automatic expiry | Not purged on account deletion; increase or decrease retention only by changing the bucket setting (not in this repository) |
| Exports | JSON archive returned to the user by `/api/user/export`; nothing stored server-side | Not retained by WriteOff | n/a | Rate limited to one export per hour; receipt images are linked, not embedded, and require sign-in |
| Google Analytics events (only if `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set) | Page and event data held by Google | Google Analytics retention setting (operator-configured; unverified) | Configure in the GA property | Must never include tax return information (see §7216 review) |

Inactive accounts: no code deletes or notifies accounts that have not been used for two years (WISP gap G10). Until an inactivity policy exists, §314.4(c)(6) is met only by user-initiated deletion.

## 2. What `deleteUserData(uid)` actually does (in order)

Source: `lib/firebase/delete-user-data.ts`, called from `DELETE /api/user/delete` (authenticated, rate limited to 10 attempts per hour per user) by the Data Rights section of `components/settings-screen.tsx`.

1. Validates the UID (length, path-safe characters) so it can be used as a document id and a Storage prefix.
2. Writes `account_deletions/{uid}.deletionRequested = true` in a transaction. Bank-link and checkout operations take leases on this document, so the marker blocks new bank or billing operations from this point.
3. Recovers pending Plaid link sessions (`recoverPendingPlaidLinks`). Failure: `BANK_LINK_RECOVERY_REQUIRED`, retryable.
4. Refuses to continue if any `linkOperations` or `billingOperations` lease is still open: `ACCOUNT_OPERATION_PENDING` (409, retryable).
5. Lists Plaid connections. If any connection is not `disconnected` and was created under a different Plaid client id or environment, or is not `active`, deletion stops with `LEGACY_BANK_REVOCATION_REQUIRED` (409, not retryable); the account, profile and encrypted token are kept for manual revocation.
6. Calls `disconnectPlaidItem` for each connection (Plaid `/item/remove`, token removed, status `disconnected`). Failure: `BANK_REVOCATION_FAILED`, retryable. Re-checks that no connection still holds a token.
7. Cancels Stripe subscriptions and deletes the Stripe customer. Failure: `BILLING_CLEANUP_FAILED`, retryable.
8. Deletes every Storage object under `receipts/{uid}/` (trailing slash prevents prefix collisions). Failure: `RECEIPT_CLEANUP_FAILED`, retryable.
9. Deletes, in batches of 500, every document the user owns in: `categories`, `rules`, `budgets`, `exports`, `audit_logs`, `analysis_jobs`, `analysis_tasks`, `analysis_status`, `transactions`, `receipts`, `plaid_connections`, `processed_webhooks`, `gross_receipts`, `income_1099`, `income_reconciliations`, `w2_income`, `tax_deductions`, `tax_organizers`, `user_corrections` (matching `userId`, `user_id` or `uid`). A document whose owner field names a different user aborts with `ACCOUNT_OWNERSHIP_CONFLICT` (409).
10. Deletes `learning_patterns/{uid}`, `filing_security_metadata/{uid}`, `tax_filing_connections/{uid}`.
11. Recursively deletes `user_profiles/{uid}` including `accounts`, nested `transactions`, `mileage_trips`, `settings`, `assets`, `quarterly_payments`, `meta`, and the consent record.
12. Deletes the Firebase Auth user (ignores `auth/user-not-found`).

Any unexpected error returns `ACCOUNT_CLEANUP_FAILED` (retryable). Because steps 1–8 run before any Firestore data is removed, a failed attempt leaves the account intact and still usable for a retry.

### 2.1 Retained after a successful deletion

- `account_deletions/{uid}` (by design), `support_audit` entries about the user, `rate_limits` counters, `processed_webhooks` without a `user_id`, `cpa_questions` documents.
- Cloud Logging entries for up to 30 days; Admin Activity audit logs up to 400 days.
- Vendor copies: Stripe payment records under Stripe's retention; Plaid's records of the removed item under Plaid's End User Privacy Policy; OpenAI abuse-monitoring logs for up to 30 days; the operator mailbox copies of CPA questions.
- Backups (§4).

The public privacy page states "You may request deletion at any time"; that is accurate, and the Data Rights section of Settings calls this endpoint. The page does not yet describe the retained items above (see `docs/compliance/PRIVACY_POLICY_AUDIT_2026-09-17.md`).

## 3. Legal holds

No legal-hold mechanism exists in code: a deletion request proceeds regardless of litigation, subpoena, or a regulator request. Procedure until one is built:

1. Counsel or the Qualified Individual declares a hold naming the UIDs and the reason; the declaration is kept in the operator appendix.
2. Engineering immediately exports the held users' data with the Admin SDK (the same collections `generateUserDataExport` reads, plus `plaid_connections` metadata without tokens, `support_audit`, and receipt objects) to a restricted Cloud Storage bucket with retention lock, and records the export location.
3. Support is told not to run the deletion runbook for those UIDs. Because the self-service endpoint remains live, a user could still delete; the export in step 2 is the preserved copy.
4. Proposed implementation (engineering, not wired): a server-only `legal_holds/{uid}` document that `deleteUserData` checks in step 2 and that returns `ACCOUNT_ON_LEGAL_HOLD` (409, not retryable) with a support contact message.
5. Release: counsel releases the hold in writing; the export bucket's retention lock expires or is removed; the deletion may then run.

## 4. Backups and point-in-time recovery

- Firestore point-in-time recovery, when enabled, keeps one version per minute for 7 days; when disabled (the default) only the last hour is readable. Whether PITR is enabled for `writeoff-23910` is unverified (WISP gap G7). Any PITR window means deleted documents remain recoverable for that window, so a deletion is final only after the window elapses.
- Firestore scheduled backups, if configured, keep snapshots for their configured retention; none is configured in this repository.
- Google's infrastructure backups: Google commits to delete customer data from active and backup systems within about 180 days of a deletion request. Users should be told that deleted data can persist in backups for up to six months.
- Cloud Storage: no object versioning or soft-delete configuration is in this repository (unverified in the console). If bucket soft delete is on, deleted receipts remain restorable for the soft-delete window.
- A restore from PITR or a backup would resurrect data for users who deleted their accounts after the snapshot. After any restore, re-run deletion for every UID in `account_deletions` with `deletionRequested = true` that has no `user_profiles` document in the live database before the restore was applied.

## 5. Disposal standards

Firestore and Storage deletions rely on Google's deletion pipeline (logical deletion, then expiry from backups, with cryptographic erasure for Cloud Storage) rather than on WriteOff-side overwriting. Application-layer ciphertext (Plaid tokens, organizer SSNs and bank account numbers) becomes unreadable if the corresponding key is destroyed, which is the fallback disposal method if a key must be retired without re-encryption (see the incident response plan §4.3). Operator laptops and exports must be full-disk encrypted; exported archives created for legal holds or support must be deleted when the hold or ticket closes.

## 6. Review

Revisit this schedule when a collection is added (the owned-collection list in `delete-user-data.ts` must be updated in the same change), when a vendor changes retention terms, when filing goes live (preparer copy-retention duties under IRC §6107(b) would then apply: counsel), and at least annually.

## Sources

- 16 CFR 314.4(c)(6) via FTC compliance guide: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- IRS Pub 583, Starting a Business and Keeping Records (record retention periods): https://www.irs.gov/publications/p583
- IRS, "How long should I keep records?": https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records
- IRS Pub 463, Travel, Gift, and Car Expenses (§274(d) substantiation, $75 documentary evidence rule): https://www.irs.gov/publications/p463
- Google Cloud, "Data deletion on Google Cloud" (180-day commitment): https://cloud.google.com/docs/security/deletion
- Firestore PITR: https://cloud.google.com/firestore/docs/pitr ; Firestore backups: https://cloud.google.com/firestore/docs/backups
- Cloud Logging retention: https://cloud.google.com/logging/quotas
- OpenAI API data usage and retention: https://platform.openai.com/docs/models/how-we-use-your-data
- Stripe Privacy Policy: https://stripe.com/privacy ; Plaid legal (End User Privacy Policy): https://plaid.com/legal/
- Prior internal research: `docs/research/reporting-state-compliance-2026.md` §5.3

## Facts verified in code

- `lib/firebase/delete-user-data.ts`: `OWNED_COLLECTIONS`, ordered steps, error codes, retained `account_deletions`, recursive profile delete, Auth user delete.
- `app/api/user/delete/route.ts`, `lib/security/rate-limit.ts`: `userDelete` limit 10 per hour; `userExport` 1 per hour.
- `lib/plaid/delete-item.ts`: `itemRemove`, account marked `disconnected`, transactions not deleted.
- `lib/plaid/connections.ts`: encrypted token storage; legacy connection handling.
- `lib/stripe/cancel-subscription.ts`: `subscriptions.cancel`, `customers.del`.
- `lib/stripe/checkout-operations.ts`, `lib/plaid/link-operations.ts`: leases stored on `account_deletions/{uid}`.
- `lib/reports/data-export.ts`: export contents (`TOP_LEVEL`, `PROFILE_CHILDREN`, accounts, transactions, receipts metadata with sign-in links, AI analysis).
- `app/api/cpa-question/route.ts`: `cpa_questions` write and Resend email; not in the owned-collection list.
- `lib/support/access.ts`: `support_audit` writes; no purge.
- `lib/security/rate-limit-store.ts`: no expiry logic.
- `lib/onboarding/consents.ts`: consent record shape and version stored on the profile.
- `lib/error-logger.ts`: console-only logging.
- Absent: legal-hold flag, inactivity purge, TTL policies, backup configuration, single-receipt delete route.
