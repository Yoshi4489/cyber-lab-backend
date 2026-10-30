# Local development

Use Node 22 (`.nvmrc`), npm, and Docker with Compose v2. The API requires
PostgreSQL; the Phase 3 worker also requires Redis.

## API

1. Copy `.env.example` to `.env` if you do not already have local configuration.
   In PowerShell use `Copy-Item .env.example .env`; in a POSIX shell use
   `cp .env.example .env`. Keep any existing `.env` values when updating it.
2. Run the command below three times. Put independent values in
   `BFF_AUTH_SECRET`, `BACKEND_SERVICE_TOKEN_SECRET`, and `INSTANCE_FLAG_SECRET`.
3. Set the PostgreSQL and seed variables described below.
4. Run `npm ci`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The API listens on `http://127.0.0.1:4000`. Its health endpoints are `/healthz`
and `/readyz`. Readiness reports the PostgreSQL probe; liveness does not touch
external dependencies.

## PostgreSQL and Redis

Generate a **separate** value with the same command and put it in
`DEV_POSTGRES_PASSWORD` in `.env`. Compose refuses to start PostgreSQL without
this value. Do not paste generated values into source, issues, or logs.

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

PostgreSQL 16 and Redis 7 publish ports on loopback only. PostgreSQL uses the
`cyber_range` user and database. Redis has no authentication in this local-only
configuration; it must never be published on a public interface or used as the
production deployment. Do not attach hostile targets to the Compose network.

Set `DEV_POSTGRES_PORT` or `DEV_REDIS_PORT` if the defaults conflict with another
service, and update the corresponding application URL when it becomes active.
Both services persist data in named volumes. `docker compose down` stops and
removes their containers while retaining the data volumes.

Changing `DEV_POSTGRES_PASSWORD` after PostgreSQL has initialized its volume
does not change the database user's password. Rotate it through PostgreSQL
before changing clients; do not delete the volume to resolve a password mismatch.

Set `DATABASE_URL` to
`postgresql://cyber_range:<password>@127.0.0.1:5432/cyber_range`, using the
configured override if PostgreSQL is published on another port. Generated
base64url passwords do not need extra URL escaping. Apply committed migrations
with `npm run db:migrate`. Use `npm run db:generate` only after a reviewed schema
change, and review the generated SQL before committing it. The worker consumes
`REDIS_URL`.

## Disabling rate limits for local testing

Session checks are limited per session (default 120/minute) and logins per
learner address, so ordinary local use stays within limits. Locally every
browser shares the loopback address, so many logins from automated runs can
still hit the 10/minute login limit. For local development and test runs only, set:

```
LOCAL_DEV_TEST=true
```

This disables the per-IP limiter (including login and session resolution) and
the per-user submission and instance-create limiters, and the API logs a
warning at startup. It defaults to `false`. Any value, including `false`, is
rejected when `NODE_ENV=production`; never set it on Render or other hosts.

## Harmless Welcome: accounts and catalog checkpoint

Use a fresh disposable database for the Welcome delivery. Phase 1 adds account
entry, catalog publication and configuration validation; it does not yet add a
Welcome target image, runtime flag policy or a running instance. Keep its worker
off until the later spawn checkpoint is implemented and approved.

In the ignored local backend configuration, set:

```dotenv
NODE_ENV=development
WELCOME_LAB_TEST_ENABLED=true
WELCOME_LAB_FLAG=FLAG{WELCOME_TO_CISCO_FAMILY}
```

The displayed value is intentional public onboarding content, not a credential.
The shared validator is used by API, worker configuration and the seed command.
It defaults off, rejects invalid values, and rejects either Welcome setting's
presence in production, including explicit `false`. Do not set these variables
on Render or other hosted services. A locally built frontend can still use its
production build while this separate backend runs in development/test mode.

Configure the ordinary database and seed-account fields, migrate the fresh
database, then run `npm run db:seed`. Welcome is published with its own stable
identity and 10-point metadata; the six sample definitions become unpublished.
To create a second verified learner, change the `SEED_PLAYER_*` values in the
private fixture configuration and seed again. Normal retries preserve existing
accounts and credentials; no email is sent and public signup remains closed.

The frontend must explicitly select `FRONTEND_MODE=live` and use matching
server-only BFF configuration. Visit `/login`, sign in with either test learner,
refresh, browse `/labs/welcome` and sign out. The briefing currently shows a
disabled **Spawn Instance** action and explains that launch is being prepared;
direct Welcome session navigation returns to its briefing. Preview keeps its
independent username-only entry and sample catalog.

Setting `WELCOME_LAB_TEST_ENABLED=false` and explicitly reseeding unpublishes
Welcome and restores the ordinary sample publication settings. Both histories
and challenge identities remain. API startup alone never reseeds data. No
existing personal or hosted database is modified by this acceptance workflow.

## Lifecycle worker

### Harmless Welcome runtime (Phase 2)

The reviewed target source is `challenges/welcome/`. It contains only a static
introductory page, a runtime-supplied flag and flag-free `/health`. Build the
image from that narrow directory; do not run a target beside control-plane
services. The Dockerfile pins its base and copies only the required runtime
sources. Its checker and manifest generator remain outside the image.

```sh
docker build --pull=false -t cyber-range-welcome-local challenges/welcome
npm run build
node challenges/welcome/runtime-manifest.mjs sha256:<reviewed-target-image-id>
```

Use the actual immutable image identity observed on the isolated lab Engine,
which may differ from a Desktop OCI index identity after image export/import.
Save the generator's JSON to a private fixture file, set `RUNTIME_MANIFEST_PATH`
to that file, and use the existing isolated worker/mTLS/ingress configuration
below. One worker/node with two explicit slots is the approved local test scope.
Transfer the image to an offline lab VM rather than enabling target internet
access. Re-run `npm run worker:preflight` before creating any learner instance.

With the validated local Welcome settings enabled, the worker injects the
configured public placeholder only for Welcome's exact challenge identity.
All other challenge IDs retain dynamic derivation. No flag is baked into the
image, manifest or database. The API verifies submissions with the same policy,
so the Welcome value scores only for Welcome; set the same two settings for the
API and the worker.
Use learner `localhost` and target `127.0.0.1` so browser session cookies cannot
follow the target link. Different ports alone do not separate cookie domains.

In explicit live mode, open Welcome, enter its session and confirm **Spawn
Instance**. The existing API accepts pending work before a worker prepares it;
the page link appears only after readiness. Refresh revalidates the remembered
instance with its owner and preserves the server's original expiry. Stop the
instance after checking the harmless page, confirm its route/resources are gone,
and remove only the disposable service fixtures. No hosted seed or deployment
is part of this workflow. Acceptance results are recorded in `PLAN.md`.

### Harmless Welcome two-user isolation (Phase 4)

Automated control-plane coverage needs only PostgreSQL:
`tests/welcome-phase-four.integration.test.ts` drives two learners through the
real API, database and lifecycle state machine (Docker is a recording fake) and
the frontend's `tests/e2e/welcome-isolation.spec.ts` repeats it through the BFF.
They prove ownership-safe denial and per-instance identities, not real
container separation. On the isolated target VM, with the same Welcome setup,
fresh preflight and two verified learners in separate browser profiles:

1. Spawn Welcome as A and B. On the VM, `docker ps --filter
   label=cyber-range.managed=true` and `docker network ls --filter
   label=cyber-range.managed=true` must each show two distinct entries whose
   `cyber-range.instance-id` labels match the two instance IDs; the two route
   files/links must differ.
2. As B, try A's instance through the browser BFF (read, extend, stop and
   submit). Each must return `NOT_FOUND` and leave A unchanged.
3. Benign reachability only: from inside A run `docker exec <A> node -e
   "fetch('http://<B address>:8080/health').then(()=>process.exit(1),()=>process.exit(0))"`.
   It must exit 0 (B unreachable). Use no scanning or other payloads.
4. Stop A. Its container, network and route must disappear while B's remain;
   B's page, health and flag submission keep working.
5. Stop B, confirm zero managed containers, networks and routes, and record the
   counts in `PLAN.md`. The shared flag cannot prove per-user flag separation.

Read [LIFECYCLE.md](LIFECYCLE.md), create a reviewed runtime-manifest JSON file,
and configure the Traefik file-provider directory and ingress container. Run
the worker separately from the API:

```sh
npm run worker
```

Local socket access is allowed only for development. The adapter still requires
the Docker engine to advertise user namespaces, seccomp and AppArmor. Docker
Desktop on the verification machine lacked user namespaces and AppArmor, so it
is suitable for PostgreSQL/Redis development but not for launching these target
containers. Production uses an isolated target host and complete Docker mTLS.

## Disposable single-target-VM alternative

The two historical validation VMs were deleted, as confirmed by the user on
2026-10-25. Replacing them does not require putting the control plane back on
the target host. One dedicated Linux VM can host only Docker Engine, ingress,
and disposable targets; the API, worker, PostgreSQL, and Redis can remain on
Windows. This is a local test topology, not hosted deployment evidence.

Prepare a fresh VM from an official checksum-verified installer, with no shared
folders, clipboard, drag-and-drop, or control-plane credentials. Keep operator
SSH keys and Docker TLS material outside both repositories. Bind any bootstrap
SSH forwarding to loopback. NAT may be used to install the operating system,
Engine, and reviewed images; remove that adapter before starting targets and
retain only the private management network. A host-only adapter still permits
host access: it does not replace Docker's isolated per-instance bridges,
default-deny egress, ownership checks, or the negative network probes.

Configure Docker user-namespace remapping, seccomp, AppArmor, and verified mTLS
following [DOCKER_MTLS.md](DOCKER_MTLS.md). Keep the worker and its runtime
manifest on Windows; deliver routes through the authenticated Engine connection
into ingress. Configure an explicit tested node capacity and use disposable
database/Redis fixtures. Do not start targets until worker preflight succeeds.

Repeat lifecycle/recovery, capacity, orphan cleanup, cross-user denial, and
network isolation acceptance on this replacement topology. Record positive
management/peer reachability baselines alongside target probe results. Old
two-VM results remain historical evidence and do not validate the new VM.

On 2026-10-25, `CyberRangePhase4Target` was prepared powered off. The existing
Ubuntu Desktop installer was verified first, then replaced with the smaller
official Ubuntu 26.04.1 Server installer to reduce the VM's memory requirement.
The streamed server download's SHA-256 matched
[Ubuntu's published checksum](https://releases.ubuntu.com/26.04.1/SHA256SUMS).
The initial memory-gated start left it powered off. On October 26 the user
authorized closing Roblox and Discord, freeing sufficient memory; installation
completed. Its tested configuration is one CPU, 2 GiB RAM and a dynamic 32 GiB
disk. The two-CPU installer boot stalled. A single CPU with APIC enabled,
x2APIC disabled and `nox2apic rcupdate.rcu_normal=1` allowed the installer and
installed disk to boot; serial console diagnostics remain enabled.

Docker 29.9.2 uses user-namespace remapping, seccomp, AppArmor and private cgroup
namespaces. Engine listens with verified mTLS on private `192.168.56.108:2376`;
operator SSH is key-only. Management firewall rules permit Windows management
traffic. The temporary NAT adapter was removed before target execution, leaving
only host-only networking and no guest default route. The absent installer
interface is marked optional to avoid future network-online startup waits.
Traefik 3.7.16 is pinned by digest, runs without capabilities as a non-root user
with a read-only root and bounded resources, and uses a separate writable route
volume. Its HTTPS listener is guest-loopback-only and reached by a key-pinned,
Windows-loopback-only SSH tunnel. The committed HTTP fixture was rebuilt against
its pinned base and referenced by its actual image ID in an out-of-repository
runtime manifest. No real CTF content was added.

Fresh Engine mTLS positive/negative checks and the trusted HTTPS ingress baseline
passed, followed by real lifecycle/scoring, capacity, expiry, crash recovery,
orphan cleanup, failed-evidence safeguards and paired IPv4/IPv6 isolation probes.
The exact scope is recorded in `docs/PLAN_HISTORY.md` and the security gate record. Final
managed resources and disposable control-plane fixtures were removed, the tunnel
closed and the installed VM retained powered off. Keep all keys, certificates,
VM disks, generated manifests and private fixture credentials outside version
control.

The generated fixture certificates are valid for seven days; reissue them and
repeat mTLS/preflight checks before reusing an expired fixture. This is not
production certificate provisioning.

Mount the static Traefik configuration file and certificate directory read-only
as separate siblings of the writable dynamic-route volume. On Docker 29.9.2 an
enclosing read-only `/etc/traefik` bind with a nested writable route volume
intermittently rejected Engine archive writes as read-only, even though an exec
writability check passed. The fixture ingress was recreated with separate
static binds while retaining its route volume, TLS document, read-only root and
runtime limits. Require the actual worker route round trip before spawning.

## Initial accounts and local mail

Set all `SEED_ADMIN_*` and `SEED_PLAYER_*` variables, then run:

```sh
npm run db:seed
```

The seed is safe to repeat. It upserts validated catalog metadata and creates
verified player/admin accounts and profiles, but does not replace an existing
password hash, role, or profile.
Use unique development credentials and keep them out of source and logs.

Verification and reset requests write JSON messages to
`LOCAL_MAIL_DIRECTORY` (default `.local-mail`). This directory is ignored by
Git. Treat its links as credentials and remove stale files when no longer
needed. The local mailer refuses production mode. Gmail supports opt-in local
demos; the production Resend adapter needs separate verified-domain setup.

## Verification

```sh
npm run lint
npm run typecheck
npm run build
npm test
```

To run infrastructure integration tests locally, set `TEST_DATABASE_URL` and
`TEST_REDIS_URL` to disposable services before `npm test`. CI starts PostgreSQL
16 and Redis 7 and runs migration, auth, catalog, scoring, progress, queue and
lifecycle integration tests in addition to the four checks above.
Production will use managed Neon
PostgreSQL and managed Redis, with API and worker processes on a VM and target
hosts in a separate trust zone.
It also requires separate application and migration database roles; see
[DATABASE_ROLES.md](DATABASE_ROLES.md). The local Compose owner credential is
for development and integration testing, not the production runtime login.

## Repeatable local acceptance checks

After building both repositories, run `npm run db:restore:drill` with a local
PostgreSQL URL and matching `pg_dump`/`pg_restore` on PATH. The development
operator login needs CREATE DATABASE. It exports a consistent snapshot,
restores a random disposable database, compares table counts/fingerprints,
and removes the copy and archive. This does not retain a backup.

`node scripts/local-auth-browser-check.mjs` tests the sibling frontend on
localhost:3201 against a restored copy on API port 4001. Email links are captured
in memory by default. `LOCAL_AUTH_SEND_EMAILS=true` sends two Gmail messages
to the configured sender; obtain recipient authorization first. The source
demo account is preserved.

`node scripts/local-lifecycle-browser-check.mjs` uses localhost:3202 and
operator-established SSH tunnels: loopback port 4002 for the VM API and 8443
for disposable ingress. Set `LOCAL_LIFECYCLE_ENV_FILE` to a private VM API
configuration copy outside Git. It uses the seeded player and sample-web-a,
creates one owned target, tests refresh/extension/destruction, and verifies
route removal. Only BFF credentials reach the frontend process. The explicitly
checked loopback health request permits the fixture's self-signed certificate;
Docker TLS remains verified. Keep the worker available until cleanup is
verified, including after any cleanup timeout. These checks do not deploy or
publicly expose services. See [operations](OPERATIONS.md).
