# Cyber Range Backend

Control-plane API for a beginner-friendly, hands-on security lab platform. Owns
accounts, the lab catalog, scoring, and the disposable lab-instance lifecycle.

This service is the only component permitted to hold Docker Engine credentials.
See [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md), and
[`AGENTS.md`](AGENTS.md) before changing anything.

The frontend lives in a separate repository:

| Repo | Path |
|---|---|
| Frontend | `C:\Users\win\Downloads\Projects\WebApps\cyber-range` |
| Backend | `C:\Users\win\Downloads\Projects\WebApps\cyber-range-backend` |

## Project status

**Now:** Phase 1 — Database and backend-owned authentication
**Done:** Phase 0 complete — error envelope, correlation ids, redacted logging, readiness, mock catalog and mock flag submission, lint, CI, all covered by tests
**Next:** Local Postgres and the `users` / `sessions` / `email_tokens` schema
**Blocked / waiting:** Nothing. A domain is still needed for `*.labs` per-instance routing, but not until Phase 3
**Last updated:** 2026-09-20

### Local development decisions

There is no domain yet and nothing is deployed, so Phase 1 runs entirely on
localhost. Each row below is a deliberate stub, not a shortcut: the full logic
gets built and tested either way, and only the outbound step is swapped later.

| Area | Now | Later | Cost to switch |
|---|---|---|---|
| Database | Local Postgres in Docker, `pg` driver | Neon serverless | One client file; schema code is identical |
| Email | Verification and reset links printed to the dev console | Resend, once a domain is verified | One mailer module |
| Signup | Endpoint returns `403` while `SIGNUPS_OPEN=false`; accounts created by a seed script | Invite codes, then open after Phase 4 | Additive — a table and one check |

### Phase 0 steps

Each row is one commit, in order, so the history can be read and bisected one
change at a time.

| # | Commit | State |
|---|---|---|
| 1 | `feat(api): add structured error envelope with stable codes` | Done |
| 2 | `refactor(auth): extract a shared token scope guard` | Done |
| 3 | `feat(api): add request correlation ids` | Done |
| 4 | `security(api): redact secrets and scrub query strings from logs` | Done |
| 5 | `feat(api): add readiness endpoint with pluggable probes` | Done |
| 6 | `test(api): cover error envelope, correlation ids and readiness` | Done |
| 7 | `feat(catalog): add flag hashing and mock lab fixtures` | Done |
| 8 | `feat(catalog): serve the mock catalog and mock flag submission` | Done |
| 9 | `test(catalog): cover mock catalog, submissions and flag hashing` | Done |
| 10 | `docs: add project status tracker to README` | Done |
| 11 | `chore(lint): add ESLint flat config with type-aware promise rules` | Done |
| 12 | `ci: run lint, typecheck and tests on every push` | Done |
| 13 | `security(deps): upgrade drizzle-orm past the SQL injection advisory` | Done |
| 14 | `security(deps): upgrade vitest past the path traversal advisory` | Done |
| 15 | `docs: mark Phase 0 complete` | Done |

Linting is type-aware but deliberately narrow. The full `recommendedTypeChecked`
preset was tried and rejected: `require-await` flags every Fastify handler,
which is `async` so that Fastify can read the return value as the body rather
than because it awaits anything, and the `no-unsafe-*` family flags every
`JSON.parse` of a response body in the tests. Both would have to be suppressed,
and a linter that is mostly suppressions stops being read. The three type-aware
rules that are enabled — `no-floating-promises`, `no-misused-promises`,
`await-thenable` — all catch the same class of bug: a promise that is never
awaited, so its rejection is swallowed and the route answers `200`.

## Mock lab data

No real lab runs yet. The catalog and flag checking are served from fixtures in
`src/mocks/challenges.ts` so the frontend can build against real-shaped data
before the database (Phase 1) and the Docker lifecycle (Phase 3) exist.

- Challenges are placeholders. **No real challenge content is designed here.**
- No flag is stored, not even a mock one. `mockFlag(slug)` derives it, so the
  mock phase follows the same rule as production: flags are never stored in
  plaintext.
- The mock flag for a challenge is `CTF{mock_<slug with dashes as underscores>}`
  — so `sample-web-a` accepts `CTF{mock_sample_web_a}`.
- A correct submission returns `{ correct: true, recorded: false }`. Nothing is
  persisted until Phase 2 adds `submissions` and `solves`.

Replacing the fixtures with database queries in Phase 2 does not change any
request or response shape.

> Public signup stays closed until every control in [`SECURITY.md`](SECURITY.md)
> is implemented and reviewed (end of Phase 4). A health endpoint and scaffolded
> `501` routes do not mean the platform is ready to host hostile targets.

## Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 | Error envelope, correlation ids, redacted logging, readiness, lint, CI | In progress |
| 1 | Drizzle schema, registration, login, email verification, password reset, roles | Not started |
| 2 | Challenge catalog, progress, flag submission, leaderboard | Not started |
| 3 | Instance lifecycle: queue, Docker adapter, Traefik routing, in-browser terminal | Not started |
| 4 | Isolation hardening — **gate for public signup** | Not started |
| 5 | Admin tools, monitoring, backups | Not started |
| 6 | Third-party auth, XP and badges, multi-node scheduling | Not started |

## Quick start

```bash
npm install
cp .env.example .env
# generate a secret, then set it in .env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm run dev
```

The server listens on `http://127.0.0.1:4000` by default.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Watch mode via tsx |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Vitest unit and contract tests |
| `npm run lint` | ESLint across `src` and `tests` |
| `npm run typecheck` | Type-check `src` and `tests` without emitting |

## Configuration

All environment variables are validated by Zod at startup (`src/config.ts`); the
process refuses to boot on invalid config. See [`.env.example`](.env.example).

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | No | `development` \| `test` \| `production` |
| `HOST` / `PORT` | No | Defaults to `127.0.0.1:4000` |
| `FRONTEND_ORIGIN` | Yes | Exact CORS origin |
| `BACKEND_SERVICE_TOKEN_SECRET` | Yes | ≥32 chars; never expose to the browser |
| `SERVICE_TOKEN_ISSUER` / `SERVICE_TOKEN_AUDIENCE` | Yes | Verified on every token |
| `DATABASE_URL` | No (until Phase 1) | Neon Postgres connection string |

Never commit `.env`, secrets, TLS material, plaintext flags, or certificates.

## API

| Method | Endpoint | Auth | State |
|---|---|---|---|
| GET | `/healthz` | None | Live |
| GET | `/readyz` | None | Live, no probes registered yet |
| GET | `/v1/meta` | None | Live |
| GET | `/v1/categories` | None | Live, mock data |
| GET | `/v1/challenges` | None | Live, mock data |
| GET | `/v1/challenges/:slug` | None | Live, mock data |
| POST | `/v1/submissions` | Service token | Live, mock flags, nothing recorded |
| POST | `/v1/instances` | Service token | `501` until Phase 3 |
| GET | `/v1/instances/:id` | Service token | `501` until Phase 3 |
| POST | `/v1/instances/:id/extend` | Service token | `501` until Phase 3 |
| DELETE | `/v1/instances/:id` | Service token | `501` until Phase 3 |

Every error response is `{ code, message, correlationId }`. The correlation id
is also returned in the `x-request-id` header.

## Testing

```bash
npm test          # contract tests via app.inject(), no network required
npm run typecheck # strict: NodeNext, verbatimModuleSyntax, exactOptionalPropertyTypes
```

## Frontend connection

The frontend calls this service through `NEXT_PUBLIC_BACKEND_URL`, for example
`http://localhost:4000`. Browser requests are accepted only from the configured
`FRONTEND_ORIGIN`. The frontend never receives Docker credentials and never
connects directly to Redis, Postgres, or a lab node.

## Documentation

| Document | Contents |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Backend rules, code boundaries, commit discipline |
| [`PLAN.md`](PLAN.md) | Implementation order and frontend integration contract |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Service topology and request flows |
| [`SECURITY.md`](SECURITY.md) | Threat model and the controls that gate launch |
