# API contract

`GET /v1/openapi.json` returns the generated OpenAPI 3.0.3 document. It describes
the implemented Phase 1 authentication routes and the existing mock domain
routes. Future scoring and lifecycle behavior is not advertised as available.
The document contains no environment values, credentials, tokens, or example
flags. It is public, like the catalog.

Request validation and response serialization use Zod schemas attached to the
Fastify routes. `fastify-type-provider-zod` converts those schemas for
`@fastify/swagger`; no separate handwritten copy of a request shape is needed.
The generator is registered before routes in `buildApp`.

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
- Catalog reads are public and return mock fixtures. The list includes
  `source: "mock"`.
- Submissions require `submissions:write` and return
  `{ correct, points, recorded: false, source: "mock" }`.
- Instance create, extend, and destroy require `instances:write`; reads require
  `instances:read`. Valid, authenticated requests still return 501.
- Instance creation currently accepts only `{ challengeId }`. No Docker
  runtime options or acting-user fields are accepted.
- Phase 3 will introduce the idempotency header and asynchronous instance
  response contract with a frontend integration checkpoint. They are not
  implemented by Phase 0.

See the implemented backend and remaining frontend responsibilities in the
[authentication contract](AUTHENTICATION.md).

## Compatibility and checks

Keep existing catalog fields and submission field names when persistence is
added. `recorded` and `source` will describe the actual implementation; their
current mock literal schemas must be updated alongside that behavior and the
frontend contract. Do not silently freeze `source` to `mock` in production.

OpenAPI and auth route tests check both security schemes, strict payloads,
absence of secrets, BFF credential separation, session-bound user tokens, and
unchanged lifecycle stubs.
Fetch `/v1/openapi.json` from a running API for frontend tooling; do not commit
an independently maintained generated copy.

Generator references: [Fastify Swagger](https://github.com/fastify/fastify-swagger)
and [Zod type provider](https://github.com/turkerdev/fastify-type-provider-zod).
