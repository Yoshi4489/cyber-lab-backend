# Backend development plan

## Harmless Welcome lab: Phase 1 complete (2026-10-26)

The user requested implementation of the harmless Welcome test plan, replacing
Cookie Monster. Confirmed choices are the exact shared Welcome flag, local
isolated VM and 10 points once. **The user approved the actual replacement
contract diff in `docs/API.md` on October 26; Phase 1 is authorized.** No Welcome
target runtime has been written. Validated local test settings and the conditional
catalog seed are implemented. Existing `/v1` DTOs/auth/lifecycle remain;
Welcome-only fixed-flag injection/verification remains a later-phase change.
No migration, dependency, hosted change or public signup is planned.

1. **Accounts/catalog:** validated local-only Welcome settings, stable identity
   and conditional disposable seed; two verified learners; frontend login and
   listing/briefing checks. Preserve historical IDs/solves.
2. **Spawn/running:** static Welcome target with runtime-injected flag, health,
   pinned image/manifest and VM preflight; actual readiness, refresh and create
   idempotency through one worker/node with two slots.
3. **Submission/persistence:** Welcome-only fixed-flag injection/verification,
   unchanged owner/running/expiry checks, incorrect/correct/repeated/concurrent
   attempts, exactly one 10-point award and real progress views.
4. **Two-user isolation:** distinct resources, foreign-operation denial, benign
   health requests between controlled targets and independent stop behavior.
5. **Expiry/cleanup:** destroy/repeat/timeout, capacity refusal/retention and
   controlled partial cleanup/retry with resource/route absence evidence.
6. **Regression/replacement readiness:** full harmless browser flow, application
   and disposable-service gates, preview/cookie isolation and final cleanup.

After each numbered phase, report changes, test steps/results and open questions,
update canonical docs and pause for approval. The shared flag is public test
content, not proof of per-user flag separation. No exploit or attack payload is
used. Real labs later use separate reviewed content and the existing dynamic
flag policy; retire Welcome by unpublishing, preserving history.

Backend agent edits only this repo; frontend agent edits only its sibling. The
lead owns contract changes; agents propose changes rather than editing the
contract. Keep commits focused and preserve unrelated work. The prior delivery
below is complete; production and hosted acceptance remain separate open gates.

Phase 1 source is split into `72f7583` (shared API/worker/seed local configuration
validation) and `3e84e38` (stable Welcome metadata and conditional seed). The flag
setting is validated but does not yet change runtime injection or submission
verification. Explicit seeding publishes only Welcome when enabled; disabling
and reseeding restores ordinary sample publication and unpublishes Welcome.
Upserts preserve catalog IDs and historical solves; integration coverage uses
direct historical database fixtures, not new Welcome submissions.

Verification on Node 24.19.0: lint, typecheck, build and whitespace passed. A
fresh native PostgreSQL 18 cluster, disposable memory-only Redis and existing
OpenSSL passed all 232 tests across 42 files with zero skips using the normal
one-worker suite. An initial catalog startup test exceeded its existing five-
second timeout under load; unchanged focused catalog checks passed 5/5, then the
unchanged full suite passed 232/232 without relaxing deadlines. New integration
checks create their own database, exercise two verified learners, wrong-password
denial, independent sessions/logout, seed toggles and history preservation.
Generated frontend types exactly match all 20 API paths; no wire shape changed.

Independent browser acceptance connected the built frontend through its BFF to
the real compiled API and a separate fresh PostgreSQL database. Both verified
learners passed wrong-password 401, login 200, HttpOnly session, Welcome-only
catalog/10 points, refresh identity, disabled launch, direct-session redirect,
logout 204 and revoked-session checks. There were no browser errors, unexpected
outbound requests, later-phase calls, emails or target creation. The acceptance
database was dropped and its API/frontend ports closed. See the sibling PLAN
for browser/regression and 24-screen visual evidence.
Final cleanup removed the owned PostgreSQL cluster and both task-labeled Redis
fixtures (including one earlier startup fixture found during final inventory).
All three fixture ports closed, with no owned PostgreSQL processes/directories,
Redis containers or private connection-state files remaining. The VM stayed off.

Repeat setup and seed instructions are in `docs/LOCAL_DEVELOPMENT.md`; run
the existing lint/typecheck/build/test commands with disposable database/Redis
settings, then use two verified operator accounts in explicit frontend live mode.
Keep worker/VM stopped for Phase 1. No open Phase 1 questions remain. **Await
approval before Phase 2 target/runtime work.** Public signup, hosted changes,
production runtime evidence and production security gates remain outside scope.

## Current delivery: mock preview and lifecycle hardening (2026-10-23)

The user approved the shared contract in `docs/API.md`. This delivery uses
local development and disposable fixtures; it does not continue hosted rollout.
The independent frontend now defaults to an isolated mock preview and retains
explicit live mode for integration tests. Only the lead may coordinate further
contract edits. Each numbered delivery phase requires its own approval.

Phase 1 backend validation is implemented: creation rechecks persisted account
email verification and refuses unverified users with 403 before creating intent;
extend/delete reject nonempty bodies with 400 after authorization. Existing
owners retain read/extend/stop access if verification changes. No DTO shape,
dependency, migration, capacity, or orphan-sweep change was introduced.

Verification on Node 24.19.0: lint, typecheck, and build passed. The full suite
against a fresh disposable native PostgreSQL 18 cluster passed 160 tests and
skipped six (five Redis queue cases and one OpenSSL-dependent TLS case). After
the final test-only ownership/no-write assertions, all 19 focused tests across
three files passed on a second fresh cluster. Both clusters were stopped and
removed; the existing demo database was not migrated or modified.

Phase 2 capacity schema/configuration and retry-safe node admission are complete.
Migration `ca700b8` adds positive capacity slots with a conservative existing-node
backfill; behavior `b888b9b` requires explicit worker capacity, uses a node lock
and durable reservations, and counts partial/orphan resources without deleting
them. Missing or ambiguous inventory fails closed. Cleanup retains capacity
until all resources are confirmed absent. Excess spawns fail asynchronously with
`node_capacity_exhausted` using the existing API response shapes.

Phase 2 verification: lint/typecheck/build passed; 185 tests passed and five
Redis queue cases skipped on disposable PostgreSQL 18. Existing Git OpenSSL
enabled the local TLS fixture. An independent upgrade check applied migrations
0000 through 0004, inserted an existing node, and verified migration 0005 backfills
one slot and rejects zero. Generated frontend types exactly match all 20 current
backend paths. Docker behavior used isolated fakes, not live hostile targets;
real isolated-host acceptance and Redis execution remain open for Phase 4.
The temporary database and cluster were stopped and removed; the existing demo
database and hosted services were not changed.

Phase 3 was approved October 24 and is implemented in `d9823fe`. Sweeps build
complete database/inventory plans, validate all ownership and canonical route
contents, and persist cleanup-start audits before deletion. Active instances,
unrelated resources and trusted ingress are preserved. Partial failures retain
capacity and retry through maintenance. Absence and unchanged terminal intent
are rechecked before success and reservation release. One execution gate covers
queue lifecycle work and sweeps; shutdown drains it, including startup sweeps.

Phase 3 verification: final lint/typecheck/build/whitespace passed. The exact
final source passed 215 tests with five Redis queue skips using a fresh native
PostgreSQL 18 cluster and existing Git OpenSSL. A readiness test initially timed
out under concurrent machine load; 32 focused checks and the full suite passed
with two workers, without weakening timeouts. Coverage includes missing/terminal
and partial resources, repeated sweeps, candidate validation and audit failures,
stripped/mismatched labels, unrelated endpoints, dependency failure, retries,
intent changes and serialization/drain. Generated frontend types still exactly
match all 20 backend paths. The disposable cluster was stopped and removed.
No demo database, real target, hosted configuration or dependency was changed.

Phase 4 was approved October 25 and completed local acceptance on October 26.
It covers disposable-service and isolated-worker acceptance. Docker Engine was
reachable again for disposable Redis service testing. A fresh native PostgreSQL 18.3
fixture and non-root, memory-only Redis 7.4.11 fixture passed all 222 tests with
zero skips, using one worker and standard test isolation/deadlines. An earlier
run spanning a host interruption had two five-second request timeouts; the
clean serial run passed without relaxing those limits.
Final lint, typecheck, build and whitespace gates also passed. Local execution
used Node 24.19.0; the configured Node 22 CI/runtime target was not rerun here.

Real Redis also reproduced a delivery-order bug: a worker could receive a job
while its durable operation was still pending, before the producer persisted
the queued marker. Claiming that delivered pending intent now permits normal
execution; the marker's pending-only update cannot rewind running or completed
work. Two regressions cover a delayed marker and producer failure after enqueue,
including once-only execution and safe redispatch. No public contract, schema,
or application dependency changed.

The user confirmed both historical lab VMs were deleted and chose one fresh
target-only Linux VM with the control plane on Windows. At the October 25
checkpoint its guarded start found about 1.5 GiB free against the 2.5 GiB
requirement and left it powered off. The disposable services and credentials
were removed then; no replacement-host acceptance was claimed.

On October 26, after the user authorized closing Roblox and Discord, the memory
check passed and Ubuntu 26.04.1 Server installed successfully. The working VM
uses one CPU, 2 GiB configured RAM and the existing dynamic 32 GiB disk. The
initial two-CPU boot stalled; a single CPU, enabled APIC, disabled x2APIC and
normal-RCU kernel setting allowed installation and subsequent disk boots.
Docker 29.9.2 advertises user namespaces, AppArmor, seccomp and private cgroup
namespaces. Real Engine mTLS accepts the worker identity and rejects a missing
client certificate, an untrusted CA and a wrong server hostname. Only server
key material was transferred to the target host; worker/CA private keys remain
outside both repositories on Windows.

The temporary NAT adapter was removed before any target started. Guest routing
shows no default route; private management SSH and Docker TCP baselines pass.
Digest-pinned constrained Traefik ingress and the committed disposable HTTP
fixture were prepared, with a key-pinned loopback HTTPS tunnel. Fresh PostgreSQL
18.3/Redis 7.4.11 fixtures and an independent restricted runtime login were
separate from the demo database. API login/logout and eight denied database
privilege probes passed. Real lifecycle, capacity, recovery, orphan cleanup and
target-side isolation acceptance subsequently passed:

- The committed HTTP fixture passed create/idempotency, live HTTPS health,
  first score 10 then zero on replay, extension, stop and ingress 404.
- Two verified players received separate targets. Six cross-user read/extend/
  delete requests returned 404 with no mutation intents, and the per-player
  active-instance limit returned 409. Both targets passed exact runtime-limit
  inspection and IPv4/IPv6/private/public/metadata/cross-instance route probes.
- A one-slot persisted node budget admitted one of two accepted concurrent
  creations; the other failed with `node_capacity_exhausted`. Real expiry
  cleaned resources and released its reservation. A hard-killed worker recovered
  through the normal lease, reusing the exact provisioning resources.
- Full and partial missing-row orphans were removed once, preserving unrelated
  resources and trusted ingress. A terminal cleanup failure retained capacity
  until its unrelated endpoint was explicitly released and cleanup retried.
- Database/inventory failures, malformed ownership and denied audit INSERT
  prevented destructive cleanup; restoration allowed successful cleanup.

The ingress fixture needed separate read-only static binds beside its writable
route volume; an enclosing read-only bind intermittently blocked Engine archive
writes. Five marker round trips and actual preflight then passed. An incomplete
crash attempt was retained in the evidence and corrected by pre-verifying the
owned worker PID before its immediate hard kill. No product source, dependency,
contract, lifetime limit or acceptance deadline changed in this resumed run.

Final managed containers/networks/routes/allocations, active intents,
reservations, pending operations and owned diagnostic containers were all zero.
Trusted ingress/TLS survived; API/worker drained. Runtime database/restricted
role/private credentials, PostgreSQL cluster and Redis fixture were removed;
their listeners closed. The ingress tunnel was closed and the installed VM
retained powered off to release memory. Twenty-three sanitized observations and
the lead's setup/management evidence are retained in the task visualization
folder's `phase4-runtime-qa`. Exact scope and limitations are in
`docs/PHASE4_SECURITY_GATE.md`. This completes the fourth local delivery
checkpoint, not the older production security gate. Pause for user approval
before the separate playable-CTF milestone.

Host-level egress anomaly monitoring, administration,
advanced features, hosted deployment work and production launch gates remain
deferred. Public signup stays closed.

The user clarified the ultimate goal is a playable web CTF platform with private
web challenge instances; "VM" means the web target, consistent with the Docker
architecture. Mock sessions are an intermediate frontend milestone. A later
separately reviewed live delivery must include authored challenges, learner flag
submission/progress integration and hosted worker/ingress acceptance through
https://cyber-lab-frontend.vercel.app and https://cyber-range-api.onrender.com.
The current approval does not change hosted configuration or close launch gates.

The numbered platform phases and deployment evidence below describe the earlier
roadmap; they are not the four approval checkpoints of this delivery. Retain
their evidence as historical records, not authorization for hosted changes.

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
The free hosted-demo API is deployed at https://cyber-range-api.onrender.com;
HTTPS health/database/auth acceptance passed. Public signup remains closed. A protected
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
Current user-approved scope includes the local Gmail demo and a free hosted
API demo; verified-domain email provisioning is deferred. Local verification/reset browser flows, real-worker
start/refresh/extend/stop and route removal, and an isolated 12-table restore
drill passed on 2026-10-05. See the gate record and
[operations runbook](docs/OPERATIONS.md). The supplied Vercel deployment needs
connector team access and server configuration before integration; the HTTPS
backend is now available.
Render browser provisioning is now accessible, and its `develop` API Blueprint
has been planned successfully. The operator requires free tiers only; Render
rejected database creation because its active free-database quota is occupied.
The alternative free Neon project is now provisioned: migrations, restricted
runtime role privileges, fresh account/catalog seed and login/session/logout
checks passed. The approved sending-only Resend key is created and deployment
configuration validation passed. The operator approved credential submission
and free API creation; Render deployed `2a76b71` successfully. Live HTTPS
readiness/catalog/login/session/profile/signup-denial/logout/revocation checks
passed. See [Render checkpoint](docs/RENDER.md).
Render API hosting preparation now includes a Docker Blueprint, a secret-free
build-context allowlist and committed migrations in the runtime image. Actual
frontend integration and hosted worker networking remain open. Verified-domain
delivery remains deferred; the hosted demo can
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
