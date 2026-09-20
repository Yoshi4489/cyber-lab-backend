# API contract

`GET /v1/openapi.json` returns the generated OpenAPI 3.0.3 document. It describes
the implemented Phase 0 routes; future auth, scoring, and lifecycle behavior is
not advertised as available. The document contains no environment values or
example flags. It is public, like the catalog.

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
5. For protected routes, add `serviceTokenSecurity` and document the required
   scope. Enforce that scope before schema validation using `requireScope` in
   `preValidation`. Documentation alone does not enforce authorization.
6. Add contract tests for accepted and rejected requests, auth, and responses.

Malformed JSON is rejected by Fastify before `preValidation`. For well-formed
JSON, authentication happens before request schema validation. Zod does not
coerce a numeric flag to a string or silently accept unknown command fields.

Every response includes `x-request-id`. API errors use
`{ code, message, correlationId }`; messages can change while codes remain
stable. The existing exception is `/readyz`: dependency failure returns 503
with `{ status: "unready", checks }`. It does not use the API error envelope.

## Current behavior

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

Phase 1 will add backend-owned authentication behind the frontend BFF. The
backend does not currently expose auth endpoints or issue opaque sessions.
See the planned [authentication contract](AUTHENTICATION.md).

## Compatibility and checks

Keep existing catalog fields and submission field names when persistence is
added. `recorded` and `source` will describe the actual implementation; their
current mock literal schemas must be updated alongside that behavior and the
frontend contract. Do not silently freeze `source` to `mock` in production.

`tests/openapi.test.ts` checks the generated path inventory, security scheme,
submission constraints, absence of secrets, and unchanged lifecycle stubs.
The existing route tests continue to cover the payload and error contracts.
Fetch `/v1/openapi.json` from a running API for frontend tooling; do not commit
an independently maintained generated copy.

Generator references: [Fastify Swagger](https://github.com/fastify/fastify-swagger)
and [Zod type provider](https://github.com/turkerdev/fastify-type-provider-zod).
