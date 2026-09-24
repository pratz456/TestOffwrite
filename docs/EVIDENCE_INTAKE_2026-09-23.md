# Evidence intake: saved email and calendar files

## Available in this branch

- Transaction **Receipt → Import email receipt** reads one saved `.eml` email. It lists supported image/PDF attachments; the user chooses one and confirms attachment. Replacing the current receipt requires a separate checkbox.
- Transaction **Details → Use calendar event** reads one `.ics` export. Events are ordered by proximity to the transaction's recorded date. The user selects an event, edits its proposed purpose, and confirms the save.
- Receipt attachment uses the existing authenticated private upload route and canonical transaction mutation. Calendar purposes use that same canonical mutation path, so genuine fact changes request durable AI reanalysis without changing a confirmed classification.
- Camera, ordinary file and email attachment uploads now share the authenticated upload/save helper. It guards against a changed account or transaction before attachment.

## Data boundaries

- The preview route authenticates the owner and verifies the transaction before parsing. Cross-site cookie requests fail. User-supplied owner IDs, extra form fields, duplicate files and invalid transaction IDs fail.
- Email limit: 8 MB; calendar limit: 1 MB. Actual request bytes are bounded before multipart parsing. Email part/attachment counts, calendar line lengths/nesting and event counts are bounded. Previews have a durable per-owner rate limit and `private, no-store` responses.
- Parsing is offline. HTML, remote images/links, executable/SVG attachments, nested emails and inline tracking/logo attachments are not rendered or followed. Original accepted image/PDF bytes are preserved and revalidated at upload.
- Recurring calendars are not expanded. Cancelled or undated events are skipped. The recorded timezone is shown; day matching does not shift local/all-day dates through UTC.
- Only a selected attachment or explicitly confirmed purpose is written. Importing a calendar event does not establish eligibility, confirm a deduction, copy all attendees into transaction facts, or grant access to a mailbox/calendar account.
- Closing a preview aborts it. Saves prevent duplicate clicks. An account change blocks saving.

## Validation

- `tests/evidence-import.test.ts`: exact receipt bytes, no remote fetch, spoofed/active/inline attachments, file and parser bounds, calendar recurrence/cancellation, owner isolation, origin checks, request shape, service outages and private responses.
- `tests/evidence-import-handlers.test.tsx`: preview-only behavior, explicit attachment/event confirmation, replacement consent, edited purpose, account changes, retry handling and cancellation.
- Existing receipt-security and transaction review-handler tests are included in the focused regression run. Browser layout and runtime integration are checked separately by the release integration pass.

## Dependencies and remaining account integration

- Added runtime parsers pinned to `mailparser@3.9.28` and `ical.js@2.2.1`; `@types/mailparser` is development-only. The September 23 dependency audit reported no advisories for those parsers.
- Initial pre-remediation `npm audit --omit=dev`: 16 dependency findings (14 moderate, 2 high); the high paths were `postcss` and `serialize-javascript`. Initial complete tree: 27 findings, including development-tool findings for `vitest`, `@vitest/ui`, `tar` and `firebase-tools`. These figures include existing dependencies and are not proof of reachable production exploits. The release pass performs targeted dependency updates and records fresh results.
- This is usable file import. Automatic email forwarding still needs an owned inbound mail domain, verified webhook/provider configuration and owner-specific routing. Continuous calendar sync still needs an explicit read-only OAuth consent flow. Neither is represented as connected by this implementation.

No production deployment is implied by this document.
