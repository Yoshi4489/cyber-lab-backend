# Instance lifecycle contract

Phase 3 implements an asynchronous, owner-bound HTTP target lifecycle. The API
stores intent in PostgreSQL and returns `202`; the worker discovers pending
operations, delivers them through BullMQ, and updates instance state after the
restricted Docker operation succeeds.

## API behavior

`POST /v1/instances`, `POST /v1/instances/:id/extend`, and
`DELETE /v1/instances/:id` require an `Idempotency-Key` header containing 8-128
letters, digits, dots, underscores, colons, or hyphens. Reusing a key for the
same request returns the original operation with `replayed: true`. Reusing it
for different input returns `409 CONFLICT`.

Creation accepts only `challengeId`; user identity always comes from the
verified service-token subject. One player may have one active instance. A new
instance starts `pending`, has a 60-minute expiry and a two-hour absolute cap.
Each successful extension adds 30 minutes without crossing that cap.

The frontend polls `GET /v1/instances/:id`. Foreign and missing instances both
return `404`. Responses never contain Docker/node IDs. `url` is omitted until
the instance is `running`, has a worker-generated route key, and
`LAB_PUBLIC_BASE_URL` is configured. Submissions accept only an owned, running,
unexpired instance whose challenge matches the request.

## Delivery and recovery

Every mutation creates an `instance_operations` row in the same database
transaction as the state change. The worker sweeps `pending` rows into BullMQ;
the operation UUID is the deterministic job ID. It marks the row `queued` only
after enqueue succeeds, so a crash between database commit and Redis delivery
is recoverable. Jobs use five attempts with exponential backoff and remain in
the failed set for inspection.

The maintenance sweep creates idempotent reaper intent for expired instances
and minute-bucketed reconciliation intent for active instances. Stale running
operations return to pending delivery. Docker resources carry backend-owned
instance/challenge labels, and deletion verifies those labels before acting.
The single-node worker processes lifecycle jobs one at a time and does not
schedule reconciliation while a spawn operation is pending, queued, or running.
This prevents startup maintenance from racing a pending spawn. Multiple worker
processes require a distributed per-instance lock before scale-out.

## Trusted runtime manifests

The worker reads a reviewed JSON array from `RUNTIME_MANIFEST_PATH`. Runtime
fields never come from an API request. Each published runnable HTTP challenge
needs an entry shaped like:

```json
[
  {
    "challengeId": "11111111-1111-4111-8111-111111111111",
    "image": "registry.example.test/range/sample@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "containerPort": 8080,
    "user": "65532:65532",
    "healthcheck": {
      "test": ["CMD", "/app/healthcheck"],
      "intervalSeconds": 5,
      "timeoutSeconds": 3,
      "retries": 5,
      "startupSeconds": 60
    },
    "resources": {
      "memoryMb": 128,
      "cpuCores": 0.5,
      "pids": 64,
      "tmpfsMb": 16
    }
  }
]
```

Replace the example digest with the reviewed image digest. Mutable tags are
rejected. Commands and health checks are accepted only from this worker-side
manifest.

## Runtime boundary

The adapter creates an internal network per instance and publishes no host
port. It uses a non-root user, drops every capability, enables
no-new-privileges, seccomp and AppArmor, makes the root filesystem read-only,
and bounds tmpfs, memory, CPU and PIDs. It never sets privileged, host network,
host PID/IPC, devices, bind mounts, or Docker socket mounts. Traefik routes are
written atomically as YAML through its file provider and removed before
resources are destroyed. Phase 4 bounds memory and swap together, JSON logs,
and IPC; reconciliation removes and audits a stopped, unhealthy, OOM-killed,
or missing target.

Production workers require remote Docker mTLS (`DOCKER_HOST` plus CA, client
certificate and key paths). A local socket is accepted only outside production.
The target host must advertise user namespaces, seccomp and AppArmor or spawn
fails closed. Docker applies its built-in seccomp profile; the adapter does not
send `seccomp=default`, which Docker 29 treats as invalid profile JSON. It
checks and reuses only matching labeled internal networks after partial failures
and detaches trusted ingress before network removal.

## Isolated-host preflight

Before starting a worker on the intended isolated host, place the reviewed
worker configuration and pinned manifest there, make each manifest image
available on that Docker host, then run:

```sh
npm run worker:preflight
```

The command uses the same Docker credential configuration as the worker. It
reads Docker host security options, verifies that the configured ingress
container is running, and inspects every pinned image in the manifest. It does
not create a target, network, route, database connection, or Redis connection.
It fails closed when user namespaces, seccomp, or AppArmor are absent; ingress
is stopped; no manifest is supplied; or a reviewed image is unavailable.

After a successful preflight, start the worker with the same configuration and
run the disposable target exit flow: create, poll until running, submit, extend,
destroy or expire, and recover after a worker restart. Record the command
output and lifecycle evidence as the final Phase 3 isolated-host check.

The prepared `scripts/phase3-exit.js` runner uses a seeded disposable player
account and the backend auth/session contract to obtain a scoped service token.
It prints instance IDs and status only; it never prints credentials or flags.
With the API, worker, PostgreSQL, Redis, and loopback ingress running, load an
ignored environment file containing their disposable connection settings and
run:

```sh
node --env-file=.env.phase3.windows scripts/phase3-exit.js full
```

The full mode checks create idempotency, readiness-only URL disclosure, ingress
health, correct and repeated flag submissions, extension bounds and idempotency,
destroy and route removal. To check restart recovery, stop the worker, run
`prepare-recovery` in place of `full`, record the printed instance ID, restart
the worker, then run `resume-recovery <instance-id>`. The prepare mode confirms
the instance remains pending while the worker is stopped. On a fresh seeded
player the runner observed 10 points for the first correct submission; later
repeat runs accept zero for an already-solved challenge and still require zero
on replay. The runner's
`PHASE3_ALLOW_LOCAL_SELF_SIGNED=true` setting permits Traefik's disposable
self-signed certificate only for the loopback ingress checked by this script.
The exit check passed on the disposable VM on 2026-09-26.

The verification Docker Desktop host lacked user namespaces and AppArmor. Its
actual preflight failed at the user-namespace gate and left zero
backend-managed containers or networks, so no real target was launched there.
A successful preflight alone does not verify target egress, cross-instance
isolation, or other Phase 4 controls.

On 2026-09-26, the disposable Ubuntu 26.04 VM with Docker Engine 29.8.1
advertised user namespaces, seccomp and AppArmor. Traefik was running as
`phase3-traefik`; the reviewed `sample-web-a` fixture image ID was
`sha256:8c09818ab9097f4dbbb962d0869b5207f394d71c5f9ced5d743d449145674c0e`.
The worker-side manifest is at
`fixtures/phase3-http/runtime-manifest.vm.json`. The actual preflight returned
`{"status":"ready","manifestCount":1}` and left zero backend-managed
containers and networks. The full API/queue/worker target lifecycle then passed
using disposable PostgreSQL 16 and Redis 7 Compose services, a Windows API
through loopback SSH tunnels, and an Ubuntu worker. The `full` runner observed
pending then running, HTTPS target health, a runtime-derived flag, 10 points
for the first correct submission and zero on replay, a bounded extension,
stopped state, and 404 after route removal. With the worker stopped,
`prepare-recovery` left an instance pending; after restart,
`resume-recovery` observed running, then destroyed it and observed route 404.
Final Docker label queries and the dynamic route directory were empty.

The first live spawn exposed a Docker 29 seccomp-option error and partial
network cleanup gap; a later run exposed that Traefik's file provider ignored
the generated JSON route. Those fixes and focused tests are committed. The
successful disposable check validates Phase 3 behavior but does not prove
default-deny egress, cross-instance isolation, Docker mTLS, or separate
production trust zones; these remain Phase 4 gates.
