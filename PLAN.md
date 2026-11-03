# Backend plan

Current state and next steps for the Cyber Range backend, as of 2026-11-03.
The dated delivery log and all earlier evidence are in
[docs/PLAN_HISTORY.md](docs/PLAN_HISTORY.md).

## Where things stand

The backend is a working local platform with one harmless test lab (Welcome),
six real web labs (two of them multi-container), three browser-terminal (shell)
labs on the gVisor sandbox, and five download challenges, verified locally. It is not
launched: public signup is closed and the production security gate
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

## CTF platform

Plan: [docs/CTF_PLAN.md](docs/CTF_PLAN.md). Phases stop for approval.

### Phase 1: content framework and first web labs (2026-10-30)

Implemented: challenge packages in `challenges/<slug>/`, exec flag delivery
(no flag in container config or process environments), hints, walkthroughs and
award calculation, and four labs: Invoice Peek, Staff Login, Log Viewer and
Ping Tool. Labs are published only with `CATALOG_PUBLISH_LABS=true`, which
production refuses. The frontend briefing, hints and walkthrough are on its
`feat/ctf-phase-1` branch.

Evidence on the local lab VM (`CyberRangePhase4Target`), Engine 29.9.2:

- `scripts/lab-check.mjs`: 32/32 checks across four labs under production
  runtime limits, using flags in the real `CTF{v1_...}` format: healthy, solver
  recovers the exact flag, flag absent from container config, PID 1 and all
  process environments, delivery file gone, flag absent from `/app`, no outbound
  network.
- Full stack through the BFF, Traefik and the worker, with two users: 50
  of 51 driver checks passed. The one failure was a wrong driver expectation:
  it wanted admins on the leaderboard, which lists players only. Awards observed:
  one hint 90, no hints 100, walkthrough first 0, two hints (250 - 75) 175,
  repeat submission 0, profile total 365. Wrong flags and another user's flag
  were rejected, per-instance flags differed, another user's instance read
  returned 404, and a traversal to `/proc/self/environ` did not reveal the flag.
- Real browser (Playwright): 13/13 checks, covering the signed-out briefing,
  hint charge, forfeit confirmation, phone width with no overflow, solving the
  lab by hand behind the route prefix, award, and stop.
- Welcome still works with its env delivery (10 points). Final VM state: 0 lab
  containers, 0 lab networks, only `tls.yml` in the route directory; no flags in
  API, worker or frontend logs.

Found and fixed during verification: solvers matched `FLAG{...}` while real
flags are `CTF{v1_...}`. The first VM check passed only because it used a fake
flag in the solver's format, so the check now uses the real format.

Not done or not run:

- The new `Lab solvers` CI job has not run yet; it first runs on a PR to
  `develop` or `main`.
- The Welcome page copy is still special-cased in the frontend (`isWelcome`),
  because it has no content package.
- The plan's `expert` difficulty, category table and `scored` column were not
  needed yet. A forfeited solve is stored with 0 points instead.

### Phase 2: artifact challenges (2026-10-31)

Implemented: the `artifact` challenge kind, optional `instanceId` on submissions
for that kind only, one derived flag per challenge version, a local artifact store
outside Git, signed-in downloads through the BFF, and an operator build. Ships
Caesar's Memo, Small e, Leaky Capture, Lost Photo and License Check.

Evidence, using real services on the local machine:

- `scripts/artifact-check.mjs`: 15/15 across five challenges. Each solver recovers
  the exact flag, the flag is not in the files as plain text, and a different flag
  gives a different answer.
- Real browser: every file downloaded through the BFF, each solver run on the
  downloaded copies, then submitted. Awards: one hint 90, 250, 100, 100, walkthrough
  first 0. All 10 submissions stored with a null instance. Signed-out download
  returned 401. Phone width had no overflow, and the session page redirects to the
  briefing. 19/20 checks passed on the first run. The other was a timing mistake in
  the check, and a separate wait confirmed the redirect.
- Integration tests: tampered files refused, traversal rejected, the manifest not
  servable, and no-instance submissions refused for web labs.
- Real tools: Chromium decodes the PNG. `tcpdump` reads all 35 packets with correct
  checksums and shows the 4 login attempts.
- Regression through the VM: web labs 50/51 with the same 365-point total. The one
  failure was a brief 502 just after a stop (see Known issues); the final state was
  0 lab containers and only `tls.yml` in the route directory. No flags in logs or
  tracked files.

Not done or not run:

- Wireshark, `exiftool` and `binwalk` were not run against the files, although the
  walkthroughs mention them. Small e's `encrypt.py` is illustrative and was not run.
- The `Lab solvers` CI job, which now also runs `artifact-check`, still hasn't run.
- License Check is JavaScript rather than a native binary, so it needs no compiler
  and is safe to run. Native reversing challenges wait for the Phase 4 workstation.
- Instead of the planned `challenge_artifacts` table and `flag_policy` column, file
  metadata lives in the store's manifest and the policy follows from `kind`.
- Anyone who solves an artifact challenge can share its flag, as the plan accepted.
  Rotating `INSTANCE_FLAG_SECRET` requires rebuilding the artifacts.

### Phase 3: per-instance origins and multi-service labs (2026-11-02)

Implemented, per [docs/CTF_PHASE3_PLAN.md](docs/CTF_PHASE3_PLAN.md):

- Each running instance is its own origin, `https://<routeKey>.<LAB_PUBLIC_HOST>/`.
  Route keys are 40 lowercase hex characters (160 bits), and Traefik routes them
  with `HostRegexp` and no prefix stripping. `LAB_PUBLIC_HOST` replaces
  `LAB_PUBLIC_BASE_URL`.
- Manifests may list up to three internal `services` beside the entry. Each gets
  the same fixed security defaults, a network alias on the instance network, no
  route and no published port. The flag goes to one named service by exec.
- Inventory, status and cleanup cover every container. Losing any service fails
  the instance, which the existing reconcile path then cleans up.
- Capacity sums `slotWeight` (`instances.slot_weight`, migration 0008) instead
  of counting instances.
- `lab-check` now drives the real `DockerOrchestrator`, so its checks use the
  production container options. CI skips only the host isolation check, because
  hosted runners lack userns remap.
- A shared admin bot (`challenges/_bot`: Alpine Chromium 156, `puppeteer-core`
  24.43.1) and two labs: Support Desk (stored XSS against the bot, medium, 250) and
  Link Preview (SSRF past a host-name denylist to a metadata service, hard, 500).

Evidence on the local lab VM (1 CPU, 1.6 GiB), Engine 29.9.2, with 6 node slots
for the run (Support Desk weighs 5, Link Preview 2):

- `lab-check` with full host verification: 32/32 across the four Phase 1 labs,
  and 24/24 across the two new labs. That covers every container of each lab:
  flag absent from config, process environments and `/app`, no outbound network,
  delivery file gone, and no containers or networks left after cleanup.
- Phase 3 driver through the BFF, worker and ingress, with two users: 33/33.
  - Two Link Preview instances on separate hosts. Each solver recovered a different
    flag, and each correct flag awarded 500. The other user's flag was rejected,
    and the other user's instance returned 404.
  - In Chromium, a script on instance A got a `TypeError` reading B with
    `fetch`, an opaque empty response with `no-cors`, and no access to B's
    document in a frame. A's host-only cookie was not visible on B.
  - Support Desk: the bot posted the key back in about 10 seconds, awarding 250.
    While it ran, a second lab failed with `node_capacity_exhausted`. Memory
    after a visit was 22 MiB for the app and 31 MiB for the bot.
  - Killing the metadata sidecar failed the instance (`runtime_stopped`, 47 s),
    and its route and resources were removed. Expiry through the reaper also
    worked. Every section ended at 0 containers, 0 networks, 0 routes and 0
    reservations.
- Real browser through the frontend: 5/5. The session panel linked to
  `https://<40 hex>.lab.localhost:8443/`, the ticket stayed on that origin, the
  submission awarded 250, and the lab stopped from the browser.
- Regressions on the same stack: Welcome solved for 10 points; Phase 1 web labs
  50/51; Phase 2 downloads 19/20. The Phase 1 failure was the driver's expected
  solve count, which didn't allow for the Welcome solve made just before; the
  total of 1125 matched exactly. The Phase 2 failure was the same redirect timing
  check as before, and a separate wait confirmed the redirect, signed in and out.
- Full backend suite: 309/309 with disposable PostgreSQL and Redis. Lint and
  typecheck are clean.

Found and fixed during verification: Chromium forced HTTPS on `http://app:8080`,
because `app` is an HSTS-preloaded top-level domain. The bot now resolves `app`
and visits by IP address.

Not done or not run:

- The VM was not enlarged. Support Desk was tested with one user, and the
  two-user check used Link Preview, as the plan's fallback allowed.
- Chromium runs with `--no-sandbox` inside its no-egress container, an accepted
  risk until the gVisor decision in Phase 4.
- Alpine's `chromium` package isn't pinned to an exact version. `puppeteer-core`
  is pinned by lockfile.
- The `Lab solvers` CI job still hasn't run. It now skips host verification
  (`LAB_CHECK_VERIFY_HOST=false`), and building the 1.4 GB bot image there is
  untested.
- The production lab domain must be separate from the frontend's registrable
  domain, ideally on the Public Suffix List. That belongs to the security gate.
- No frontend change was needed: it already accepts any `https:` instance URL.

### Phase 4: browser terminal and pwn (2026-11-03)

Implemented the first browser-terminal labs. Learners get a shell in the browser
through `ttyd`, served on the instance's own origin like any web target, so the
API gains no terminal code and the worker keeps sole Docker authority.

- A manifest can set `sandbox: "gvisor"`, running every container of the lab on
  the `runsc` kernel; `runc` stays the default and Phase 1-3 labs are byte-for-byte
  unchanged. Preflight fails closed if the host does not advertise `runsc`.
- Shell labs get one exec-capable `workspace` tmpfs (`/tmp` stays `noexec`), so a
  learner can compile and run code in their home directory only.
- gVisor's netstack can't reach Docker's embedded DNS, so the worker gives the
  entry container an `/etc/hosts` entry for each internal service, built from the
  address each gets when it starts.
- Instance-backed labs are now `web` or `shell`; artifact challenges still launch
  nothing. `lab-check` drives shell labs through the real orchestrator under
  `runsc` with a Python/pwntools solver.
- Three labs: First Overflow (stack overflow to a win function, easy, 100),
  Format Leak (format-string stack read, medium, 250), and World Readable
  (credential enumeration to an internal vault, easy, 100). The workstation image
  ships gcc, gdb, pwntools and a vendored static `ttyd`.

gVisor spike on the lab VM (`runsc release-20261019.0`, verified by sha256,
registered beside `runc`): the sandbox runs our full container hardening, `gdb`
sets breakpoints and reads registers, ASLR stays on (gVisor refuses to disable
it, which the design assumed), and the exploit works end to end. Docker's embedded
DNS does not work under `runsc`; the `/etc/hosts` approach above resolves it.

Evidence on the local lab VM (1 CPU, 1.6 GiB), Engine 29.9.2, 6 node slots:

- `lab-check` with full host verification, all nine runtime labs (Phase 1, 3 and
  4): every solver recovers the exact flag, with per-container checks that the flag
  is absent from config, process environments and `/app`/`/opt`, no outbound
  network, the flag is never on the workstation, and no containers or networks are
  left after cleanup. The three shell labs run under `runsc`.
- Phase 4 full-stack driver through the BFF, worker and ingress: 12/12. First
  Overflow started from the session panel, its URL was a per-instance terminal
  origin (`https://<40 hex>.lab.localhost:8443/`), the `ttyd` terminal returned
  200 through ingress, the exploit (run from a workstation container on the
  instance network) recovered the flag and scored 100, a wrong flag was rejected,
  a second lab failed with `node_capacity_exhausted` (First Overflow weighs 5 of
  6 slots), the lab stopped cleanly, and the VM ended at zero managed resources.
- Real browser: the session panel offers an "Open terminal" link to the instance
  origin, and the page loads as `ttyd - Terminal`.
- Regression: Welcome solved for 10 points; all nine runtime labs pass `lab-check`.
  (Running every lab back-to-back while the worker was live failed as expected,
  because the worker's orphan reaper removed the check's own containers; with the
  worker stopped, as on CI, all nine pass.)
- Full backend suite: 313/313 with disposable PostgreSQL and Redis; lint and
  typecheck clean. Frontend: build, typecheck, lint and 130 unit tests pass.

Found and fixed during verification: the spawn query only launched `web`
challenges, so shell labs returned 404; it now accepts `web` and `shell`. The
First Overflow offset (48) and the Format Leak format-string position (54) were
found with gdb/pwntools and baked into the solvers.

Not done or not run:

- The VM was not enlarged, so it holds one shell lab at a time (workstation plus
  target, about 640 MB).
- gVisor is registered as a non-default runtime on the lab VM only. Production
  lab hosts must install and verify it; this is recorded for the security gate.
- The privilege-escalation profile (Phase 5) is deliberately not started: these
  labs need no privilege change, and `no-new-privileges` stays set.
- The `Lab solvers` CI job still hasn't run; it skips host verification and so
  skips the gVisor labs, which are checked on the lab VM instead. Building the
  ~820 MB workstation image on CI is untested.
- Alpine's `chromium` (Support Desk bot) and Debian packages are not pinned to
  exact versions; `pwntools`, `ttyd` and base images are pinned.

## Next steps, in order

1. **Review CTF Phase 4, then decide what follows: Phase 5 (privilege-escalation
   profile, a separate security review) or hosted rollout.** Phase 5 relaxes
   `no-new-privileges` for reviewed labs on the stronger sandbox and needs explicit
   approval; it does not proceed by default. Before more VM runs:
   - The Engine mTLS set was reissued on 2026-10-30 and expires 2026-11-29;
     the keys are outside Git on the Windows host.
   - The ingress HTTPS certificate on the VM is valid until 2026-11-29 and
     covers `localhost`, `127.0.0.1` and `*.lab.localhost`. Its CA is outside
     Git on the Windows host. (Earlier notes said 2026-11-01; that was out of date.)
   - Disposable PostgreSQL/Redis were removed, so migrate and seed fresh ones.
     Start `phase4-traefik` (left stopped) and the loopback SSH tunnel. Set
     `LAB_PUBLIC_HOST=lab.localhost:8443` and enough `LAB_NODE_CAPACITY_SLOTS`
     for Support Desk's weight of 5.
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

- Whether to start CTF Phase 5 (privilege-escalation profile) next, or hosted
  rollout and the production security gate.
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

- A new route can return 404 for a moment after an instance reports `running`,
  while Traefik reloads. The longest gap measured was 837 ms over 12 starts, so
  people won't normally notice it, but scripts should wait for a 200. A stopped
  lab can likewise return 502 briefly before its route disappears.

- With default file parallelism, three older lifecycle integration tests
  occasionally race on the shared test database. Run
  `npx vitest run --no-file-parallelism` for a reliable local result. CI has
  passed on `develop`.
- `AGENTS.md` and this file describe the backend only; frontend status is in
  the sibling repository's `PLAN.md`.
