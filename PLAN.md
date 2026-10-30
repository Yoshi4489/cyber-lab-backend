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
| Rate limits | Done. Session checks per session, login/verify/reset per learner IP forwarded by the BFF, submissions and spawns per user. `LOCAL_DEV_TEST=true` disables all limits locally. |
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
| 4. Two-user isolation | Done on the local VM (2026-10-30) |
| 5. Expiry and cleanup | Done on the local VM (2026-10-30) |
| 6. Regression and replacement readiness | Done on the local VM (2026-10-30) |

Phase 4 control-plane evidence: `tests/welcome-phase-four.integration.test.ts`
(real API, database and lifecycle state machine with a recording Docker fake)
and the frontend's `tests/e2e/welcome-isolation.spec.ts`. Both prove ownership
denial and per-instance identities, not real container separation.

Phase 4 real-container evidence (2026-10-30, `CyberRangePhase4Target`, API,
worker and disposable PostgreSQL/Redis on Windows, two slots, 24/24 checks):

| Check | Observed |
|---|---|
| mTLS, freshly issued set | Valid client 200 (Engine 29.9.2); no client certificate, untrusted CA and wrong hostname rejected. `npm run worker:preflight` ready. |
| Both learners running | 2 containers, 2 networks, 2 routes, labels matching both instance ids; both pages 200 through ingress |
| Container options (both) | Unprivileged, read-only root, all capabilities dropped, no-new-privileges, AppArmor `docker-default`, 64 PIDs, 128 MiB, 0.5 CPU, no ports or mounts, bounded noexec `/tmp` |
| Networks (both) | Internal, isolated IPv4/IPv6 gateway mode, IPv6 disabled |
| B against A through the BFF | Read, extend, stop and submit each 404 `NOT_FOUND`; A unchanged |
| Reachability | Each target reached its own address (200); A to B and B to A blocked (`ENETUNREACH`) |
| Stop A | 1 container, 1 network, 1 route left, all B's; A's link 404; B's page and health 200; B's flag scored 10 |
| Stop B | 0 containers, 0 networks, 0 routes |

Limits: learners were separate cookie-holding HTTP clients against the real BFF
(frontend `origin/develop` 63151ff in development mode), not separate browser
profiles, so the UI was not exercised. Seccomp was not probed separately in
this run; the shared flag cannot prove per-user flag separation. This is local
evidence, not production-topology evidence.

Phase 5 evidence (2026-10-30, same VM and topology, two slots, 5-second
maintenance interval, `LOCAL_DEV_TEST=true`, 32/32 checks):

| Check | Observed |
|---|---|
| Repeated stop | Same key replayed (`replayed: true`); a new key and a stop after `stopped` were both safe; route 404; 0 containers, networks, routes and reservations |
| Capacity refusal | Third spawn accepted 202 then `failed` with `node_capacity_exhausted` and audited; resources stayed 2/2/2 with no third target; slot reusable after a confirmed stop |
| Expiry | One disposable row's expiry moved into the past; the real reaper produced `expired` in 6 seconds; resources gone, route 404, other learner unaffected, submission 404, reservation released |
| Partial cleanup | An unrelated endpoint on A's network blocked removal: A stayed `stopping`, container and route removed, network and endpoint kept, B unaffected, another spawn refused. The stop used all 5 attempts and was marked failed. After the endpoint was released, the next minute's reconcile finished cleanup, A ended `stopped` and a new spawn ran |
| Final state | 0 containers, 0 networks, 0 routes, 0 reservations; route directory only `tls.yml`; ingress intact |

Limits: the real 60-minute timer was not waited out, and the terminal-instance
orphan sweep audits were not exercised in this run (see the gate record).

Finding fixed after this run: automatic expiry and failed stop attempts wrote no
audit event. They now record `instance.expired`, `instance.stopped` and
`instance.stop_failed` (see [docs/LIFECYCLE.md](docs/LIFECYCLE.md)). Verified by
integration tests with a fake Docker (276 tests passed on disposable
PostgreSQL/Redis), then confirmed on the VM in Phase 6.

Phase 6 evidence (2026-10-30, backend 11d820c, frontend `origin/develop` 63151ff
production build in live mode, real API limits, same VM):

| Check | Observed |
|---|---|
| Backend gates | Lint, typecheck, build, 276/276 tests with no skips |
| Frontend gates | Lint, typecheck, 130/130 unit tests, build, preview isolation, BFF smoke, 57/57 preview and 117/117 live-fixture browser tests |
| Generated types | Regenerated from the running API; identical apart from line endings |
| Browser journey | Closed signup, wrong password refused, login, refresh, briefing, keyboard spawn, target page, incorrect, correct (10 points) and repeat flag, one solve, extend, profile, leaderboard, stop, route 404, logout, relogin keeps points |
| Cookie hosts | Learner on `localhost`, target on `127.0.0.1`: no cookie or referrer reached the target, and the browser held no target cookie |
| Responsive and theme | Four pages at desktop, tablet and mobile in light and dark with no horizontal overflow |
| Keyboard | Focus visible at each stop up to Spawn Instance, reached in 12 tabs |
| Audit events | `instance.stopped` and `instance.expired` once each; `instance.stop_failed` once with the lab still `stopping`, then `instance.stopped` once after recovery; no flag or route in details |
| Final state | 0 containers, 0 networks, 0 routes, 0 reservations; route directory only `tls.yml`; disposable services and frontend snapshot removed |

43 of 44 journey checks passed first time. The failure was the driver reading
the dashboard heading too early; a retest over three reloads showed the session
valid and the name replacing a generic heading within about 250 ms.

Limits: gates ran on Node 24, not the pinned 22. Only three screenshots were
reviewed by eye. Expiry used a moved row, and this is local evidence, not
production-topology evidence.

Frontend observations, not fixed: the signed-in dashboard briefly shows its
generic heading on reload; the navigation labels Leaderboard and Profile "Coming
soon" although both read real data; "View your profile" wraps its arrow.

## Next steps, in order

1. **Choose the next milestone.** The Welcome phases are complete; real content
   and hosted rollout each need separate approval. Before more VM runs:
   - The Engine mTLS set was reissued on 2026-10-30 and expires 2026-11-29;
     the keys are outside Git on the Windows host.
   - The ingress HTTPS certificate on the VM still expires **2026-11-01** and
     must be reissued before later use. Its CA was not found on the host.
   - Disposable PostgreSQL/Redis were removed, so migrate and seed fresh ones.
     Start `phase4-traefik` (left stopped) and the loopback SSH tunnel.
2. **Decide the general per-IP limit.** Routes other than auth still share one
   100/minute per-IP budget across all learners behind the BFF. Keying them by
   verified user is a separate API decision.
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

- The next milestone after Welcome: real content, or hosted rollout and the
  production security gate.
- How to key the general rate limit (point 2 above).
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
