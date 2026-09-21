# AGENTS.md

Read this file, then `PLAN.md`, `ARCHITECTURE.md`, and `SECURITY.md` before
changing the backend.

## Scope

This repository is the backend for the Cyber Range frontend at
`C:\Users\win\Downloads\Projects\WebApps\cyber-range`.

The backend owns the API, authorization boundary, database access, scoring,
queue workers, and the lab lifecycle boundary. The frontend owns presentation
and calls this service over HTTP. The backend is the only service allowed to
hold Docker Engine credentials.

## Non-negotiable rules

1. Never accept a user id from a request body for authorization. Read it from
   the verified service token subject.
2. Never expose Docker, Redis, Postgres, or lab-node credentials to the
   frontend or to a target instance.
3. Never pass arbitrary request data into Docker options. Build runtime options
   only from a validated challenge manifest and fixed security defaults.
4. Never run a target privileged, mount a Docker socket into a target, or let a
   target reach the control plane or private network ranges.
5. Never store plaintext flags. Dynamic flags are derived at verification time.
6. Every instance operation must check ownership and be safe to retry.
7. Do not open public signups until every required control in `SECURITY.md` is
   complete.

## Code boundaries

- `src/routes/` contains HTTP adapters and request validation.
- `src/auth/` verifies frontend-to-backend service tokens.
- `src/services/` will contain application rules behind typed repository,
  mailer, and lifecycle interfaces.
- `src/db/` will contain Drizzle schema access and migrations.
- `src/queue/` will contain BullMQ producers and workers.
- `src/orchestrator/` will contain the narrow Docker lifecycle adapter.
- `tests/` contains unit, contract, and lifecycle tests.

Generated OpenAPI comes from the Zod route schemas; see `docs/API.md`. Phase 1
implements backend-owned accounts and opaque sessions behind the frontend BFF;
read `docs/AUTHENTICATION.md` before changing auth.
Auth bootstrap resolves credentials or tokens at the backend and must never
trust a submitted acting-user id.

Keep the Docker adapter small enough to audit in one sitting. Business rules
belong in ordinary application services where possible.

## Engineering principles

Apply SOLID principles when designing or changing backend code:

- Keep each module responsible for one clear concern. Routes translate HTTP;
  application services enforce business rules; repositories handle persistence;
  queue code handles delivery; and the orchestrator owns the narrow Docker
  lifecycle boundary.
- Depend on interfaces or typed contracts at boundaries so business logic can
  be tested without Docker, Redis, Postgres, or network access.
- Keep abstractions justified by a real boundary or a likely implementation
  variation. Do not add indirection that hides simple behavior.
- Prefer small, composable functions and explicit dependencies over global
  state, hidden side effects, or framework-specific logic in domain code.
- Preserve substitutability and narrow interfaces: implementations must honor
  the same authorization, idempotency, validation, and error contracts.

Use ordinary software engineering judgment throughout the SDLC:

1. Understand the requirement and its security impact before coding.
2. Check the plan, architecture, security model, existing contracts, and
   related code before choosing a design.
3. Define the smallest coherent change and its acceptance criteria.
4. Implement in layers that match the code boundaries and keep external input
   validated at the edge.
5. Add or update meaningful unit, contract, integration, or lifecycle tests for
   the behavior and risk being changed.
6. Run formatting, type checks, linting, and the relevant test suites.
7. Review the diff for authorization gaps, secret exposure, unsafe Docker
   options, retries, migration safety, and unrelated changes.
8. Document API, security, migration, and operational changes when they affect
   another contributor or service.

## Commit discipline

Commit work in separate, reviewable batches. Never combine the entire task in
one large commit. Split commits by logical, independently understandable
change, such as:

- database schema and migrations;
- domain or application services;
- HTTP routes and validation;
- queue producers and workers;
- orchestrator and security hardening;
- tests;
- documentation or configuration.

Keep each commit focused, readable, and easy to revert or debug. Avoid mixing
format-only changes, unrelated refactors, generated files, and behavior
changes in the same commit. Each commit should leave the repository in a
consistent state and should include the checks needed for the code it changes.
Review `git diff` and `git status` before committing, and verify that no
secrets, certificates, local configuration, or unrelated user changes are
included. Use the conventional commit format shown below with a scope that
matches the affected boundary.

For this delivery workflow, commit and push each verified logical batch before
the next batch, and finish the current phase before beginning another. Update
the status docs with implemented behavior and actual validation evidence;
clearly label future contracts and checks that could not run locally.

## Commit format

Use one logical change per commit:

```
feat(api): add challenge catalog endpoint
feat(orchestrator): add instance spawn worker
security(orchestrator): enforce container runtime defaults
docs(api): document frontend service token flow
```

Never commit `.env`, secrets, TLS material, plaintext flags, or certificates.
