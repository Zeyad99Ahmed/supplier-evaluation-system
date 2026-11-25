#!/usr/bin/env bash
# Removes everything deploy.sh created (Floci reset or, on real AWS, to stop any cost).
# The database is NOT dropped here: drop it explicitly if you really want to (see docs/RECOVERY.md).
source "$(dirname "$0")/lib.sh"
read -r -p "Delete all ses-* Lambda functions, APIs, roles, secrets, alarms and the website bucket on $TARGET? [y/N] " ok
[ "$ok" = "y" ] || exit 0
for s in "${SERVICES[@]}"; do
  id=$(api_id_of "$s"); [ -n "$id" ] && aws apigatewayv2 delete-api --api-id "$id" && echo "deleted API $(api_name "$s")"
  aws lambda delete-function --function-name "$(fn_name "$s")" 2>/dev/null && echo "deleted function $(fn_name "$s")"
  aws iam delete-role-policy --role-name "$(role_name "$s")" --policy-name "ses-$s-least-privilege" 2>/dev/null || true
  aws iam delete-role --role-name "$(role_name "$s")" 2>/dev/null && echo "deleted role $(role_name "$s")"
  # 7-day recovery window: a secret deleted by mistake can still be restored (restore-secret)
  aws secretsmanager delete-secret --secret-id "ses/$s" --recovery-window-in-days 7 >/dev/null 2>&1 && echo "scheduled deletion of secret ses/$s"
done
aws cloudwatch delete-alarms --alarm-names ses-repeated-failed-logins ses-many-403 ses-server-errors 2>/dev/null || true
aws s3 rb "s3://$WEB_BUCKET" --force 2>/dev/null && echo "deleted bucket $WEB_BUCKET"
rm -f "$ROOT/infra/floci-urls.env"
