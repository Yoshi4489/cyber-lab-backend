# Operator recovery and credential procedures

Scope: local demo procedures and production preparation. The isolated restore
drill passed on 2026-10-05; credential rotation and incident exercises below
are documented procedures, not completed drills. Public signup stays closed.

## Backup and restore

For the loopback demo, `npm run db:restore:drill` exports a consistent snapshot,
restores a randomly named disposable database, compares every public/Drizzle
table count and row fingerprint, and drops only that copy. The successful run
matched 12 tables; an injected callback failure also removed the copy. It does
not alter the source account or retain a backup. Use a development operator
login, not the restricted application login. See [local checks](LOCAL_DEVELOPMENT.md).

Before accepting production data, choose a backup owner, recovery point/time
targets, retention policy and encrypted off-host storage. Use managed database
backups/PITR where available, test an isolated restore, and record duration,
data comparison and application login/read acceptance. Restrict backup access;
backups contain password hashes and account data. Never overwrite a live
database as a drill. Reconcile restored instance intent with Docker before
starting the worker: stale intent must not revive unauthorized targets.

## Credential rotation

Schedule a maintenance window. Drain targets where required, stop new mutations,
and retain an operator-controlled rollback configuration outside Git. Rotate
one boundary at a time; record only timestamps and verification results.

| Credential | Rotation and acceptance |
|---|---|
| BFF bootstrap and service-token keys | Generate independent replacements, update API and frontend server together, restart/redeploy, verify login/session/domain calls and rejection of old credentials. A single key is supported, so coordinated downtime may be necessary. |
| Frontend session sealing key | Replace server-side, restart/redeploy, require fresh login; old cookies must no longer resolve. Never put it in a public environment variable. |
| PostgreSQL/Redis login | Provision replacement restricted access, verify grants/TLS, stop worker, update API/worker secrets, restart, check readiness/queue/lifecycle, then revoke the old login. Migrations retain a separate owner. |
| Docker client certificate | Issue a replacement through the trusted CA, retain worker-only private material, verify Engine identity/client-auth rejection tests and worker preflight, replace/restart worker, test owned lifecycle. Revoking a compromised certificate needs an explicit Engine trust/revocation strategy; replacing the worker file alone is insufficient. |
| Instance flag derivation key | Drain all active targets before replacement, restart API and worker with the same key, then launch fresh targets. Existing injected flags otherwise stop matching verification. |
| Gmail/production mail key | Revoke or replace in the provider, update backend-only configuration, restart API, and send only an explicitly authorized test. Check generic failure acknowledgements and sanitized audit events. |

For compromise, do not restore the compromised old credential as rollback.
Production secret custody, certificate revocation and a measured rotation drill
remain open requirements. See [Docker mTLS](DOCKER_MTLS.md) and
[database roles](DATABASE_ROLES.md).

## Incident response

1. Keep signup closed. Stop new lifecycle admissions and pause/stop the worker
   if integrity is uncertain. Isolate the affected host through management
   firewall controls while preserving operator access and evidence.
2. Record UTC times, request/operation/instance IDs, sanitized audit events,
   queue states and Docker labels. Do not collect flags, raw session tokens,
   mail links or secrets into tickets or routine logs.
3. Revoke affected sessions and compromised credentials. Inspect ownership,
   target isolation and control-plane access; use normal audited lifecycle
   cleanup for identified backend-owned resources when safe. Do not issue a
   broad Docker prune or delete unrelated resources.
4. Restore into an isolated environment if needed, compare data and reconcile
   persisted instance intent against real resources. Repeat preflight, ownership,
   route removal, isolation and crash/retry checks before resuming admissions.
5. Record cause, affected scope, recovery checks and follow-up changes. Designate
   an incident owner and communication process before production launch.

No production incident or rotation exercise has been performed. Completing
this document does not close the Phase 4 production gate or Phase 5 operations.
