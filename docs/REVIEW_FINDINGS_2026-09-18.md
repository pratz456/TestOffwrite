# Adversarial review — launch-critical paths (2026-09-18)

Branch `cursor/t4-review-b231`, base `e99620c`. Six fixes, one commit each, each with a regression test that fails on
the base. P0 = data loss / cross-user exposure; P1 = wrong money, identifier leak or defeated operator safeguard;
P2 = consistency, cost or hardening. No P0 found. Line numbers refer to the fixed tree.

## 1. Plaid credential migration (`scripts/production-plaid-credential-migration.mjs`, `lib/plaid/legacy-migration.ts`)

Verified: one transaction per profile; > 400 accounts defers token clears to follow-up transactions and writes the
completion marker last, so a crash mid-apply is resumed by rerunning (`legacy-migration.ts:88-99`). Backup is written
0600, re-read and digest-checked before the first write (`:301-305`); apply rebuilds the plan from live data and refuses
a stale one; key fingerprint, project, emulator and schema are checked; no token reaches plan, result or console.
Ownership mismatch is refused inside the transaction (`legacy-migration.ts:87`).

- **P1 fixed `e917495`** — `privateBackupDirectory` compared the path against `process.cwd()` only (`:62`). Run from
  `scripts/`, `--backup <checkout>/backups` passed and a file of plaintext tokens could land in the repository. The
  checkout holding the script is now always a root. Test: "backups inside the checkout".
- **P2 fixed `e917495`** — two token-bearing profiles naming one `plaid_item_id` were both planned `migrate`; the first
  uid claimed the connection and the second failed at apply with no hint in the reviewed plan. Both are now
  `manual_review` with `itemIdShared: true` (`:124-135`); an id-only profile still migrates. Test: "sends two token-bearing profiles…".
- **P2 open** — `--verify` proves only that no `plaid_token`/`access_token` remains (`:249`); `clean` ignores
  `profilesWithLegacyItemId`/`profilesNotMarked` and never decrypts a connection with the release key. Exercise one
  migrated user's bank read after apply. The backup directory is created (`:64`) before the inside-checkout refusal;
  state loading is N+1 (`:89-110`), fine at launch scale. A runtime ownership mismatch also makes the lazy per-request
  migration throw (`lib/plaid/connections.ts:37`): that user's bank routes answer 503 until resolved; the app still loads.

## 2. Overlap reconciliation (`scripts/production-overlap-reconciliation.mjs`, `lib/transactions/historical-overlap.ts`, `record-scope.ts`)

Verified: decisions listing a candidate as another canonical, a record twice, or duplicate+distinct are refused
(`historical-overlap.ts:309-332`); a superseded canonical, pending/removed records, owner or scope mismatch and a changed
date/amount/merchant/currency key are refused (`:261-278`). Each ≤ 400-write transaction re-reads and re-plans every
pair; a refusal throws and aborts its chunk; the digest excludes `alreadyApplied`, so the printed confirmation resumes an
interrupted apply. Evidence holds decision ids and paths only; amounts/merchants exist only in the 0600 backup.

- **P1 fixed `be1d39c`** — `getTransactionsServer`/`getPaginatedTransactionsServer` with `fields:` projected away
  `superseded_by`, so `isSupersededRecord` was false on every projected read and relinked duplicates re-entered
  tax-savings, monthly-deductions and tax-assistant totals. Record-scope fields now ride every projection
  (`lib/firebase/transactions-server.ts:244`). Test: "still drops superseded duplicates…".
- **P1 fixed `bec6e3d`** — `assertPrivateOutputPath` had the same cwd-only anchor as area 1 (`:202`); backup and
  evidence paths are now also checked against the checkout. Test: "refuses a backup or evidence path inside the checkout…".
- Reader sweep (aggregate, exports, audit packet, business income, taxpayer context, analysis jobs, notifications,
  dashboards, client hooks, paginated server): after the fix every aggregation path filters through `record-scope`. The
  only unfiltered readers are single-row or write paths: `app/api/transactions/[id]/route.ts`, `app/api/ai/analyze-transaction/route.ts:59`
  (a superseded row analysed by id costs one model call, no totals impact), `reset-unreviewed-classifications/route.ts:80`, account deletion.

## 3. Bulk confirm (`app/api/transactions/bulk-confirm/route.ts`, `lib/transactions/bulk-confirm.ts`)

Verified: same-origin → auth → body → rate limit; rows come only from the caller's `user_profiles/{uid}` subtree plus
the root collection filtered by owner field, and `ownedBy` re-checks both owner spellings (`:60-62`), so `merchantKey`
alone selects nothing; pending, bank-removed, superseded and reviewed rows are excluded (`:66-70`); `category` must
resolve through `reviewCategory`, `_REVIEW_REQUIRED` is rejected (`:105-109`) and `taxDecisionUpdate` runs per row like
the single route; batches of 400 < 500; learning correction keyed by the caller's uid; response has counts and own ids.
P2 open: the JSON body is parsed before the rate limit (`route.ts:25-27`, zod-bounded to 500 chars) and `loadCandidates`
reads every account's whole subcollection with a 20-field projection (`:86-92`), O(all rows) per call.

## 4. Tax organizer identifiers (`lib/tax-organizer/identifiers.ts`, `organizer-server.ts`, `app/api/tax/organizer/route.ts`)

Verified: identifiers are validated to digit-only shapes before encryption (`:24-28`), so an `a:b:c` plaintext can
never be stored and `isEncrypted` (`lib/security/utils.ts:156`) cannot misfire; echoed ciphertext is kept only when
identical to the stored value, anything else must re-validate as digits (`:115-118`), so no double encryption; masks
return last four only, the IP PIN is never printed; free-text redaction uses the shared redactor (amounts/dates kept).

- **P2 open** — `iv:tag:ciphertext` carries no key id; rotating `ENCRYPTION_KEY` makes `decryptSensitive` throw and the
  organizer GET answers 503 for every user (`route.ts:32`) until a re-encryption migration runs with the old key.
  Legacy plaintext is re-encrypted on read as-is (`identifiers.ts:86`) without normalization (preserved, not corrected).

## 5. Document import (`app/api/tax/import-document/route.ts`, `lib/ocr/document-text.ts`, `lib/security/identifier-redaction.ts`)

Verified: auth → rate limit → bounded multipart read → size → MIME allow-list → magic bytes → OCR → redaction → text
model; the whole image leaves only with the request flag AND the signed §7216 consent on file (`:414-419`); PDFs are
refused (415). Tesseract: one shared worker, timeout, terminate-and-discard on failure, timer cleared in `finally`.
Probed OK: SSN with spaces/dots/unicode dashes, ITIN, `EIN:12-3456789`, `$123,456,789.00`, `123456789.00`, ZIP+4
`78701-1234`, phone `555-123-4567`, 10-digit accounts.

- **P1 fixed `7cb1345`** — a bare nine-digit run directly after `,` or `.` was not redacted (`SSN.123456789`, the
  common OCR reading of a colon). The lookbehind now rejects only the tail of a longer number
  (`identifier-redaction.ts:36`). Tests: "after an OCR-misread colon", decimal/version controls.
- **P2 open** — one shared worker serializes OCR across concurrent uploads and the timeout includes queue time, so a
  burst yields `ocr_unavailable` fallbacks (consent prompts) rather than slow success (`document-text.ts:25-45`).

## 6. Grounding policy (`lib/ai/transaction-tax-policy.ts`, `lib/ai/analyzeTransaction.ts`)

Verified: no path keeps `is_deductible: true` with `status: 'ok'` without a saved sentence-length purpose; the
personal-likely, mixed-use, off-category, asset and travel gates read the saved transaction, not model fields, so
category/kind choice cannot skip them (78 policy + 78 red-team tests). Fixes below: one false positive, one leak.

- **P1 fixed `7a0d0a7`** — `EXPLICIT_PERSONAL_NOTE` (`:268`) matched "not for personal use", "zero personal use",
  "vacation rental business" and "vacation photography", turning a business purpose into a confident non-deductible
  verdict. Negation lookbehind and business-object lookahead added; "family vacation" still reads as personal.
- **P1 fixed `7cb1345`** — `redactTaxIdentifiers` (`:280`) matched only delimited 3-2-4 / 2-7 shapes and covered five
  hand-listed fields; `travel_destination`, `attendees`, `equipment_details`, `mileage_details` (own `business_purpose`),
  `profile.business_purpose`, `office_location` and `taxpayer_context…last_business_purpose` reached the provider
  unredacted (gap noted in `SUBPROCESSORS_2026-09-17.md:45`). It now delegates to the shared redactor and
  `buildAnalysisContext` (`analyzeTransaction.ts:522`) redacts every string in the payload, so new fields are covered by
  default; update the compliance docs' wording. Test: "redacts identifier-shaped digits in every free-text context field…".

## 7. Consent gate (`components/onboarding/consent-reacknowledgment.tsx`, `components/protected-layout-client.tsx`)

Verified: skipped for profile-setup accounts and when the profile read failed (`:99`), so no trap; covers every
`/protected/*` path including settings and subscriptions, so no URL bypass; renders `LogoutButton`, so sign-out works.

- **P2 open** — because the gate covers `/protected/subscriptions`, declining the new terms blocks billing and
  cancellation; consider exempting that page (click-to-cancel). Re-acknowledgment of `bank_data`/`ai_review` is
  client-side only: `app/api/ai/*`, `analysis-job` and `plaid/auto-analyze` never call `hasAcknowledgedRequiredConsents`,
  so a user on the previous terms can keep triggering analysis via the API (only `document_import` is enforced server-side).

## 8. Export reader (`lib/reports/export-records.ts`)

- **P1 fixed `dbbf183`** — `nestedSeen` counted a row once per owner query, so a legacy row carrying both `user_id`
  and `userId` counted twice and `count()` equality could skip the walk while an owner-field-less row was missing from
  the export. It now holds distinct document paths per account (`:43`). Test: "does not let a row returned by both owner
  queries stand in…". Every seen row is inside the counted collection (seen ⊆ counted), so with distinct paths equal
  cardinality does imply the same set; the N-vs-N case in the brief cannot arise and no extra count() is needed.

## Residual risks

Organizer key rotation needs a re-encryption migration first (4). `--verify` proves token absence, not decryptability
(1). Server-side consent enforcement for AI routes awaits a product decision (7). Out of scope, same bug class as 1/2:
`scripts/production-migration-inventory.mjs:193` still anchors its private-path check to cwd only.
