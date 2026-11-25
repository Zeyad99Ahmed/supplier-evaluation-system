#!/usr/bin/env bash
# Shared settings for the Floci / AWS scripts (Git Bash, like the labs). Sourced by the other scripts.
set -euo pipefail
export MSYS_NO_PATHCONV=1            # stop Git Bash turning /api/... into Windows paths (Lab 7 tip)
export AWS_PROFILE="${AWS_PROFILE:-floci}"
export AWS_PAGER=""

# D:/cloud/... style on Git Bash (pwd -W) so node and the Windows AWS CLI both understand it
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && (pwd -W 2>/dev/null || pwd))"
cd "$ROOT"   # file:// and fileb:// arguments below are relative to the project folder, as in the labs
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
SERVICES=(auth-service supplier-service order-service evaluation-service)
LAMBDA_RUNTIME="${LAMBDA_RUNTIME:-nodejs22.x}"   # Lab 7 used nodejs24.x; set LAMBDA_RUNTIME=nodejs24.x if your Floci has it
WEB_BUCKET="${WEB_BUCKET:-ses-web}"
ENV_FILE="$ROOT/infra/.env.floci"

if [ "$ACCOUNT" = "000000000000" ]; then
  TARGET=floci
  api_url() { echo "http://$1.execute-api.localhost.floci.io:4566"; }
  SITE_ORIGIN="http://localhost:4566"
  SITE_URL="http://localhost:4566/$WEB_BUCKET/index.html"
else
  TARGET=aws
  api_url() { echo "https://$1.execute-api.$REGION.amazonaws.com"; }
  SITE_ORIGIN="http://$WEB_BUCKET.s3-website-$REGION.amazonaws.com"
  SITE_URL="$SITE_ORIGIN/index.html"
fi

fn_name() { echo "ses-$1"; }
role_name() { echo "ses-$1-role"; }
api_name() { echo "ses-$1-api"; }
upper() { echo "$1" | tr 'a-z-' 'A-Z_'; }   # order-service -> ORDER_SERVICE
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# Load (or create) the git-ignored secrets file.
load_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    log "Creating $ENV_FILE with random secrets (git-ignored)"
    rnd() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }
    sed -e "s/^PG_OWNER_PASSWORD=.*/PG_OWNER_PASSWORD=$(rnd 18)/" \
        -e "s/^AUTH_DB_PASSWORD=.*/AUTH_DB_PASSWORD=$(rnd 18)/" \
        -e "s/^SUPPLIER_DB_PASSWORD=.*/SUPPLIER_DB_PASSWORD=$(rnd 18)/" \
        -e "s/^ORDER_DB_PASSWORD=.*/ORDER_DB_PASSWORD=$(rnd 18)/" \
        -e "s/^EVALUATION_DB_PASSWORD=.*/EVALUATION_DB_PASSWORD=$(rnd 18)/" \
        -e "s/^JWT_SECRET=.*/JWT_SECRET=$(rnd 48)/" \
        -e "s/^INTERNAL_JWT_SECRET=.*/INTERNAL_JWT_SECRET=$(rnd 48)/" \
        -e "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=Admin$(node -e "process.stdout.write(String(require('crypto').randomInt(100000,999999)))")x/" \
        "$ROOT/infra/.env.floci.example" > "$ENV_FILE"
    chmod 600 "$ENV_FILE" || true
  fi
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
  if grep -q CHANGE_ME "$ENV_FILE"; then echo "Replace every CHANGE_ME in $ENV_FILE first." >&2; exit 1; fi
}

db_url() { # db_url <role> <password> <host:port>
  local q=""; [ "${DB_SSL:-}" = "require" ] && q="?sslmode=require"
  local pw; pw="$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$2")"
  echo "postgres://$1:$pw@$3/${DB_NAME:-supplierdb}$q"
}

db_role() { case "$1" in auth-service) echo auth_svc;; supplier-service) echo supplier_svc;; order-service) echo order_svc;; evaluation-service) echo evaluation_svc;; esac; }
db_pw_var() { case "$1" in auth-service) echo AUTH_DB_PASSWORD;; supplier-service) echo SUPPLIER_DB_PASSWORD;; order-service) echo ORDER_DB_PASSWORD;; evaluation-service) echo EVALUATION_DB_PASSWORD;; esac; }

api_id_of() { aws apigatewayv2 get-apis --query "Items[?Name=='$(api_name "$1")'].ApiId | [0]" --output text 2>/dev/null | grep -v None || true; }
