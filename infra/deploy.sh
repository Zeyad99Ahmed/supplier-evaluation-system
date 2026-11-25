#!/usr/bin/env bash
# Deploys the Supplier Directory & Evaluation System to Floci (or real AWS with the same commands).
#
#   docker compose -f infra/floci/docker-compose.yml up -d     (needs PG_OWNER_PASSWORD - see below)
#   bash infra/deploy.sh all                 # everything: DB, 4 services, website, monitoring
#   bash infra/deploy.sh order-service       # ONE service only - each student deploys their own service
#   bash infra/deploy.sh db | web | monitoring
#
# Per service it creates/updates (AWS services used by every student):
#   Secrets Manager  ses/<service>            DATABASE_URL (own DB role), JWT secrets, API key (evaluation)
#   IAM              ses-<service>-role       trust: lambda.amazonaws.com; policy infra/iam/<service>-policy.json
#   Lambda           ses-<service>            Node.js, handler <service>/lambda.handler, env SECRET_ID=...
#   API Gateway      ses-<service>-api        HTTP API, only the routes in infra/routes.txt (+ OPTIONS for CORS)
#   CloudWatch Logs  /aws/lambda/ses-<service> 14-day retention, metric filters + alarms (monitoring.sh)
# Website: S3 bucket ses-web (deploy-frontend.sh).
source "$(dirname "$0")/lib.sh"
WHAT="${1:-all}"
load_env_file
export PG_OWNER_PASSWORD

start_containers() { # Floci + Postgres (skipped on real AWS or when using Neon)
  [ "$TARGET" = "floci" ] || return 0
  [ "${DB_SSL:-}" = "require" ] && return 0
  log "Starting Postgres container (docker compose)"
  docker compose -f "$ROOT/infra/floci/docker-compose.yml" up -d
  for i in $(seq 1 30); do
    docker exec ses-postgres pg_isready -U ses_owner -d supplierdb >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "Postgres did not become ready" >&2; exit 1
}

deploy_db() {
  start_containers
  log "Database: roles, schemas, grants, first admin ($DB_HOST_FOR_SETUP)"
  DATABASE_ADMIN_URL="$(db_url ses_owner "$PG_OWNER_PASSWORD" "$DB_HOST_FOR_SETUP")" node "$ROOT/scripts/db-setup.js"
}

deploy_secret() { # $1 service
  local svc=$1 name="ses/$1" role pwvar json
  role=$(db_role "$svc"); pwvar=$(db_pw_var "$svc")
  json=$(SVC="$svc" URL="$(db_url "$role" "${!pwvar}" "$DB_HOST_FOR_LAMBDA")" node -e '
    const s = { DATABASE_URL: process.env.URL, JWT_SECRET: process.env.JWT_SECRET, INTERNAL_JWT_SECRET: process.env.INTERNAL_JWT_SECRET };
    if (process.env.SVC === "evaluation-service" && process.env.EXCHANGE_API_KEY) s.EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY;
    process.stdout.write(JSON.stringify(s));')
  if aws secretsmanager describe-secret --secret-id "$name" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$name" --secret-string "$json" >/dev/null
    echo "secret $name updated (new version)"
  else
    aws secretsmanager create-secret --name "$name" --description "Runtime secrets for $svc" --secret-string "$json" >/dev/null
    echo "secret $name created"
  fi
}

deploy_role() { # $1 service
  local svc=$1 role; role=$(role_name "$svc")
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws iam create-role --role-name "$role" --assume-role-policy-document "file://infra/iam/lambda-trust-policy.json" >/dev/null
    echo "role $role created"
  fi
  local policy; policy=$(sed -e "s/\${REGION}/$REGION/g" -e "s/\${ACCOUNT}/$ACCOUNT/g" "$ROOT/infra/iam/$svc-policy.json")
  # inline policy = exactly this service's permissions (replaced on every deploy, so no stale rights remain)
  aws iam put-role-policy --role-name "$role" --policy-name "ses-$svc-least-privilege" --policy-document "$policy"
  echo "policy ses-$svc-least-privilege attached to $role"
}

deploy_function() { # $1 service
  local svc=$1 fn; fn=$(fn_name "$svc")
  node "$ROOT/scripts/package-lambda.js" "$svc"
  local vars="SERVICE_NAME=$svc,SECRET_ID=ses/$svc,NODE_ENV=production,SERVICE_TRANSPORT=lambda,CORS_ORIGINS=$SITE_ORIGIN"
  vars="$vars,SUPPLIER_SERVICE_FUNCTION=$(fn_name supplier-service),ORDER_SERVICE_FUNCTION=$(fn_name order-service),EVALUATION_SERVICE_FUNCTION=$(fn_name evaluation-service)"
  vars="$vars,APPROVAL_THRESHOLD_EGP=${APPROVAL_THRESHOLD_EGP:-50000}"
  if aws lambda get-function --function-name "$fn" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$fn" --zip-file "fileb://dist/$svc.zip" >/dev/null
    aws lambda wait function-updated-v2 --function-name "$fn" 2>/dev/null || sleep 3
    aws lambda update-function-configuration --function-name "$fn" --timeout 15 --memory-size 256 --environment "Variables={$vars}" >/dev/null
    echo "function $fn updated"
  else
    aws lambda create-function --function-name "$fn" --runtime "$LAMBDA_RUNTIME" --handler "$svc/lambda.handler" \
      --role "arn:aws:iam::$ACCOUNT:role/$(role_name "$svc")" --zip-file "fileb://dist/$svc.zip" \
      --timeout 15 --memory-size 256 --environment "Variables={$vars}" >/dev/null
    aws lambda wait function-active-v2 --function-name "$fn" 2>/dev/null || sleep 3
    echo "function $fn created ($LAMBDA_RUNTIME)"
  fi
}

deploy_api() { # $1 service
  local svc=$1 fn api_id integ
  fn=$(fn_name "$svc")
  api_id=$(api_id_of "$svc")
  if [ -z "$api_id" ]; then
    api_id=$(aws apigatewayv2 create-api --name "$(api_name "$svc")" --protocol-type HTTP --query ApiId --output text)
    echo "API $(api_name "$svc") created: $api_id"
  fi
  integ=$(aws apigatewayv2 get-integrations --api-id "$api_id" --query 'Items[0].IntegrationId' --output text 2>/dev/null | grep -v None || true)
  if [ -z "$integ" ]; then
    integ=$(aws apigatewayv2 create-integration --api-id "$api_id" --integration-type AWS_PROXY --payload-format-version 2.0 \
      --integration-uri "arn:aws:lambda:$REGION:$ACCOUNT:function:$fn" --query IntegrationId --output text)
  fi
  local existing; existing=$(aws apigatewayv2 get-routes --api-id "$api_id" --query 'Items[].RouteKey' --output text 2>/dev/null || true)
  local paths=()
  while read -r s method path; do
    [ "$s" = "$svc" ] || continue
    paths+=("$path")
    if ! grep -qF -- "$method $path" <<<"$existing"; then
      aws apigatewayv2 create-route --api-id "$api_id" --route-key "$method $path" --target "integrations/$integ" >/dev/null
      echo "route $method $path"
    fi
  done < <(grep -v '^#' "$ROOT/infra/routes.txt" | grep -v '^\s*$')
  # browser CORS pre-flight for every published path (Express cors() answers it)
  for path in $(printf '%s\n' "${paths[@]}" | sort -u); do
    grep -qF -- "OPTIONS $path" <<<"$existing" || aws apigatewayv2 create-route --api-id "$api_id" --route-key "OPTIONS $path" --target "integrations/$integ" >/dev/null
  done
  aws apigatewayv2 get-stages --api-id "$api_id" --query 'Items[].StageName' --output text | grep -q '\$default' || \
    aws apigatewayv2 create-stage --api-id "$api_id" --stage-name '$default' --auto-deploy \
      --default-route-settings ThrottlingBurstLimit=50,ThrottlingRateLimit=20 >/dev/null
  # resource policy on the function: only THIS API may invoke it through API Gateway
  aws lambda add-permission --function-name "$fn" --statement-id "apigw-$api_id" --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$api_id/*" >/dev/null 2>&1 || true
  echo "API for $svc: $(api_url "$api_id")"
}

deploy_service() {
  log "Deploying $1 to $TARGET (account $ACCOUNT, $REGION)"
  deploy_secret "$1"; deploy_role "$1"; deploy_function "$1"; deploy_api "$1"
}

collect_urls() { # writes infra/floci-urls.env with every API URL (no secrets in it)
  : > "$ROOT/infra/floci-urls.env"
  for s in "${SERVICES[@]}"; do
    local id; id=$(api_id_of "$s")
    [ -n "$id" ] && echo "$(upper "$s" | sed 's/_SERVICE//')_API=$(api_url "$id")" >> "$ROOT/infra/floci-urls.env"
  done
  echo "SITE_URL=$SITE_URL" >> "$ROOT/infra/floci-urls.env"
}

case "$WHAT" in
  all)
    deploy_db
    for s in "${SERVICES[@]}"; do deploy_service "$s"; done
    collect_urls
    bash "$ROOT/infra/monitoring.sh"
    bash "$ROOT/infra/deploy-frontend.sh"
    ;;
  db) deploy_db ;;
  web) collect_urls; bash "$ROOT/infra/deploy-frontend.sh" ;;
  monitoring) bash "$ROOT/infra/monitoring.sh" ;;
  auth-service|supplier-service|order-service|evaluation-service) deploy_service "$WHAT"; collect_urls ;;
  *) echo "usage: bash infra/deploy.sh all|db|web|monitoring|<service>"; exit 1 ;;
esac

log "Done. URLs:"; cat "$ROOT/infra/floci-urls.env"
echo "Smoke test: bash infra/check-deploy.sh"
