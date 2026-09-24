# Production launch operations: September 24, 2026

This is the current operating baseline for `writeoff-23910` and `writeoffapp.com`.
Deployment identity and provider verification are recorded in
[Production integrations](PRODUCTION_INTEGRATIONS_2026-09-24.md). A configured
control, a successful live transaction, and a tested recovery are separate evidence.

## Audit and configuration status

The initial read-only launch audit found no managed backup schedule, PITR, database delete
protection, TTL policy, uptime check, alert policy, notification channel or custom
log metric. The earlier pre-cutover export is a useful recovery artifact, but is
not a recurring backup. Both application schedules were enabled.

The release operator applied the minimal recovery and monitoring configuration.
Independent read-back confirmed PITR and delete protection enabled, one daily
backup schedule with 14-week retention, one uptime check, five enabled alert
policies and two log metrics. The throttle TTL policy was initially confirmed
ACTIVE, then the next coordinated deployment removed its undeclared field
override. Read-back at 18:58:52 UTC returned no TTL policy. Declarative retention
in `firestore.indexes.json` and a subsequent deployment are pending; do not
manually reapply it during the release. The first scheduled backup,
heartbeat detection, alert delivery and restore drill are not yet verified.
One explicitly authorized email notification channel is enabled and attached to
all five production policies; the exact recipient is retained in private evidence.

| Control | Applied state | Verification and limitation |
| --- | --- | --- |
| Database delete protection | ENABLED | Read-back confirmed; protects database deletion, not document deletion. |
| Point-in-time recovery | ENABLED, retention 604,800 seconds | Read-back confirmed; earliest recoverable time was September 24, 17:46 UTC. The seven-day window builds after enablement. |
| Managed backups | One daily schedule, retention 8,467,200 seconds (14 weeks) | Schedule `d518b9b8-4ebe-49ab-b20f-43bb5a4a4eb3` read back. First completed backup and restore drill remain unverified. |
| Expired throttle records | Missing after deployment; declarative repair pending | Initial ACTIVE policy was removed because it was absent from deployed field overrides. Five sampled records use timestamps. Rate decisions already ignore expired windows, but automated storage cleanup is not active. |
| Public uptime | HTTPS `/auth/login`, every 5 minutes, 30-second timeout, US/Europe/Asia-Pacific checkers | Tests public availability, DNS and TLS. Does not sign in or test a bank/payment. |
| Availability incident | More than one checker fails for 5 minutes | Filters one-checker blips; investigate in Cloud Monitoring. |
| Server incident | At least 5 SSR 5xx responses in 5 minutes | Ignores ordinary 4xx review/authorization responses. Inspect affected route/revision. |
| Background incident | At least 10 worker ERROR entries in 10 minutes | Includes transient retries; inspect backlog, provider limits, origin and secret bindings. |
| Analysis transport backlog | Oldest unacknowledged message exceeds 15 minutes for 10 minutes | Bound to the four actual analysis Eventarc/Pub/Sub subscriptions. Detects delivery delay, not silently stalled work already acknowledged by transport. |
| Scheduled-sync silence | No completion heartbeat for 6 hours | Three expected two-hour runs. Absence detection requires an initial observed heartbeat; a completion can include partial failures. |

These policies now route to the one authorized operator inbox. Channel and policy
read-back confirms configuration; actual inbox delivery is not yet verified.
The channel does not require an email verification code. There is no alert for
every ordinary tax review or isolated model retry.

The private evidence directory retains the applied monitoring read-back, an
independent recovery read-back and the exact narrowly scoped setup scripts.
It contains no application secrets. No new IAM grants, billing budget, backup
bucket retention changes or weekly export job were applied.

### Backlog coverage

At 18:52 UTC, the four analysis transport subscriptions each had zero undelivered
messages and zero oldest-unacknowledged age throughout the preceding hour.
The configured delay threshold uses the official
[Pub/Sub backlog-age metric](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#gcp-pubsub),
whose value is seconds. Re-resolve subscription names if Eventarc triggers are
recreated. This snapshot is not a throughput or outage-detection test.

The current application stores durable work in `analysis_tasks`, version-1
progress summaries in `analysis_jobs`, and profile-refresh work in
`profile_analysis_refresh`. Read-only inspection found no active/paused durable
analysis tasks or profile refreshes. Eight historical unversioned job summaries
remain marked running; the current status endpoint excludes those legacy records.
None was changed or deleted. The production error and transport alerts do not
detect a task silently stalled after transport acknowledgement. Continuous
coverage of that case would require an application queue-age metric or a
read-only watchdog; neither is claimed as implemented here.

## Authentication and application hardening

Production Firebase email/password API and server-cookie lifecycle passed **19
checks** using one newly created synthetic Auth account. Signup succeeded;
unverified session creation returned 403; invalid passwords were rejected; valid
password login and verified server-session creation succeeded. The session was
Secure, HttpOnly, SameSite=Lax, private/no-store and bound to the created owner.
Authenticated profile reads succeeded without creating a profile. Missing or
invalid credentials were rejected, logout cleared the cookie, and deletion of
the exact UID/email was confirmed with subsequent session rejection.

Email verification was **simulated with Admin on that synthetic account**. No
email, app profile, transaction, bank or billing record was created. This does
not establish inbox delivery. The release operator separately observed a fresh
Google browser sign-in at **18:42:53 UTC**, corroborated by the account's Auth
last-sign-in metadata. Production verification/reset and support inbox delivery
still await recipient authorization and an actual delivery check.

The next application release includes these source fixes:

- `06b9ef0`: email sign-in reuses Firebase's supported IndexedDB/local/session
  persistence fallback; it no longer forces potentially blocked localStorage.
  Email verification and server-session checks remain. Independent review found
  no issue; 53 focused auth/origin tests passed.
- `351e70e`: a removed bank record restored by an added or modified event clears
  its removal marker atomically and invalidates its old AI suggestion. Removed,
  pending or superseded records cannot receive new AI results; owner-confirmed
  bookkeeping is preserved.
- `db45a7e`: active but unsettled or failed subscriptions lead to billing recovery,
  and billing links open the Payment tab. Checkout closure no longer claims that
  no charge occurred. Billing actions use the configured shared Stripe client;
  account-deletion billing cleanup checks provider owner metadata before acting.

These are code corrections, not evidence of a new real bank exchange, genuine
payment settlement/webhook delivery or load-tested scaling capacity. The current
integration release report remains authoritative for what is actually deployed.

## Recovery commands and read-back

Run against the explicit production project. Inspect current state first; retain
the name of any existing daily schedule and update it instead of duplicating it.

```sh
gcloud firestore databases describe --database='(default)' --project=writeoff-23910
gcloud firestore backups schedules list --database='(default)' --project=writeoff-23910
gcloud firestore fields ttls list --database='(default)' --collection-group=rate_limits --project=writeoff-23910

gcloud firestore databases update --database='(default)' --enable-pitr --delete-protection --project=writeoff-23910
# Only when no daily schedule exists:
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14w --project=writeoff-23910
# Otherwise use schedules update --backup-schedule=<existing-id> --retention=14w.
gcloud firestore fields ttls update expiresAt --database='(default)' --collection-group=rate_limits --enable-ttl --project=writeoff-23910

# Repeat the three initial reads, then check actual completed backups:
gcloud firestore backups list --project=writeoff-23910 --format='table(name,database,state,expireTime)'
```

The preparation scripts for this release deliberately exclude new IAM grants,
budget changes, bucket retention changes and weekly export jobs. Do not run the
older broad `production-observability.sh --apply` as a substitute for this scoped
configuration. Backups omit security rules and TTL policies: keep the exact
release source and private deployment evidence with the recovery record.

For a restore drill, restore into a **separate database**, compare expected
document/account counts and selected records, and record elapsed time and result.
Do not restore over subsequent user writes. Credential migration and activated
bank-history review require compatible importers; see the current integration
report's rollback restrictions. A fresh deployment cannot reverse provider state.

## Runtime and cost boundaries

The committed SSR configuration is **2 GiB, 1 CPU, minInstances 0,
maxInstances 20, concurrency 40, timeout 60 seconds**. `minInstances: 0` is required
by the current guarded Hosting pinned-revision deployment; do not copy the old
scale document's warm-instance recommendations into this release.

These are resource bounds, not a tested capacity promise. No sustained load test
has certified 5,000 or 100,000 daily users. Model workers have bounded concurrency,
leases, retry counts and task age. Durable owner rate limits guard costly manual
routes. Neither mechanism is a global daily spend cap; new accounts and imported
history still add work. Measure real signup/import volume, provider throttling,
queue age and latency before increasing marketing traffic or worker concurrency.

PITR is billed on stored data and has no free tier; recovery reads/exports incur
read charges. Managed backups charge for retained storage and restores. Fourteen
weeks is the documented maximum retention. See [Firestore PITR](https://docs.cloud.google.com/firestore/native/docs/pitr)
and [managed backups](https://docs.cloud.google.com/firestore/native/docs/backups).
TTL deletes are billed; they are not part of free usage. See
[Firestore billing](https://firebase.google.com/docs/firestore/pricing).

The current [Observability pricing](https://cloud.google.com/products/observability/pricing)
includes one million uptime executions per project per month, then $0.30 per
1,000 executions. The configured single five-minute check is below that execution
allowance; it still generates application requests and logs. Custom log metrics
are usage billed above the applicable free allotment. Alert-policy metric pricing
on that page starts September 1, 2027, not the date of this audit. No spending cap
or budget was added by this plan.

## Dependency verification

Production-only dependency audits at the audit date found no high/critical
findings in the application or analysis worker. The scheduled-sync lockfile had
six high and three critical findings. The patch in commit `c487a18` updates them
within existing dependency ranges, leaving all three deployable trees with zero
high/critical findings. Remaining moderate counts: application 11, scheduled sync
8, analysis worker 9. This is an advisory scan, not proof of universal security.

The Firebase-generated SSR package is an additional dependency graph and must be
audited independently. The release operator's generated-package audit subsequently
found two high findings in the image-processing dependency chain. Remediation and
another generated-package audit are pending. The three source lockfile results
must not be presented as a clean audit of the complete deployed runtime.

Fresh Node 22 `npm ci --ignore-scripts`, scheduled-sync TypeScript build and 67
focused scheduled-sync/deployment-contract tests passed. The lockfile change must
be included in the next coordinated production deployment to protect the running
scheduled function.
