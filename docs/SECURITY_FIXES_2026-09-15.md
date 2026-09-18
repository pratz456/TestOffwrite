# Receipt, analysis-job and offline-cache fixes

Local implementation only. No production rules or application deployment was performed.

## What changed

- Receipt upload verifies an ID token or Firebase `__session` cookie, rejects cross-site cookie uploads, and checks the authenticated user's transaction before writing anything.
- Uploads accept one non-empty JPG, PNG, GIF, WebP or PDF of at most 10 MiB. The actual multipart body is bounded before parsing; MIME labels and file signatures must agree. These signature checks are not a malware scan.
- New receipt bytes use only an explicitly configured existing Cloud Storage bucket (environment, initialized Admin app or Hosting FIREBASE_CONFIG); missing configuration fails closed without a production fallback. Firestore stores small owner/path metadata and one-segment receipt IDs, avoiding its 1 MiB document limit. If metadata creation fails, the new object is deleted.
- Receipt downloads verify the metadata owner and Storage owner path, bound bytes read, and return private `no-store` responses with `nosniff`, a sandbox CSP and sanitized filenames. PDFs download as attachments. Legacy base64 records and previously saved three-segment receipt URLs remain supported through an owner-checked compatibility route.
- Existing analysis jobs/status documents require server-written ownership in both Firestore rules and the job API. The rules retain subscriptions to not-yet-created analysis jobs only under the caller's exact UID prefix.
- Transaction update rules use `affectedKeys()`, closing the old `changedKeys()` bypass that allowed adding or deleting protected fields. Legitimate note, classification and receipt edits remain permitted.
- Client profile creation cannot supply subscription/trial entitlement fields. Admin trial-manager and Stripe-webhook writes remain supported, as do normal client profile creation and edits.
- Storage rules enforce receipt size and type on both creation and replacement; owner deletion still works.
- The PWA now caches only explicit public static assets. API requests, protected/auth pages, React server-component/data requests, third-party responses and other HTML use `NetworkOnly`. Start-URL and front-end navigation caches are disabled. A custom activation worker purges only known legacy WriteOff API/page/image caches; unrelated and public precaches remain.

## Validation

- 30 mocked receipt-handler tests: authentication, revoked sessions, CSRF boundary, ownership, malformed/oversized uploads, private persistence/downloads, legacy base64/URLs, explicit bucket selection and cleanup after metadata failure.
- 9 analysis-job API tests: both owner-field spellings, misleading ID prefixes, missing owners, not-found polling and invalid paths.
- 19 PWA tests: first-match privacy routing, explicit public caching and targeted activation cleanup.
- 11 real Firestore/Storage emulator tests: owner and other-user access, collection/group queries, job pre-creation, protected-field additions/deletions, profile create/update escalation, server entitlement writes, receipt creation/replacement/deletion, size and content type.
- Real Admin Storage save, private metadata and bounded-range download were also exercised against the demo Storage emulator.
- All emulator data was synthetic, under `demo-writeoff-security`, with services bound to `127.0.0.1`. Emulators were stopped afterward. No production customer records or application secrets were read.
- Isolated production-build verification passed: 187 precache entries contained zero private API/protected/auth URLs; compiled runtime matchers routed private requests to NetworkOnly. The actual imported worker's activation handler removed 14 legacy sensitive caches from synthetic Cache Storage and preserved unrelated/public/precache entries. The built manifest included current, legacy and process receipt routes.

## Repeating the rule tests

Install Java 21 or make an existing Java 21 runtime available to the Firebase CLI. The test suite uses only existing repository dependencies. Create a temporary Firebase configuration pointing at this repository's `firestore.rules` and `storage.rules` and set emulator ports to Firestore `8180` and Storage `9299`, both on `127.0.0.1`.

Run the Firebase CLI with `--project demo-writeoff-security --only firestore,storage --config <temporary-config>`. While the emulators are running, run:

```sh
WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/security-rules.emulator.test.ts
```

Without this explicit environment flag, the emulator suite skips without initializing Firebase SDKs or making network requests. The suite uses fixed loopback endpoints and a fixed demo project, and clears only that demo Firestore database. Stop the emulators after the run.

## Checks before release

1. Repeat the generated-worker inspection for the release build: no `/api`, `/protected` or `/auth` precache URLs, no legacy API/page runtime caches, and an imported custom cleanup worker. This passed for the local batch build.
2. In a staging production build, sign in as synthetic user A, upload/view a receipt, then sign out and sign in as synthetic user B in the same browser. B must receive no receipt bytes using A's receipt URL.
3. Seed the browser with the old worker's caches, activate the new worker and inspect Cache Storage. Known legacy sensitive caches must disappear; unrelated caches and current public assets must remain.
4. Take that browser offline. Protected pages should show only the generic offline screen or a network error, with no previously viewed account balances, transactions, receipts or reports.
5. Verify browser uploads and new-tab receipt opening through the actual staging Hosting proxy using its session cookie. Confirm the existing configured Storage bucket and service-account permissions before release.

## Remaining scope

This is a focused audit, not certification of the entire application. Shared API authentication/session handling, receipt OCR/import, direct Firebase download-token URLs, distributed upload quotas, durable cleanup when deleting accounts/receipts, and production end-to-end flows need separate review. No global type/size validation was added to every user-editable Firestore field.

Relevant primary documentation: [Firestore field controls](https://firebase.google.com/docs/firestore/security/rules-fields), [Storage data validation](https://firebase.google.com/docs/storage/security), [rules string operators](https://firebase.google.com/docs/reference/rules/rules.String). The installed `@ducanh2912/next-pwa` implementation was inspected to verify `workboxOptions.runtimeCaching`, default replacement order, custom worker imports and start-URL behavior.

## Scoped audit assessment

```json
{
  "score": 4,
  "summary": "The identified receipt/job confidentiality and rule-update bypasses have local fixes with handler and emulator regressions. Production verification and broader application controls remain outside this audit.",
  "findings": [
    {
      "check": "Storage Abuse and Type Safety",
      "severity": "minor",
      "issue": "Some other user-owned Firestore documents still lack per-field size and type limits; accepted receipt signatures do not establish malware safety.",
      "recommendation": "Add schema limits where actual client workflows are specified, and assess document scanning and distributed quotas before scaling."
    }
  ]
}
```
