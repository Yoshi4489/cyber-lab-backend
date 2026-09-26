# Backend development plan

## Scope and current state

This backend is the authorization, data, scoring, and lab lifecycle boundary
for Cyber Range. Phases 0 through 2 and the Phase 3 implementation are complete.
The next delivery is Phase 3 validation on a compliant isolated Docker host,
followed by the Phase 4 security gate. This plan covers
backend work and frontend contract checkpoints; frontend implementation stays
in its separate repository.

The current local run passes 59 tests and skips 38 environment-gated cases on
Node 22.23.2. Local PostgreSQL 16 and Redis 7 containers start, become healthy,
and accept direct client operations. Remote CI has passed on `develop`. See
README for current verification evidence.
Nothing is deployed and public signup remains closed.

The Ubuntu 26.04 validation VM now advertises userns, seccomp and AppArmor.
On 2026-09-26, preflight passed with a running disposable Traefik ingress and
one digest-pinned HTTP fixture. It left zero backend-managed containers and
networks. The real lifecycle flow and separation from control-plane data
services remain unverified.

Effort: S is a focused change; M spans several modules; L requires several
reviewable batches and integration/security checks. These are relative sizes,
not time estimates.

## Phase 0: API foundation and repository alignment (implemented)

- Existing scaffold: errors, request IDs, redacted logs, liveness/readiness,
  scoped service tokens, mock catalog/submissions, lint, tests, and CI.
- Standardize Node 22 in package engines, .nvmrc, Docker, and CI.
- Add local PostgreSQL/Redis Compose configuration and setup instructions.
- Generate OpenAPI from Zod route schemas and verify current API behavior.
- Align README, architecture, auth contract, and security requirements.
- The obsolete Phase 0 finishing script is no longer present.

Exit evidence: lint, typecheck, build, 39 tests, YAML parsing, reviewed diffs,
and healthy PostgreSQL 16 and Redis 7 containers with successful direct client
operations. Compose is development infrastructure, not a production lab host.

## Phase 1: Database and backend-owned authentication (implemented)

Dependency: Phase 0. Delivered accounts/auth only; the catalog remains mocked.

| Task | Depends on | Effort |
|---|---|---|
| PostgreSQL adapter, Drizzle schema and committed migration for users, profiles, sessions, email tokens, audit events, and roles | Local PostgreSQL | Implemented |
| Database readiness, cleanup, migration and idempotent account seed commands | Schema | Implemented |
| Argon2id passwords and opaque hashed session/token repositories | Schema | Implemented |
| Session lifecycle, verification/reset services and development mailer | Persistence and hashing | Implemented |
| Auth bootstrap routes, BFF/session contract and current-user authorization | Auth services | Implemented |
| Generated contracts and PostgreSQL integration tests | Routes | Implemented |
| Frontend secure-cookie/CSRF integration checkpoint | Backend contract | Pending in frontend repository |

Sessions use 30-day inactivity and 90-day absolute expiry, fresh tokens on
login, logout revocation, and single-use email tokens. Public signup returns
403. Initial accounts are seeded
or provisioned by operators; broader admin account APIs arrive in Phase 5.

The backend owns credentials, accounts, sessions, roles, and account status.
The frontend BFF uses a dedicated server credential for auth bootstrap,
resolves its opaque session against the backend, and signs short-lived
user-scoped service tokens. See [authentication contract](docs/AUTHENTICATION.md).

The `pg` connection boundary supports local PostgreSQL and managed Neon while
preserving transaction support. The unused Neon HTTP scaffold has been removed.

Exit evidence: seeded player/admin authentication passes through the backend BFF
contract; sessions expire/revoke correctly; reset/verification tokens cannot be
replayed; authorization rejects foreign, expired, revoked, role-disallowed, and
disabled sessions; signup is closed. PostgreSQL tests cover migrations,
concurrent token consumption, and repeated seeding. The actual frontend cookie
and CSRF flow remains a separate repository checkpoint.

## Phase 2: Persistent catalog and scoring (implemented)

Dependency: Phase 1 users and database.

- Implemented: validated repository challenge definitions, idempotent database
  seed, published-only public reads, and `source: "database"`.
- Implemented: submission/audit persistence and transaction-safe first solves;
  concurrent correct attempts award points once.
- Implemented: subject-bound profile/progress and privacy-limited leaderboard
  queries with generated contracts.
- Implemented: HMAC per-instance flag derivation/verification and a trusted-user
  submission rate limiter.
- Pending in the frontend repository: catalog/source, `profile:read`, leaderboard,
  and submission contract integration.

Per-instance flags depend on real instance identity. Phase 3 now supplies the
owned running-instance resolver; tests still use explicit fixtures where Docker
is not relevant.

Exit evidence: repository/contract tests prove catalog compatibility,
published-only reads, solve uniqueness under eight concurrent requests,
subject-bound progress, leaderboard privacy, and no flag/hash leakage. No real
challenge authoring or content-management UI is included.

## Phase 3: Asynchronous HTTP lab lifecycle (implemented; host validation pending)

Dependencies: Phases 1-2, Redis, Docker test environment, trusted manifests.
A routing domain and certificates are prerequisites for remote deployment.

- Implemented: instances, operations and node persistence with explicit transitions.
- Implemented: BullMQ producers/workers for spawn, destroy, extend, reap and reconcile;
  deterministic job IDs, bounded retries/backoff and failed-job inspection.
- Implemented: ownership-checked API operations and client idempotency keys.
  Creation returns a pending instance ID; the frontend polls until ready.
- Implemented: the narrow Docker adapter, fixed runtime restrictions, trusted image
  manifests, isolated networks, generated Traefik routes, health polling and
  cleanup of partial failures.
- Implemented: `npm run worker:preflight`, a read-only check of the Docker
  isolation controls, ingress availability, and every reviewed pinned image
  before a worker receives lifecycle jobs.
- Implemented: expiry/reconciliation jobs and backend polling integration tests.
- Passed on the Ubuntu VM: read-only preflight with userns, seccomp, AppArmor,
  running ingress and one reviewed pinned HTTP fixture image.
- Pending: frontend polling integration in the frontend repository and one full
  create/poll/submit/extend/destroy/recovery target run on the Ubuntu VM.

Start with HTTP targets and a single node. One active instance per player,
60-minute default lifetime, 2-hour absolute maximum. Extensions cannot exceed
that maximum. Operations must be safe to retry, including duplicate deliveries,
worker crashes, and partial database/Docker failures.

Security restrictions apply from the first real target. Phase 4 verifies and
hardens them; it is not permission to run unrestricted targets in Phase 3.
Local tests use disposable fixtures. Production targets must use separate
hosts/trust zones and remote Docker mTLS.

A preflight does not create a target or prove the runtime network boundary.
Automated exit evidence covers start-state transitions, polling, submission
ownership, extension caps, destroy, expiry, recovery, foreign-user denial,
readiness-only URLs and partial-create cleanup. The remaining exit check is the
same flow with a disposable pinned image on a compliant isolated host after
`npm run worker:preflight` succeeds. Docker Desktop on the verification machine
lacked userns and AppArmor, so its preflight correctly refused to run a target.
The Ubuntu VM preflight passed and likewise left zero backend-managed containers
or networks. The full target flow still needs PostgreSQL, Redis, the worker and
API connected for the disposable run. Its validation topology must be recorded
separately from the production requirement for distinct control-plane and
target trust zones.

## Phase 4: Isolation hardening and security gate (L)

Dependency: working Phase 3 lifecycle on isolated test infrastructure.

- L: Verify user namespaces, capabilities, seccomp, AppArmor, immutable root
  filesystems, tmpfs, CPU/memory/PID/storage limits, and Docker mTLS.
- L: Test default-deny egress, private/metadata/control-plane blocking,
  cross-instance isolation, and isolated ingress.
- M: Add automatic abuse termination and append-only audit protections.
- M: Review every required control in SECURITY.md with recorded evidence.

Exit: complete security review. Public signup remains closed until this gate
passes; passing it alone does not automatically enable signup.

## Phase 5: Administration and operations (M)

Dependencies: auth/scoring/lifecycle; Phase 4 for public hostile workloads.

- M: Admin account creation/disable/reset and operational instance/job views.
- M: Metrics and alerts for auth failures, queue lag, capacity, lifecycle errors,
  reconciliation mismatches, and abuse kills.
- M: Backups, restore drills, credential rotation and incident runbooks.
- M: Stage/deploy API and worker Compose services on a VM using managed Neon
  and Redis, with target hosts in a separate trust zone.

Exit: observable staged deployment, successful restore exercise, tested rollback
and migrations. Essential readiness and diagnostic logging are introduced in
earlier phases; this phase adds operator workflows.

## Phase 6: Advanced access and scaling (L, deferred)

Dependency: stable, hardened HTTP lifecycle and operations.

Add browser terminal access, raw TCP/WireGuard, capacity-aware multi-node
scheduling, and evaluate microVMs for kernel-sensitive exercises. Third-party
auth, XP, badges, and cohorts are future work, not Phase 1 requirements.

## Delivery and validation

Use focused conventional commits for independently understandable changes.
Review staged diffs for secrets, unsafe options, authorization gaps, migrations,
and unrelated edits. Run relevant checks, commit, and push each reviewed batch.
Complete and push a phase before starting the next; never run a script that
automatically stages everything or silently pushes multiple phases together.

Always run lint, typecheck, build, and relevant Vitest contracts. Add disposable
PostgreSQL integration services in Phase 1, Redis tests in Phase 3, and isolated
Docker lifecycle jobs when that environment exists. Frontend Playwright runs
belong to the frontend repo, coordinated through generated OpenAPI and phase
checkpoints. A schema change, revocation rule, retry contract, or isolation
claim requires a corresponding meaningful test.

Next task: connect disposable PostgreSQL, Redis, the API and worker to the
Ubuntu validation VM; run and record the full Phase 3 target lifecycle exit
check. Commit and push its evidence before beginning the Phase 4 isolation
test matrix. Public signup remains closed.
