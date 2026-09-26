# Phase 4 security gate: validation record

**Status: open.** The disposable Ubuntu 26.04 VM validates several runtime
controls, but it is not a production layout. Public signup remains closed.
This record distinguishes observed behavior from code-level tests and
unverified production boundaries.

## Disposable-host evidence (2026-09-26 to 2026-09-27)

The same Ubuntu VM ran Docker Engine 29.8.1, the worker, Traefik, and disposable
PostgreSQL 16 and Redis 7. On 2026-09-26, the API ran on Windows through
loopback-only SSH tunnels. For the 2026-09-27 drills, the API also ran on the VM
and the Windows test runner used loopback SSH forwarding. Neither layout is a
separate target trust zone.

| Control | Evidence | Result |
|---|---|---|
| User namespace | Target `/proc/self/uid_map` mapped container UID 0 to host UID 100000; Docker host advertised userns. | Passed on VM |
| Non-root, capabilities, no-new-privileges | Target reported UID 65532, `CapEff=0`, `NoNewPrivs=1`; Docker inspect showed `Privileged=false`. | Passed on VM |
| Seccomp and AppArmor | Target reported seccomp filter mode 2; inspect showed `apparmor=docker-default`. Preflight requires Docker's built-in/default seccomp profile. | Passed on VM |
| Filesystem and resources | Root write failed; `/tmp` write succeeded. Inspect showed read-only root, 16 MiB tmpfs, 128 MiB memory and swap, 0.5 CPU, 64 PIDs, private cgroup namespace, IPC disabled, and JSON logs limited to two 10 MiB files. No mounts or host port bindings. | Passed on VM |
| Egress and private ranges | The target's TCP probes to `1.1.1.1:80`, `169.254.169.254:80`, `10.0.2.15:5432`, and `172.17.0.1:2375` each returned `ENETUNREACH`. | Passed for these VM destinations |
| Cross-network isolation | A labeled disposable peer container on a second internal Docker network had IP `172.20.0.2`. The target's probe to that IP returned `ENETUNREACH`. The peer was removed. | Passed for the disposable peer |
| Isolated ingress | HTTPS reached the live target through its unguessable Traefik route; target had no host port. After destruction, the route returned 404 and managed Docker resources were absent. | Passed on VM |
| Automatic termination | Stopped, unhealthy, and OOM targets each became instance `failed` with the corresponding `runtime_stopped`, `runtime_unhealthy`, or `runtime_oom` failure code and `instance.runtime_terminated` audit event. On 2026-09-27, suspending the target's Node process made Docker report `unhealthy`; a memory-hungry exec made Docker report `OOMKilled=true` while the main container stayed healthy. The worker removed each container, network, and route file. The drill used a 5-second maintenance interval; default is 60 seconds. | All three paths passed on disposable VM |
| Worker shutdown | With no active target, the worker remained alive 15 seconds after SIGTERM because its duplicated BullMQ Redis client stayed open. After `aa6a603`, a VM rebuild exited within 5 seconds; CI also checks that the duplicate reaches Redis `end` state. | Passed on disposable VM and CI |
| Audit append-only | Migrations 0003-0004 rejected direct `UPDATE`/`DELETE` with SQLSTATE 55000 and retained audit rows while user references were anonymized by foreign keys. | Passed on disposable PostgreSQL |
| Application database grants | CI created a temporary `cyber_range_app` group and separate login, applied `scripts/db-app-role.sql`, and connected as that login. Audit insert worked; audit update/delete/truncate, table creation/alteration, and user deletion failed with SQLSTATE 42501. Test writes rolled back and both roles were removed. | Passed in CI; production role pending |
| Remote Docker mTLS | Production config requires HTTPS host, CA, client certificate, and key and rejects a local socket or URL credentials/path. Ubuntu CI completed a generated-certificate HTTPS handshake with the worker client, required its client certificate, and rejected an untrusted server CA. No remote Engine connection was exercised. | Local handshake passed; remote Engine pending |
| Ingress route visibility | Worker startup and preflight write a random marker beside routes and read it through the Docker archive API inside ingress, then remove it. On the disposable VM, `/etc/traefik/dynamic` passed and an incorrect container path failed; no marker remained. Production requires the ingress directory setting. | Passed on disposable VM; authenticated remote delivery pending |

The committed `scripts/phase4-probe.mjs` is the target-side pass/fail probe.
Its private-host and Docker-gateway addresses are specific to this VM. The
Phase 3 exit runner verifies create/poll/HTTPS/submission/extend/destroy and
restart recovery. Do not use its self-signed-certificate allowance for a
non-loopback ingress.
Final Docker label queries after both 2026-09-27 drills found no backend-managed
containers or networks, and the dynamic route directory was empty. The API and
worker validation processes were stopped; PostgreSQL, Redis, and Traefik stayed
running for future disposable checks.

## Controls still needed to close the gate

1. Put the worker and data services in a control-plane trust zone and the
   target Docker Engine on a separate host. Exercise real Docker mTLS with
   server-certificate verification and no target/control-plane credentials or
   management routes exposed to the target. Define and verify authenticated
   delivery of Traefik file-provider routes to that host: the current router
   writes files beside the worker, not beside the remote ingress. The visibility
   probe checks whether a file appears inside ingress; it neither transports
   files nor proves Traefik loaded the provider configuration.
2. Repeat egress, metadata, private-address, control-plane, and cross-instance
   probes in that topology, including an application-created second instance.
   The VM's separate peer network demonstrates only local Docker isolation.
3. Repeat worker crash/retry with the production separate-host topology. The
   disposable VM passed stopped, unhealthy, and OOM cleanup and audit drills,
   but Phase 3 supports one worker on one node; concurrent workers need a
   per-instance distributed lock before scale-out.
4. Provision the production application and migration-owner roles separately
   using [the database role procedure](DATABASE_ROLES.md). Apply the reviewed
   grants, verify direct and inherited privileges, and run the API and worker
   with the application login. The CI login test does not prove production
   grants or prevent a database owner from disabling the audit trigger.
5. Complete the remaining launch controls in `SECURITY.md`: frontend secure
   cookie/CSRF integration, production email handling, operational backup and
   restore, credential rotation, and incident response. Review auth/session,
   logging/redaction, scoring, and lifecycle evidence together before any
   public signup decision.

The Phase 4 gate is not satisfied by a passing VM probe or CI suite alone.
`SIGNUPS_OPEN` must remain `false` until the production-topology checks and
separate launch review pass.
