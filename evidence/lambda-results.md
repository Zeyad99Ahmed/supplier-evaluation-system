# Packaged Lambda function tests (mock AWS endpoint)

Run at 2026-11-22T01:01:28.733Z - **6/6 passed**

| ID | Owner | Category | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|---|
| LT-01 | Ebraheem (deployment lead) | Deployment | Packaged supplier-service zip answers GET /api/health as a Lambda | 200, runtime "lambda", database ok, secret loaded from Secrets Manager | 200 {"status":"ok","service":"supplier-service","runtime":"lambda","environment":"production","database":"ok"} | PASS | `{"status":"ok","service":"supplier-service","runtime":"lambda","environment":"production","database":"ok"}` |
| LT-02 | Ebraheem (deployment lead) | Deployment | Login through the packaged auth-service handler | 200 + token | 200 | PASS | `HTTP 200, token issued: true` |
| LT-03 | Ebraheem (deployment lead) | Deployment | Authenticated GET /api/orders through the order-service handler; CORS header for the S3 site | 200, only own orders, Access-Control-Allow-Origin set | 200, 5 orders, ACAO=http://localhost:4566 | PASS | `HTTP 200 total=5` |
| LT-04 | Zeyad + Ebraheem | Integration | Archive a supplier with open orders via Lambda: supplier-service calls order-service with lambda:InvokeFunction | 409 SUPPLIER_HAS_OPEN_ORDERS and one Invoke of ses-order-service | 409 SUPPLIER_HAS_OPEN_ORDERS; invoked: ses-order-service | PASS | `{"error":{"code":"SUPPLIER_HAS_OPEN_ORDERS","message":"This supplier has 2 open order(s). Deliver or cancel them before archiving."}}` |
| LT-05 | Ebraheem (deployment lead) | Security | Unauthenticated request and unknown route through the evaluation-service handler | 401 and 404 | 401, 404 | PASS | `{"error":{"code":"UNAUTHENTICATED","message":"Authentication is required."}}` |
| LT-06 | Ebraheem (deployment lead) | Security | Each function requests only its own secret from Secrets Manager | only ses/<own-service> secrets were requested | requested: ses/supplier-service, ses/auth-service, ses/order-service, ses/evaluation-service | PASS | `ses/supplier-service, ses/auth-service, ses/order-service, ses/evaluation-service` |
