#!/usr/bin/env bash
# Smoke test of a deployment (like Lab 7 check-lab7.sh): health of the 4 APIs, a route that API Gateway
# must block, CORS for the website origin vs another origin, and the website files (no .env exposed).
source "$(dirname "$0")/lib.sh"
# shellcheck disable=SC1091
source "$ROOT/infra/floci-urls.env"
pass=0; fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
for v in AUTH_API SUPPLIER_API ORDER_API EVALUATION_API; do
  url="${!v}"
  check "$v /api/health answers runtime lambda" "curl -s '$url/api/health' | grep -q '\"runtime\":\"lambda\"'"
done
check "internal route not published (API Gateway 404)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$ORDER_API/internal/suppliers/x/open-orders')\" = 404 ]"
check "protected route without token -> 401" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '$SUPPLIER_API/api/suppliers')\" = 401 ]"
check "CORS allows the website origin" "curl -s -i -X OPTIONS -H 'Origin: $SITE_ORIGIN' -H 'Access-Control-Request-Method: POST' '$ORDER_API/api/orders' | grep -qi 'access-control-allow-origin: $SITE_ORIGIN'"
check "CORS refuses another origin" "! curl -s -i -X OPTIONS -H 'Origin: http://evil.example' -H 'Access-Control-Request-Method: POST' '$ORDER_API/api/orders' | grep -qi 'access-control-allow-origin'"
check "website index.html is served" "curl -s '$SITE_URL' | grep -q 'Supplier Directory'"
check "website config.js points to API Gateway" "curl -s '${SITE_URL%index.html}js/config.js' | grep -q '$ORDER_API'"
check "no .env in the bucket" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${SITE_URL%index.html}.env')\" != 200 ]"
echo "Result: $pass passed, $fail failed"
[ "$fail" = 0 ]
