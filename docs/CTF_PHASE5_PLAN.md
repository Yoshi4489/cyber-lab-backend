# CTF Phase 5 plan: privilege-escalation profile

Status: the owner approved the SECURITY.md rule change and the spike on
2026-11-04. The spike ran on the lab VM the same day; results are below and
change the design (see [Spike results](#spike-results-2026-11-04)). Nothing
else is built. It extends Phase 5 in [CTF_PLAN.md](CTF_PLAN.md).

## Spike results (2026-11-04)

A throwaway image ran on the VM with the adapter's fixed hardening (`--cap-drop
ALL`, read-only root, `noexec,nosuid` `/tmp`, uid 1000, no network, PID and
memory limits, userns-remap). It contained a set-uid-to-`keeper` copy of `cat`,
a set-uid-root copy of `id`, a sudo rule, and a set-uid launcher that runs a
fixed job as `keeper`.

| Runtime | `no-new-privileges` | Set-uid helper | Set-uid root | Launcher job | sudo |
|---|---|---|---|---|---|
| `runsc` | on | blocked | blocked | runs as learner | refused (flag set) |
| `runsc` | off | **ignored** | **ignored** | runs as learner | refused (euid not 0) |
| `runsc --allow-suid` | on | blocked | blocked | runs as learner | refused (flag set) |
| `runsc --allow-suid` | off | works | euid 0, `CapEff` 0 | runs as `keeper` | **fails: needs `CAP_SETGID`** |
| `runc` (control) | off | works | euid 0, `CapEff` 0 | runs as `keeper` | fails: needs `CAP_SETGID` |

Conclusions:

1. **gVisor ignores set-uid bits by default** (`allow-suid: false`). Removing
   `no-new-privileges` alone does nothing on `runsc`. The profile needs a second
   host runtime, `runsc-suid` (`runsc --allow-suid`). Plain `runsc` stays the
   default for every other gVisor lab, so the host change can't widen them.
2. With `runsc-suid` and `no-new-privileges` off, set-uid works and an escalated
   process keeps an empty effective and bounding capability set. With
   `no-new-privileges` on, `runsc-suid` still blocks escalation.
3. **Real sudo can't work without `CAP_SETGID`.** Per decision 3, Sudo Slip uses
   a small reviewed set-uid wrapper that enforces a narrow sudo-like rule, not
   sudo itself, and no capability is added.
4. A two-account lab works with no capability: the container starts as
   `learner`, and a set-uid `keeper` launcher runs the scheduled job. The job
   keeps the learner's group (changing group would need `CAP_SETGID`), so lab
   files must be designed around owner, not group, permissions.

Host change made for the spike and kept: `/etc/docker/daemon.json` on the VM
gained `"runsc-suid": {"path": "/usr/local/bin/runsc", "runtimeArgs":
["--allow-suid"]}`, followed by `systemctl reload docker`. The original is at
`/etc/docker/daemon.json.pre-phase5`.

## Goal

Let a small set of reviewed shell labs teach local privilege escalation inside
the learner's own sandbox, without weakening any other lab or the host.

| Lab | Flaw | Difficulty | Reference |
|---|---|---|---|
| SUID Surprise | A set-uid helper that trusts its caller | Medium, 250 | CWE-250, T1548.001 |
| Cron Mischief | A scheduled job runs a script the learner can write | Medium, 250 | CWE-732, T1053.003 |
| Sudo Slip | A sudo rule that allows more than intended | Hard, 500 | CWE-269, T1548.003 |

The flag sits in a file only a second account in the same container can read.
"Escalation" means moving from the `learner` account to that account (or to
container root) inside one gVisor sandbox. It never means host root, extra
capabilities, or reaching anything outside the instance network.

**Exit:** all three solvers pass through the real stack on the VM; each lab's
flag is unreadable as `learner` without the intended flaw; the isolation,
egress, ingress and cleanup probes from Phase 4 pass unchanged; and every
non-profile lab still runs with `no-new-privileges`.

## What changes in SECURITY.md

Today: "`no-new-privileges` stays set" for every container. Proposed rule:

> A lab may set `privilege: "escalation"` only if it runs on gVisor, its id is
> in the reviewed allowlist in code, and the relaxation applies to its entry
> container only. The profile removes `no-new-privileges` and runs that
> container on the `runsc-suid` runtime (gVisor with set-uid honoured), and
> nothing else: capabilities stay dropped, user-namespace remapping, seccomp, AppArmor,
> read-only root, resource limits and network isolation are unchanged.

Everything else in SECURITY.md stays as written.

## Constraints found while planning

| Finding | Effect on the plan |
|---|---|
| `no-new-privileges` blocks set-uid and file capabilities from taking effect | This is the one flag the profile must relax; all three labs depend on set-uid (sudo is itself set-uid) |
| With `CapDrop: ALL`, a process that becomes uid 0 has no capabilities | Good: it can read root-owned files by owner permission but can't mount, load modules, change networking or bypass file permissions. Labs must put the flag behind ordinary ownership, not behind a capability |
| userns-remap maps container root to an unprivileged host uid | Even a full in-container escalation stays an unprivileged host user, under gVisor |
| `sudo` calls `setgroups` and `setresuid`; some of these need `CAP_SETGID`/`CAP_SETUID` even after a set-uid exec | **Confirmed by the spike:** sudo fails without `CAP_SETGID`. Sudo Slip uses a small reviewed set-uid wrapper that behaves like a narrow sudo rule, never `CapAdd` |
| Cron Mischief needs a job running as a second account while the learner's shell runs as `learner` | **Confirmed by the spike:** a set-uid launcher started by the `learner` entrypoint works with no capability |
| gVisor implements set-uid exec and `no_new_privs` in its own kernel | **Confirmed by the spike:** it ignores set-uid unless `--allow-suid` is set, and honours `no_new_privs`. Hence the `runsc-suid` runtime |
| The VM holds one shell lab at a time (1 CPU, 1.6 GiB) | Same slot weights as Phase 4 (about 4–5); no change |
| The three labs need no target container | Single-service labs: the workstation is the target. Cheaper than Phase 4 pwn labs |

## Design

### 1. Manifest profile

- `runtime.json` gains `privilege: z.enum(['standard', 'escalation']).default('standard')`.
- Zod refinement: `escalation` requires `sandbox: 'gvisor'`.
- A code-level allowlist `ESCALATION_LABS` (challenge ids) in
  `src/orchestrator/runtime-manifests.ts`. A manifest asking for `escalation`
  with an id not on the list fails validation. Adding a lab means a reviewed
  code change, not just a JSON edit.
- `buildContainerOptions`, for the entry service of an `escalation` manifest
  only, omits `no-new-privileges` from `SecurityOpt` and sets `Runtime:
  'runsc-suid'` (a fixed name, never from the manifest). Internal services keep
  `runsc` and `no-new-privileges`. `CapDrop: ['ALL']`, `Privileged:
  false`, no `CapAdd`, and every other default stay fixed and are asserted in
  tests.
- Preflight: if any manifest uses `escalation`, the host must advertise
  `runsc-suid`; and every `escalation` manifest must be gVisor and allowlisted
  (defence in depth if the loader is bypassed). The `runsc-suid` host setup is
  documented in `docs/LIFECYCLE.md`.

### 2. Flag placement

The existing exec flag delivery runs `load-flag.sh` as a manifest-fixed user.
For these labs it runs as the second account and writes the flag mode `0400`
into a tmpfs path owned by that account. No flag in the image, environment or
any learner-readable path. `lab-check` adds a negative probe: as `learner`,
without the flaw, the flag file can't be read.

### 3. Lab packages

Each lab extends the shared `_pwn` workstation base (ttyd, uid 1000 `learner`)
with one reviewed misconfiguration and one second account. Each ships
`definition.json`, briefing, walkthrough, `runtime.json` and a Python solver,
like the Phase 4 labs. The owner writes the lab content; it goes through the
normal reviewer sign-off.

Contract the harness and loader expect (World Readable is the closest example):

| Item | Requirement |
|---|---|
| Folder | `challenges/<slug>/`, folder name equal to `slug` |
| Ids | SUID Surprise `a5000000-0000-4000-8000-000000000001`, Cron Mischief `…0002`, Sudo Slip `…0003`. Anything else is refused by the allowlist |
| `definition.json` | `kind: "shell"`, `category: "linux"`; points must match difficulty (medium 250, hard 500); hint costs below the points |
| `runtime.json` | `sandbox: "gvisor"`, `privilege: "escalation"`, `user: "1000:1000"`, `containerPort: 7681`, healthcheck `["CMD", "/usr/local/bin/lab-healthcheck"]`, no `services`. Resources and `slotWeight` like World Readable |
| Flag | `flagDelivery: { mode: "exec", command: ["/app/load-flag.sh"], user: "<second account uid:gid>" }`, with `_pwn/load-flag.sh` copied to `/app/` as First Overflow's target does. It writes `/tmp/flag.txt` mode 0600 owned by that account, which `learner` can't read |
| Image | `Dockerfile` starts with the shared workstation stage copied from World Readable, so the layer is reused. Add any new source files to the `challenges/.dockerignore` allowlist |
| Solver | `solve/solve.py` runs inside the entry container as `learner` (stdin to `python3 -`) and prints only the flag |
| Limits found by the spike | Real `sudo` can't run (needs `CAP_SETGID`): Sudo Slip needs a set-uid program of its own. A set-uid launcher keeps the learner's group, so protect files by owner, not group |

`lab-check` then proves, for each escalation lab: the solver returns the exact
flag; the entry's `CapBnd` and `CapEff` are empty and `NoNewPrivs` is 0;
`learner` can't find the flag in `/home /tmp /opt /var /srv /etc`; the flag is
not in the container config, any process environment or the image; there is no
egress; and cleanup leaves nothing. Every standard shell lab is also checked
for `NoNewPrivs: 1`.

### 4. Checks

- `lab-check`: solver passes; negative read probe; egress probe; and an
  in-container probe that the escalated process has an empty capability set
  (`CapEff` 0 in `/proc/self/status`).
- A probe that a non-profile lab (First Overflow) still reports
  `NoNewPrivs: 1`.

## Steps and commits

1. Spike on the VM (done 2026-11-04; see Spike results). sudo needs a
   capability, so Sudo Slip uses a set-uid wrapper instead.
2. `security(orchestrator)`: profile field, allowlist, adapter change, preflight.
3. `test(orchestrator)`: adapter and manifest tests for the profile.
4. `feat(labs)`: the three lab packages.
5. `test(labs)`: lab-check probes.
6. `docs(security)`: SECURITY.md rule change, LIFECYCLE.md, PLAN.md evidence.

## Tests

- Unit: `escalation` with runc fails; with an unlisted id fails; allowlisted
  gVisor manifest drops only `no-new-privileges`; `CapDrop`, `Privileged`, no
  `CapAdd` and the other `SecurityOpt` entries are unchanged; standard labs keep
  `no-new-privileges`; internal services of an escalation lab keep it.
- Lab: three solvers through `lab-check` on the VM, plus the negative and
  capability probes above.
- Full stack: the Phase 4 driver pattern for one escalation lab (start,
  terminal reachable, solve scores, wrong flag rejected, stop, zero residual).
- Regression: backend suite, all existing `lab-check` labs, Welcome.

## Decisions

1. **SECURITY.md rule change:** approved by the owner on 2026-11-04. The rule
   text now also names the `runsc-suid` runtime the spike showed is required.
2. **Capability policy:** `CapAdd` stays forbidden for every lab. "Capable"
   (capability misuse, Expert) stays out of scope; it would need its own
   review, likely on a per-lab VM.
3. **Sudo:** the spike showed sudo needs `CAP_SETGID`, so Sudo Slip uses a
   reviewed set-uid wrapper instead of real sudo.

## Not in this phase

- Any `CapAdd`, privileged mode, host mounts or kernel-exploit content.
- Escalation on runc, or on any service other than the entry.
- The "Capable" lab.
- Hosted rollout; the production security gate stays open.
