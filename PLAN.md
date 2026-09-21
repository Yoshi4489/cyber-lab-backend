# Backend development plan

## Scope and current state

This backend is the authorization, data, scoring, and lab lifecycle boundary
for Cyber Range. Phase 0 implementation is complete. The next delivery is the
Phase 1 authentication foundation, with no fixed deadline. This plan covers
backend work and frontend contract checkpoints; frontend implementation stays
in its separate repository.

Local tests and checks pass on Node 22.23.2. Local PostgreSQL 16 and Redis 7
containers start, become healthy, and accept direct client operations. Remote
CI results are not yet independently confirmed. See README for current
verification evidence. Nothing is deployed and public signup remains closed.

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

## Phase 1: Database and backend-owned authentication (L, next)

Dependency: Phase 0. Deliver accounts/auth only; keep the catalog mocked.

| Task | Depends on | Effort |
|---|---|---|
| Add pg adapter, Drizzle schema and committed SQL migrations for users, profile data, sessions, email tokens, audit events, and player/admin roles | Local PostgreSQL | M |
| Add database readiness, connection cleanup, migration and idempotent account seed commands | Schema | M |
| Add Argon2id passwords and opaque hashed session/token repositories | Schema | M |
| Add session lifecycle, verification/reset services and development mailer | Persistence and hashing | L |
| Add auth bootstrap routes, BFF/session integration and current-user authorization | Auth services | L |
| Add generated contracts, integration tests and frontend checkpoint | Routes | M |

Sessions use 30-day inactivity and 90-day absolute expiry, fresh tokens on
login, logout revocation, and single-use email tokens. Public signup returns
403 when the Phase 1 signup endpoint is added. Initial accounts are seeded
or provisioned by operators; broader admin account APIs arrive in Phase 5.

The backend owns credentials, accounts, sessions, roles, and account status.
The frontend BFF uses a dedicated server credential for auth bootstrap,
resolves its opaque session against the backend, and signs short-lived
user-scoped service tokens. See [authentication contract](docs/AUTHENTICATION.md).

Use the pg connection boundary for local PostgreSQL and managed Neon, preserving
transaction support. Replace the currently unused Neon HTTP scaffold during this
phase. Schema changes and consuming application behavior get separate commits.

Exit: a seeded player/admin can authenticate through the planned BFF contract;
sessions expire/revoke correctly; reset/verification tokens cannot be replayed;
authorization rejects expired/revoked sessions and disabled accounts; signup is
closed. Database integration tests cover migrations and repeated seeding.

## Phase 2: Persistent catalog and scoring (M)

Dependency: Phase 1 users and database.

- M: Seed catalog metadata from reviewed repository challenge definitions;
  retain public reads and current field names. Update mock source markers.
- M: Store submissions, first solves, progress, and audit events; ensure
  concurrent correct submissions award points only once.
- M: Add profile/leaderboard queries and a frontend contract checkpoint.
- M: Build per-instance flag derivation/verification behind a tested interface.

Per-instance flags depend on real instance identity in Phase 3. During Phase 2,
test this boundary using explicit instance fixtures. Do not award production
points for mock flags or pretend a mock session is a running lab. Production
dynamic submissions become available with the owned-instance lifecycle.

Exit: repository/contract tests prove catalog compatibility, solve uniqueness,
and no flag/hash leakage. No real challenge authoring or content-management UI.

## Phase 3: Asynchronous HTTP lab lifecycle (L)

Dependencies: Phases 1-2, Redis, Docker test environment, trusted manifests.
A routing domain and certificates are prerequisites for remote deployment.

- M: Add instances, operations and node persistence with explicit transitions.
- M: Add BullMQ producers/workers for spawn, destroy, extend, reap and reconcile;
  deterministic job IDs, bounded retries/backoff and failed-job inspection.
- M: Implement ownership-checked API operations and client idempotency keys.
  Creation returns a pending instance ID; the frontend polls until ready.
- L: Add the narrow Docker adapter, fixed runtime restrictions, trusted image
  manifests, isolated networks, generated Traefik routes, health polling and
  cleanup of partial failures.
- M: Add expiry/reconciliation jobs and frontend polling integration tests.

Start with HTTP targets and a single node. One active instance per player,
60-minute default lifetime, 2-hour absolute maximum. Extensions cannot exceed
that maximum. Operations must be safe to retry, including duplicate deliveries,
worker crashes, and partial database/Docker failures.

Security restrictions apply from the first real target. Phase 4 verifies and
hardens them; it is not permission to run unrestricted targets in Phase 3.
Local tests use disposable fixtures. Production targets must use separate
hosts/trust zones and remote Docker mTLS.

Exit: start, poll, submit, extend, destroy, expire and recover complete end to
end; foreign-user access fails; routing URLs appear only after readiness;
partial operations do not leave unmanaged containers.

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

Next implementation task: Phase 1 PostgreSQL adapter, initial Drizzle schema,
reviewed migration, and migration integration tests. It starts only after this
Phase 0 handoff is committed and pushed.
