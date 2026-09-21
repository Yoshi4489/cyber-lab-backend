# Authentication contract for Phase 1

Status: Phase 1 backend implemented. PostgreSQL accounts/sessions, BFF bootstrap
routes, Argon2id credentials, local development mail, and session-bound service
tokens are active. The frontend secure-cookie/CSRF integration and production
Resend delivery remain separate checkpoints. Public signup is closed.

## Ownership and credentials

The backend owns accounts, Argon2id password hashes, player/admin roles,
verification state, account status, and opaque sessions in PostgreSQL. The
frontend BFF owns browser interaction and calls the backend over server-side
HTTPS. It does not authenticate passwords against its own database.

There are two separate server credentials:

| Credential | Purpose | Holder |
|---|---|---|
| BFF_AUTH_SECRET | Authenticate the BFF on auth bootstrap endpoints | Frontend server and backend API |
| BACKEND_SERVICE_TOKEN_SECRET | Sign/verify scoped user operation tokens | Frontend server and backend API |

Use `Authorization: Bearer ...` on each endpoint family; auth bootstrap must
not accept a user service token as its BFF credential or vice versa. Generate
the secrets independently, compare bootstrap credentials safely, and keep both
out of browser JavaScript, URLs, client bundles, and logs.

The bootstrap credential only authenticates the calling BFF. It never selects
a player or grants admin rights. Login resolves the user from verified
credentials; other auth operations resolve an opaque session or single-use
email token. No request accepts an acting-user ID for authorization.

## HTTP surface

These routes are generated into OpenAPI. All are behind the dedicated BFF
credential and configurable auth rate limits.

| Method and path | Input | Intended behavior |
|---|---|---|
| POST /v1/auth/login | email, password | Verify credentials/status; issue fresh opaque session to BFF |
| POST /v1/auth/session | sessionToken | Resolve live session and return trusted user/session identity and allowed scopes |
| POST /v1/auth/logout | sessionToken | Revoke session; repeated logout is harmless |
| POST /v1/auth/verification/request | email | Generic acknowledgement; dispatch verification link when eligible |
| POST /v1/auth/verification/confirm | token | Atomically consume token and verify the account |
| POST /v1/auth/password-reset/request | email | Generic acknowledgement; dispatch reset link when eligible |
| POST /v1/auth/password-reset/confirm | token, newPassword | Consume token, update hash and revoke existing sessions |
| POST /v1/auth/signup | registration fields | Return 403/FORBIDDEN while public signup is closed |

Only the BFF receives raw session credentials. Its browser-session flow must
keep them outside JavaScript-accessible storage, using a sealed HttpOnly cookie
or a server-side session reference. The frontend implementation and cookie
library belong to the frontend repository; backend tests exercise the HTTP
contract with a test BFF. Production cookies are Secure, use appropriate
SameSite settings, and browser mutations require CSRF/origin checks.

The session resolution response gives the BFF a backend-owned user ID, backend
session ID, and allowed operation scopes. The BFF signs domain requests with
`sub`, `sid`, `iss`, `aud`, `iat`, `exp`, and the narrow required `scope`.
The existing maximum service-token age remains five minutes.

The backend verifies the signed subject and checks that `sid` is live and
belongs to it. Current account status and role permissions must also be checked.
Request bodies and browser-supplied role/scope values cannot override these
checks. Revoked sessions and disabled accounts fail even when the JWT itself
has not expired. The BFF resolves the session before minting a new token.

The `sid` claim is required. Tokens without it are rejected, and no fallback
bypasses database-backed session validation. The frontend must include the
backend session ID returned by session resolution.

## Session and account rules

- Store only hashes of strong random session/verification/reset tokens.
- Use 30-day inactivity and 90-day absolute session expiry, enforced using
  backend time. Activity cannot extend the absolute limit.
- Create a new session token on login. Logout revokes that session; password
  reset and disabling an account revoke existing sessions.
- Consume verification/reset tokens once, transactionally, with bounded expiry.
- Store Argon2id hashes with tunable production parameters. Low-cost hashing
  settings are for isolated tests, never the production default.
- Limit roles to player and admin. An idempotent seed creates initial accounts
  using runtime-provided credentials and never prints passwords or rewrites
  existing hashes on an ordinary repeat run.
- Keep `SIGNUPS_OPEN=false` when the setting is added. No invites or public
  registration rollout is required for the first milestone. The broader admin
  account-management API is Phase 5 work.

## Email and logging

The mailer is a replaceable dependency. Development writes JSON messages to the
ignored `LOCAL_MAIL_DIRECTORY` (default `.local-mail`) and refuses to run as a
production mailer. Resend follows after a domain is verified. Local links do not
enter normal request or audit logs; captured-log tests cover password, session,
and email-token field names.

Login and email workflows must avoid account enumeration. Public responses use
the existing error envelope and do not expose storage/provider details.
Verification/reset email links must lead to the frontend flow and must not be
logged as full URLs. Do not reuse real user credentials in seeds or tests.

## Acceptance and frontend checkpoint

Test valid/invalid BFF credentials, credentials used on the wrong endpoint
family, successful/failed login, token replay, concurrent token consumption,
expiry boundaries, logout retries, reset revocation and role/account changes.
Prove request bodies cannot choose the user, foreign sessions cannot satisfy
`sid`, revoked sessions cannot mint/use tokens, and signup remains closed.

Backend acceptance covers these cases with PostgreSQL integration tests and the
generated contract. The remaining frontend checkpoint must verify secure cookie
handling, CSRF/origin checks, session resolution, scoped token signing, logout,
verification/reset links, and error mapping in the frontend repository.
