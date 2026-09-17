# WriteOff Incident Response Plan

Date: 2026-09-17. Version: 1.0. Owner: Qualified Individual (WISP §2). Satisfies 16 CFR 314.4(h) (goals, internal processes, roles and authority, communications, remediation, documentation, post-incident review) and 314.4(j) (FTC notification). Companion to `docs/compliance/WISP_2026-09-17.md`.

Goals: stop unauthorized access quickly, preserve evidence, restore correct data, meet every notification deadline, and fix the weakness that allowed the event. A "security event" is any unauthorized access to, or disruption or misuse of, an information system or customer information (§314.2). Treat a suspected event as real until evidence shows otherwise.

## 1. Roles and decision authority

| Role | Who | Authority |
|---|---|---|
| Incident Commander (IC) | Qualified Individual, or the most senior engineer available until the QI is reached | Declares the incident and severity; approves containment actions including disabling logins and pausing deploys; owns the timeline |
| Engineering lead | Engineer with production IAM access | Executes containment (§4), collects logs, performs recovery |
| Communications lead ("one voice", Pub 5708 PIO) | Named by the operator | Sole author of user, regulator, press, and vendor communications; nothing is sent without IC and counsel sign-off |
| Counsel | Outside counsel (privacy / tax) | Determines notification obligations (§5), law-enforcement delay requests, and the §7216 posture |
| Vendor liaison | Operator | Opens tickets with Google Cloud, Stripe, Plaid, OpenAI, Resend; receives their incident notices |

Status: none of these names are recorded in the repository (WISP gap G1). Keep the roster, phone numbers, and vendor support contacts in the operator-held appendix. A single-person operation still fills every role and should pre-arrange counsel.

## 2. Severity levels

| Level | Definition | Examples | Initial response |
|---|---|---|---|
| SEV1 | Confirmed or likely unauthorized acquisition of customer information, or compromise of an encryption key, service account, or console credential | Firestore export exfiltrated; `PLAID_TOKEN_ENCRYPTION_KEY` or `SSN_ENCRYPTION_KEY` leaked; attacker holds Firebase admin credentials | Within 1 hour: contain (§4), start evidence log, notify counsel; notification clock (§5) starts at discovery |
| SEV2 | Suspected unauthorized access without confirmed acquisition; vendor-reported breach affecting WriteOff data; secret committed to a public place with no evidence of use | Stripe or Plaid incident notice; API key found in a public repository; anomalous `support_audit` volume | Within 4 hours: contain, rotate, investigate; decide within 72 hours whether SEV1 |
| SEV3 | Integrity or availability event without exposure | Bad deploy corrupts transaction data; scheduled sync failing for all users; Cloud Run outage | Same day: restore (§4.6), root cause, user status message if visible |
| SEV4 | Policy violation, no customer data | Support admin lookup without a ticket; deploy that bypassed CI | Within 1 week: review and corrective action |

## 3. Detection sources

- Alerting being defined on a separate branch (not in this tree): Cloud Monitoring on 5xx rate for the SSR service, Cloud Functions failures (`syncAllUsersTransactions` throws `BANK_SYNC_RETRY_REQUIRED` when any user fails), and `support_audit` write volume. Until it lands, the IC checks Cloud Logging error output from `lib/error-logger.ts` and the Firebase console daily.
- `support_audit` collection: every support diagnostics lookup with admin UID and target UID; review weekly.
- `user_profiles.last_scheduled_sync_status = 'error'` counts.
- Rate-limit denials (`rate_limits` counters) spiking on `auth.session`, `support.account`, or `user.export`.
- Vendor notices: Plaid, Stripe, OpenAI, Google Cloud, Resend security emails to the operator mailbox; Stripe Radar or dispute anomalies.
- GitHub: secret-scanning or Dependabot alerts (enablement unverified).
- Users: reports to writeoffapp@gmail.com; IRS notices to users about duplicate returns (a signal of preparer data theft per IRS guidance).

## 4. Containment and recovery steps for this stack

Record every command, time, and operator in the incident log before running it. Prefer reversible actions first.

### 4.1 Freeze

1. Pause releases: disable the `deploy.yml` workflow in GitHub Actions or revoke the deployer's permission. Do not push fixes until the IC approves.
2. Preserve evidence: export Cloud Logging entries for the window (default retention is only 30 days), snapshot `support_audit`, `rate_limits`, and `account_deletions`, and record Firebase Auth sign-in metadata for affected users. Do not delete anything.

### 4.2 Revoke sessions and lock accounts

- One user: `adminAuth.revokeRefreshTokens(uid)`. Because every API route verifies tokens and the `__session` cookie with `checkRevoked = true`, the user's existing sessions fail on their next request. Then `adminAuth.updateUser(uid, { disabled: true })` if the account itself is suspect.
- All users (credential-database or key compromise): iterate `adminAuth.listUsers()` and revoke tokens for each; force password reset by email. No script for this exists in the repository; write it in `/tmp`, review it, and keep a copy in the incident record.
- Support administrators: remove the UID from `SUPPORT_ADMIN_UIDS` and clear the `admin` custom claim (`adminAuth.setCustomUserClaims(uid, { admin: false })`); redeploy the environment so the allowlist change takes effect.
- Operator accounts: rotate Google, GitHub, Stripe, Plaid, OpenAI, and Resend passwords and enable MFA where missing (WISP gap G2).

### 4.3 Rotate secrets (order matters)

| Secret | How | Implications |
|---|---|---|
| Firebase Admin / Cloud Run service account | Google Cloud IAM: disable the key or service account, issue a new one, redeploy | Cloud Run and Functions restart; verify `production:preflight` passes |
| `CLOUD_FUNCTION_SECRET` (worker to `/api/plaid/sync-transactions-internal`) | Set a new Secret Manager version; redeploy the functions and the SSR service together | Scheduled syncs fail until both sides match |
| Plaid client secret | Plaid dashboard: rotate; update the environment | Existing access tokens keep working. If access tokens themselves were exposed in plaintext, call Plaid's item removal for every active connection (`disconnectPlaidItem`) and ask users to reconnect; the code has no token-rotation call, only removal |
| `PLAID_TOKEN_ENCRYPTION_KEY` | No re-encryption tool exists. Rotating the key makes every stored `encryptedAccessToken` undecryptable; users must reconnect every bank. Preferred sequence: (a) write a one-off re-encryption script that decrypts with the old key and encrypts with the new one inside a transaction, (b) test it on staging, (c) run it, then (d) retire the old key. If the key is confirmed stolen and tokens may be copied, skip re-encryption and remove the items at Plaid | Bank sync stops for any connection not migrated; the deletion flow still works because it removes items at Plaid first |
| `SSN_ENCRYPTION_KEY` | Same re-encryption approach for `tax_organizers` fields `taxpayerSSN`, `spouseSSN`, `bankAccount` (`isEncrypted` identifies ciphertext). Old key must be kept until re-encryption completes | Organizer reads fail for un-migrated documents |
| Stripe secret key and webhook signing secret | Stripe dashboard: roll the key (Stripe allows a grace period), create a new webhook secret; update `STRIPE_SECRET_KEY` and the webhook secret; redeploy | Webhooks fail signature checks until redeploy; `processed_webhooks` prevents replay when they resume |
| OpenAI API key | Platform dashboard: revoke and create; update `OPENAI_API_KEY` | AI analysis and document import fail until redeploy. Prompts are sent with `store: false`; OpenAI retains abuse-monitoring logs up to 30 days, so ask OpenAI support whether the compromised key was used |
| Resend API key | Dashboard: revoke and create | CPA-question emails fall back to server logging |
| `SUPPORT_ADMIN_UIDS` | Environment change plus redeploy | Removes support access immediately |

### 4.4 Isolate a vendor

If a vendor reports a breach: stop calls to that vendor at the environment level (unset its key so the code's "unavailable" paths engage), record what data classes that vendor held (see `docs/compliance/SUBPROCESSORS_2026-09-17.md`), and request their incident report and the affected-user list in writing.

### 4.5 Malicious or corrupt writes

Firestore rules deny client writes to server-only collections, so corruption of `plaid_connections`, `account_deletions`, `rate_limits`, or `support_audit` implies a compromised server credential: treat as SEV1 and rotate under §4.3. For user-owned documents, the rules limit which transaction fields a client may change; use `user_corrections` (immutable, client-created) to reconstruct legitimate edits. No general write-audit log exists: the `audit_logs` collection is named only as a deletion target and nothing in the code writes to it.

### 4.6 Restore data (Firestore PITR)

- With point-in-time recovery enabled, Firestore keeps one version per minute for 7 days. Recover a subset by stale-reading at a timestamp and writing back; recover everything by exporting at a timestamp to a new database or cloning. Without PITR, only the last hour is readable. PITR is disabled by default and its status for `writeoff-23910` is unverified (WISP gap G7): confirm and enable before launch.
- Cloud Storage receipts: no object versioning or backup is configured in this repository (unverified); receipts deleted by an attacker are unrecoverable unless a bucket-level policy exists.
- After any restore, re-run the Plaid sync for affected users and verify `plaid_connections` documents still match the current `PLAID_CLIENT_ID` and `PLAID_ENV`, otherwise the deletion flow flags them as legacy connections requiring manual revocation.

## 5. Notification obligations

Counsel decides scope; the IC tracks deadlines from the discovery date. Encrypted data whose key was not compromised is generally excluded from notification duties (FTC Rule; CA Civ. Code §1798.82(a)). Application-layer ciphertext (Plaid tokens, organizer SSNs) qualifies only if the key stayed secret; Google default at-rest encryption does not help once an attacker reads through Firestore.

### 5.1 FTC Safeguards Rule (16 CFR 314.4(j))

- Trigger: unauthorized acquisition of unencrypted customer information of 500 or more consumers ("notification event"). Unauthorized access counts as acquisition unless reliable evidence shows acquisition did not and could not reasonably have occurred.
- Deadline: as soon as possible and no later than 30 days after discovery.
- Content: company name and contact, description of the information types, date or range, number of consumers affected or potentially affected, general description of the event, whether law enforcement asked for a public-disclosure delay. Filed on the FTC's Safeguards Rule reporting form (linked from the Safeguards Rule page); the report may be made public.

### 5.2 IRS and state tax agencies

- Report client data theft to the IRS Stakeholder Liaison for the operator's state (area mailboxes `cl.sl.area.2@irs.gov` through `cl.sl.area.6@irs.gov`, 202-317-4015). The liaison notifies IRS Criminal Investigation and can block fraudulent returns. IRS assisters cannot take third-party identity-theft reports by phone.
- Report to each state tax agency where affected users file; the IRS directs preparers to the Federation of Tax Administrators "Report a Data Breach" directory for state contacts.
- Tell users to file IRS Form 14039 only if they receive an IRS notice or an e-file rejection for a duplicate SSN; recommend an IRS Identity Protection PIN.
- Also notify the FBI field office if the IRS directs, local police for a report, and the cyber-insurance carrier if any.

### 5.3 State breach-notification laws (patterns, not an enumeration)

All 50 states and DC require notice to affected residents; the trigger is typically a name plus SSN, government ID, tax ID, or financial account credential, or an email/username plus password. Deadlines fall into three patterns:

- 30 days to individuals: California (30 calendar days from discovery, effective 2026-01-01; AG receives a sample copy within 15 days of consumer notice if more than 500 residents); Florida (30 days; Department of Legal Affairs within 30 days if 500 or more residents; consumer reporting agencies if more than 1,000; 15-day extension for good cause). Colorado, Washington, and New York (as amended 2024) also use 30 days: unverified in this pass.
- 45 days: Maryland, Ohio, and several others: unverified in this pass.
- 60 days: Texas (individuals within 60 days of determining the breach; Attorney General within 30 days if 250 or more Texas residents, via the AG's electronic form).
- Many states instead say "most expedient time possible and without unreasonable delay" with no fixed day count. Plan to the shortest applicable deadline (30 days) for every user and let counsel confirm per state from the users' `state` profile field.
- Regulator thresholds differ (CA more than 500; FL 500; TX 250; some states any number). Consumer reporting agencies must often be told above 1,000 affected residents. Encrypted data with an uncompromised key is excluded almost everywhere.

### 5.4 Vendors and partners

Google Cloud, Stripe, Plaid, OpenAI, and Resend terms contain incident-cooperation clauses; whether WriteOff must notify them of WriteOff-side incidents depends on the executed terms (unverified). Plaid must be told promptly if access tokens were exposed so items can be invalidated.

## 6. User notice template

Send by email to the address on the Firebase Auth record (and by post where a mailing address is held). California requires the title "Notice of Data Breach" and these headings; using them everywhere is simplest.

```
Subject: Notice of Data Breach – WriteOff

Notice of Data Breach                                   Date: [date of notice]

What Happened?
On [date/range], [plain description: e.g., an unauthorized person accessed our
database]. We discovered this on [date] and [contained it on date].
[If delayed by law enforcement: Notification was delayed at the request of law
enforcement.]

What Information Was Involved?
[List only the categories actually involved, e.g., name, email address, state,
bank transaction descriptions and amounts, receipt images, Social Security
number, Employer Identification Number.] [State clearly what was NOT involved,
e.g., bank login credentials, which WriteOff never receives.]

What We Are Doing
[Containment steps in plain words: revoked all sessions, rotated keys,
disconnected bank links, engaged forensics, notified the FTC/IRS/state.]
[If SSNs or tax IDs were involved: offer identity-theft protection at no cost
for at least 12 months (California requirement), with enrollment steps.]

What You Can Do
- Reset your WriteOff password and any account that shared it.
- Request an IRS Identity Protection PIN at irs.gov/ippin.
- File IRS Form 14039 only if you receive an IRS notice or your e-filed return
  is rejected for a duplicate Social Security number.
- Consider a credit freeze or fraud alert: Equifax 1-800-685-1111, Experian
  1-888-397-3742, TransUnion 1-888-909-8872 [required in CA when SSN/ID exposed].
- Review your bank statements; disconnect bank links in WriteOff Settings.

For More Information
Email writeoffapp@gmail.com or call [phone]. [Name and address of WriteOff.]
```

Regulator report content (FTC form, state AG forms): entity name and contact, incident date range, discovery date, number of affected consumers by state, information types, summary of the event and response, whether law enforcement requested delay, and the consumer notice sample.

## 7. Documentation and post-incident review

Keep an incident log with: discovery time and source, timeline of actions, evidence locations, affected UIDs and states, decisions (with who and why), notifications sent (to whom, when, copy), and cost. Within two weeks of closure: root-cause analysis, corrective actions with owners and dates, and updates to the WISP risk table and this plan. Retain incident records at least five years (Florida requires five years for a documented no-notice determination). Run a tabletop exercise annually using a scenario from §2.

## Sources

- 16 CFR Part 314, especially §314.4(h) and (j): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314 (automated retrieval blocked; requirements confirmed via the FTC guide)
- FTC, "FTC Safeguards Rule: What Your Business Needs to Know": https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- FTC Safeguards Rule page (reporting form link): https://www.ftc.gov/legal-library/browse/rules/safeguards-rule
- FTC, "Data Breach Response: A Guide for Business": https://www.ftc.gov/business-guidance/resources/data-breach-response-guide-business
- IRS, "Data theft information for tax professionals": https://www.irs.gov/individuals/data-theft-information-for-tax-professionals
- IRS Stakeholder Liaison contacts: https://www.irs.gov/businesses/small-businesses-self-employed/stakeholder-liaison-contacts
- IRS, "Identity theft information for tax professionals": https://www.irs.gov/identity-theft-central/identity-theft-information-for-tax-professionals
- IRS Pub 4557: https://www.irs.gov/pub/irs-pdf/p4557.pdf ; IRS Pub 5708 (Attachment C, breach procedures): https://www.irs.gov/pub/irs-pdf/p5708.pdf
- California Civ. Code §1798.82: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82 ; CA AG reporting: https://oag.ca.gov/privacy/databreach/reporting
- Florida Stat. §501.171: http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html
- Texas AG data breach reporting: https://www.texasattorneygeneral.gov/consumer-protection/data-breach-reporting (Tex. Bus. & Com. Code §521.053 text confirmed only via secondary mirrors: unverified)
- Firestore PITR: https://cloud.google.com/firestore/docs/pitr ; Cloud Logging retention: https://cloud.google.com/logging/quotas
- OpenAI API data retention: https://platform.openai.com/docs/models/how-we-use-your-data

## Facts verified in code

- `lib/firebase/api-auth.ts`, `lib/firebase/receipt-security.ts`, `app/api/auth/session/route.ts`: `verifyIdToken(token, true)` and `verifySessionCookie(session, true)` (revocation honored); 14-day cookie.
- `lib/support/access.ts`: `SUPPORT_ADMIN_UIDS` and `admin` claim both required; `support_audit` written per lookup.
- `lib/plaid/connections.ts`: AES-256-GCM with `PLAID_TOKEN_ENCRYPTION_KEY`; no re-encryption or token-rotation routine. `lib/plaid/delete-item.ts`: item removal only.
- `lib/security/utils.ts`: `encryptSensitive`/`decryptSensitive`/`isEncrypted` with `SSN_ENCRYPTION_KEY`.
- `functions/src/index.ts`: `CLOUD_FUNCTION_SECRET`, scheduled every 2 hours, throws on any failure.
- `app/api/stripe/webhook/route.ts`, `processed_webhooks` in `lib/firebase/delete-user-data.ts`: webhook replay protection collection exists.
- `lib/openai/client.ts`, `lib/ai/analyzeTransaction.ts`, `app/api/tax/import-document/route.ts`, `app/api/tax/import-bank-statement/route.ts`: `store: false`.
- `app/api/cpa-question/route.ts`: Resend used when `RESEND_API_KEY` is set, otherwise logs.
- `lib/error-logger.ts`: console output to Cloud Logging; no external SIEM.
- `firestore.rules`: server-only collections; limited client update fields on transactions.
- Absent: revocation scripts, alerting configuration, PITR/backup configuration, incident roster.
