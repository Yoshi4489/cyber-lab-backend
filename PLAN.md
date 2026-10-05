# Backend development plan

## Scope and current state

This backend is the authorization, data, scoring, and lab lifecycle boundary
for Cyber Range. Phases 0 through 2 and the Phase 3 implementation are complete.
The Phase 3 disposable-host lifecycle check has passed. The next delivery is
the Phase 4 security gate. This plan covers
backend work and frontend contract checkpoints; frontend implementation stays
in its separate repository.

The latest local run passes 112 tests and skips 46 environment-gated cases on
Node 24.19.0; Node 22 remains supported and passes CI. PostgreSQL 16 and Redis 7
containers previously became healthy and accepted direct operations; this
machine now also has a working native PostgreSQL 18.3 demo database.
Remote CI has passed on `develop`. See
README for current verification evidence.
The backend is not deployed and public signup remains closed. A protected
Vercel frontend URL has been supplied; deployed integration is unverified.
Phase 4 VM checks have
passed. Real Engine mTLS and remote route-delivery preflight passed on the
two-VM topology on 2026-10-04. Live HTTPS lifecycle, two-instance isolation,
network-drift termination, and mid-spawn crash recovery also passed. Production
deployment checks remain open.

The Ubuntu 26.04 validation VM now advertises userns, seccomp and AppArmor.
On 2026-09-26, preflight and the disposable HTTP lifecycle passed with a
running Traefik ingress and one digest-pinned fixture. Create/poll, HTTPS
access, once-only scoring, extension, destruction, route removal, and recovery
after a worker restart passed. Both runs left zero backend-managed containers,
networks, and routes. Separate-host isolation was subsequently validated on
two disposable VMs; production trust-zone controls remain unverified.

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
| Frontend cookie/CSRF integration checkpoint | Backend contract | Implemented in frontend; 33 focused unit checks passed; production HTTPS/browser validation pending |

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
- Implemented in the frontend repository: database catalog/source reads.
- Pending in the frontend repository: `profile:read`, leaderboard and submission
  contract integration.

Per-instance flags depend on real instance identity. Phase 3 now supplies the
owned running-instance resolver; tests still use explicit fixtures where Docker
is not relevant.

Exit evidence: repository/contract tests prove catalog compatibility,
published-only reads, solve uniqueness under eight concurrent requests,
subject-bound progress, leaderboard privacy, and no flag/hash leakage. No real
challenge authoring or content-management UI is included.

## Phase 3: Asynchronous HTTP lab lifecycle (implemented; disposable-host exit passed)

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
- Implemented: `npm run worker:preflight`, a check of the Docker
  isolation controls, ingress availability, and every reviewed pinned image
  before a worker receives lifecycle jobs.
- Implemented: expiry/reconciliation jobs and backend polling integration tests.
- Passed on the Ubuntu VM: preflight with userns, seccomp, AppArmor,
  running ingress and one reviewed pinned HTTP fixture image.
- Passed on the Ubuntu VM: full create/poll/submit/extend/destroy target run and
  pending-operation recovery after a worker restart.
- Implemented in the frontend repository: polling and learner lifecycle controls
  with fixture tests; local real-worker/ingress browser acceptance passed on
  2026-10-05. Deployed acceptance remains pending.

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
readiness-only URLs and partial-create cleanup. The disposable pinned-image run
passed on the Ubuntu VM after `npm run worker:preflight` succeeded. Docker
Desktop on the verification machine
lacked userns and AppArmor, so its preflight correctly refused to run a target.
The Ubuntu VM ran PostgreSQL and Redis in Compose, the worker locally, and the
API through loopback SSH tunnels for validation. Both target runs left zero
backend-managed containers, networks, and routes. This topology is separate
from the production requirement for distinct control-plane and target trust zones.

## Phase 4: Isolation hardening and security gate (L)

Dependency: working Phase 3 lifecycle on isolated test infrastructure.

The disposable Ubuntu VM passed user-namespace, seccomp/AppArmor, capability,
filesystem/resource, egress, cross-network peer, and ingress checks. The
adapter now bounds swap and logs, rejects disabled seccomp, and terminates
stopped/unhealthy/OOM targets with an audit event. All three termination paths
passed disposable VM drills, and a worker shutdown Redis leak was fixed and
validated on the VM. Direct audit row mutation is blocked by migrations
0003-0004. A restricted application-role grant script
and separate-login disposable-database test now pass CI. A disposable mTLS
handshake test passes, but production deployment and database roles remain
unprovisioned. Worker startup now verifies route delivery and fails closed:
under `file` delivery it probes whether its route directory is visible inside
ingress, and under `ingress` delivery it round-trips a marker through the Docker
channel. The disposable VM passed the visibility probe and rejected a wrong path.
Delivery preflight against a real separate VM passed on 2026-10-04, after
replacing ingress's read-only route mount with a writable dedicated volume.
Live routing and two-player isolation passed after fixing ordinary internal
bridges' access to host services. The adapter now requires Docker 28+ isolated
gateway modes, rejects legacy networks, and terminates network drift. Target
IPv6 is disabled. A real mid-spawn SIGKILL recovered on attempt two with the
same container and network; final cleanup left zero managed resources. See the
[Phase 4 gate record](docs/PHASE4_SECURITY_GATE.md) for exact evidence and
limits. **The gate remains open.**

- L: Verify user namespaces, capabilities, seccomp, AppArmor, immutable root
  filesystems, tmpfs, CPU/memory/PID/storage limits, and Docker mTLS.
- L: Test default-deny egress, private/metadata/control-plane blocking,
  cross-instance isolation, and isolated ingress.
- M: Add automatic abuse termination and append-only audit protections.
- M: Review every required control in SECURITY.md with recorded evidence.

Remaining work: review the deployed production firewall and domain/TLS layout;
provision and verify separate production application and migration database
roles; and finish frontend, production email, and operational launch controls.
Repeat the validated probes and recovery drill on the actual deployment.
Current user-approved scope is a local Gmail demo; production domain/email
provisioning is deferred. Local verification/reset browser flows, real-worker
start/refresh/extend/stop and route removal, and an isolated 12-table restore
drill passed on 2026-10-05. See the gate record and
[operations runbook](docs/OPERATIONS.md). The supplied Vercel deployment needs
connector team access and a reachable HTTPS backend before integration.
Render browser provisioning is now accessible, and its `develop` API Blueprint
has been planned successfully. The operator requires free tiers only; Render
rejected database creation because its active free-database quota is occupied.
The alternative free Neon project is now provisioned: migrations, restricted
runtime role privileges, fresh account/catalog seed and login/session/logout
checks passed. The approved sending-only Resend key is created and deployment
configuration validation passed. Free API credential submission and public
endpoint creation await confirmation; no Render resource
has been created. See [Render checkpoint](docs/RENDER.md).
Render API hosting preparation now includes a Docker Blueprint, a secret-free
build-context allowlist and committed migrations in the runtime image. Actual
deployment waits for Render credential submission/API creation and frontend
integration. Verified-domain delivery remains deferred; the hosted demo can
use the restricted Resend test sender for the operator's own account email.
See [Render deployment](docs/RENDER.md). Remote worker networking and ingress
remain separate prerequisites for hosted lab acceptance.
Authenticated remote route delivery is now
implemented: `TRAEFIK_ROUTE_DELIVERY=ingress` extracts each rendered route into
the ingress container over the worker's own authenticated Docker connection and
removes it with an argument vector, so the target host holds no control-plane
credential. Production configuration requires that mode. It is covered by unit
tests, real remote Engine preflight, and live HTTPS target lifecycle. Separate
database owner/application logins passed
effective privilege checks on the disposable control-plane database; production
role provisioning remains open.
The single-node worker is serialized. Multi-worker scale-out needs a
per-instance distributed lock and is deferred until it can be tested.

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

Next task: validate frontend cookies/CSRF over deployed HTTPS and activate
verified-domain production email, then provision the production topology and database roles and
record the remaining deployment and operational checks in the gate record.
Public signup remains closed.

Local-demo email update (2026-10-05): opt-in Gmail SMTP delivery is implemented
for verification/reset links, with backend-only credentials and verified TLS.
Gmail authentication and one operator-approved setup email passed; inbox receipt
and actual frontend email-link flows remain unverified. Lint, typecheck, build,
and 100 tests passed on local Node 24.19.0; 46 environment-gated tests skipped.
Node 22 remains the supported runtime. Gmail is rejected in production and does
not close the production email gate. See [email setup](docs/EMAIL.md).

Phase 4 follow-up (2026-10-05): the production Resend adapter is implemented
with fixed HTTPS delivery, bounded requests, hashed idempotency keys and
sanitized errors. Verification/reset delivery failures now retain generic HTTP
acknowledgements and write safe audit events. Local lint/typecheck/build passed,
with 112 tests passed and 46 environment skips on Node 24.19.0. The adapter's
Node 22 CI passed at run 37268300486. No live Resend email was sent; verified
domain, provider credentials and deployed frontend URL remain required.

Frontend status review: sibling commit `64afe70` documents implemented auth,
cookie/CSRF and learner catalog/lifecycle UI. Its 33 focused authentication unit
checks passed locally. Production HTTPS/browser checks, live email-link flows,
actual worker UI acceptance, and submissions/progress/leaderboard integration
remain open. No frontend source was changed in this backend delivery.

Additional local database evidence: all 16 authentication service, repository
and HTTP integration tests passed in a separate disposable PostgreSQL 18.3
database, removed after the run. The demo database and accounts were preserved.
The email failure security fix passed Node 22/PostgreSQL/Redis CI at
[run 37268528702](https://github.com/Yoshi4489/cyber-lab-backend/actions/runs/37268528702).
