# Backend security model

This control plane can authorize users, award scores, create containers and
expose targets. Backend authorization, lab isolation and recovery from partial
failures are required security boundaries.

Phases 1 and 2 implement the database-backed authentication, catalog, scoring,
dynamic-flag, and progress controls described below. Browser cookie/CSRF and
scoring integration, production email, operations, and all lab-isolation
controls remain launch requirements. No real targets run yet.

## API and authorization

- Verify service-token signature, HS256 algorithm, issuer, audience, expiry,
  issued-at, required subject and narrow operation scope.
- Derive the acting user for protected resources only from the verified sub.
  Reject body fields that attempt to select the acting user or runtime options.
- Verify the signed token's backend session reference belongs to
  sub, is active/unexpired, and the account is enabled. Check current roles
  for privileged actions; BFF possession alone must not grant admin rights.
- Check instance ownership on every read, extend, reset and destroy action.
- Validate external bodies, parameters, queries and manifests through Zod.
  Generated OpenAPI must use the same route schemas.
- Rate-limit auth, catalog-sensitive, submission and spawn operations. Derive
  per-user keys from verified identity and trust forwarded IPs only from
  explicitly configured proxies.
- Keep stable error codes/correlation IDs without exposing stack traces, flags,
  secrets or topology. Never log credentials through exception causes.
- Treat CORS as browser policy, not authentication.

## Authentication requirements (Phase 1)

- Store Argon2id password hashes, never passwords or reversible encryption.
- Keep the dedicated BFF auth credential separate from the service-token signing
  key. Use TLS and redact both. Neither credential may reach the browser.
- An auth bootstrap credential proves the BFF, not the player. Login must verify
  credentials; session operations must resolve the stored opaque-session hash.
- Store only hashes of session, verification and reset tokens. Use strong random
  tokens, single-use email tokens and transactional consumption.
- Enforce 30-day inactivity and 90-day absolute session limits using backend
  time. Issue a fresh session token on login, revoke on logout, and revoke
  existing sessions on password reset or account disable.
- Keep browser cookies HttpOnly, Secure in production, and appropriately
  SameSite. The BFF enforces origin/CSRF checks on browser mutations. Do not put
  bearer credentials into browser local storage.
- Keep auth/reset responses resistant to account enumeration. Add configurable
  route-specific rate limits before enabling any self-service account flow.
- Public signup remains closed. Seeded/operator-created accounts are the initial
  path; account seeds must not overwrite credentials on a normal retry.
- Development email links use an explicit local-only delivery path and never
  production request/audit logs. Production delivery uses Resend after domain
  verification. Test captured logs for password, session and email-token leaks.

The backend now enforces these Phase 1 rules, including captured-log redaction
tests and a signup configuration that accepts only `false`. The frontend cookie
and CSRF checkpoint and production Resend delivery remain incomplete. See
[AUTHENTICATION.md](docs/AUTHENTICATION.md) for the implemented contract.

## Docker boundary

- Keep Docker credentials only in the backend worker.
- Use Docker Engine mTLS for remote nodes. Never mount a Docker socket into a
  target or the deployed backend services.
- Construct options only from a trusted validated manifest and fixed defaults.
- Reject privileged mode, host networking, host PID/IPC, arbitrary devices,
  socket mounts, and unapproved capabilities.
- Enforce user namespaces, dropped capabilities, no-new-privileges, seccomp,
  AppArmor, read-only roots, bounded tmpfs, CPU, memory, PID and storage limits.
- Use pinned images and backend-controlled resource labels. Bound health
  checks, retries and startup times; failed starts must clean up resources.

These defaults apply when Phase 3 first runs a target. Phase 4 adds verification
and hardening; it does not defer the basic restrictions.

## Network boundary

- Keep target hosts and control-plane services on separate hosts/trust zones.
- Deny target access to private ranges, metadata services, database, Redis,
  Docker Engine, backend and frontend control-plane addresses.
- Default-deny target egress and cross-instance traffic.
- Route player HTTP traffic through isolated ingress, never through a host
  management endpoint. Use unguessable instance routes and owner-only URL reads.
- Never attach targets to the local development Compose network or publish
  its unauthenticated Redis beyond loopback.

## Data, flags, retries and audit

- Derive per-instance flags from a dedicated backend secret and runtime identity;
  persist neither expected flags nor submitted values. Verify only after an
  ownership resolver binds user, challenge, and instance.
- Never include expected or submitted flags in API responses, logs, browser
  bundles, images or audit details.
- Award points once per user/challenge through a database uniqueness/transaction
  guarantee, including concurrent requests.
- Make lifecycle mutations ownership-checked and retry-safe, with scoped
  idempotency records and reconciliation of database, queue and Docker state.
- Audit failed submissions and destructive/admin actions without flag/token
  contents; enforce append-only access for application audit writers.
- Reap expired instances and enforce the active-instance quota and lifetime cap.

Phase 2 enforces the flag, solve-uniqueness, audit-content, subject-bound
progress, and verified-user rate-limit rules with integration tests. The real
owned-instance resolver, restricted flag injection, and append-only production
audit role remain Phase 3/4 work; dynamic submissions return 501 until then.

## Launch evidence

Public signup remains closed until every required control is implemented and
reviewed. Track evidence for token/session abuse, cross-user access, flag/log
leakage, concurrent solves, retries/crash recovery, container restrictions,
egress/private-range blocking and cross-instance isolation.

A completed security gate authorizes a separate launch decision; it never
automatically flips signup open. Health endpoints, a passing mock suite,
Compose configuration, or 501 lifecycle routes are not evidence of target
isolation. Operator backups/restore drills and incident procedures must be
ready before accepting production user data.
