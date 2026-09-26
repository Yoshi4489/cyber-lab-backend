# Backend architecture

## Responsibility split

```text
Player browser
    |
    v
Frontend BFF (Next.js)
    | dedicated auth credential + opaque session for auth operations
    | short-lived, scoped user JWT for domain operations
    v
Backend API (Fastify)
    |-- PostgreSQL: identities, sessions, catalog, scores, instance intent
    |-- Redis/BullMQ: lifecycle job delivery
    |
Backend worker (separate process)
    |-- PostgreSQL/Redis
    |-- Docker Engine over mTLS
    v
Separate lab hosts + isolated Traefik ingress
    |
Disposable hostile targets
```

The backend owns passwords, account state, sessions, authorization, scoring,
and persistence. The frontend owns presentation and the BFF browser boundary.
The BFF transports credentials to backend auth services and signs short-lived
service tokens only after resolving a backend session. It does not keep a
second independent user/account authority.

Only the worker holds Docker Engine credentials. The frontend and targets
receive no Docker, database, Redis, or lab-node administrative credentials.
Players may reach their target through lab ingress; this is distinct from
access to the host, Docker Engine, or control plane.

Phases 1 through 3 implement PostgreSQL identity, catalog, scoring, progress,
repositories; authentication services; BFF bootstrap routes; session-bound
authorization; public catalog/leaderboard reads; lifecycle intent; durable queue
delivery; worker transitions; and the restricted Docker/Traefik boundary.

## Module boundaries

| Boundary | Responsibility |
|---|---|
| src/routes | HTTP schemas, validation, serialization, auth entry checks |
| src/auth | Service-token verification; Phase 1 credentials/session boundary |
| src/services | Business rules and coordination through typed dependencies |
| src/db | Database client, repositories, schema and migrations |
| src/queue | Job production, delivery, retry policy and worker entry point |
| src/orchestrator | Narrow Docker lifecycle adapter consuming trusted runtime specs |
| src/plugins | Error handling, correlation IDs, generated OpenAPI |
| tests | Units, contracts and later service/lifecycle integration tests |

Business services depend on small interfaces where implementations can vary:
repositories, mailer, queue, trusted manifest loader, and orchestrator.
Introduce each interface with its real consumer rather than prebuilding a
generic repository framework.

## Identity and token flow

1. Browser submits login to the frontend BFF under its own CSRF protection.
2. BFF sends credentials to the backend with a dedicated auth credential.
3. Backend verifies Argon2id password/account state and creates an opaque
   session. PostgreSQL stores only its hash and expiry/revocation metadata.
4. BFF binds the opaque session to its secure browser-session flow and resolves
   it at the backend before signing a user operation token.
5. BFF signs HS256 claims including sub, issuer, audience, issued-at, expiry,
   narrow scope, and the backend `sid` session reference.
6. Backend verifies the token and uses the verified sub as the acting user.
   Phase 1 also validates session ownership/liveness and current account/role
   state, so revocation is not bypassed by an unexpired service token.
7. Domain services apply ownership and permission checks to resource IDs.

The dedicated BFF credential identifies a trusted caller, not a signed-in user.
User identity never comes from an acting-user field in a request body. The
verifier validates signature, algorithm, issuer, audience, required claims,
five-minute max token age, scope, session ownership/liveness, current account
status, and current role permissions.

The [auth contract](docs/AUTHENTICATION.md) describes bootstrap, cookie handling,
expiry/revocation and the frontend integration checkpoint.

## Data and challenge definitions

Phase 1 replaced the unused Neon HTTP factory with a transactional PostgreSQL
connection adapter supporting local PostgreSQL and managed Neon. Drizzle defines
identity, catalog, submission, solve, and audit data through reviewed committed
SQL migrations. Database transactions enforce single-use auth tokens and one
scored solve per user/challenge.

Validated repository definitions seed public catalog metadata into PostgreSQL.
Separate worker-only runtime manifests bind challenge IDs to pinned images,
resource limits, non-root users, and bounded health checks. Flags are HMAC-derived per user/challenge/instance at
runtime; no expected or submitted flag is persisted. Target flag injection uses
a narrow runtime path, never an image layer, public API response, or unrestricted
Docker option.

The submission service resolves a running, unexpired instance through a narrow
ownership interface before deriving or checking a flag, then records attempts,
audits, and first solves transactionally. Progress reads use only the verified token subject; the public
leaderboard exposes display names and aggregate scores without account IDs.

## Lifecycle intent and recovery (Phase 3)

The API persists owned instance intent and idempotency records. A worker sweep
adds pending operations to BullMQ using the operation UUID as the job ID and
marks delivery only after enqueue succeeds. This closes the database/enqueue
gap and recovers stale running operations.

Workers validate the manifest/quota, choose the registered node, create an isolated
network, start the pinned image with fixed restrictions, configure ingress,
poll health, and mark the instance running. URLs are exposed only to the owner
after readiness. Reapers expire instances; reconciliation compares persisted
intent with Docker resources labeled by backend-owned IDs and repairs drift.

Before starting a worker on an isolated host, `npm run worker:preflight` uses
the same Docker credential boundary to read the required host controls, inspect
the ingress container, and confirm every trusted pinned image is present. It
does not create Docker resources or connect to PostgreSQL or Redis.

Create/extend/destroy accept client idempotency keys. Repeated deliveries,
partial creates, lost replies and worker restarts must not duplicate resources
or points. One player has at most one active instance, a default 60-minute
lifetime and a 2-hour absolute maximum. HTTP targets ship first.

The current single-node worker serializes lifecycle jobs. Startup maintenance
skips reconciliation while a spawn operation is active, so both jobs cannot
race over the same Docker network. A second worker process requires a
distributed per-instance lock; multi-node scheduling remains deferred. The
adapter writes Traefik file-provider YAML, and runtime reconciliation destroys
and audits stopped, unhealthy, OOM-killed, or missing targets.

## Deployment boundaries

Local Compose runs PostgreSQL/Redis on loopback with named data volumes.
The API runs separately through npm and consumes PostgreSQL; Redis is a worker
dependency. Never run challenge targets on that control-plane
Compose network.

The production control-plane VM will run separate API and worker processes
with managed Neon and Redis. Lab targets run on separate hosts/trust zones via
Docker mTLS and isolated ingress. Readiness will check active dependencies;
liveness stays independent of them. A domain/TLS setup is required before
remote target routing, and every SECURITY.md gate must pass before public signup.
The API and worker will use a restricted PostgreSQL application login; migrations
will use a separate table owner. The reviewed grants and operational checks are
described in [database roles](docs/DATABASE_ROLES.md). Production provisioning
remains an open Phase 4 gate.
