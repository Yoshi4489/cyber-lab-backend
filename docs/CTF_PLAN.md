# Real CTF challenge platform: technical plan

## Context

All six Welcome phases passed on the local lab VM, so the lifecycle, isolation, scoring and cleanup are proven, but only for one harmless page. The catalog otherwise holds six "Sample" rows with no target behind them. This plan adds real, hands-on challenges across nine domains by extending that platform.

Decisions already made:
- **Access:** browser terminal for pwn, Linux and network targets.
- **Content:** original challenges, built and reviewed in this repo.
- **First release:** local VM. The production gate stays a separate later milestone.
- **Scoring:** fixed points by difficulty, with hint costs.

Nothing here is implemented yet. Each phase below stops for approval, as `PLAN.md` requires.

---

## 1. Current system analysis

| Area | Today | File |
|---|---|---|
| Stack | Fastify 5, Zod, Drizzle/PostgreSQL, BullMQ/Redis, Dockerode; Next.js BFF in a sibling repo | `AGENTS.md` |
| Roles | `player`, `admin`. An `admin:write` scope exists, but there are no admin routes in either repo | `src/services/authentication.ts` |
| Catalog | Repo-defined TypeScript seeded into `challenges`; `kind` is `web` or `shell`; difficulty stops at `hard` | `src/catalog/definitions.ts`, `src/db/schema.ts` |
| Runtime | Worker-only manifest: pinned image, non-root UID, one port, resource limits | `src/orchestrator/runtime-manifests.ts` |
| Scoring | Once-only by database constraint; `solves.points` snapshots the award | `src/db/scoring-repository.ts` |
| Flags | HMAC of user, challenge and instance; never stored | `src/services/runtime-flags.ts` |
| Frontend | Live catalog, briefing, session panel and flag form. Non-web labs show "Shell lab access is not available". Welcome copy is hardcoded through `isWelcome()`. Response schemas are `.strict()` | `cyber-range` repo: `features/catalog/live.ts`, `features/session/` |

### Conflicts that shape this plan

These come from reading the current code. Each would break a real challenge or open an unintended shortcut.

| # | Finding | Effect | Fix |
|---|---|---|---|
| 1 | `CYBER_RANGE_FLAG` is passed as a container env var (`buildContainerOptions`) | Any path traversal reads `/proc/self/environ`, any shell runs `env`, and the flag falls out without the intended exploit | Flag delivery over exec stdin into a tmpfs file (Phase 1) |
| 2 | `submissions.instanceId` is `NOT NULL`, and `SubmissionService` requires an owned running instance | Crypto, forensics and reverse-engineering downloads have no instance, so they can't be submitted | Nullable instance plus challenge-level flags (Phase 2) |
| 3 | The adapter and inventory assume one container per instance, and a second one throws "duplicate allocations" | SSRF internals, XSS bots and pwn workstations can't exist | Multi-service manifests (Phase 3) |
| 4 | All targets share one origin, `/labs/<routeKey>/` (`traefik-router.ts:98`) | A stored XSS payload on one learner's target runs on the same origin as everyone else's | Per-instance subdomains (Phase 3) |
| 5 | `no-new-privileges`, `CapDrop: ALL` and a non-root user are fixed | SUID and privilege-escalation challenges cannot work at all | Separate reviewed profile and stronger sandbox (Phase 5) |
| 6 | `/tmp` is mounted `noexec`, and the root filesystem is read-only | Learners can't compile or run an exploit in a shell | An exec workspace on the workstation only (Phase 4) |
| 7 | Targets have no egress by design | Reverse-shell and out-of-band callback solutions fail | Keep it. Author in-band solutions, or give a listener inside the instance network |
| 8 | Ingress is attached to every instance network | A learner with a shell sits next to ingress, which routes to other instances | Route keys stay unguessable; add a negative probe in Phase 4 |
| 9 | One flag per instance is checked only while running | An expired lab can't accept a flag found just before expiry | Keep it; show remaining time clearly in the UI |

The VM has 1 CPU and 2 GiB, with targets at 128 MiB each. It will not hold pwn workstations or a headless browser bot, so see section 5.

---

## 2. CTF architecture

```text
Browser ── Next.js BFF ── Fastify API ── PostgreSQL
   │                         │  └─ Artifact store (behind an interface)
   │                       Redis/BullMQ
   │                         │
   │                       Worker ── Docker mTLS ──┐
   │                                               v
   └── <routeKey>.labs.<host> ── Traefik ── Instance network (isolated, no egress)
                                              ├─ entry: web app or terminal (ttyd)
                                              └─ other services: DB, internal API, bot, pwn target
```

### Delivery types

| `kind` | Examples | Learner gets | Flag |
|---|---|---|---|
| `web` (exists) | SQLi, IDOR, SSRF, XSS | Per-instance web app | Per instance |
| `artifact` (new) | Crypto, forensics, reverse engineering, OSINT bundles | Downloads, no instance | Per challenge version |
| `shell` (exists, unused) | Pwn, Linux, network, NIST assessments | Browser terminal on a workstation beside the target | Per instance |

### Key design choices

**Browser terminal is just another route.** A `ttyd` process inside the workstation image is served through existing Traefik routing, which handles WebSockets natively. This needs no terminal code in the API, no Docker `exec` streaming, and no new Docker authority. It keeps the rule that only the worker holds Docker credentials, and keeps the adapter small. The unguessable route key is the access control, the same as web targets today.

**Flag delivery.** The manifest gets `flagDelivery`, one of:
- `exec` (required for real labs): before the route exists, the worker runs a reviewed one-shot command as a manifest-fixed user, passing the flag in that exec's environment only. The command writes it to a tmpfs file, and the lab reads and removes it. Readiness waits for it. The flag stays out of the container config and PID 1's environment. (Exec environment replaced the first stdin design because half-closing a hijacked Docker stream over TLS is unreliable.)
- `env`: Welcome only.

**Challenge-level flags for downloads.** Artifact flags are `FLAG{HMAC(secret, challengeId:artifactVersion)}`. They are derived rather than stored, which satisfies non-negotiable rule 5. They are baked into artifacts by an operator build, never in Git. Flags can be shared between learners here; this is accepted for self-paced learning. Per-user generated artifacts can follow if it becomes a real problem.

**Challenge packages.** Per `docs/challenge-authoring.md` in the frontend, there is no YAML and no second format. Each challenge is a folder validated by extended Zod schemas:

```text
challenges/<slug>/
  definition.json   public metadata, hints, references, delivery type
  briefing.md       scenario, objectives, learning outcomes
  walkthrough.md    released only after solve or forfeit; never contains a real flag
  runtime.json      services, limits, flag delivery (image digests supplied at deploy)
  src/  Dockerfile  pinned by digest
  solve/            automated solver, proves it is solvable
```

`src/catalog/definitions.ts` is replaced by a loader over these folders, keeping existing IDs. The frontend's old `web-001-cookie-monster` sketch stays unused.

**Publication gate.** A challenge can only be published if its schema validates, its solver passes, its unintended-path checks pass (finding 1), its walkthrough exists, and its reviewer sign-off is recorded in the PR.

**Scoring.**
- Base points: Easy 100, Medium 250, Hard 500, Expert 1000. Welcome keeps 10.
- Award = base minus unlocked hint costs, with a floor of 10% of base.
- Opening the walkthrough before solving forfeits points: the solve is recorded with no score and doesn't count on the leaderboard.
- Both are computed in the existing `recordSubmission` transaction, so concurrent attempts still award once. The unlock takes the same row lock to prevent a race.

**Admin tools.** Authoring stays in Git, because a web form that accepts images or Docker options would break rule 3. Admins get: publish/unpublish, a live instance list with force-stop, a submissions view and per-challenge stats, all behind `admin:write` with current-role checks and audit events.

---

## 3. Database design

Reviewed migrations, additive only:

| Change | Detail |
|---|---|
| `challenge_difficulty` | Add `expert` |
| `challenge_kind` | Add `artifact` |
| `challenges` | Add `briefing_md`, `objectives` jsonb, `learning_outcomes` jsonb, `references` jsonb (CWE, ATT&CK, NIST, OWASP), `flag_policy` (`instance` or `challenge`), `min_points` |
| `challenge_categories` (new) | `slug` PK, `label`, `sort_order`, so a new category needs no frontend change |
| `challenge_hints` (new) | `id`, `challenge_id`, `position`, `body_md`, `cost`; unique on challenge and position |
| `challenge_walkthroughs` (new) | `challenge_id` PK, `body_md`, kept apart so catalog queries can't leak it |
| `challenge_unlocks` (new) | `user_id`, `challenge_id`, `hint_id` (null means walkthrough), `cost_applied`, `created_at`; unique per user and item |
| `challenge_artifacts` (new) | `id`, `challenge_id`, `version`, `filename`, `media_type`, `size_bytes`, `sha256`, `storage_key` |
| `submissions` | `instance_id` nullable, with a check that it's required when the policy is `instance` |
| `solves` | Add `scored` boolean, false after a forfeit; the leaderboard filters on it |

No flags, expected values or submitted values are stored anywhere. `instances` keeps its primary container ID; extra services are tracked by Docker labels, which inventory already trusts. Progression uses `difficulty` and `tags` at first; a prerequisites table waits until a learning path needs it.

### API additions

All follow the existing route, Zod and OpenAPI patterns, with matching frontend adapter and schema updates, because the frontend's schemas are strict.

- `GET /challenges/:slug` adds briefing fields, hints (locked bodies hidden), artifacts.
- `POST /challenges/:slug/hints/:id/unlock`, and `POST /challenges/:slug/walkthrough/unlock`.
- `GET /challenges/:slug/walkthrough`, and `GET /challenges/:slug/artifacts/:id`, streamed through the BFF.
- `POST /submissions` makes `instanceId` optional for the `challenge` policy.
- `/admin/*` as above.

---

## 4. Challenge roadmap

Each challenge is original, inspired by real vulnerability patterns rather than copied. "W" is web, "A" is artifact, "S" is shell. "P" is the phase it needs.

### Web exploitation
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Invoice Peek | IDOR in a billing portal | Easy | W | 1 | CWE-639, OWASP A01 |
| Staff Login | SQLi authentication bypass | Easy | W | 1 | CWE-89, A03 |
| Log Viewer | Path traversal, source to secret | Easy | W | 1 | CWE-22 |
| Ping Tool | Command injection, in-band only | Medium | W | 1 | CWE-78, T1059 |
| Blind Catalog | Boolean blind SQLi | Medium | W | 1 | CWE-89 |
| Avatar Upload | Upload filter bypass to code execution | Medium | W | 1 | CWE-434 |
| Forged Session | JWT algorithm and key confusion | Hard | W | 1 | CWE-347 |
| Support Desk | Stored XSS against an admin bot | Medium | W | 3 | CWE-79 |
| Quick Transfer | CSRF with a bot victim | Medium | W | 3 | CWE-352 |
| Link Preview | SSRF to an internal metadata-style service | Hard | W | 3 | CWE-918, A10 |
| Chain of Custody | IDOR + SSRF + SQLi chain | Expert | W | 3 | Multiple |

### Cryptography
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Caesar's Memo | Classical and encoding layers with frequency analysis | Easy | A | 2 | Classical |
| Weak Vault | Salted hash cracking with a provided wordlist | Easy | A | 2 | CWE-916 |
| Small e | RSA low exponent | Medium | A | 2 | CWE-326 |
| Shared Prime | RSA moduli sharing a factor | Medium | A | 2 | CWE-327 |
| Pixel Leak | AES-ECB pattern leak | Medium | A | 2 | CWE-327 |
| Padding Oracle | CBC padding oracle service | Hard | W | 1 | CWE-209 |
| Nonce Reuse | ECDSA or GCM nonce reuse | Expert | A | 2 | CWE-323 |

### Pwn
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| First Overflow | Stack overflow to a win function | Easy | S | 4 | CWE-121 |
| Format Leak | Format string reads a secret | Medium | S | 4 | CWE-134 |
| Canary Walk | Leak a canary, then overflow | Hard | S | 4 | CWE-121 |
| Return Trip | ROP with ASLR leak to libc | Hard | S | 4 | CWE-121 |
| Heap Notes | Use-after-free in a note service | Expert | S | 4 | CWE-416 |

Pwn runs as a network service in its own container, and the learner exploits it from the workstation, so it needs no SUID. Exploits must assume ASLR is on, because the host setting is shared and Docker's default seccomp blocks disabling it per process.

### Reverse engineering
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| License Check | Static analysis of a serial check | Easy | A | 2 | ATT&CK T1027 |
| Packed Up | Unpack, then analyse | Medium | A | 2 | T1027.002 |
| Anti-Debug | Bypass debugger detection | Hard | A | 2 | T1622 |
| Benign Dropper | Config extraction from a safe, harmless sample | Hard | A | 2 | Non-functional by design |

### Forensics
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Lost Photo | Metadata and file carving | Easy | A | 2 | T1005 |
| Leaky Capture | Credentials in a synthetic PCAP | Easy | A | 2 | T1040 |
| Exfil over DNS | Rebuild a file from DNS tunnelling | Medium | A | 2 | T1048 |
| Memory Lane | Memory image with Volatility | Hard | A | 2 | T1003 |
| Disk Timeline | Incident timeline from a disk image | Hard | A | 2 | SP 800-86 |

All artifacts are generated synthetically, with no real personal data or live malware.

### OSINT
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Fictional Footprint | Pivot across a fictional company's self-hosted site, staff pages and photos | Easy | W | 1 | T1593 |
| Git Remembers | Secret in the history of a provided fictional repo | Medium | A | 2 | CWE-540 |
| Where Was It Taken | EXIF and visual clues in generated photos | Medium | A | 2 | T1592 |

OSINT uses only fictional, self-contained data, because pointing learners at the real internet would risk targeting real people and break when sites change.

### Network security
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Protocol Autopsy | Reconstruct a custom protocol from a PCAP | Medium | A | 2 | T1040 |
| Zone Transfer | Misconfigured DNS AXFR inside the lab network | Medium | S | 4 | T1590.002 |
| Segment Breach | Reach a service through a misconfigured dual-homed host | Hard | S | 4 | T1021 |

### Linux and system security
| Challenge | Scenario | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| World Readable | Enumeration and leaked credentials, no privilege change | Easy | S | 4 | T1552 |
| Cron Mischief | Writable script run by a higher-privilege service account | Medium | S | 5 | T1053.003 |
| SUID Surprise | SUID binary abuse | Medium | S | 5 | T1548.001 |
| Sudo Slip | Misconfigured sudo rule | Hard | S | 5 | T1548.003 |
| Capable | Linux capability misuse | Expert | S | 5 | T1548 |

### NIST and standards
These are real tasks that produce evidence, not quizzes. The flag is only released by a verifier that checks the work.

| Challenge | Task | Diff | Type | P | Reference |
|---|---|---|---|---|---|
| Rules of Engagement | Run a scoped assessment on a live lab, staying within the written scope; touching an out-of-scope decoy voids the flag | Medium | S | 4 | SP 800-115 |
| Least Privilege Audit | Find control failures on a live host, then fix them; a verifier releases the flag when they're remediated | Medium | S | 4 | SP 800-53 AC-6, AU-2 |
| Detect It | Write a detection rule; a verifier replays attack and benign traffic and releases the flag on no misses and no false positives | Hard | S | 4 | CSF Detect, ATT&CK |
| Contain and Recover | Work a live simulated incident: find the persistence, remove it and restore service | Expert | S | 4 | CSF Respond and Recover |
| Risk Evidence | Trace a breach from logs and configs to the control that failed and the root cause; the flag comes from data only found in the evidence | Hard | A | 2 | CSF Identify, SP 800-53 |

Control and framework mappings will be checked against the current NIST publications during content review. I wrote these from memory and did not look them up for this plan.

**Totals:** 11 web, 7 crypto, 5 pwn, 4 reverse engineering, 5 forensics, 3 OSINT, 3 network, 5 Linux, 5 NIST: 48 challenges. The first release ships a small part of this, and the rest are added steadily. The list is a backlog, not a commitment to build all 48 at once.

---

## 5. Infrastructure requirements

| Area | Requirement |
|---|---|
| Lab VM | Raise from 1 CPU, 2 GiB, 32 GiB to about 4 CPU, 8 GiB, 80 GiB for Phases 3 and 4. Your PC's free memory was already a limit on 2026-10-25, so **check this before Phase 3**; otherwise use a cheap dedicated box |
| Capacity | Add `slotWeight` to manifests, because a workstation plus target costs far more than one small page. `prepareSpawn` counts weight, not instances |
| Images | Pinned by digest; transferred offline to the VM with `docker save` and `docker load`, as Welcome was. A private registry comes with hosting |
| Workstation image | Shared `ctf-workstation` (ttyd, gdb, pwntools, nmap, tcpdump, compilers), about 1 GiB; a non-root learner; bounded exec workspace |
| Kernel isolation | Learners get arbitrary code execution in `shell` labs, so the shared kernel becomes the main risk. Spike gVisor (`runsc`) in Phase 4, including whether it works with `userns-remap` and with `gdb`. This is unverified, and the fallback is a dedicated disposable VM per lab host |
| Networking | Per-instance isolated bridge stays. Add `<routeKey>.labs.<host>` routing with wildcard TLS on a domain separate from the frontend's. Locally, `*.lab.localhost` |
| Storage | `ArtifactStore` interface: local files first, S3-compatible with hosting. Size cap per file, SHA-256 checked on read |
| Tmpfs | Per-service limits, plus a total disk quota so one learner can't fill the host |
| CI | Build each challenge, run its solver and unintended-path checks on the disposable CI runner, on an internal Docker network with no published ports. Keep the control plane off it |

---

## 6. Implementation phases

Each phase ends with VM evidence recorded in `PLAN.md`, a pause for approval, and commits split by boundary per `AGENTS.md`. Backend and frontend stay in separate repos, with contracts going through `docs/API.md` and generated OpenAPI.

**Phase 0: Prerequisites**
- Merge `fix/lifecycle-stop-audit-events` into `develop`; reissue the ingress certificate, which expires 2026-11-01.
- Sync your local frontend copy, which is 12 commits behind with uncommitted work. That's your call, and I won't touch that work.

**Phase 1: Content framework and first real web labs**
- Package loader and schemas; `exec-stdin` flag delivery; hints, walkthroughs and the new scoring.
- Frontend: generic briefing, hints panel and walkthrough; remove Welcome hardcoding; unpublish samples.
- Solver CI and publication gate.
- Ships: Invoice Peek, Staff Login, Log Viewer, Ping Tool.
- Exit: solvers pass on the VM, and `/proc/self/environ` and similar paths don't reveal the flag.

**Phase 2: Artifact challenges**
- `artifact` kind; nullable submission instance; challenge-level flags; artifact store and download route; operator build.
- Ships: Caesar's Memo, Small e, Leaky Capture, Lost Photo, License Check.
- Exit: download-only solve recorded with no instance, and no flag in Git or images' build context.

**Phase 3: Subdomains and multi-service**
- Per-instance subdomains; multi-service manifests; inventory and cleanup for several containers; `slotWeight`; admin bot base image.
- Ships: Support Desk, Link Preview.
- Exit: Phases 4 and 5 style isolation and partial-cleanup checks repeat for multi-container labs. XSS on A can't touch B's origin.

**Phase 4: Browser terminal and pwn**
- Workstation image; `ttyd` route; frontend terminal link; exec workspace; gVisor spike and decision; negative ingress probe.
- Ships: First Overflow, Format Leak, World Readable, Rules of Engagement, Zone Transfer.
- Exit: learner shell can't reach the control plane, host, other instances or the internet; fork bombs and disk filling stay contained; cleanup verified.

**Phase 5: Privilege-escalation profile (separate security review)**
- A named manifest profile that relaxes `no-new-privileges` only for reviewed challenges and only on the stronger sandbox. This changes `SECURITY.md`'s rules, so it **needs your explicit approval and doesn't proceed by default**.
- Ships: SUID Surprise, Cron Mischief, Sudo Slip.

**Phase 6: Admin tools and content growth**
- Admin API and UI; challenge stats; live leaderboard and profile labels in the frontend, including the "Coming soon" fix found in Phase 6 of Welcome.
- Work through the rest of the backlog.

**Phase 7: Hosting (separate milestone)**
- Close the production security gate in `docs/PHASE4_SECURITY_GATE.md`, a lab host, domain and TLS, backups, monitoring, abuse reporting and terms of use. Public signup stays closed until this passes.

### Critical files

- Backend: `src/catalog/definitions.ts`, `src/orchestrator/runtime-manifests.ts`, `docker-adapter.ts`, `traefik-router.ts`, `src/services/docker-lifecycle-handler.ts`, `submissions.ts`, `runtime-flags.ts`, `runtime-inventory.ts`, `src/db/schema.ts`, `scoring-repository.ts`, `lifecycle-state-repository.ts`, `managed-cleanup-repository.ts`, `src/routes/challenges.ts`, `submissions.ts`, new `src/routes/admin.ts`, `challenges/`, `SECURITY.md`, `docs/API.md`.
- Frontend: `features/catalog/live.ts`, `features/briefing/lab-briefing.tsx`, `features/session/session-panel.tsx`, `features/progress/flag-form.tsx`, `features/backend/catalog-schemas.ts`, new hints, walkthrough, downloads and admin features.

### Reuse rather than rebuild

- Lifecycle state machine, idempotency and reconciliation: `DockerLifecycleHandler`, `instance-lifecycle.ts`.
- Once-only award: `recordSubmission` and `solves_user_challenge_unique`.
- `FixedWindowUserRateLimiter` for submissions and unlocks.
- `flagMatches` and `HmacInstanceFlagService` for challenge-level flags.
- Ingress delivery and cleanup in `ingress-traefik-router.ts`.
- `audit_events`, `requireScope`, and the frontend's CSS modules, tokens and `.eyebrow` styling.

---

## 7. Risk assessment

| Risk | Sev | Mitigation |
|---|---|---|
| Container escape from a learner shell through a kernel bug | Critical | Separate lab host; userns remap; gVisor or VM isolation decision before shells ship; no control-plane secrets on the host |
| Lab used to attack others | High | No egress, proven by probes; keep raw TCP and VPN out of scope |
| Unintended solution or flag leak (env, image layers, health endpoint, walkthrough) | High | `exec-stdin` delivery; unintended-path checks in CI; flags kept out of images |
| Cross-learner attack through a shared origin or bot | High | Per-instance subdomains and separate lab domain; one bot per instance with no real credentials |
| Relaxed privilege profile weakens the whole host | High | Phase 5 only, separate review, stronger sandbox required |
| Real malware or personal data in artifacts | High | Synthetic artifacts only; non-functional samples; reviewer checklist |
| Vulnerable code running outside its sandbox | High | Targets run only on the lab host and disposable CI, per `AGENTS.md`; keep the vulnerable code clearly labelled |
| Resource exhaustion (fork bombs, disk, CPU) | Medium | PID, memory, CPU and tmpfs limits; slot weights; 60-minute expiry; reaper |
| Too little hardware for pwn and bots | Medium | Check before Phase 3; one active instance per user already enforced |
| Adapter grows too big to audit | Medium | Keep multi-service logic in manifest validation; terminal adds no Docker code; review size at each phase |
| Flag sharing on artifact challenges | Low | Accepted for self-paced use; per-user artifacts later if needed |
| Frontend and backend drift | Medium | Strict schemas already fail loudly; generated types checked at each phase |
| Content effort (48 challenges with solver and walkthrough) | Medium | Ship in small sets; the backlog isn't a deadline |
| Licensing and legal | Medium | Original content; terms of use and authorised-use statement required before hosting |

---

## Verification

Applies at each phase:

1. Backend: `npm run lint`, `typecheck`, `build`, `npx vitest run --no-file-parallelism` with disposable PostgreSQL and Redis.
2. Frontend: lint, typecheck, unit, build, preview isolation, BFF smoke, `test:e2e`, and generated types checked against the running API.
3. Per challenge: solver passes through the real stack on the VM, a wrong flag fails, a second learner's flag differs where the policy is per-instance, and known shortcuts don't reveal it.
4. Platform repeat: the Welcome Phase 4 to 6 drivers re-run against the new challenge types, including two-user denial, reachability probes, expiry, partial cleanup and zero final resources.
5. Scoring: hint costs, the floor, walkthrough forfeit and concurrent submissions with an unlock.
6. Evidence with real counts recorded in `PLAN.md`, labelling anything that couldn't run.
