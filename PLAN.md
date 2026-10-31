# Backend plan

Current state and next steps for the Cyber Range backend, as of 2026-10-30.
The dated delivery log and all earlier evidence are in
[docs/PLAN_HISTORY.md](docs/PLAN_HISTORY.md).

## Where things stand

The backend is a working local platform for one harmless test lab (Welcome).
It is not launched: public signup is closed and the production security gate
is open.

| Area | State |
|---|---|
| API foundation | Done. Fastify 5, Zod at every edge, generated OpenAPI, stable error codes, request ids, redacted logs, liveness/readiness. |
| Accounts and sessions | Done. Backend-owned accounts, Argon2id passwords, opaque sessions behind the frontend BFF, email verification and reset. Signup returns 403. |
| Catalog, scoring, progress | Done. Published catalog, once-only scoring on a database constraint, profile and leaderboard. |
| Lab lifecycle | Done. Durable intents, BullMQ worker, Docker adapter over mTLS, Traefik routes, expiry, extension, reaping, reconciliation, orphan cleanup, crash recovery. |
| Isolation controls | Implemented and verified on earlier disposable VMs: user namespaces, seccomp, AppArmor, dropped capabilities, read-only root, resource limits, isolated per-instance networks, default-deny egress. |
| Rate limits | Done. Session checks per session, login/verify/reset per learner IP forwarded by the BFF, submissions and spawns per user, and the general limit per service-token user (anonymous requests per address). `LOCAL_DEV_TEST=true` disables all limits locally. |
| Hosted demo | API on Render (https://cyber-range-api.onrender.com) with a Neon database. No worker or lab host is connected, so it cannot spawn labs. |

### Welcome test lab

Welcome is a harmless static page that openly shows a fixed public flag
(`FLAG{WELCOME_TO_CISCO_FAMILY}`), worth 10 points once. It exists only to test
the platform end to end. It is enabled by `WELCOME_LAB_TEST_ENABLED=true` with
`WELCOME_LAB_FLAG` in development or test; production refuses to start with
either set. Every other challenge uses per-instance HMAC flags.

| Phase | State |
|---|---|
| 1. Accounts and catalog | Done |
| 2. Spawn and running | Done on the local VM (2026-10-26) |
| 3. Submission and persistence | Done (merged to `develop`) |
| 4. Two-user isolation | Control-plane half done and pushed; **real-container half waiting on the VM** |
| 5. Expiry and cleanup | Not started; needs approval |
| 6. Regression and replacement readiness | Not started |

Phase 4 control-plane evidence: `tests/welcome-phase-four.integration.test.ts`
(real API, database and lifecycle state machine with a recording Docker fake)
and the frontend's `tests/e2e/welcome-isolation.spec.ts`. Both prove ownership
denial and per-instance identities, not real container separation.

## Next steps, in order

1. **Finish Phase 4 on the lab VM.** Follow the Phase 4 checklist in
   [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) and record the
   container, network and route counts here. VM state as of 2026-10-30:
   - VM `CyberRangePhase4Target`, user `laboperator`, Engine with mTLS on
     `192.168.56.108:2376`, no default route. SSH is key-only; the operator
     has a working key (kept outside Git).
   - The Engine server certificate expires **2026-11-01**. The CA key and the
     worker's client certificate were not found on the Windows host, so a
     fresh set must be issued with [docs/DOCKER_MTLS.md](docs/DOCKER_MTLS.md)
     (use `192.168.56.108` as the server address) before the worker can
     connect.
   - Still to confirm with `sudo docker ...` (the user is not in the docker
     group): isolation options, the Traefik ingress container, the Welcome
     image id, and zero leftover managed resources.
2. **Phase 5 (approved 2026-10-31, control-plane half in progress):** expiry,
   repeated stop, capacity refusal, partial-cleanup retry. Its real-container
   checks also run on the VM. Then Phase 6.
3. **Close the production security gate** before any public lab hosting. See
   [docs/PHASE4_SECURITY_GATE.md](docs/PHASE4_SECURITY_GATE.md). Open items:
   production firewall and domain/TLS review, separate production application
   and migration database roles ([docs/DATABASE_ROLES.md](docs/DATABASE_ROLES.md)),
   verified-domain email, deployed frontend HTTPS cookie and email-link
   checks, and a worker plus separate lab host for the hosted API.
4. **Later work:** admin and operations (account/instance admin, metrics and
   alerts, credential rotation, staged deployment with rollback), a
   per-instance distributed lock for more than one worker, and the deferred
   items (browser terminal, raw TCP/WireGuard, multi-node scheduling,
   microVMs).

Public signup stays closed until the security gate passes; passing it does not
open signup by itself.

## Decisions waiting on the owner

- Any hosted change, dependency, migration or contract change.

## How work is delivered

- Work on a branch, open a PR to `develop`, and merge only when CI is green.
- Finish and record one Welcome phase before starting the next, and pause for
  approval between phases.
- Backend and frontend stay in their own repositories; contract changes go
  through `docs/API.md` and generated OpenAPI.
- Record real evidence (commands, counts, dates) here when a step completes.
  Label anything that could not run as not run.
- Keep credentials, certificates, VM disks, manifests and private env files
  out of Git.

## Known issues

- With default file parallelism, three older lifecycle integration tests
  occasionally race on the shared test database. Run
  `npx vitest run --no-file-parallelism` for a reliable local result. CI has
  passed on `develop`.
- `AGENTS.md` and this file describe the backend only; frontend status is in
  the sibling repository's `PLAN.md`.
