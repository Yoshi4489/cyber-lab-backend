# Catalog and scoring contract

Status: implemented. Catalog, submission persistence, first solves, profile
progress, leaderboard queries, dynamic flag derivation, verified-user rate
limiting and the owned running-instance resolver are active code paths.

## Catalog

`GET /v1/categories`, `GET /v1/challenges`, and
`GET /v1/challenges/:slug` are public. They return published rows seeded from
validated repository definitions. Existing challenge fields remain stable and
the list reports `source: "database"`. Definitions contain no flag material.

## Hints and walkthroughs

Each lab package sets its hints and their costs. The award is the base points
minus unlocked hint costs, with a floor of 10% of base, rounded up. Opening the
walkthrough before solving makes the award 0; the solve is still recorded.
After a solve, hints and the walkthrough are free and don't change the award.
Unlocks and awards take the same per-player, per-challenge lock, so an unlock
racing a solve can't apply a cost twice or lose it. Unlocks are safe to retry.

## Artifact challenges

Download challenges omit `instanceId`. Their flag is an HMAC of the challenge ID and
`definitionVersion`, baked into the files by `scripts/build-artifacts.mjs` and derived
again at submission, so no flag is stored. Omitting `instanceId` for any other kind
returns 404, and so does sending one for an artifact challenge. Bump
`definitionVersion` and rebuild when a challenge's files change.

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

The server-wired resolver reads persisted instance ownership and accepts only a
running instance before its expiry. Foreign, stopped, expired, or mismatched
instances return ownership-safe `NOT_FOUND`.

The local Welcome test policy (`docs/API.md`) is the only exception to dynamic
flags: while enabled outside production, Welcome's fixed ID verifies the shared
public value through the same checks. No other ID ever accepts it.

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
- submission `instanceId`, `recorded: true`, points-awarded semantics, and the
  owned running-instance requirement;
- `RATE_LIMITED`, ownership-safe `NOT_FOUND`, and ordinary auth errors.
