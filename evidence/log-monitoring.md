# Log and monitoring evidence

Generated 2026-11-22T01:01:28.875Z from 739 structured log lines (515 HTTP requests) in logs/*.log.
Same JSON lines that each Lambda writes to CloudWatch Logs (/aws/lambda/ses-<service>).

## 1. Requests per service and status (metric: count by status)

| Service | Requests | 2xx/3xx | 4xx | 401 | 403 | 404 | 5xx |
|---|---|---|---|---|---|---|---|
| auth-service | 90 | 56 | 34 | 21 | 5 | 0 | 0 |
| supplier-service | 164 | 139 | 25 | 4 | 2 | 0 | 0 |
| order-service | 149 | 116 | 33 | 6 | 6 | 6 | 0 |
| evaluation-service | 112 | 93 | 17 | 2 | 2 | 4 | 2 |

Average latency 29 ms, p95 148 ms.

## 2. Alarm rules evaluated over the logs (same thresholds as infra/monitoring.sh)

| Alarm | Rule | Max in any 5-min window | State | Window |
|---|---|---|---|---|
| ses-repeated-failed-logins | FailedLogins >= 5 in 5 min | 9 | **ALARM** | 2026-11-21T22:51:06.076Z to 2026-11-21T22:51:48.969Z |
| ses-many-403 | Http403 >= 10 in 5 min | 8 | OK | 2026-11-21T22:51:44.026Z to 2026-11-21T22:51:48.985Z |
| ses-server-errors | Http5xx >= 1 in 5 min | 2 total | **ALARM** | - |

## 3. Security events (filter: level = warn)

| Event | Count |
|---|---|
| AUTH_LOGIN_FAILED | 15 |
| ACCESS_DENIED_ROLE | 11 |
| ACCESS_DENIED_OWNERSHIP | 10 |
| ACCOUNT_CREATED | 8 |
| AUTH_MISSING_TOKEN | 8 |
| EXTERNAL_API_FAILURE | 6 |
| AUTH_INVALID_TOKEN | 4 |
| SUPPLIER_ARCHIVED | 2 |
| ACCESS_DENIED_SELF_APPROVAL | 2 |
| AUTH_ACCOUNT_LOCKED | 2 |
| AUTH_LOGIN_LOCKED | 2 |
| AUTH_SESSION_INVALID | 2 |
| ACCOUNT_DISABLED | 2 |
| ACCOUNT_ENABLED | 2 |
| INTERNAL_TOKEN_INVALID | 2 |
| INTERNAL_CALLER_DENIED | 2 |

## 4. Failed-login sources (possible password guessing)

| Source IP | Failed logins |
|---|---|
| ::1 | 17 |

## 5. External API (ExchangeRate) failures: 6

- 2026-11-21T22:51:54.308Z network error contacting 127.0.0.1:9: TypeError
- 2026-11-21T22:51:54.437Z 127.0.0.1:4099 returned an invalid response
- 2026-11-21T22:51:54.576Z network error contacting 127.0.0.1:9: TypeError
- 2026-11-22T00:59:30.486Z network error contacting 127.0.0.1:9: TypeError
- 2026-11-22T00:59:30.547Z 127.0.0.1:4099 returned an invalid response

## 6. Sample log lines (no passwords, tokens, request bodies or comments are ever logged)

```json
{"ts":"2026-11-21T22:50:58.973Z","level":"info","service":"auth-service","event":"http_request","reqId":"2946cfe7-d5af-427e-98f1-2353e5e93514","method":"POST","path":"/api/users","status":201,"ms":101,"userId":"24232c5a-ae4b-4d28-98c3-b6ff182dfe03","role":"admin"}
{"ts":"2026-11-21T22:51:06.076Z","level":"warn","service":"auth-service","event":"AUTH_LOGIN_FAILED","reqId":"589a8d89-36d1-4743-b7ef-34d7829c0b67","method":"POST","path":"/api/auth/login","userId":"24232c5a-ae4b-4d28-98c3-b6ff182dfe03","status":401,"ip":"::1","detail":{"reason":"wrong_password","attempt":1}}
{"ts":"2026-11-21T22:51:44.023Z","level":"warn","service":"auth-service","event":"ACCESS_DENIED_ROLE","reqId":"814f4adf-cd7c-40c5-bc16-bebb61b37432","method":"GET","path":"/api/users","userId":"c4ec2e19-cbd8-42b1-b9ba-8c80452e728a","status":403,"ip":"::1","detail":{"role":"staff","needed":["admin"]}}
{"ts":"2026-11-21T22:51:48.222Z","level":"warn","service":"order-service","event":"ACCESS_DENIED_OWNERSHIP","reqId":"dcad61dc-2135-44ab-8ae2-dc92ed63bcf2","method":"GET","path":"/api/orders/68909455-de6b-45f0-816e-739ac48fcba5","userId":"fd0bfae7-7391-485b-bf9c-d896099c479d","status":404,"ip":"::1","detail":{"orderId":"68909455-de6b-45f0-816e-739ac48fcba5"}}
{"ts":"2026-11-21T22:51:54.308Z","level":"warn","service":"evaluation-service","event":"EXTERNAL_API_FAILURE","userId":null,"status":502,"detail":{"provider":"exchangerate-api","reason":"network error contacting 127.0.0.1:9: TypeError"}}
{"ts":"2026-11-21T22:50:59.936Z","level":"info","service":"supplier-service","event":"service_call","target":"evaluation-service","method":"POST","path":"/internal/convert","status":200,"ms":541}
```

## Equivalent CloudWatch commands on Floci

```bash
aws logs filter-log-events --log-group-name /aws/lambda/ses-auth-service --filter-pattern '{ $.event = "AUTH_LOGIN_FAILED" }'
aws logs filter-log-events --log-group-name /aws/lambda/ses-order-service --filter-pattern '{ $.status = 403 }'
aws cloudwatch get-metric-statistics --namespace SES/Security --metric-name FailedLogins --statistics Sum --period 300 --start-time <t0> --end-time <t1>
aws cloudwatch describe-alarms --alarm-names ses-repeated-failed-logins
```
