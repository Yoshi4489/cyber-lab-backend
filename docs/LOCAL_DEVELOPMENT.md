# Local development

Use Node 22 (`.nvmrc`), npm, and Docker with Compose v2. The Phase 1 API requires
PostgreSQL. Redis can remain stopped until Phase 3 worker development.

## API

1. Copy `.env.example` to `.env` if you do not already have local configuration.
   In PowerShell use `Copy-Item .env.example .env`; in a POSIX shell use
   `cp .env.example .env`. Keep any existing `.env` values when updating it.
2. Run the command below twice. Put independent values in `BFF_AUTH_SECRET` and
   `BACKEND_SERVICE_TOKEN_SECRET`.
3. Set the PostgreSQL and seed variables described below.
4. Run `npm ci`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The API listens on `http://127.0.0.1:4000`. Its health endpoints are `/healthz`
and `/readyz`. Readiness reports the PostgreSQL probe; liveness does not touch
external dependencies.

## PostgreSQL and Redis

Generate a **separate** value with the same command and put it in
`DEV_POSTGRES_PASSWORD` in `.env`. Compose refuses to start PostgreSQL without
this value. Do not paste generated values into source, issues, or logs.

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

PostgreSQL 16 and Redis 7 publish ports on loopback only. PostgreSQL uses the
`cyber_range` user and database. Redis has no authentication in this local-only
configuration; it must never be published on a public interface or used as the
production deployment. Do not attach hostile targets to the Compose network.

Set `DEV_POSTGRES_PORT` or `DEV_REDIS_PORT` if the defaults conflict with another
service, and update the corresponding application URL when it becomes active.
Both services persist data in named volumes. `docker compose down` stops and
removes their containers while retaining the data volumes.

Changing `DEV_POSTGRES_PASSWORD` after PostgreSQL has initialized its volume
does not change the database user's password. Rotate it through PostgreSQL
before changing clients; do not delete the volume to resolve a password mismatch.

Set `DATABASE_URL` to
`postgresql://cyber_range:<password>@127.0.0.1:5432/cyber_range`, using the
configured override if PostgreSQL is published on another port. Generated
base64url passwords do not need extra URL escaping. Apply committed migrations
with `npm run db:migrate`. Use `npm run db:generate` only after a reviewed schema
change, and review the generated SQL before committing it. Phase 3 starts using
`REDIS_URL`.

## Initial accounts and local mail

Set all `SEED_ADMIN_*` and `SEED_PLAYER_*` variables, then run:

```sh
npm run db:seed
```

The seed is safe to repeat. It creates verified player/admin accounts and their
profiles, but does not replace an existing password hash, role, or profile.
Use unique development credentials and keep them out of source and logs.

Verification and reset requests write JSON messages to
`LOCAL_MAIL_DIRECTORY` (default `.local-mail`). This directory is ignored by
Git. Treat its links as credentials and remove stale files when no longer
needed. The local mailer refuses production mode; Resend is not configured yet.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

To run PostgreSQL integration tests locally, set `TEST_DATABASE_URL` to a
disposable PostgreSQL database before `npm test`. CI starts PostgreSQL 16 and
runs migration/auth integration tests in addition to the four checks above.
Queue/lifecycle tests arrive in Phase 3. Production will use managed Neon
PostgreSQL and managed Redis, with API and worker processes on a VM and target
hosts in a separate trust zone.
