# Recovery runbook

| Situation | Action |
|---|---|
| Cloud resources deleted or misconfigured | `bash infra/deploy.sh all` recreates secrets, IAM roles and policies, Lambda functions, APIs, alarms and the website from the repository. |
| Schema, roles or grants damaged | `DATABASE_ADMIN_URL=<owner url> node scripts/db-setup.js`. It is idempotent and never deletes rows. |
| Data deleted by mistake | Records are soft-deleted (archived, cancelled or disabled); history tables show who changed what. Restore from a backup: `docker exec ses-postgres pg_dump -U ses_owner supplierdb > backup.sql`, then `psql ... < backup.sql`. On Neon, use point-in-time restore or create a branch. |
| Secret leaked | Change it at the source (`ALTER ROLE <svc> PASSWORD ...`, a new JWT secret or a new API key). Put the new value in `infra/.env.floci`, then run `bash infra/deploy.sh <service>` to create a new Secrets Manager version. Changing `JWT_SECRET` logs everyone out. |
| Account compromised | An Admin disables the account (its sessions are revoked), then checks `audit.activity_log` / CloudWatch for what it did. |
| Secret deleted by mistake | `aws secretsmanager restore-secret --secret-id ses/<service>` (7-day recovery window). |

Dropping the whole database is a manual, deliberate step: `docker compose -f infra/floci/docker-compose.yml down -v` removes the volumes.
