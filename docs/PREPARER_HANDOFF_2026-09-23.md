# Receipt-inclusive preparer handoff

## User flow

Filing Hub → Export → **Send your preparer one package** downloads one selected-year ZIP. A trial/Premium entitlement is checked server-side for every package build and link creation; Basic does not unlock it. The existing owner records archive remains a separate portability export.

The ZIP includes sanitized saved records JSON, transaction CSV, existing audit-support JSON/CSV, unresolved transaction questions, receipt-status JSON, a README, and a manifest with byte counts and SHA-256 checksums. Original uploaded receipt files are included where ownership, selected-year transaction association, Storage path, size and file signature can be verified. Original receipts are unredacted and can contain personal information.

Missing, corrupt, external-link-only and legacy embedded receipts are explicitly listed. Their count appears in download response headers, the UI, ZIP filename, README and manifest. This is a records snapshot, not a filed return or completeness certification. Invalid source datasets fail the package rather than dropping a dataset silently.

## Private sharing

Creating a link requires the owner's explicit sharing checkbox and a 1-, 3- or 7-day expiry. The server accepts integer expiries from 1 through 7 days. The link points to a fixed ZIP snapshot; later account changes do not change it. No email or message is sent automatically.

- 256-bit random token; only its domain-separated SHA-256 hash is stored.
- Raw secret appears only in the creation response and URL fragment, never an HTTP URL. The standalone public landing immediately removes the fragment from browser history and passes the token only in a POST body when the recipient clicks Download.
- Standalone HTML has no application layout, analytics, auth SDK, service-worker registration or third-party scripts. A hash-based CSP allows only its own download script. Sensitive responses use no-store, no-referrer and noindex headers.
- Possession grants access only to the fixed ZIP. It grants no account access, edits, extra exports or filing authority.
- Owners can list and revoke links even after their plan expires. Token/expiry/revocation and account deletion are rechecked after reading bytes so revocation during a download blocks the response. Copies downloaded earlier cannot be recalled.
- Snapshot bytes must match their saved size and SHA-256 hash. Storage uses private server-only paths and never generates public Firebase download tokens or signed Storage URLs.

## Bounds and cleanup

Maximum 5 active links per owner, 6 package-build/share requests per hour, and 20 anonymous download attempts per ten minutes per address. Packages allow 5,000 selected-year transactions, 250 linked receipts, 10 MB per receipt, 16 MB combined original receipts and 20 MB total ZIP. Oversized packages fail with an actionable 413 response.

Firestore collections `preparer_handoffs` and `preparer_handoff_owners` and Storage prefix `preparer_handoffs/{uid}/` are server-only. Account deletion calls `deletePreparerHandoffsForUser`, revoking and removing metadata, snapshots and orphan files. Account-deletion state blocks new shares and downloads. Expired links stop downloading immediately. The `analysis` Functions codebase's `cleanupExpiredPreparerHandoffs` job runs hourly and deletes up to 200 expired/revoked private snapshots per run, including a revoked snapshot whose immediate Storage deletion failed. It derives each path from the validated owner and handoff ID, deletes Storage first, then transactionally removes metadata and its owner slot. Storage or Firestore failures retain retryable metadata; the job retries three times and logs only counts. Large backlogs can take multiple runs, so operators should alert on failed executions and repeated `batchFull` runs. Deploy this scheduled function with the release; local code alone does not enable production retention.

## Verification

37 focused tests verify actual ZIP extraction and exact original receipt bytes, complete file inventory, manifest, missing receipt states, unsafe owner/path/URL rejection, malformed and oversized bodies, explicit sharing consent, Premium access, post-expiry-plan revocation, no-store responses, hash-only token persistence, token expiry, concurrent revocation, snapshot tampering, bounded active links and scoped account-deletion cleanup. Runtime browser/emulator verification is tracked separately in the release validation report.

No tax return is automatically filed. No production deployment is implied by this implementation.
