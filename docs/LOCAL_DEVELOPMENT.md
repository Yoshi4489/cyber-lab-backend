# Local development

Use Node 22 (`.nvmrc`), npm, and Docker with Compose v2. The API requires
PostgreSQL; the Phase 3 worker also requires Redis.

## API

1. Copy `.env.example` to `.env` if you do not already have local configuration.
   In PowerShell use `Copy-Item .env.example .env`; in a POSIX shell use
   `cp .env.example .env`. Keep any existing `.env` values when updating it.
2. Run the command below three times. Put independent values in
   `BFF_AUTH_SECRET`, `BACKEND_SERVICE_TOKEN_SECRET`, and `INSTANCE_FLAG_SECRET`.
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
change, and review the generated SQL before committing it. The worker consumes
`REDIS_URL`.

## Lifecycle worker

Read [LIFECYCLE.md](LIFECYCLE.md), create a reviewed runtime-manifest JSON file,
and configure the Traefik file-provider directory and ingress container. Run
the worker separately from the API:

```sh
npm run worker
```

Local socket access is allowed only for development. The adapter still requires
the Docker engine to advertise user namespaces, seccomp and AppArmor. Docker
Desktop on the verification machine lacked user namespaces and AppArmor, so it
is suitable for PostgreSQL/Redis development but not for launching these target
containers. Production uses an isolated target host and complete Docker mTLS.

## Initial accounts and local mail

Set all `SEED_ADMIN_*` and `SEED_PLAYER_*` variables, then run:

```sh
npm run db:seed
```

The seed is safe to repeat. It upserts validated catalog metadata and creates
verified player/admin accounts and profiles, but does not replace an existing
password hash, role, or profile.
Use unique development credentials and keep them out of source and logs.

Verification and reset requests write JSON messages to
`LOCAL_MAIL_DIRECTORY` (default `.local-mail`). This directory is ignored by
Git. Treat its links as credentials and remove stale files when no longer
needed. The local mailer refuses production mode. Gmail supports opt-in local
demos; the production Resend adapter needs separate verified-domain setup.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

To run infrastructure integration tests locally, set `TEST_DATABASE_URL` and
`TEST_REDIS_URL` to disposable services before `npm test`. CI starts PostgreSQL
16 and Redis 7 and runs migration, auth, catalog, scoring, progress, queue and
lifecycle integration tests in addition to the four checks above.
Production will use managed Neon
PostgreSQL and managed Redis, with API and worker processes on a VM and target
hosts in a separate trust zone.
It also requires separate application and migration database roles; see
[DATABASE_ROLES.md](DATABASE_ROLES.md). The local Compose owner credential is
for development and integration testing, not the production runtime login.

## Repeatable local acceptance checks

After building both repositories, run `npm run db:restore:drill` with a local
PostgreSQL URL and matching `pg_dump`/`pg_restore` on PATH. The development
operator login needs CREATE DATABASE. It exports a consistent snapshot,
restores a random disposable database, compares table counts/fingerprints,
and removes the copy and archive. This does not retain a backup.

`node scripts/local-auth-browser-check.mjs` tests the sibling frontend on
localhost:3201 against a restored copy on API port 4001. Email links are captured
in memory by default. `LOCAL_AUTH_SEND_EMAILS=true` sends two Gmail messages
to the configured sender; obtain recipient authorization first. The source
demo account is preserved.

`node scripts/local-lifecycle-browser-check.mjs` uses localhost:3202 and
operator-established SSH tunnels: loopback port 4002 for the VM API and 8443
for disposable ingress. Set `LOCAL_LIFECYCLE_ENV_FILE` to a private VM API
configuration copy outside Git. It uses the seeded player and sample-web-a,
creates one owned target, tests refresh/extension/destruction, and verifies
route removal. Only BFF credentials reach the frontend process. The explicitly
checked loopback health request permits the fixture's self-signed certificate;
Docker TLS remains verified. Keep the worker available until cleanup is
verified, including after any cleanup timeout. These checks do not deploy or
publicly expose services. See [operations](OPERATIONS.md).
