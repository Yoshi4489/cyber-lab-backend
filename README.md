# Cyber Range Backend

Control-plane API for a beginner-friendly security lab platform. The backend
owns accounts, authorization, catalog data, scoring, and disposable lab
instances. Only the backend worker may hold Docker Engine credentials.

Read [AGENTS.md](AGENTS.md), [PLAN.md](PLAN.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and [SECURITY.md](SECURITY.md) before changing
the backend.

The separate frontend repository is
`C:\Users\win\Downloads\Projects\WebApps\cyber-range`.
This repository is
`C:\Users\win\Downloads\Projects\WebApps\cyber-range-backend`.

## Project status

**Now:** Phase 3 disposable-host lifecycle and restart recovery passed on the Ubuntu VM.
**Next:** Phase 4 isolation hardening and security verification.
**Last updated:** 2026-09-26.

Working today: Fastify/TypeScript, PostgreSQL through `pg` and Drizzle,
committed migrations, account seeds, Argon2id credentials, opaque sessions,
verification/reset flows, player/admin roles, BFF auth routes, session-bound
service tokens, generated OpenAPI, PostgreSQL readiness, seeded catalog reads,
transactional submissions/first solves, player progress, public leaderboard,
per-instance flag derivation, owned/idempotent instance APIs, PostgreSQL
lifecycle state, BullMQ delivery/recovery, expiry/reconciliation, a separate
worker, restricted Docker options, and generated Traefik file-provider routes.

Not implemented yet: the frontend cookie/CSRF, scoring and lifecycle checkpoints,
production email delivery, authored player challenges, Phase 4 isolation evidence,
or deployment. A disposable HTTP target and runtime manifest were used for the
Phase 3 exit check. Dynamic submission scoring is active only for
an owned, running, unexpired instance. Local development email is written only
to the ignored `.local-mail` directory.

Verification: 101 Vitest cases are defined; the current local run passes 63 and
skips 38 environment-gated cases. Lint, type checking, and build pass on Node
22.23.2.
Node 22 is aligned across package engines, type definitions, .nvmrc, Docker,
and CI. Compose and CI YAML parse successfully. PostgreSQL 16 and Redis 7 were
started with Docker Desktop, reached healthy status, accepted direct client
operations, and exposed reachable loopback ports. PostgreSQL used the supported
`DEV_POSTGRES_PORT=55432` override because port 5432 was unavailable on the
verification machine. CI starts disposable PostgreSQL for migration, auth,
catalog, scoring, and progress integration tests, validates Compose
configuration, and runs linting, type checking, building, and tests on Node 22.
CI now starts disposable Redis as well as PostgreSQL. Docker Desktop 29.7.2 was
reachable, but its engine did not advertise user namespaces or AppArmor; the
worker preflight correctly rejected the host before any Docker resource was
created. The verification observed zero backend-managed containers and
networks after the command. Run `npm run worker:preflight` on the intended
isolated host before starting a worker; it verifies host isolation, ingress,
and reviewed images without creating a target.

On 2026-09-26, the Ubuntu 26.04 VM with Docker Engine 29.8.1 advertised
AppArmor, seccomp and user namespaces. The disposable Traefik ingress was
running, and the pinned `sample-web-a` validation image was present. The actual
`worker:preflight` command returned `{"status":"ready","manifestCount":1}`;
zero backend-managed containers and networks existed afterward. PostgreSQL 16
and Redis 7 then ran as disposable Compose services on the VM; the API used
loopback SSH tunnels and the worker ran on Ubuntu. The disposable target reached
`running` through HTTPS ingress, yielded a runtime-derived flag, awarded 10
points once and zero on replay, extended within the cap, stopped, and lost its
route. A pending operation recovered after the worker restarted. Both runs left
zero backend-managed containers, networks, and dynamic routes. This single-host
validation topology does not establish Phase 4 network isolation or production
trust-zone separation. Remote CI for the route fix passed on `develop`
([run 36233883933](https://github.com/Yoshi4489/cyber-lab-backend/actions/runs/36233883933)).

The earlier Phase 0 finishing script is absent from the current repository.
Use reviewed commands and focused commits; no automatic commit/push cleanup
script is retained.

## Roadmap

| Phase | Deliverable | State |
|---|---|---|
| 0 | API foundation, Node 22 alignment, local services, generated OpenAPI, agreed docs | Implemented |
| 1 | PostgreSQL schema/migrations, backend auth, sessions, player/admin roles, BFF contract | Implemented |
| 2 | Seeded persistent catalog, submissions, first-solve scoring, progress, leaderboard | Implemented |
| 3 | Queued HTTP instance lifecycle, Docker adapter, routing, idempotency, reconciliation | Implemented; Ubuntu VM lifecycle and restart recovery passed |
| 4 | Isolation hardening and security review; required gate for public signup | In progress |
| 5 | Admin tools, monitoring, backup/restore, operational deployment | Planned |
| 6 | Browser terminal, TCP/VPN access, multi-node scheduling, advanced progression/auth | Deferred |

See [PLAN.md](PLAN.md) for ordered tasks, dependencies, effort, and exit criteria.
There is no fixed delivery deadline. The immediate milestone is Phase 4
isolation evidence; the frontend lifecycle contract checkpoint remains open.

Public signup stays closed until every required control in
[SECURITY.md](SECURITY.md) is implemented and reviewed.

## Agreed development choices

| Area | Decision |
|---|---|
| Runtime | Node 22, npm, Fastify 5, strict TypeScript, Zod |
| Identity | Backend owns credentials and opaque PostgreSQL sessions; frontend BFF mediates browser access |
| Authentication | Argon2id; player/admin roles; seeded or operator-created accounts |
| Database | Local PostgreSQL, Drizzle migrations; managed Neon in production |
| Email | Explicit development-only delivery locally; Resend after domain setup |
| Catalog | Reviewed repository manifests and seeded read-only catalog |
| Scoring | Per-instance dynamic flags; points awarded once per user/challenge |
| Labs | HTTP first; one active instance/player; 60-minute default, 2-hour maximum |
| Operations | API and worker on a VM with Compose; managed data services; separate target hosts |

These are implementation decisions, not claims that later phases already work.
The [authentication contract](docs/AUTHENTICATION.md) defines the implemented
backend trust boundary and the remaining frontend checkpoint. The
[scoring contract](docs/SCORING.md) defines Phase 2 behavior and the Phase 3
instance dependency. The [lifecycle contract](docs/LIFECYCLE.md) defines the
Phase 3 API, worker, manifest, recovery, and deployment boundaries.

## Quick start

Use Node 22, then:

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Generate independent values for `BFF_AUTH_SECRET`,
`BACKEND_SERVICE_TOKEN_SECRET`, `INSTANCE_FLAG_SECRET`, and
`DEV_POSTGRES_PASSWORD`. Start Compose, set `DATABASE_URL`, run
`npm run db:migrate`, provide the seed variables, and run `npm run db:seed`
before `npm run dev`. In PowerShell, use
`Copy-Item .env.example .env`. If you already have a local `.env`, update it
without replacing existing values.

The API listens on `http://127.0.0.1:4000`. Read
[local development](docs/LOCAL_DEVELOPMENT.md) to start PostgreSQL and Redis,
generate their local password, change ports, or retain data when stopping them.
Never commit credentials, `.env`, certificates, TLS material, or real flags.

## Scripts and checks

| Command | Purpose |
|---|---|
| `npm run dev` | Watch mode through tsx |
| `npm run build` | Compile TypeScript to dist |
| `npm start` | Run the compiled server |
| `npm run worker` | Run the lifecycle worker from TypeScript |
| `npm run worker:start` | Run the compiled lifecycle worker |
| `npm run worker:preflight` | Read-only isolated-host readiness check before starting a worker |
| `npm run worker:preflight:start` | Run the compiled host preflight |
| `npm run db:generate` | Generate a reviewed migration after schema changes |
| `npm run db:migrate` | Apply committed PostgreSQL migrations |
| `npm run db:seed` | Idempotently seed the catalog and configured player/admin accounts |
| `npm test` | Unit/contracts; PostgreSQL/Redis integrations run when their test URLs are set |
| `npm run lint` | ESLint and focused promise-safety rules |
| `npm run typecheck` | Strict type checking for source and tests |

CI validates Compose configuration and runs lint, type checking, build, and
tests on pushes and pull requests targeting `main` or `develop`. A local pass
does not establish a remote CI result.

Lint deliberately enables `no-floating-promises`, `no-misused-promises`,
and `await-thenable` without the entire type-checked recommended preset.

## Configuration

`src/config.ts` validates API settings at startup. The example file also
contains separate worker settings. Docker credentials are parsed only by
`src/worker-config.ts`, never by the API configuration.

| Variable | Current consumer | Requirement |
|---|---|---|
| `NODE_ENV` | API | development/test/production; defaults to development |
| `HOST`, `PORT` | API | Defaults to 127.0.0.1:4000 |
| `FRONTEND_ORIGIN` | API | Required exact CORS origin; not an authorization mechanism |
| `BFF_AUTH_SECRET` | API and frontend server | Dedicated auth bootstrap credential; distinct from signing key |
| `BACKEND_SERVICE_TOKEN_SECRET` | API and frontend server | Signs/verifies five-minute user JWTs; never browser-visible |
| `INSTANCE_FLAG_SECRET` | API and worker | Derives per-user/challenge/instance flags; backend-only and distinct |
| `SERVICE_TOKEN_ISSUER`, `SERVICE_TOKEN_AUDIENCE` | API | Required JWT checks |
| `DATABASE_URL` | API and database commands | Required PostgreSQL URL |
| `SIGNUPS_OPEN` | API | Must remain `false`; open signup is not implemented |
| `AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW` | API | Per-route auth request limits |
| `SUBMISSION_RATE_LIMIT_MAX`, `SUBMISSION_RATE_LIMIT_WINDOW_MS` | API | Fixed-window limits keyed by verified user identity |
| `INSTANCE_RATE_LIMIT_MAX`, `INSTANCE_RATE_LIMIT_WINDOW_MS` | API | Instance-create limits keyed by verified user identity |
| `LAB_PUBLIC_BASE_URL` | API | Base URL used only when a target is running and has an unguessable route |
| `LOCAL_MAIL_DIRECTORY` | Development API | Ignored local verification/reset delivery directory |
| `DEV_POSTGRES_PASSWORD` | Local Compose | Required to initialize local PostgreSQL |
| `DEV_POSTGRES_PORT`, `DEV_REDIS_PORT` | Local Compose | Default 5432 and 6379, loopback only |
| `REDIS_URL` | Worker | BullMQ connection; never sent to targets or frontend |
| `RUNTIME_MANIFEST_PATH` | Worker/preflight | Reviewed JSON array of pinned runtime manifests |
| `TRAEFIK_DYNAMIC_DIRECTORY`, `LAB_INGRESS_CONTAINER` | Worker/preflight | Isolated ingress file-provider path and container name |
| `LAB_NODE_NAME` | Worker/preflight | Non-secret scheduling identity stored in PostgreSQL |
| `DOCKER_HOST`, `DOCKER_CA_PATH`, `DOCKER_CERT_PATH`, `DOCKER_KEY_PATH` | Production worker/preflight | Complete remote Docker mTLS configuration |
| `DOCKER_SOCKET_PATH` | Development worker/preflight only | Local disposable testing; rejected in production |

Seed variables are consumed only by `npm run db:seed`; normal repeated seeding
does not replace an existing password hash or profile.

## Current API

The full generated contract is available at `GET /v1/openapi.json`.
See [API guidance](docs/API.md) for schema conventions and compatibility rules.

| Method | Endpoint | Auth | Behavior |
|---|---|---|---|
| GET | /healthz | None | Liveness |
| GET | /readyz | None | Readiness, including PostgreSQL in the running API |
| GET | /v1/meta | None | API metadata |
| GET | /v1/openapi.json | None | Generated OpenAPI 3.0.3 |
| GET | /v1/categories | None | Published database categories |
| GET | /v1/challenges | None | Published database catalog |
| GET | /v1/challenges/:slug | None | Published challenge metadata |
| POST | /v1/auth/login | BFF credential | Verify credentials and issue opaque session |
| POST | /v1/auth/session | BFF credential | Resolve and refresh a live session |
| POST | /v1/auth/logout | BFF credential | Idempotently revoke a session |
| POST | /v1/auth/verification/request | BFF credential | Generic acknowledgement; local delivery when eligible |
| POST | /v1/auth/verification/confirm | BFF credential | Consume verification token once |
| POST | /v1/auth/password-reset/request | BFF credential | Generic acknowledgement; local delivery when eligible |
| POST | /v1/auth/password-reset/confirm | BFF credential | Reset password and revoke sessions |
| POST | /v1/auth/signup | BFF credential | Always 403 while signup is closed |
| POST | /v1/submissions | submissions:write | Verify against an owned running instance and record scoring transactionally |
| GET | /v1/profile | profile:read | Current player progress from verified subject |
| GET | /v1/leaderboard | None | Top 100 active-player display names and scores |
| POST | /v1/instances | instances:write + Idempotency-Key | Persist pending spawn intent; return 202 |
| GET | /v1/instances/:id | instances:read | Owner-only polling; URL appears only while running |
| POST | /v1/instances/:id/extend | instances:write + Idempotency-Key | Add 30 minutes up to the 2-hour cap; return 202 |
| DELETE | /v1/instances/:id | instances:write + Idempotency-Key | Persist retry-safe stop intent; return 202 |

Errors use `{ code, message, correlationId }`. All responses echo
`x-request-id`. The existing readiness exception returns its check results
with HTTP 503, not the ordinary error envelope.

The seeded entries remain catalog fixtures rather than authored challenge
content. Catalog lists use `source: "database"`. Successful submission handling
uses `recorded: true` and `source: "database"`; points are nonzero only for the
first correct solve. No expected or submitted flag is persisted.

## Frontend connection

Authenticated browser actions go through the frontend BFF. The BFF holds the
backend URL and both server credentials in server-only configuration. It
resolves the opaque backend session, then signs short-lived service tokens with
the trusted `sub`, `sid`, and allowed scope. The backend rechecks session
ownership, liveness, account status, and current role on every protected call.
Public catalog requests may remain browser-accessible under the configured
CORS origin. Neither a public backend URL nor CORS proves user identity.

Docker, database, Redis, and lab-node credentials never cross into the frontend.
Players access targets through isolated lab ingress; they never
access the Docker Engine or administrative node interfaces.
