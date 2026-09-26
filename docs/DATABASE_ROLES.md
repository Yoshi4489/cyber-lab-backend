# Production database roles

Phase 4 requires a migration/table owner and a separate API/worker login.
`scripts/db-app-role.sql` is the reviewed application grant list. CI connects
through a separate disposable application login to verify it, but no production
role has been provisioned.

After applying the committed Drizzle migrations as the migration owner, a
database administrator must create `cyber_range_app` as a `NOLOGIN` role and
create a separate login for the API and worker. Give that login membership in
`cyber_range_app` and `CONNECT` on the application database. Set its password
through the provider's secret manager or an interactive `psql` password prompt;
never put it in SQL files, shell history, logs, or this repository. Do not give
the login membership in the migration owner, table ownership, `CREATEDB`,
`CREATEROLE`, or `SUPERUSER`.

Run the grant file as the migration/table owner after every migration that
changes database objects. For example, with the migration credential already
provided through a secure environment:

```sh
psql -X -v ON_ERROR_STOP=1 --single-transaction -f scripts/db-app-role.sql
```

The file revokes existing direct table grants from `cyber_range_app` before
granting `SELECT` and `INSERT` on the eleven application tables and `UPDATE`
only where current backend code needs it. It grants no `DELETE` or `TRUNCATE`.
New tables receive no automatic grants and must be reviewed explicitly. The
role needs schema `USAGE`, but neither it nor the login may have schema
`CREATE` through `PUBLIC` or inherited roles. Keep `db:migrate` on the owner
credential; give the API and worker only the application login's `DATABASE_URL`.

Before deploying, connect as the application login and verify its effective
privileges, including inherited grants. Confirm it can insert an audit event
but cannot update, delete, or truncate one; cannot create or alter tables; and
cannot read Drizzle's migration journal. Verify the normal login/session,
submission, lifecycle, and audit paths with that login. Also verify that the
migration owner can apply a migration, while the application login cannot.
Record those production results in the [Phase 4 gate](PHASE4_SECURITY_GATE.md).
