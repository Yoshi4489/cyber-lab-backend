# Local development

Use Node 22 (`.nvmrc`), npm, and Docker with Compose v2. The API can run without
Docker during Phase 0 because it serves fixtures and does not use a database.

## API

1. Copy `.env.example` to `.env` if you do not already have local configuration.
   In PowerShell use `Copy-Item .env.example .env`; in a POSIX shell use
   `cp .env.example .env`. Keep any existing `.env` values when updating it.
2. Run the command below and put its output in `BACKEND_SERVICE_TOKEN_SECRET`.
3. Run `npm ci`, then `npm run dev`.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The API listens on `http://127.0.0.1:4000`. Its health endpoints are `/healthz`
and `/readyz`. Readiness currently has no registered dependency probes.

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

Phase 1 will add the `pg` database adapter, migrations, and seed command. Until
then, leave `DATABASE_URL` empty: the existing unused factory only supports Neon
HTTP. The local URL will be
`postgresql://cyber_range:<password>@127.0.0.1:5432/cyber_range`; generated
base64url passwords do not need extra URL escaping. Phase 3 will start using
`REDIS_URL`. Starting these containers does not wire them into the Phase 0 API.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

CI uses Node 22, validates the Compose structure, and runs these four checks.
Compose validation does not prove the containers start or that networking is
isolated. Runtime database tests arrive in Phase 1 and queue/lifecycle tests in
Phase 3. Production will use managed Neon PostgreSQL and managed Redis, with
API and worker processes on a VM and target hosts in a separate trust zone.
