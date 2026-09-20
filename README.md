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

**Now:** Phase 0 implementation complete, including repository alignment.
**Next:** Phase 1 database and backend-owned authentication foundation.
**Last updated:** 2026-09-21.

Working today: Fastify/TypeScript, service-token verification, error envelopes,
correlation IDs, redacted request logging, health/readiness, mock catalog and
submissions, generated OpenAPI, local dependency configuration, lint, build,
type checks, and contract tests.

Not implemented yet: database schema/migrations, account or session endpoints,
email delivery, persisted scores, queue workers, real targets, or deployment.
The existing database factory is an unused Neon HTTP scaffold. Local Compose
does not connect the API to PostgreSQL or Redis.

Verification: 39 tests, lint, type checking, and build pass on Node 22.23.2.
Node 22 is aligned across package engines, type definitions, .nvmrc, Docker,
and CI. Compose and CI YAML parse successfully, but Docker is unavailable on
the implementation machine, so container startup has not been verified there.
CI includes Compose configuration validation; it does not yet run dependency
integration tests. Remote CI results have not been independently confirmed.

The earlier Phase 0 finishing script is absent from the current repository.
Use reviewed commands and focused commits; no automatic commit/push cleanup
script is retained.

## Roadmap

| Phase | Deliverable | State |
|---|---|---|
| 0 | API foundation, Node 22 alignment, local services, generated OpenAPI, agreed docs | Implemented |
| 1 | PostgreSQL schema/migrations, backend auth, sessions, player/admin roles, BFF integration | Next |
| 2 | Seeded persistent catalog, submissions, first-solve scoring, progress, leaderboard | Planned |
| 3 | Queued HTTP instance lifecycle, Docker adapter, routing, idempotency, reconciliation | Planned |
| 4 | Isolation hardening and security review; required gate for public signup | Planned |
| 5 | Admin tools, monitoring, backup/restore, operational deployment | Planned |
| 6 | Browser terminal, TCP/VPN access, multi-node scheduling, advanced progression/auth | Deferred |

See [PLAN.md](PLAN.md) for ordered tasks, dependencies, effort, and exit criteria.
There is no fixed delivery deadline. The immediate milestone is Phase 1 auth
foundation; catalog persistence and real labs remain later milestones.

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
The [authentication contract](docs/AUTHENTICATION.md) defines the planned trust
boundary and frontend checkpoints.

## Quick start

Use Node 22, then:

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated value into `BACKEND_SERVICE_TOKEN_SECRET` in `.env`, then
run `npm run dev`. In PowerShell, use `Copy-Item .env.example .env`. If you
already have a local `.env`, update it without replacing existing values.

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
| `npm test` | Unit and API contract tests, without external services |
| `npm run lint` | ESLint and focused promise-safety rules |
| `npm run typecheck` | Strict type checking for source and tests |

CI validates Compose configuration and runs lint, type checking, build, and
tests on pushes and pull requests targeting `main` or `develop`. A local pass
does not establish a remote CI result.

Lint deliberately enables `no-floating-promises`, `no-misused-promises`,
and `await-thenable` without the entire type-checked recommended preset.

## Configuration

`src/config.ts` validates API settings at startup. The example file also
contains Compose and future worker settings which the API does not yet consume.

| Variable | Current consumer | Requirement |
|---|---|---|
| `NODE_ENV` | API | development/test/production; defaults to development |
| `HOST`, `PORT` | API | Defaults to 127.0.0.1:4000 |
| `FRONTEND_ORIGIN` | API | Required exact CORS origin; not an authorization mechanism |
| `BACKEND_SERVICE_TOKEN_SECRET` | API and frontend server | Required, at least 32 characters; never browser-visible |
| `SERVICE_TOKEN_ISSUER`, `SERVICE_TOKEN_AUDIENCE` | API | Required JWT checks |
| `DATABASE_URL` | Reserved | Optional today; leave empty until Phase 1 integration |
| `DEV_POSTGRES_PASSWORD` | Local Compose | Required to initialize local PostgreSQL |
| `DEV_POSTGRES_PORT`, `DEV_REDIS_PORT` | Local Compose | Default 5432 and 6379, loopback only |
| `REDIS_URL` | Future worker | Not consumed until Phase 3 |

BFF bootstrap credentials, signup controls, and session settings will be added
with Phase 1 validation; they are not active environment settings today.

## Current API

The full generated contract is available at `GET /v1/openapi.json`.
See [API guidance](docs/API.md) for schema conventions and compatibility rules.

| Method | Endpoint | Auth | Behavior |
|---|---|---|---|
| GET | /healthz | None | Liveness |
| GET | /readyz | None | Readiness, no dependency probes yet |
| GET | /v1/meta | None | API metadata |
| GET | /v1/openapi.json | None | Generated OpenAPI 3.0.3 |
| GET | /v1/categories | None | Mock categories |
| GET | /v1/challenges | None | Mock catalog |
| GET | /v1/challenges/:slug | None | Mock challenge |
| POST | /v1/submissions | submissions:write | Mock checking; no persisted solve |
| POST | /v1/instances | instances:write | 501 until Phase 3 |
| GET | /v1/instances/:id | instances:read | 501 until Phase 3 |
| POST | /v1/instances/:id/extend | instances:write | 501 until Phase 3 |
| DELETE | /v1/instances/:id | instances:write | 501 until Phase 3 |

Errors use `{ code, message, correlationId }`. All responses echo
`x-request-id`. The existing readiness exception returns its check results
with HTTP 503, not the ordinary error envelope.

Mock challenges are placeholders, not real challenge content. Mock flags are
derived by `mockFlag(slug)`; no real flag material is stored. Correct mock
submissions return `recorded: false`. Phase 2 keeps field names but changes
`source` and `recorded` to reflect persistence, with a frontend checkpoint.

## Frontend connection

Authenticated browser actions go through the frontend BFF. The BFF holds the
backend URL in server-only configuration and signs short-lived service tokens.
Public catalog requests may remain browser-accessible under the configured
CORS origin. Neither a public backend URL nor CORS proves user identity.

Docker, database, Redis, and lab-node credentials never cross into the frontend.
Players will access targets through isolated lab ingress in Phase 3; they never
access the Docker Engine or administrative node interfaces.
