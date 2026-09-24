# Production launch operations: September 24, 2026

This is the current operating baseline for `writeoff-23910` and `writeoffapp.com`.
Deployment identity and provider verification are recorded in
[Production integrations](PRODUCTION_INTEGRATIONS_2026-09-24.md). A configured
control, a successful live transaction, and a tested recovery are separate evidence.

## Audit and configuration status

The read-only launch audit found no managed backup schedule, PITR, database delete
protection, TTL policy, uptime check, alert policy, notification channel or custom
log metric. The earlier pre-cutover export is a useful recovery artifact, but is
not a recurring backup. Both application schedules were enabled.

The following minimal configuration has been prepared for the release operator.
**This document does not establish that it has been applied.** Record actual
read-back evidence and the first completed backup/heartbeat before marking those
controls verified. Notification channels require separate owner authorization.

| Control | Target | Verification and limitation |
| --- | --- | --- |
| Database delete protection | Enabled | Read `deleteProtectionState`; protects database deletion, not document deletion. |
| Point-in-time recovery | Enabled, up to 7 days | Read `earliestVersionTime` and `versionRetentionPeriod`; the seven-day window builds after enablement. |
| Managed backups | One daily schedule, 14-week retention | Read schedule plus a completed backup. Creation time is chosen by Firestore. A schedule is not a restore test. |
| Expired throttle records | TTL on `rate_limits.expiresAt` | Five sampled live records used Firestore timestamps; source stores a Date. TTL is asynchronous and rate decisions already ignore expired windows. |
| Public uptime | HTTPS `/auth/login`, every 5 minutes, 30-second timeout, US/Europe/Asia-Pacific checkers | Tests public availability, DNS and TLS. Does not sign in or test a bank/payment. |
| Availability incident | More than one checker fails for 5 minutes | Filters one-checker blips; investigate in Cloud Monitoring. |
| Server incident | At least 5 SSR 5xx responses in 5 minutes | Ignores ordinary 4xx review/authorization responses. Inspect affected route/revision. |
| Background incident | At least 10 worker ERROR entries in 10 minutes | Includes transient retries; inspect backlog, provider limits, origin and secret bindings. |
| Scheduled-sync silence | No completion heartbeat for 6 hours | Three expected two-hour runs. Absence detection requires an initial observed heartbeat; a completion can include partial failures. |

Initially these alerts create console incidents only. They do not page or email
anyone until an authorized notification channel is attached and delivery tested.
There is no alert for every ordinary tax review or isolated model retry.

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
1,000 executions. The proposed single five-minute check is below that execution
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

Fresh Node 22 `npm ci --ignore-scripts`, scheduled-sync TypeScript build and 67
focused scheduled-sync/deployment-contract tests passed. The lockfile change must
be included in the next coordinated production deployment to protect the running
scheduled function.
