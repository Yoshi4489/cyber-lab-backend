# Catalog and scoring contract

Status: Phase 2 backend implemented. Catalog, submission persistence, first
solves, profile progress, leaderboard queries, dynamic flag derivation, and
verified-user rate limiting are active code paths. The production submission
resolver returns 501 until Phase 3 provides owned running instances.

## Catalog

`GET /v1/categories`, `GET /v1/challenges`, and
`GET /v1/challenges/:slug` are public. They return published rows seeded from
validated repository definitions. Existing challenge fields remain stable and
the list reports `source: "database"`. Definitions contain no flag material.

## Dynamic submissions

`POST /v1/submissions` requires a live session-bound service token with
`submissions:write` and this strict body:

```json
{
  "challengeId": "uuid",
  "instanceId": "uuid",
  "flag": "CTF{...}"
}
```

The backend derives the acting user only from the verified token subject. An
owned-instance resolver must bind that user and instance to the submitted
challenge before flag verification. Flags are HMAC-derived from the user,
challenge, and instance using `INSTANCE_FLAG_SECRET`; the secret and derived
flag never enter PostgreSQL, API responses, or logs.

Every accepted attempt is stored without its flag value. Correct attempts race
on the database uniqueness constraint for `(user_id, challenge_id)`, so only one
creates the first solve and receives points. The response is:

```json
{
  "correct": true,
  "points": 10,
  "recorded": true,
  "source": "database"
}
```

`points` is the award from this attempt. A repeated correct solve returns zero.
Responses never echo the submitted or expected flag. The fixed-window limiter
keys on the verified user identity after live-session authorization.

The current server-wired resolver returns `NOT_IMPLEMENTED` (501). Phase 3 swaps
in persisted instance ownership and activates this same service. Fixture-based
integration tests are the only Phase 2 path that awards points.

## Progress and leaderboard

`GET /v1/profile` requires `profile:read`. It ignores caller-selected user IDs
and returns the verified subject's display profile, totals, available challenge
count, and solve history.

`GET /v1/leaderboard` is public and returns up to 100 active players ordered by
points, solve count, completion time, and stable tie-breakers. It exposes display
names and aggregate results only; emails, user IDs, roles, and session data are
not returned. Disabled accounts and admin accounts are excluded.

## Frontend checkpoint

The frontend repository must update its generated contract and UI for:

- catalog `source: "database"`;
- the new `profile:read` scope and `/v1/profile` response;
- the public `/v1/leaderboard` response;
- submission `instanceId`, `recorded: true`, points-awarded semantics, and
  `NOT_IMPLEMENTED` until the Phase 3 instance flow is connected;
- `RATE_LIMITED`, ownership-safe `NOT_FOUND`, and ordinary auth errors.
