#!/usr/bin/env bash
# CloudWatch logging & monitoring (shared task, lead: Zeyad).
# Every Lambda writes one JSON line per request and per security event (services/shared/logger.js).
# This script sets log retention, turns selected events into metrics with metric filters, and adds alarms.
#   bash infra/monitoring.sh
source "$(dirname "$0")/lib.sh"

NS="SES/Security"
for s in "${SERVICES[@]}"; do
  lg="/aws/lambda/$(fn_name "$s")"
  aws logs create-log-group --log-group-name "$lg" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$lg" --retention-in-days 14     # cost: logs are not kept forever
  # 403 responses (unauthorised role / self-approval) in every service
  aws logs put-metric-filter --log-group-name "$lg" --filter-name "forbidden-403" \
    --filter-pattern '{ $.event = "http_request" && $.status = 403 }' \
    --metric-transformations metricName=Http403,metricNamespace=$NS,metricValue=1,defaultValue=0
  # 401 responses (missing/expired/forged tokens)
  aws logs put-metric-filter --log-group-name "$lg" --filter-name "unauthenticated-401" \
    --filter-pattern '{ $.event = "http_request" && $.status = 401 }' \
    --metric-transformations metricName=Http401,metricNamespace=$NS,metricValue=1,defaultValue=0
  # server errors
  aws logs put-metric-filter --log-group-name "$lg" --filter-name "server-errors-5xx" \
    --filter-pattern '{ $.event = "http_request" && $.status >= 500 }' \
    --metric-transformations metricName=Http5xx,metricNamespace=SES/Operations,metricValue=1,defaultValue=0
  echo "log group $lg: retention 14 days, filters forbidden-403, unauthenticated-401, server-errors-5xx"
done

# Auth: failed logins and lock-outs
aws logs put-metric-filter --log-group-name "/aws/lambda/$(fn_name auth-service)" --filter-name "failed-logins" \
  --filter-pattern '{ ($.event = "AUTH_LOGIN_FAILED") || ($.event = "AUTH_ACCOUNT_LOCKED") }' \
  --metric-transformations metricName=FailedLogins,metricNamespace=$NS,metricValue=1,defaultValue=0
# Evaluation: ExchangeRate API failures
aws logs put-metric-filter --log-group-name "/aws/lambda/$(fn_name evaluation-service)" --filter-name "exchange-api-failures" \
  --filter-pattern '{ $.event = "EXTERNAL_API_FAILURE" }' \
  --metric-transformations metricName=ExchangeApiFailures,metricNamespace=SES/Operations,metricValue=1,defaultValue=0
echo "filters failed-logins (auth) and exchange-api-failures (evaluation) created"

# Alarms (alert-style observations)
aws cloudwatch put-metric-alarm --alarm-name "ses-repeated-failed-logins" \
  --alarm-description "5 or more failed logins in 5 minutes - possible password guessing" \
  --namespace $NS --metric-name FailedLogins --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 5 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching
aws cloudwatch put-metric-alarm --alarm-name "ses-many-403" \
  --alarm-description "10 or more 403 responses in 5 minutes - someone probing admin routes" \
  --namespace $NS --metric-name Http403 --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 10 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching
aws cloudwatch put-metric-alarm --alarm-name "ses-server-errors" \
  --alarm-description "Any 5xx response" \
  --namespace SES/Operations --metric-name Http5xx --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching
echo "alarms ses-repeated-failed-logins, ses-many-403, ses-server-errors created"

cat <<'EOF'

Useful queries (evidence for the report):
  aws logs filter-log-events --log-group-name /aws/lambda/ses-auth-service --filter-pattern '{ $.event = "AUTH_LOGIN_FAILED" }' --query 'events[].message'
  aws logs filter-log-events --log-group-name /aws/lambda/ses-order-service --filter-pattern '{ $.status = 403 }' --query 'events[].message'
  aws cloudwatch get-metric-statistics --namespace SES/Security --metric-name FailedLogins --statistics Sum --period 300 \
      --start-time $(date -u -d '-1 hour' +%FT%TZ) --end-time $(date -u +%FT%TZ)
  aws cloudwatch describe-alarms --alarm-names ses-repeated-failed-logins --query 'MetricAlarms[].[AlarmName,StateValue]'
EOF
