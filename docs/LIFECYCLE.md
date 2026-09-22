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
written atomically through its file provider and removed before resources are
destroyed.

Production workers require remote Docker mTLS (`DOCKER_HOST` plus CA, client
certificate and key paths). A local socket is accepted only outside production.
The target host must advertise user namespaces, seccomp and AppArmor or spawn
fails closed.

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

The verification Docker Desktop host lacked user namespaces and AppArmor. Its
actual preflight failed at the user-namespace gate and left zero
backend-managed containers or networks, so no real target was launched there.
A successful preflight alone does not verify target egress, cross-instance
isolation, or other Phase 4 controls.
