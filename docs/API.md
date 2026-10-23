# API contract

`GET /v1/openapi.json` returns the generated OpenAPI 3.0.3 document. It describes
the implemented authentication, catalog, scoring, progress, leaderboard, and
Phase 3 lifecycle contracts.
The document contains no environment values, credentials, tokens, or example
flags. It is public, like the catalog.

Request validation and response serialization use Zod schemas attached to the
Fastify routes. `fastify-type-provider-zod` converts those schemas for
`@fastify/swagger`; no separate handwritten copy of a request shape is needed.
The generator is registered before routes in `buildApp`.

## Approved delivery contract: mock preview and lifecycle hardening

**Review checkpoint (2026-10-23): documentation diff approved by the user.**
Phase 1 preview isolation and backend validation and Phase 2 node capacity
admission are implemented. Later phases still require their own approval after
the preceding phase report. Destructive orphan cleanup remains pending; status documents
record actual verification. Agents must propose further contract changes
to the lead and user, never edit this contract on their own.

### Frontend preview boundary

The frontend introduces server-only `FRONTEND_MODE=preview|live`. Unset means
`preview`, including production builds. Only an explicit valid `live` setting
may enable backend access; invalid configuration must fail closed. Browser
query parameters, storage, cookies, and submitted fields cannot select a mode.

| Surface | Preview mode | Explicit live mode |
|---|---|---|
| Learner pages | Local, visibly labeled demo data; username-only entry; simulated sessions and completion | Retain existing live integration behavior; unfinished screens remain honestly labeled |
| Backend-facing frontend `/api` handlers | Return HTTP 404 with the existing `NOT_FOUND` BFF error envelope before accessing credentials, resolving cookies, or making upstream requests | Retain existing BFF authentication, origin checks, scopes, and response validation |
| Frontend `/instances` operator page | Return 404 regardless of `LIVE_INSTANCE_UI` | Keep the additional `LIVE_INSTANCE_UI` server gate |
| Verification and password-reset pages | Explain simulated accounts; collect no credentials or email tokens for processing | Retain existing backend-backed forms |

The API-handler gate includes catalog, backend status, authentication and email
actions, instances, and submissions. It applies even when valid backend secrets
and an old live-session cookie are present. Preview actions issue no live
session cookie and make no backend calls, including server-rendered reads.
Preview is an explicitly selected experience, never an API-error fallback.

The frontend consumes its committed generated types and validates fixture data
against the corresponding public schemas. It must not import sibling backend
source or change backend `source` literals to add a demo mode. Fixture origin
is tracked separately from API DTOs and displayed as demo data, never as actual
database activity, real scores, or authorization. Editorial-only fields remain
frontend metadata. Preview completion uses a "Finish demo" action and a mock
submission result; it does not generate or send a flag or create a target.

### Backend semantic changes

Existing `/v1` request/response shapes, service-token claims, scopes, and error
envelopes remain authoritative. No new public endpoint is required.

| Operation | Required implementation change |
|---|---|
| `POST /v1/instances` | After valid session/scope authorization, check current persisted email verification. An unverified account receives HTTP 403 `FORBIDDEN`; no instance or spawn operation is created. Do not trust a browser field or stale token claim for verification. |
| `POST /v1/instances/:id/extend` and `DELETE /v1/instances/:id` | After authorization, reject any nonempty body with HTTP 400 `INVALID_REQUEST`, including `{}` and acting-user/runtime fields. Empty-body requests keep their existing behavior. |
| Worker spawn admission | Enforce a positive configured capacity for the single registered lab node. Count reservations and outstanding managed resources; retries reuse their reservation. Cleanup failure must not free capacity while resources remain. |
| Spawn refused at capacity | Keep the accepted HTTP 202 creation contract. Worker processing ends the instance in `failed` with `failureCode: "node_capacity_exhausted"`, visible through existing owner polling. Record an audit event; do not spawn resources for the refused request. |
| Maintenance | Add inventory-to-database reconciliation for managed orphan containers, networks, and routes, serialized with lifecycle execution. Preserve unrelated resources and trusted ingress. Abort destructive work on failed database/inventory reads; audit and retry partial cleanup. |

Creation still accepts only `{ challengeId }`. User identity comes from the
verified service-token subject. One active instance per account, idempotent
mutations, owner-only reads and cleanup, and running-only target URL disclosure
remain unchanged. Initial expiry is 60 minutes after creation; each extension
adds 30 minutes up to the two-hour absolute cap. Instance statuses remain
`pending`, `provisioning`, `running`, `stopping`, `stopped`, `failed`, `expired`.
The verification change gates creation only; owners retain the existing access
rules for reading, extending, and stopping their instances.

### Acceptance and delivery limits

Prove preview isolation with backend settings populated, an old live cookie,
and upstream requests blocked or spied on. Exercise both page renders and
direct frontend API requests. Keep a separate explicit-live test configuration.
Backend coverage must include unverified creation, empty/nonempty command
bodies, capacity races and retries, orphan ownership labels, unavailable
dependencies, and repeated/partial cleanup. Regenerate OpenAPI types only when
approved route-schema changes require it, and check freshness afterward.

Use local services and disposable isolated fixtures only. No dependency adds,
hosted deployment changes, real CTF content, or public signup opening are part
of this delivery. Host-level egress anomaly monitoring is deferred and remains
a launch blocker; default-deny isolation still requires real fixture evidence.
After each numbered phase, update existing status documents with actual checks,
report changed behavior, testing and open questions, and await approval before
the next phase. This review does not close any production security gate.

## Adding a route

1. Use `app.withTypeProvider<ZodTypeProvider>()` in the route plugin.
2. Define Zod schemas for inputs and every response. Reject extra body fields
   with `.strict()` where the endpoint has a fixed command shape.
3. Set a stable, unique `operationId`, tags, and a useful description.
4. Include the common error responses from `src/routes/schemas.ts`.
5. For protected domain routes, add `serviceTokenSecurity` and document the
   required scope. Enforce it before schema validation using `requireScope` and
   the live-session authorizer. BFF bootstrap routes use `bffAuthSecurity` and
   `requireBff`. Documentation alone does not enforce authorization.
6. Add contract tests for accepted and rejected requests, auth, and responses.

Malformed JSON is rejected by Fastify before `preValidation`. For well-formed
JSON, authentication happens before request schema validation. Zod does not
coerce a numeric flag to a string or silently accept unknown command fields.

Every response includes `x-request-id`. API errors use
`{ code, message, correlationId }`; messages can change while codes remain
stable. The existing exception is `/readyz`: dependency failure returns 503
with `{ status: "unready", checks }`. It does not use the API error envelope.

## Current behavior

- Authentication bootstrap routes require the dedicated BFF credential. They
  implement login, session resolution, logout, verification/reset request and
  confirmation. Signup validates the registration shape and returns 403.
- User service tokens require `sub`, `sid`, issuer, audience, issued-at, expiry,
  and scope. Protected calls recheck session ownership/liveness, account status,
  and current role permissions in PostgreSQL.
- Catalog reads are public, include published database rows only, preserve the
  original public fields, and return `source: "database"` on the list.
- Submissions require `submissions:write`, an `instanceId`, and an owned running
  challenge instance. They persist the attempt and return
  `{ correct, points, recorded: true, source: "database" }`; only the first
  correct solve awards points. The server-wired resolver accepts only an owned,
  running, unexpired instance for the requested challenge.
- `GET /v1/profile` requires `profile:read` and derives the account only from the
  verified subject. `GET /v1/leaderboard` is public and omits account IDs/emails.
- Instance create, extend, and destroy require `instances:write` and a valid
  `Idempotency-Key`; reads require `instances:read`. Mutations persist intent
  and return `202` with the instance, operation ID, and replay indicator.
- Instance creation accepts only `{ challengeId }`. No Docker runtime options
  or acting-user fields are accepted. Owner polling omits the route URL until
  the worker marks the target running.
- Creation checks current persisted email verification after session/scope
  authorization; unverified accounts receive `403 FORBIDDEN` without intent.
  Existing owner read, extend, and stop permissions remain unchanged.
- Extend and delete commands reject nonempty bodies, including `{}`, with
  `400 INVALID_REQUEST` after authorization. Empty-body commands retain their
  existing lifecycle and idempotency behavior.

See the implemented backend and remaining frontend responsibilities in the
[authentication contract](AUTHENTICATION.md) and [scoring contract](SCORING.md).

## Compatibility and checks

Keep existing catalog fields stable. Submission bodies now require
`{ challengeId, instanceId, flag }`; the frontend must obtain `instanceId` from
the Phase 3 lifecycle before submitting. `points` means points awarded by this
attempt, so a repeated correct solve returns zero.

OpenAPI and route tests check both security schemes, strict payloads, absence of
secrets, BFF credential separation, session-bound user tokens, catalog fields,
profile/leaderboard exposure, lifecycle ownership, idempotency, and polling.
Fetch `/v1/openapi.json` from a running API for frontend tooling; do not commit
an independently maintained generated copy.

Generator references: [Fastify Swagger](https://github.com/fastify/fastify-swagger)
and [Zod type provider](https://github.com/turkerdev/fastify-type-provider-zod).
