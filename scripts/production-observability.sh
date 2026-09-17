#!/usr/bin/env bash
# =============================================================================
# WriteOff production observability kit — backups, metrics, alerts, uptime, budget
#
# Target: Firebase project writeoff-23910 (Next.js SSR on Cloud Run service
# "ssrwriteoff23910" in us-central1, Firestore "(default)", Cloud Functions
# codebases `functions` (syncAllUsersTransactions) and `functions-analysis`
# (queueBankTransactionAnalysis, processBankTransactionAnalysis)).
#
# Modes (exactly one):
#   --print   default. Echo every gcloud command and JSON body. Runs nothing,
#             needs no credentials. In print mode the "create" branch is shown;
#             --apply switches to the matching "update" when a resource exists.
#   --apply   Execute. Idempotent: every resource is looked up first and either
#             created or updated in place; re-running converges to the same state.
#   --verify  Read-only. Describes/lists what is deployed; never mutates.
#
# Usage:
#   scripts/production-observability.sh --project writeoff-23910
#   scripts/production-observability.sh --project writeoff-23910 --apply \
#       --alert-email ops@example.com --budget-amount 300 \
#       [--billing-account XXXXXX-XXXXXX-XXXXXX] [--bucket NAME] \
#       [--bucket-location us] [--cmek-key projects/P/locations/L/keyRings/R/cryptoKeys/K]
#   scripts/production-observability.sh --project writeoff-23910 --verify
#
# Nothing here reads or prints application secrets. The only personal value on
# the command line is the alert e-mail address you pass in.
# =============================================================================
set -euo pipefail

MODE=print
PROJECT=""
# Public project number (the preflight pins it as the Firebase sender ID); used
# for service-agent identities and the budget filter without a credentialed lookup.
PROJECT_NUMBER="930596534802"
REGION="us-central1"
SSR_SERVICE="ssrwriteoff23910"
DATABASE="(default)"
BUCKET=""
BUCKET_LOCATION="us"
CMEK_KEY=""
ALERT_EMAIL=""
BUDGET_AMOUNT=""
BILLING_ACCOUNT=""
EXPORT_SA_ID="writeoff-firestore-export"
EXPORT_JOB="writeoff-firestore-weekly-export"
UPTIME_HOST="writeoffapp.com"
UPTIME_PATH="/auth/login"
CHANNEL_DISPLAY_NAME="WriteOff production on-call (email)"
UPTIME_DISPLAY_NAME="WriteOff login page"
BUDGET_DISPLAY_NAME="WriteOff production monthly budget"
# Scheduled sync runs every 2 hours. The operator asked for a 26 h silence alarm;
# Cloud Monitoring caps metric-absence at 23.5 h (84600 s), so this fires sooner
# (after ~11 missed runs) and is documented as such.
SYNC_ABSENCE_SECONDS=84600

usage() { sed -n '2,28p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print) MODE=print ;;
    --apply) MODE=apply ;;
    --verify) MODE=verify ;;
    --project) PROJECT="${2:-}"; shift ;;
    --project-number) PROJECT_NUMBER="${2:-}"; shift ;;
    --region) REGION="${2:-}"; shift ;;
    --ssr-service) SSR_SERVICE="${2:-}"; shift ;;
    --bucket) BUCKET="${2:-}"; shift ;;
    --bucket-location) BUCKET_LOCATION="${2:-}"; shift ;;
    --cmek-key) CMEK_KEY="${2:-}"; shift ;;
    --alert-email) ALERT_EMAIL="${2:-}"; shift ;;
    --budget-amount) BUDGET_AMOUNT="${2:-}"; shift ;;
    --billing-account) BILLING_ACCOUNT="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "$PROJECT" != "writeoff-23910" ]]; then
  echo "FAIL: --project writeoff-23910 is required (got '${PROJECT:-<none>}')." >&2
  exit 2
fi
if [[ ! "$PROJECT_NUMBER" =~ ^[0-9]+$ ]]; then echo "FAIL: --project-number must be numeric." >&2; exit 2; fi
BUCKET="${BUCKET:-${PROJECT}-firestore-backups}"
if [[ "$MODE" == apply ]]; then
  [[ -n "$ALERT_EMAIL" ]] || { echo "FAIL: --apply requires --alert-email." >&2; exit 2; }
  [[ "$BUDGET_AMOUNT" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "FAIL: --apply requires a numeric --budget-amount (USD)." >&2; exit 2; }
fi
if [[ "$MODE" != print ]] && ! command -v gcloud >/dev/null 2>&1; then
  echo "FAIL: gcloud is required for --$MODE (use --print without credentials)." >&2
  exit 2
fi
ALERT_EMAIL="${ALERT_EMAIL:-REPLACE_ALERT_EMAIL}"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-REPLACE_BUDGET_AMOUNT}"

EXPORT_SA="${EXPORT_SA_ID}@${PROJECT}.iam.gserviceaccount.com"
FIRESTORE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com"
GCS_AGENT="service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"
# Cloud Functions 2nd gen exposes each function as a Cloud Run service with a
# lower-cased name; log filters match both resource shapes.
SYNC_FUNCTION="syncAllUsersTransactions"
SYNC_SERVICE="syncalluserstransactions"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
# Filled in during --apply; placeholders keep --print output readable.
CHANNEL_NAME="projects/${PROJECT}/notificationChannels/CHANNEL_ID"
UPTIME_CHECK_ID="UPTIME_CHECK_ID"

# ----------------------------------------------------------------------------- helpers
# Shell-quote for copy-paste: anything outside the safe set (notably "(default)",
# spaces and quotes) is wrapped in single quotes.
q() {
  local arg="$1"
  if [[ "$arg" =~ ^[A-Za-z0-9_./:=@,+%-]+$ ]]; then printf '%s' "$arg"; else printf "'%s'" "${arg//\'/\'\\\'\'}"; fi
}
show() { local out="" a; for a in "$@"; do out+="$(q "$a") "; done; printf '%s\n' "${out% }"; }
note() { printf '# %s\n' "$*"; }
heading() { printf '\n# ===== %s =====\n' "$*"; }
# Mutating command: always echoed, executed only with --apply.
run() { show "$@"; if [[ "$MODE" == apply ]]; then "$@"; fi; }
# Same, but keeps stdout (a created resource name) in CAPTURED for --apply.
CAPTURED=""
run_capture() { CAPTURED=""; show "$@"; if [[ "$MODE" == apply ]]; then CAPTURED="$("$@")"; fi; }
# Read-only command: echoed, executed in --verify and --apply.
read_cmd() { show "$@"; if [[ "$MODE" != print ]]; then "$@" || true; fi; }
# Existence probe. Print mode assumes "absent" so the create path is displayed.
probe() {
  if [[ "$MODE" == print ]]; then printf '#   (exists?) %s\n' "$(show "$@")"; return 1; fi
  "$@" >/dev/null 2>&1
}
capture() { if [[ "$MODE" == print ]]; then printf ''; else "$@" 2>/dev/null || true; fi; }
# Write a JSON body (stdin) to the work directory and expose its path as JSON_FILE;
# in print mode the body is echoed so the operator can review exactly what would be sent.
JSON_FILE=""
write_json() {
  local name="$1"
  JSON_FILE="$WORKDIR/$name.json"
  cat > "$JSON_FILE"
  if [[ "$MODE" == print ]]; then printf '# --- %s.json ---\n' "$name"; cat "$JSON_FILE"; printf '# --- end %s.json ---\n' "$name"; fi
}

# ----------------------------------------------------------------------------- sections
section_apis() {
  heading "APIs"
  note "Idempotent. Firestore backups/PITR, Scheduler (weekly export), Monitoring, Logging, Budgets."
  run gcloud services enable firestore.googleapis.com storage.googleapis.com cloudscheduler.googleapis.com \
    monitoring.googleapis.com logging.googleapis.com billingbudgets.googleapis.com cloudresourcemanager.googleapis.com \
    --project "$PROJECT" --quiet
}

section_firestore_protection() {
  heading "Firestore point-in-time recovery and delete protection"
  note "PITR keeps 7 days of minute-granularity versions so a bad migration can be exported from a timestamp"
  note "(gcloud firestore export --snapshot-time). Delete protection blocks accidental database deletion."
  note "Both are safe to re-apply; the flags are absolute settings, not toggles."
  run gcloud firestore databases update --database "$DATABASE" --enable-pitr --delete-protection --project "$PROJECT" --quiet
}

section_bucket() {
  heading "Private backup bucket gs://$BUCKET"
  note "Uniform bucket-level access (no per-object ACLs), public access prevention enforced, 400-day retention"
  note "policy (objects cannot be deleted or overwritten before 400 days; the policy is intentionally NOT locked"
  note "so a mistaken retention can still be shortened by an owner). Nearline class: exports are written weekly"
  note "and read only in a restore; 400 d retention already exceeds the 30-day Nearline minimum."
  note "Location '$BUCKET_LOCATION' (multi-region) survives a regional outage; pass --bucket-location to match"
  note "the database location shown by 'gcloud firestore databases describe' if you prefer co-location."
  local common=(--uniform-bucket-level-access --public-access-prevention --retention-period 400d)
  if [[ -n "$CMEK_KEY" ]]; then
    note "CMEK requested: the Cloud Storage service agent must be able to use the key before objects are written."
    run gcloud kms keys add-iam-policy-binding "$CMEK_KEY" --member "serviceAccount:${GCS_AGENT}" \
      --role roles/cloudkms.cryptoKeyEncrypterDecrypter --quiet
    common+=(--default-encryption-key "$CMEK_KEY")
  fi
  if probe gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT"; then
    run gcloud storage buckets update "gs://$BUCKET" "${common[@]}"
  else
    run gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$BUCKET_LOCATION" \
      --default-storage-class nearline "${common[@]}"
  fi
  note "Same-project bucket: the Firestore service agent ($FIRESTORE_AGENT) can write exports with its default"
  note "project permissions. Only a bucket in ANOTHER project would need roles/storage.admin on the bucket."
}

section_backups() {
  heading "Daily managed Firestore backup (Firestore-native, same location as the database)"
  note "Managed backups are the fastest restore path (gcloud firestore databases restore into a new database)."
  note "14 weeks is the maximum retention; the database is small, so storage cost is negligible."
  note "One daily schedule per database is allowed, so an existing one is updated rather than duplicated."
  note "A daily schedule is the one WITHOUT weeklyRecurrence.day (dailyRecurrence is an empty object, which"
  note "gcloud filters cannot test for presence reliably)."
  local existing=""
  local list_cmd=(gcloud firestore backups schedules list --database "$DATABASE" --project "$PROJECT"
    --filter 'NOT weeklyRecurrence.day:*' --format 'value(name.basename())')
  existing="$(capture "${list_cmd[@]}" | head -n 1)"
  if [[ -n "$existing" ]]; then
    run gcloud firestore backups schedules update --database "$DATABASE" --backup-schedule "$existing" --retention 14w --project "$PROJECT"
  else
    printf '#   (exists?) %s\n' "$(show "${list_cmd[@]}")"
    run gcloud firestore backups schedules create --database "$DATABASE" --recurrence daily --retention 14w --project "$PROJECT"
  fi
}

section_export_job() {
  heading "Weekly Firestore export to gs://$BUCKET (Cloud Scheduler → Firestore exportDocuments)"
  note "An export is a portable copy outside the database service (importable into any project/emulator)"
  note "and the artifact the rollback plan references for irreversible data migrations."
  note "A dedicated service account carries only the export permission; Scheduler mints its OAuth token."
  if ! probe gcloud iam service-accounts describe "$EXPORT_SA" --project "$PROJECT"; then
    run gcloud iam service-accounts create "$EXPORT_SA_ID" --display-name "WriteOff Firestore weekly export" --project "$PROJECT"
  fi
  note "roles/datastore.importExportAdmin is the narrowest predefined role containing datastore.databases.export."
  run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${EXPORT_SA}" \
    --role roles/datastore.importExportAdmin --condition None --quiet
  note "outputUriPrefix is the bare bucket on purpose: Firestore then creates a timestamped folder per run,"
  note "so weekly exports never overwrite each other under the retention policy."
  local body="{\"outputUriPrefix\":\"gs://${BUCKET}\"}"
  local uri="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}:exportDocuments"
  local args=(--location "$REGION" --schedule "0 9 * * 1" --time-zone "Etc/UTC" --uri "$uri" --http-method POST
    --headers "Content-Type=application/json" --message-body "$body" --oauth-service-account-email "$EXPORT_SA"
    --oauth-token-scope "https://www.googleapis.com/auth/datastore" --attempt-deadline 320s
    --description "Weekly full Firestore export for WriteOff production" --project "$PROJECT")
  if probe gcloud scheduler jobs describe "$EXPORT_JOB" --location "$REGION" --project "$PROJECT"; then
    run gcloud scheduler jobs update http "$EXPORT_JOB" "${args[@]}"
  else
    run gcloud scheduler jobs create http "$EXPORT_JOB" "${args[@]}"
  fi
  note "First export on demand (also the pre-migration backup step in the go-live runbook):"
  note "  gcloud scheduler jobs run $EXPORT_JOB --location $REGION --project $PROJECT"
}

# Log-based metrics. Response bodies are never logged by Cloud Run, so the
# request log (httpRequest.status + requestUrl) is the observable signal for the
# SSR codes; the Functions codes appear as thrown error text.
ensure_log_metric() {
  local name="$1" file="$2"
  if probe gcloud logging metrics describe "$name" --project "$PROJECT"; then
    run gcloud logging metrics update "$name" --config-from-file "$file" --project "$PROJECT"
  else
    run gcloud logging metrics create "$name" --config-from-file "$file" --project "$PROJECT"
  fi
}

section_log_metrics() {
  heading "Log-based metrics (logging.googleapis.com/user/*)"
  local ssr="resource.type=\\\"cloud_run_revision\\\" AND resource.labels.service_name=\\\"${SSR_SERVICE}\\\""
  local route_extractor="REGEXP_EXTRACT(httpRequest.requestUrl, \\\"^https?://[^/]+(/api/[a-z0-9_-]+)\\\")"

  note "WORKER_RETRY_REQUIRED: the analysis worker route answers 503 when a task cannot complete safely and the"
  note "functions-analysis bridge throws ANALYSIS_WORKER_RETRY_REQUIRED so Eventarc retries. Sustained counts"
  note "mean the SSR worker or its secret binding is unhealthy while tasks keep queueing."
  write_json metric-worker-retry <<EOF
{
  "description": "WriteOff analysis worker retries: SSR /api/internal/analysis-worker 503s plus ANALYSIS_WORKER_RETRY_REQUIRED thrown by functions-analysis",
  "filter": "(${ssr} AND httpRequest.requestUrl:\"/api/internal/analysis-worker\" AND httpRequest.status=503) OR (resource.type=(\"cloud_function\" OR \"cloud_run_revision\") AND (textPayload:\"WORKER_RETRY_REQUIRED\" OR jsonPayload.message:\"WORKER_RETRY_REQUIRED\"))",
  "metricDescriptor": { "metricKind": "DELTA", "valueType": "INT64", "unit": "1" }
}
EOF
  ensure_log_metric writeoff_worker_retry_required "$JSON_FILE"

  note "SUBSCRIPTION_UNAVAILABLE: /api/subscriptions/* answers 503 when Stripe or the profile read fails;"
  note "check-access runs on every protected-app load, so a spike here means paying users see the paywall."
  write_json metric-subscription-unavailable <<EOF
{
  "description": "WriteOff SUBSCRIPTION_UNAVAILABLE proxies: 503 responses on /api/subscriptions/* (check-access, verify-stripe, fix-access)",
  "filter": "(${ssr} AND httpRequest.status=503 AND httpRequest.requestUrl:\"/api/subscriptions/\") OR (${ssr} AND textPayload:\"SUBSCRIPTION_UNAVAILABLE\")",
  "metricDescriptor": { "metricKind": "DELTA", "valueType": "INT64", "unit": "1" }
}
EOF
  ensure_log_metric writeoff_subscription_unavailable "$JSON_FILE"

  note "Review-code 422 volume: tax, report, export and reconciliation routes answer 422 with a *_REVIEW_REQUIRED"
  note "code by design. Track the volume per route family; a step change after a deploy (for example every"
  note "profile returning HOME_OFFICE_REVIEW_REQUIRED) is a regression signal, not an outage."
  write_json metric-review-required-422 <<EOF
{
  "description": "WriteOff 422 review-required responses by /api route family",
  "filter": "${ssr} AND httpRequest.status=422",
  "metricDescriptor": {
    "metricKind": "DELTA", "valueType": "INT64", "unit": "1",
    "labels": [ { "key": "route", "valueType": "STRING", "description": "First /api path segment" } ]
  },
  "labelExtractors": { "route": "${route_extractor}" }
}
EOF
  ensure_log_metric writeoff_review_required_422 "$JSON_FILE"

  note "SSR 5xx by route family: complements the built-in run.googleapis.com/request_count ratio alert with"
  note "a per-route breakdown for triage."
  write_json metric-ssr-5xx <<EOF
{
  "description": "WriteOff SSR 5xx responses by /api route family (${SSR_SERVICE})",
  "filter": "${ssr} AND httpRequest.status>=500",
  "metricDescriptor": {
    "metricKind": "DELTA", "valueType": "INT64", "unit": "1",
    "labels": [ { "key": "route", "valueType": "STRING", "description": "First /api path segment" } ]
  },
  "labelExtractors": { "route": "${route_extractor}" }
}
EOF
  ensure_log_metric writeoff_ssr_5xx "$JSON_FILE"

  note "Scheduled-sync heartbeat: functions/src/index.ts logs 'Scheduled bank synchronization completed' once per"
  note "run (every 2 h). Its absence drives the missed-sync alert below."
  write_json metric-scheduled-sync-completed <<EOF
{
  "description": "WriteOff scheduled bank sync completions (heartbeat for ${SYNC_FUNCTION})",
  "filter": "((resource.type=\"cloud_function\" AND resource.labels.function_name=\"${SYNC_FUNCTION}\") OR (resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SYNC_SERVICE}\")) AND jsonPayload.message=\"Scheduled bank synchronization completed\"",
  "metricDescriptor": { "metricKind": "DELTA", "valueType": "INT64", "unit": "1" }
}
EOF
  ensure_log_metric writeoff_scheduled_sync_completed "$JSON_FILE"
}

section_channel() {
  heading "Notification channel (email)"
  note "One channel object, referenced by every policy and the budget. Re-runs reuse it by display name."
  local existing=""
  existing="$(capture gcloud beta monitoring channels list --project "$PROJECT" \
    --filter "displayName=\"${CHANNEL_DISPLAY_NAME}\"" --format 'value(name)' | head -n 1)"
  if [[ -n "$existing" ]]; then
    CHANNEL_NAME="$existing"
    note "Reusing $CHANNEL_NAME"
  else
    printf '#   (exists?) %s\n' "$(show gcloud beta monitoring channels list --project "$PROJECT" --filter "displayName=\"${CHANNEL_DISPLAY_NAME}\"" --format 'value(name)')"
    run_capture gcloud beta monitoring channels create --project "$PROJECT" --display-name "$CHANNEL_DISPLAY_NAME" \
      --description "Primary alert recipient for WriteOff production" --type email \
      --channel-labels "email_address=${ALERT_EMAIL}" --user-labels app=writeoff,env=production --format 'value(name)'
    if [[ "$MODE" == apply ]]; then
      CHANNEL_NAME="$CAPTURED"
      [[ -n "$CHANNEL_NAME" ]] || { echo "FAIL: channel create returned no resource name." >&2; exit 1; }
    fi
  fi
}

ensure_policy() {
  local display="$1" file="$2" existing=""
  existing="$(capture gcloud monitoring policies list --project "$PROJECT" --filter "displayName=\"${display}\"" --format 'value(name)' | head -n 1)"
  if [[ -n "$existing" ]]; then
    run gcloud monitoring policies update "$existing" --policy-from-file "$file" --project "$PROJECT" --quiet
  else
    printf '#   (exists?) %s\n' "$(show gcloud monitoring policies list --project "$PROJECT" --filter "displayName=\"${display}\"" --format 'value(name)')"
    run gcloud monitoring policies create --policy-from-file "$file" --project "$PROJECT"
  fi
}

section_alerts() {
  heading "Alert policies"
  local runbook="See docs/PRODUCTION_GO_LIVE_RUNBOOK_2026-09-17.md (rollback trigger criteria) and docs/SUPPORT_RUNBOOK_2026-09-17.md."
  local labels='"userLabels": { "app": "writeoff", "env": "production", "managed_by": "production-observability-sh" }'
  local ssr_run="resource.type = \\\"cloud_run_revision\\\" AND resource.labels.service_name = \\\"${SSR_SERVICE}\\\""
  local display

  display="WriteOff SSR 5xx ratio > 2% (5 min)"
  note "Ratio of 5xx to all requests on the SSR service over 5-minute windows; fires on the first breach."
  note "Uses the built-in request_count metric so it works even if request logging is later excluded."
  write_json policy-ssr-5xx-ratio <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "5xx / all requests on ${SSR_SERVICE} > 2%",
    "conditionThreshold": {
      "filter": "${ssr_run} AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\"",
      "aggregations": [ { "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_DELTA", "crossSeriesReducer": "REDUCE_SUM", "groupByFields": [ "resource.labels.service_name" ] } ],
      "denominatorFilter": "${ssr_run} AND metric.type = \"run.googleapis.com/request_count\"",
      "denominatorAggregations": [ { "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_DELTA", "crossSeriesReducer": "REDUCE_SUM", "groupByFields": [ "resource.labels.service_name" ] } ],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.02,
      "duration": "0s",
      "trigger": { "count": 1 },
      "evaluationMissingData": "EVALUATION_MISSING_DATA_INACTIVE"
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "1800s" },
  "documentation": { "mimeType": "text/markdown", "content": "SSR service ${SSR_SERVICE} is returning more than 2% 5xx. Check Cloud Run logs by route (metric writeoff_ssr_5xx). ${runbook}" },
  ${labels}
}
EOF
  ensure_policy "$display" "$JSON_FILE"

  display="WriteOff SSR p95 latency > 3 s (5 min)"
  note "p95 of request latency across all revisions, 5-minute windows, must persist for 5 minutes."
  note "Cold starts (minInstances 0) and event-loop stalls from PDF/OCR routes show up here first."
  write_json policy-ssr-p95 <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "p95 request latency on ${SSR_SERVICE} > 3000 ms",
    "conditionThreshold": {
      "filter": "${ssr_run} AND metric.type = \"run.googleapis.com/request_latencies\"",
      "aggregations": [ { "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_DELTA", "crossSeriesReducer": "REDUCE_PERCENTILE_95", "groupByFields": [ "resource.labels.service_name" ] } ],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 3000,
      "duration": "300s",
      "trigger": { "count": 1 },
      "evaluationMissingData": "EVALUATION_MISSING_DATA_INACTIVE"
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "1800s" },
  "documentation": { "mimeType": "text/markdown", "content": "p95 latency above 3 s on ${SSR_SERVICE}. Compare instance count and CPU utilization; see docs/PRODUCTION_SCALE_2026-09-17.md for the scale posture. ${runbook}" },
  ${labels}
}
EOF
  ensure_policy "$display" "$JSON_FILE"

  display="WriteOff Cloud Functions error rate > 10% (10 min)"
  note "Executions with status != ok as a share of all executions, per function, over 10-minute windows."
  note "The scheduler runs once per 2 h, so a single failed run is 100% for that window: that is intended,"
  note "because one failure already means users' bank data did not refresh (BANK_SYNC_RETRY_REQUIRED)."
  write_json policy-functions-errors <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "execution errors / executions per function > 10%",
    "conditionThreshold": {
      "filter": "resource.type = \"cloud_function\" AND metric.type = \"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status != \"ok\"",
      "aggregations": [ { "alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_DELTA", "crossSeriesReducer": "REDUCE_SUM", "groupByFields": [ "resource.labels.function_name" ] } ],
      "denominatorFilter": "resource.type = \"cloud_function\" AND metric.type = \"cloudfunctions.googleapis.com/function/execution_count\"",
      "denominatorAggregations": [ { "alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_DELTA", "crossSeriesReducer": "REDUCE_SUM", "groupByFields": [ "resource.labels.function_name" ] } ],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.1,
      "duration": "0s",
      "trigger": { "count": 1 },
      "evaluationMissingData": "EVALUATION_MISSING_DATA_INACTIVE"
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "3600s" },
  "documentation": { "mimeType": "text/markdown", "content": "A Cloud Function (syncAllUsersTransactions, queueBankTransactionAnalysis or processBankTransactionAnalysis) is failing. Read its logs: gcloud functions logs read FUNCTION --gen2 --region ${REGION}. Configuration errors surface as BANK_SYNC_CONFIGURATION_REQUIRED / ANALYSIS_WORKER_CONFIGURATION_REQUIRED. ${runbook}" },
  ${labels}
}
EOF
  ensure_policy "$display" "$JSON_FILE"

  display="WriteOff scheduled bank sync silent for ${SYNC_ABSENCE_SECONDS}s"
  note "Metric-absence on the completion heartbeat. Requested window: 26 h. Cloud Monitoring's documented maximum"
  note "absence duration is 23.5 h (84600 s); the policy uses that maximum, which is stricter than 26 h."
  note "If you need exactly 26 h, publish a custom 'seconds since last completion' gauge and threshold it instead."
  write_json policy-scheduled-sync-absent <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "no 'Scheduled bank synchronization completed' log for ${SYNC_ABSENCE_SECONDS}s",
    "conditionAbsent": {
      "filter": "metric.type = \"logging.googleapis.com/user/writeoff_scheduled_sync_completed\"",
      "aggregations": [ { "alignmentPeriod": "3600s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" } ],
      "duration": "${SYNC_ABSENCE_SECONDS}s",
      "trigger": { "count": 1 }
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "7200s" },
  "documentation": { "mimeType": "text/markdown", "content": "syncAllUsersTransactions has not logged a completion for ${SYNC_ABSENCE_SECONDS}s (schedule: every 2 h). Check the Cloud Scheduler job firebase-schedule-syncAllUsersTransactions-${REGION}, the function's logs, and that CLOUD_FUNCTION_SECRET is bound. ${runbook}" },
  ${labels}
}
EOF
  ensure_policy "$display" "$JSON_FILE"

  display="WriteOff Firestore reads > 3x 7-day baseline"
  note "PromQL: 1-hour read rate compared with the average rate over the trailing 7 days, sustained 10 minutes."
  note "The second clause (> 1 read/s) suppresses the alert while the 7-day baseline is still near zero."
  note "Reads are the dominant Firestore cost driver in this app (collection-group transaction scans per load)."
  write_json policy-firestore-reads-spike <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "document reads: 1h rate > 3 x 7d rate",
    "conditionPrometheusQueryLanguage": {
      "query": "sum(rate(firestore_googleapis_com:document_read_count[1h])) > 3 * sum(rate(firestore_googleapis_com:document_read_count[7d])) and sum(rate(firestore_googleapis_com:document_read_count[1h])) > 1",
      "duration": "600s",
      "evaluationInterval": "300s",
      "alertRule": "WriteOffFirestoreReadsSpike",
      "labels": { "severity": "warning" }
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "3600s" },
  "documentation": { "mimeType": "text/markdown", "content": "Firestore document reads are running at more than 3x the 7-day baseline. Look for a runaway client listener, a loop in a sync, or a scraping session (rate_limits documents show per-owner windows). Cost impact: see docs/PRODUCTION_SCALE_2026-09-17.md. ${runbook}" },
  ${labels}
}
EOF
  ensure_policy "$display" "$JSON_FILE"
}

section_uptime() {
  heading "Uptime check https://${UPTIME_HOST}${UPTIME_PATH}"
  note "The login page is SSR-rendered, so a passing check proves DNS, TLS, Hosting, the Cloud Run service and"
  note "Next.js rendering end to end from three or more regions every 5 minutes. --validate-ssl also catches"
  note "certificate problems before users do."
  local existing=""
  existing="$(capture gcloud monitoring uptime list-configs --project "$PROJECT" --filter "displayName=\"${UPTIME_DISPLAY_NAME}\"" --format 'value(name)' | head -n 1)"
  if [[ -n "$existing" ]]; then
    UPTIME_CHECK_ID="${existing##*/}"
    note "Reusing uptime check $existing"
  else
    printf '#   (exists?) %s\n' "$(show gcloud monitoring uptime list-configs --project "$PROJECT" --filter "displayName=\"${UPTIME_DISPLAY_NAME}\"" --format 'value(name)')"
    run_capture gcloud monitoring uptime create "$UPTIME_DISPLAY_NAME" --project "$PROJECT" --resource-type uptime-url \
      --resource-labels "host=${UPTIME_HOST},project_id=${PROJECT}" --protocol https --port 443 --path "$UPTIME_PATH" \
      --request-method get --status-classes 2xx --validate-ssl=true --period 5 --timeout 10 \
      --user-labels app=writeoff,env=production --format 'value(name)'
    if [[ "$MODE" == apply ]]; then
      UPTIME_CHECK_ID="${CAPTURED##*/}"
      [[ -n "$UPTIME_CHECK_ID" ]] || { echo "FAIL: uptime create returned no resource name." >&2; exit 1; }
    fi
  fi
  local display="WriteOff login page uptime check failing"
  note "Standard uptime alert shape: count of failed checkers over a 20-minute alignment; fires when more than"
  note "one region reports failure for 60 s, which filters single-region blips."
  write_json policy-uptime <<EOF
{
  "displayName": "${display}",
  "combiner": "OR",
  "conditions": [ {
    "displayName": "https://${UPTIME_HOST}${UPTIME_PATH} check failed from >1 region",
    "conditionThreshold": {
      "filter": "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${UPTIME_CHECK_ID}\" AND resource.type = \"uptime_url\"",
      "aggregations": [ { "alignmentPeriod": "1200s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": [ "resource.label.*" ] } ],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 1,
      "duration": "60s",
      "trigger": { "count": 1 }
    }
  } ],
  "notificationChannels": [ "${CHANNEL_NAME}" ],
  "alertStrategy": { "autoClose": "1800s" },
  "documentation": { "mimeType": "text/markdown", "content": "https://${UPTIME_HOST}${UPTIME_PATH} is failing its uptime check. Confirm the Hosting release and the ${SSR_SERVICE} revision; this is a rollback trigger. See docs/PRODUCTION_GO_LIVE_RUNBOOK_2026-09-17.md." },
  "userLabels": { "app": "writeoff", "env": "production", "managed_by": "production-observability-sh" }
}
EOF
  ensure_policy "$display" "$JSON_FILE"
}

resolve_billing_account() {
  if [[ -z "$BILLING_ACCOUNT" && "$MODE" != print ]]; then
    local name
    name="$(gcloud billing projects describe "$PROJECT" --format 'value(billingAccountName)' 2>/dev/null || true)"
    BILLING_ACCOUNT="${name#billingAccounts/}"
  fi
  BILLING_ACCOUNT="${BILLING_ACCOUNT:-REPLACE_BILLING_ACCOUNT_ID}"
}

section_budget() {
  heading "Monthly budget (${BUDGET_AMOUNT} USD)"
  note "Budgets never stop spend; they notify. Thresholds at 50%, 90%, 100% actual and 100% forecasted, routed"
  note "to the same email channel as the alerts and to Billing Account Administrators by default."
  note "Requires the Billing Account Costs Manager (or Administrator) role on the billing account."
  resolve_billing_account
  local existing=""
  existing="$(capture gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --filter "displayName=\"${BUDGET_DISPLAY_NAME}\"" --format 'value(name)' | head -n 1)"
  # Shared by create and update; threshold rules differ in flag shape between the two verbs.
  local args=(--display-name "$BUDGET_DISPLAY_NAME" --budget-amount "${BUDGET_AMOUNT}USD" --calendar-period month
    --filter-projects "projects/${PROJECT}"
    --notifications-rule-monitoring-notification-channels "$CHANNEL_NAME")
  if [[ -n "$existing" ]]; then
    note "update replaces the rule set from a file (percent is 1.0-based, same as the API's thresholdPercent)."
    write_json budget-threshold-rules <<EOF
[
  { "thresholdPercent": 0.5, "spendBasis": "CURRENT_SPEND" },
  { "thresholdPercent": 0.9, "spendBasis": "CURRENT_SPEND" },
  { "thresholdPercent": 1.0, "spendBasis": "CURRENT_SPEND" },
  { "thresholdPercent": 1.0, "spendBasis": "FORECASTED_SPEND" }
]
EOF
    run gcloud billing budgets update "$existing" "${args[@]}" --threshold-rules-from-file "$JSON_FILE"
  else
    printf '#   (exists?) %s\n' "$(show gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --filter "displayName=\"${BUDGET_DISPLAY_NAME}\"")"
    run gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" "${args[@]}" \
      --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
      --threshold-rule percent=1.0,basis=forecasted-spend
  fi
}

verify_all() {
  heading "VERIFY: Firestore protection"
  read_cmd gcloud firestore databases describe --database "$DATABASE" --project "$PROJECT" \
    --format 'yaml(locationId,pointInTimeRecoveryEnablement,versionRetentionPeriod,earliestVersionTime,deleteProtectionState)'
  note "expect pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED and deleteProtectionState: DELETE_PROTECTION_ENABLED"

  heading "VERIFY: backup bucket"
  read_cmd gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" \
    --format 'yaml(location,storageClass,iamConfiguration,retentionPolicy,encryption,softDeletePolicy)'
  note "expect uniformBucketLevelAccess.enabled: true, publicAccessPrevention: enforced, retentionPeriod: 34560000 (400 d)"
  read_cmd gcloud storage ls "gs://$BUCKET/"
  note "expect one timestamped folder per completed export"

  heading "VERIFY: managed backups"
  read_cmd gcloud firestore backups schedules list --database "$DATABASE" --project "$PROJECT"
  read_cmd gcloud firestore backups list --project "$PROJECT" --format 'table(name.basename(),database,state,expireTime)'

  heading "VERIFY: weekly export job"
  read_cmd gcloud scheduler jobs describe "$EXPORT_JOB" --location "$REGION" --project "$PROJECT" \
    --format 'yaml(state,schedule,timeZone,lastAttemptTime,status,httpTarget.uri,httpTarget.oauthToken.serviceAccountEmail)'
  note "expect state: ENABLED and, after the first run, status.code absent or 0"
  read_cmd gcloud firestore operations list --database "$DATABASE" --project "$PROJECT" --limit 5

  heading "VERIFY: log-based metrics"
  read_cmd gcloud logging metrics list --project "$PROJECT" --filter 'name:writeoff_' --format 'table(name,description)'
  note "expect writeoff_worker_retry_required, writeoff_subscription_unavailable, writeoff_review_required_422, writeoff_ssr_5xx, writeoff_scheduled_sync_completed"

  heading "VERIFY: notification channel, alert policies, uptime check"
  read_cmd gcloud beta monitoring channels list --project "$PROJECT" --filter 'displayName:"WriteOff"' --format 'table(name,type,enabled,verificationStatus)'
  read_cmd gcloud monitoring policies list --project "$PROJECT" --filter 'displayName:"WriteOff"' --format 'table(displayName,enabled,conditions[0].displayName)'
  note "expect 6 enabled policies: 5xx ratio, p95 latency, functions error rate, scheduled sync silent, Firestore reads, uptime"
  read_cmd gcloud monitoring uptime list-configs --project "$PROJECT" --filter 'displayName:"WriteOff"' \
    --format 'table(name.basename(),displayName,monitoredResource.labels.host,httpCheck.path,period)'

  heading "VERIFY: budget"
  resolve_billing_account
  read_cmd gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --filter 'displayName:"WriteOff"' \
    --format 'table(displayName,amount.specifiedAmount.units,thresholdRules[].thresholdPercent)'
}

# ----------------------------------------------------------------------------- main
printf '# production-observability.sh mode=%s project=%s region=%s ssr=%s bucket=gs://%s\n' "$MODE" "$PROJECT" "$REGION" "$SSR_SERVICE" "$BUCKET"
if [[ "$MODE" == verify ]]; then
  verify_all
  exit 0
fi
section_apis
section_firestore_protection
section_bucket
section_backups
section_export_job
section_log_metrics
section_channel
section_alerts
section_uptime
section_budget
printf '\n# Done (%s). Run with --verify to read back state.\n' "$MODE"
