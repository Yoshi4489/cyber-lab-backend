# Backend Plan: Cyber Range

## Current status

The backend is scaffolded. It currently provides:

- Fastify and TypeScript build scripts.
- Helmet, CORS, global rate limiting, and a health endpoint.
- Versioned `/v1` routes.
- HMAC JWT verification for frontend-to-backend service tokens.
- A Drizzle plus Neon database factory.
- Contract tests for the health endpoint.

Instance lifecycle, scoring, and persistence are intentionally not enabled by
the scaffold yet.

## Technology

| Concern | Choice |
|---|---|
| HTTP service | Fastify 5 with TypeScript |
| Validation | Zod at every external boundary |
| Authentication boundary | Short-lived HS256 service tokens from the frontend server |
| Database | Neon PostgreSQL with Drizzle ORM |
| Queue | BullMQ 6 on Redis |
| Container control | Dockerode over Docker Engine mTLS |
| HTTP ingress | Traefik on separate lab nodes |
| Tests | Vitest for units and contracts, Playwright from the frontend for E2E |

## Build order

### Phase 1: API foundation

- Keep the health endpoint and versioned API namespace stable.
- Add OpenAPI or generated route contracts once the first domain routes land.
- Add structured error codes and request correlation ids.
- Add production logging and metrics without logging flags or tokens.

### Phase 2: Database and frontend API

- Add Drizzle schema and migrations for profiles, challenges, submissions,
  solves, instances, nodes, and audit logs.
- Implement challenge catalog reads for the frontend.
- Implement authenticated flag submission with rate limiting and audit records.
- Implement leaderboard and profile reads.
- Keep schema migration and application behavior in separate commits.

### Phase 3: Instance control

- Add instance ownership checks and signed service-token claims.
- Add BullMQ producers for spawn, destroy, extend, reap, and reconcile.
- Add a narrow Dockerode adapter that applies fixed security defaults.
- Add health polling and explicit instance state transitions.
- Add Traefik route creation through generated labels.

### Phase 4: Lab hardening

- Provision lab nodes with user namespace remapping and mTLS.
- Enforce capabilities, seccomp, AppArmor, read-only filesystems, tmpfs, CPU,
  memory, PID, storage, egress, and network restrictions.
- Add automatic abuse kills and append-only audit records.
- Complete the security review before public signup.

### Phase 5: Scaling and advanced access

- Add multiple lab nodes and capacity-aware scheduling.
- Add raw TCP and WireGuard only after HTTP lifecycle hardening is complete.
- Evaluate microVMs for kernel-sensitive challenges.

## Frontend integration contract

The frontend should call the backend through its server side. The browser must
not receive `BACKEND_SERVICE_TOKEN_SECRET`.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/healthz` | None | Deployment health check |
| GET | `/v1/meta` | None | API discovery |
| GET | `/v1/challenges` | Frontend session or public | Catalog listing |
| POST | `/v1/instances` | Signed service token | Queue a user-owned instance |
| GET | `/v1/instances/:id` | Signed service token | Read an owned instance |
| POST | `/v1/instances/:id/extend` | Signed service token | Extend an owned instance |
| DELETE | `/v1/instances/:id` | Signed service token | Destroy an owned instance |
| POST | `/v1/submissions` | Frontend session or service token | Submit a flag |

The current scaffold returns `501` for instance operations until the database,
queue, and orchestrator phases are implemented.
