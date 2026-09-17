#!/usr/bin/env bash
# =============================================================================
# WriteOff production secrets + IAM kit — enumerate, provision (print), verify
#
# Target: Firebase project writeoff-23910. Every name below is read from the
# code, not guessed:
#   scripts/production-preflight.mjs      validateProductionConfiguration(): requireValue()
#                                         plus the regex/length checks on secret-bearing names
#   functions/src/index.ts                defineSecret('CLOUD_FUNCTION_SECRET')
#   functions-analysis/src/index.ts       defineSecret('ANALYSIS_WORKER_SECRET')
#   scripts/prepare-production-release.mjs the non-secret Functions .env files it writes
#   app/api/**, lib/**                     process.env reads that consume the values
#
# Modes (exactly one):
#   --print   default. Lists every secret, where it lives at runtime, the IAM
#             bindings, and the exact gcloud commands to provision them. Runs
#             nothing and needs no credentials.
#   --verify  Read-only. For each Secret Manager secret: exists? has an ENABLED
#             version? runtime SA holds secretAccessor? Lists the deploy service
#             account's roles and, after a deploy, the Functions secret bindings.
#             Secret VALUES are never accessed, printed or compared by this script.
#
# Usage:
#   scripts/production-secrets.sh --project writeoff-23910
#   scripts/production-secrets.sh --project writeoff-23910 --verify \
#       --deploy-sa DEPLOYER@writeoff-23910.iam.gserviceaccount.com \
#       [--runtime-sa 930596534802-compute@developer.gserviceaccount.com]
# =============================================================================
set -euo pipefail

MODE=print
PROJECT=""
PROJECT_NUMBER="930596534802"   # public; pinned by the preflight as the Firebase sender id
REGION="us-central1"
DEPLOY_SA=""
RUNTIME_SA=""
SSR_FUNCTION="ssrwriteoff23910"

usage() { sed -n '2,28p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print) MODE=print ;;
    --verify) MODE=verify ;;
    --project) PROJECT="${2:-}"; shift ;;
    --project-number) PROJECT_NUMBER="${2:-}"; shift ;;
    --region) REGION="${2:-}"; shift ;;
    --deploy-sa) DEPLOY_SA="${2:-}"; shift ;;
    --runtime-sa) RUNTIME_SA="${2:-}"; shift ;;
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
if [[ "$MODE" == verify ]] && ! command -v gcloud >/dev/null 2>&1; then
  echo "FAIL: gcloud is required for --verify (use --print without credentials)." >&2
  exit 2
fi
# 2nd-gen functions (all three codebases here, including the frameworks SSR
# function) run as the default compute service account unless firebase.json sets
# `serviceAccount`; it does not. Pass --runtime-sa if production differs.
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
DEPLOY_SA="${DEPLOY_SA:-REPLACE_DEPLOY_SA@${PROJECT}.iam.gserviceaccount.com}"
PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
EVENTARC_AGENT="service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com"

# ----------------------------------------------------------------------------- inventory
# Secret Manager secrets that MUST exist before `firebase deploy --non-interactive`:
# firebase-tools binds each defineSecret() name to the function and refuses to
# deploy when the secret is missing (it cannot prompt in CI).
# name | consumer function(s) | declared at | verified by the SSR at | preflight rule
FUNCTION_SECRETS=(
  "CLOUD_FUNCTION_SECRET|syncAllUsersTransactions (functions, codebase default)|functions/src/index.ts:15 defineSecret, :21 secrets:[...]|app/api/plaid/sync-transactions-internal/route.ts:21 header x-cloud-function-secret|>= 32 characters"
  "ANALYSIS_WORKER_SECRET|queueBankTransactionAnalysis + processBankTransactionAnalysis (functions-analysis, codebase analysis)|functions-analysis/src/index.ts:5 defineSecret, :8 secrets:[...]|app/api/internal/analysis-worker/route.ts:16 header x-analysis-worker-secret|>= 32 characters"
)
FUNCTION_TARGETS=(
  "syncAllUsersTransactions|CLOUD_FUNCTION_SECRET"
  "queueBankTransactionAnalysis|ANALYSIS_WORKER_SECRET"
  "processBankTransactionAnalysis|ANALYSIS_WORKER_SECRET"
)

# Server-only secrets the preflight REQUIRES in the release env file. They reach
# the SSR function inside the packaged .env.production.local (Next.js reads it at
# build and at server start) — they are NOT Secret Manager bindings. Keeping a
# Secret Manager secret of the same name is the recommended source of truth for
# materializing that file; --verify reports these as RECOMMENDED, not REQUIRED.
# name | preflight rule (scripts/production-preflight.mjs) | consumer
SSR_SECRETS=(
  "PLAID_SECRET|requireValue (line 96)|lib/plaid/config.ts:45 — production secret for the reviewed PLAID_CLIENT_ID"
  "OPENAI_API_KEY|requireValue (line 96)|lib/openai/client.ts — the only OpenAI credential name"
  "PLAID_TOKEN_ENCRYPTION_KEY|64 hex chars, distinct from SSN key (lines 100-103)|lib/plaid/connections.ts:31 — encrypts stored Plaid access tokens"
  "SSN_ENCRYPTION_KEY|64 hex chars (lines 100-103) — PRESERVE the existing production key|lib/security/utils.ts:88 — stored taxpayer identifiers become unreadable if rotated"
  "ANALYSIS_WORKER_SECRET|>= 32 chars (line 104) — same value as the Secret Manager secret|app/api/internal/analysis-worker/route.ts:16"
  "CLOUD_FUNCTION_SECRET|>= 32 chars (line 104) — same value as the Secret Manager secret|app/api/plaid/sync-transactions-internal/route.ts:21"
  "STRIPE_SECRET_KEY|sk_live_ or rk_live_ prefix (line 105)|lib/stripe/subscription-sync.ts, lib/stripe/cancel-subscription.ts, app/api/stripe/*"
  "STRIPE_WEBHOOK_SECRET|whsec_ prefix (line 108)|app/api/stripe/webhook/route.ts"
)

# Runtime-read, not enforced by the preflight. Listed so nobody invents a binding
# for them; each has a documented fallback.
OPTIONAL_SECRETS=(
  "RESEND_API_KEY|app/api/cpa-question/route.ts:76|absent: CPA questions are logged server-side instead of e-mailed"
  "RATE_LIMIT_HASH_SECRET|lib/security/rate-limit.ts:101|absent: rate-limit keys use plain SHA-256 instead of HMAC (still safe)"
  "FIREBASE_ADMIN_PRIVATE_KEY (+ FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PROJECT_ID)|lib/firebase/admin.ts:9-13|OMIT on Cloud Run: Application Default Credentials of the runtime SA are used"
)

# Non-secret Functions env written by scripts/prepare-production-release.mjs:54-55
# into <release>/functions*/.env.writeoff-23910 (firebase-tools loads them at deploy).
FUNCTION_ENV=(
  "functions/.env.${PROJECT}|SITE_URL, PLAID_ENV=production, PLAID_CLIENT_ID|functions/src/index.ts:12-14 defineString"
  "functions-analysis/.env.${PROJECT}|ANALYSIS_WORKER_ORIGIN|functions-analysis/src/index.ts:6 defineString"
)

# Deploy service account (the JSON key in the GitHub `production` environment
# secret FIREBASE_SERVICE_ACCOUNT). Project-level roles, least privilege for
# `firebase deploy --only hosting,firestore,storage,functions`:
DEPLOY_ROLES=(
  "roles/firebasehosting.admin|hosting: create versions, finalize and release"
  "roles/cloudfunctions.developer|functions + frameworks: create/update the 2nd-gen functions including the SSR function ${SSR_FUNCTION}"
  "roles/run.admin|frameworks/functions deploy sets Cloud Run IAM (allUsers invoker on public HTTPS functions) and service settings"
  "roles/firebaserules.admin|firestore.rules and storage.rules rulesets + releases"
  "roles/datastore.indexAdmin|firestore.indexes.json (create/list/delete composite indexes)"
  "roles/firebase.viewer|resolve the project (firebase.projects.get) and read enabled services"
)

# ----------------------------------------------------------------------------- helpers
q() {
  local arg="$1"
  if [[ "$arg" =~ ^[A-Za-z0-9_./:=@,+%-]+$ ]]; then printf '%s' "$arg"; else printf "'%s'" "${arg//\'/\'\\\'\'}"; fi
}
show() { local out="" a; for a in "$@"; do out+="$(q "$a") "; done; printf '%s\n' "${out% }"; }
note() { printf '# %s\n' "$*"; }
heading() { printf '\n# ===== %s =====\n' "$*"; }
# Read-only command: echoed, executed only in --verify. Output is passed through.
read_cmd() { show "$@"; if [[ "$MODE" == verify ]]; then "$@" || true; fi; }
# Read-only command whose stdout is captured (empty when unavailable).
capture() { if [[ "$MODE" == verify ]]; then "$@" 2>/dev/null || true; else printf ''; fi; }
field() { local record="$1" index="$2"; printf '%s' "$record" | cut -d'|' -f"$index"; }

# ----------------------------------------------------------------------------- print sections
print_inventory() {
  heading "A. Secret Manager secrets REQUIRED before deploy (Functions defineSecret bindings)"
  local record
  for record in "${FUNCTION_SECRETS[@]}"; do
    note "$(field "$record" 1)"
    note "    bound to : $(field "$record" 2)"
    note "    declared : $(field "$record" 3)"
    note "    checked  : $(field "$record" 4)"
    note "    rule     : $(field "$record" 5); the SSR env file must carry the identical value"
  done
  note "firebase-tools binds each as secretEnvironmentVariables{key=NAME, secret=NAME, version=latest} on deploy."

  heading "B. Server-only secrets the preflight REQUIRES in the SSR release env file (not Secret Manager bindings)"
  for record in "${SSR_SECRETS[@]}"; do
    note "$(field "$record" 1)  — $(field "$record" 2)"
    note "    consumer : $(field "$record" 3)"
  done
  note "Delivery: scripts/prepare-production-release.mjs writes the env file into the release directory as"
  note ".env.production.local; the frameworks deploy packages it with the SSR function source. Anyone with"
  note "cloudfunctions.functions.sourceCodeGet on ${SSR_FUNCTION} can read it, so keep deployer/viewer access tight."

  heading "C. Optional runtime secrets (no preflight rule; documented fallback)"
  for record in "${OPTIONAL_SECRETS[@]}"; do
    note "$(field "$record" 1)  — read at $(field "$record" 2)"
    note "    $(field "$record" 3)"
  done

  heading "D. Non-secret Functions environment (written by prepare-production-release)"
  for record in "${FUNCTION_ENV[@]}"; do
    note "$(field "$record" 1): $(field "$record" 2)   ($(field "$record" 3))"
  done
}

print_provisioning() {
  heading "E. Provision the two Functions secrets (run once; values arrive on stdin, never as arguments)"
  note "Automatic replication keeps the secret in the same project; --data-file=- reads the value from stdin so"
  note "it never lands in shell history or process listings. Generate 32+ random bytes for each, e.g.:"
  note "  openssl rand -hex 32 | gcloud secrets versions add NAME --data-file=- --project ${PROJECT}"
  note "(then put the same value in the SSR env file; the preflight only checks length >= 32)"
  local record name
  for record in "${FUNCTION_SECRETS[@]}"; do
    name="$(field "$record" 1)"
    note "--- ${name} ---"
    show gcloud secrets create "$name" --replication-policy automatic --project "$PROJECT" --labels app=writeoff,env=production
    note "  (if it already exists, skip create and only add a version):"
    show gcloud secrets versions add "$name" --data-file=- --project "$PROJECT"
  done

  heading "F. Runtime service account access — secretAccessor on the two secrets ONLY (no project-level grant)"
  note "The SSR function does not read Secret Manager, so it needs no accessor role. firebase-tools would add these"
  note "bindings itself during deploy, but pre-granting means the deployer never needs secretmanager.*.setIamPolicy."
  for record in "${FUNCTION_SECRETS[@]}"; do
    name="$(field "$record" 1)"
    show gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" \
      --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor
  done

  heading "G. Recommended: keep the SSR secrets in Secret Manager too, and materialize the env file from them"
  note "Same create/add-version pattern as E for each name in section B (skip the two already created)."
  note "When building the env file for the GitHub secret PRODUCTION_ENV_FILE, pull values with"
  note "  gcloud secrets versions access latest --secret NAME --project ${PROJECT}"
  note "into a 0600 file on an encrypted disk; the preflight validates formats, the deploy script builds with"
  note "secret-free shell env (buildEnvironment in scripts/deploy-production-release.mjs)."

  heading "H. Deploy service account — project roles (least privilege for the coordinated deploy)"
  for record in "${DEPLOY_ROLES[@]}"; do
    note "$(field "$record" 1): $(field "$record" 2)"
    show gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${DEPLOY_SA}" \
      --role "$(field "$record" 1)" --condition None
  done
  note "Service Account User on the runtime SA (required to deploy functions that run as it):"
  show gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT" \
    --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser
  note "Secret metadata read on the two bound secrets (firebase-tools confirms existence/version and, with the"
  note "runtime binding already present, does not need to change the secret IAM policy):"
  for record in "${FUNCTION_SECRETS[@]}"; do
    name="$(field "$record" 1)"
    show gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" \
      --member "serviceAccount:${DEPLOY_SA}" --role roles/secretmanager.viewer
  done
  note "NOT granted: roles/secretmanager.secretAccessor (deployer never reads values), roles/editor, roles/owner,"
  note "roles/datastore.owner, roles/storage.admin (Hosting and Functions uploads use signed URLs from their APIs)."

  heading "I. One-time service-agent bindings for the Firestore-triggered 2nd-gen functions (owner runs once)"
  note "functions-analysis has never been deployed to production (docs/PRODUCTION_CUTOVER_2026-09-16.md). On the"
  note "first deploy of a Firestore/Eventarc trigger firebase-tools tries to grant these; if the deployer cannot"
  note "set project IAM it only warns, and the trigger then fails to deliver events. Grant them up front:"
  show gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${PUBSUB_AGENT}" \
    --role roles/iam.serviceAccountTokenCreator --condition None
  show gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${EVENTARC_AGENT}" \
    --role roles/eventarc.serviceAgent --condition None
  show gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${RUNTIME_SA}" \
    --role roles/eventarc.eventReceiver --condition None
  show gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${RUNTIME_SA}" \
    --role roles/run.invoker --condition None

  heading "J. Release-review evidence for secretManagerBindings"
  note "Paste into .writeoff-production-migration-review.json -> secretManagerBindings.evidence (no values):"
  note "  1. Output of: scripts/production-secrets.sh --project ${PROJECT} --verify"
  note "     showing CLOUD_FUNCTION_SECRET and ANALYSIS_WORKER_SECRET exist, each with an ENABLED version, and"
  note "     serviceAccount:${RUNTIME_SA} as secretAccessor."
  note "  2. After deploy: gcloud functions describe <fn> --gen2 ... secretEnvironmentVariables for the three"
  note "     functions (section K of --verify) naming those secrets with version latest."
  note "  3. A statement that the SSR env file carries the same two values. Compare digests, never values:"
  note "       gcloud secrets versions access latest --secret NAME --project ${PROJECT} | sha256sum"
  note "       grep '^NAME=' <env-file> | cut -d= -f2- | tr -d '\"' | tr -d '\\n' | sha256sum"
  note "  4. The preflight PASS line from the deploy log (it enforces the formats in section B)."
  note "  5. Confirmation that SSN_ENCRYPTION_KEY is the pre-existing production key (preflight 'pending' item)."
}

# ----------------------------------------------------------------------------- verify
verify_secret() {
  local name="$1" requirement="$2" exists="no" enabled="no" accessor="no"
  if [[ -n "$(capture gcloud secrets describe "$name" --project "$PROJECT" --format 'value(name)')" ]]; then exists="yes"; fi
  if [[ "$exists" == yes ]]; then
    if [[ -n "$(capture gcloud secrets versions list "$name" --project "$PROJECT" --filter 'state=ENABLED' --format 'value(name)' --limit 1)" ]]; then enabled="yes"; fi
    if capture gcloud secrets get-iam-policy "$name" --project "$PROJECT" --flatten 'bindings[].members' \
        --filter 'bindings.role=roles/secretmanager.secretAccessor' --format 'value(bindings.members)' \
        | grep -qx "serviceAccount:${RUNTIME_SA}"; then accessor="yes"; fi
  fi
  printf '%-10s %-28s exists=%-4s enabled_version=%-4s runtime_accessor=%s\n' "$requirement" "$name" "$exists" "$enabled" "$accessor"
}

verify_all() {
  heading "K. VERIFY (read-only; values are never accessed)"
  note "Commands used per secret:"
  show gcloud secrets describe NAME --project "$PROJECT" --format 'value(name)'
  show gcloud secrets versions list NAME --project "$PROJECT" --filter 'state=ENABLED' --format 'value(name)' --limit 1
  show gcloud secrets get-iam-policy NAME --project "$PROJECT" --flatten 'bindings[].members' \
    --filter 'bindings.role=roles/secretmanager.secretAccessor' --format 'value(bindings.members)'
  echo
  local record name seen=" "
  for record in "${FUNCTION_SECRETS[@]}"; do
    name="$(field "$record" 1)"; seen+="$name "
    verify_secret "$name" REQUIRED
  done
  for record in "${SSR_SECRETS[@]}"; do
    name="$(field "$record" 1)"
    [[ "$seen" == *" $name "* ]] && continue
    seen+="$name "
    verify_secret "$name" RECOMMENDED
  done
  for record in "${OPTIONAL_SECRETS[@]}"; do
    name="$(field "$record" 1)"; name="${name%% *}"
    verify_secret "$name" OPTIONAL
  done
  note "REQUIRED rows must read exists=yes enabled_version=yes runtime_accessor=yes before dispatching the deploy."

  heading "VERIFY: deploy service account roles on the project"
  read_cmd gcloud projects get-iam-policy "$PROJECT" --flatten 'bindings[].members' \
    --filter "bindings.members=serviceAccount:${DEPLOY_SA}" --format 'value(bindings.role)'
  note "expect exactly: $(printf '%s ' "${DEPLOY_ROLES[@]%%|*}")"
  read_cmd gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" --project "$PROJECT" --flatten 'bindings[].members' \
    --filter "bindings.members=serviceAccount:${DEPLOY_SA}" --format 'value(bindings.role)'
  note "expect roles/iam.serviceAccountUser"

  heading "VERIFY: service-agent bindings for Eventarc/Firestore triggers"
  read_cmd gcloud projects get-iam-policy "$PROJECT" --flatten 'bindings[].members' \
    --filter "bindings.members=serviceAccount:${RUNTIME_SA}" --format 'value(bindings.role)'
  note "expect roles/eventarc.eventReceiver and roles/run.invoker among the runtime SA roles"
  read_cmd gcloud projects get-iam-policy "$PROJECT" --flatten 'bindings[].members' \
    --filter "bindings.members=serviceAccount:${PUBSUB_AGENT} OR bindings.members=serviceAccount:${EVENTARC_AGENT}" \
    --format 'table(bindings.members,bindings.role)'

  heading "VERIFY (post-deploy): Functions secret bindings and runtime identity"
  for record in "${FUNCTION_TARGETS[@]}"; do
    name="$(field "$record" 1)"
    read_cmd gcloud functions describe "$name" --gen2 --region "$REGION" --project "$PROJECT" \
      --format 'yaml(serviceConfig.serviceAccountEmail,serviceConfig.secretEnvironmentVariables)'
    note "expect secretEnvironmentVariables[].secret = $(field "$record" 2), version latest, serviceAccountEmail = ${RUNTIME_SA}"
  done
  read_cmd gcloud functions describe "$SSR_FUNCTION" --gen2 --region "$REGION" --project "$PROJECT" \
    --format 'yaml(serviceConfig.serviceAccountEmail,serviceConfig.secretEnvironmentVariables,serviceConfig.availableMemory,serviceConfig.maxInstanceCount,serviceConfig.minInstanceCount,serviceConfig.maxInstanceRequestConcurrency,serviceConfig.timeoutSeconds)'
  note "expect no secretEnvironmentVariables on the SSR function (values are packaged, see section B)."
  note "Never describe it with the default format: serviceConfig.environmentVariables would print plain values."
}

# ----------------------------------------------------------------------------- main
printf '# production-secrets.sh mode=%s project=%s runtime_sa=%s deploy_sa=%s\n' "$MODE" "$PROJECT" "$RUNTIME_SA" "$DEPLOY_SA"
if [[ "$MODE" == verify ]]; then
  verify_all
  exit 0
fi
print_inventory
print_provisioning
printf '\n# Done (print). Nothing was executed. Run with --verify to read back state.\n'
