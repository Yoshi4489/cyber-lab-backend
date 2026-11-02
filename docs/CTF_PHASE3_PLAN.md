# CTF Phase 3 plan: per-instance origins and multi-service labs

Status: proposed on 2026-11-02, not started. It needs approval before any code
changes. It extends Phase 3 in [CTF_PLAN.md](CTF_PLAN.md).

## Goal

Run labs that need more than one container and give each instance its own
browser origin. Ship two labs that depend on both:

| Lab | Flaw | Difficulty | Services |
|---|---|---|---|
| Support Desk | Stored XSS against an admin bot | Medium, 250 | app, bot |
| Link Preview | SSRF to an internal metadata-style service | Hard, 500 | app, metadata |

**Exit:** both solvers pass through the real stack on the VM. A script in
instance A can't read instance B's pages or cookies. Phase 5-style partial
cleanup (one service killed mid-run) and reaper checks leave zero resources,
and Welcome plus the Phase 1 and 2 labs still pass.

## Constraints found while planning

| Finding | Effect on the plan |
|---|---|
| The VM has 1 CPU and 1.6 GiB usable, and the host had about 270 MB free | It can't be enlarged right now. Design for one or two instances at once, with slot weights, and close host apps before VM runs (see Decisions) |
| The ingress certificate is valid until 2026-11-29 and already covers `*.lab.localhost` | No reissue needed for local subdomains. An earlier note in `PLAN.md` said it expired on 2026-11-01; that was out of date |
| Route keys are base64url, with mixed case and `_` | Not valid as a DNS label. New keys become 32 lowercase base32 characters (160 bits) |
| Browsers resolve `*.localhost` to loopback; Node and curl on Windows don't | Solvers and drivers pin `*.lab.localhost` to `127.0.0.1` with a custom lookup |
| The ingress is attached to every instance network and can reach every service on it | Fine while learners only reach labs through routes, which point at the entry service only. Phase 4 shells revisit this (finding 8) |
| Targets have no egress | XSS can't send cookies out. Support Desk is solved in-band: the payload makes the admin's own browser post the secret where the learner can read it |

## Design

### 1. Per-instance origins

- Traefik rule `Host(\`<routeKey>.<LAB_PUBLIC_HOST>\`)`, with no path prefix or
  strip middleware. `LAB_PUBLIC_BASE_URL` is replaced by `LAB_PUBLIC_HOST` (for
  example `lab.localhost:8443`). The instance URL is `https://<routeKey>.<host>/`.
- Route documents keep exact canonical rendering as their ownership proof.
  `assertManagedRouteDocument` parses the host rule. Switching formats needs a
  drained node: no running instances and no old route files. The rollout step
  checks this and refuses otherwise.
- Labs already use relative links, so they need no change. Cookies stay
  host-only, with no `Domain` attribute.
- For hosting: the lab domain must be separate from the frontend's registrable
  domain, and ideally on the Public Suffix List, so instances are different sites
  and not just different origins. This is recorded for the production gate, not
  built now.

### 2. Multi-service manifests

```json
{
  "challengeId": "...", "image": "sha256:...", "containerPort": 8080,
  "user": "10001:10001", "healthcheck": {}, "resources": {}, "slotWeight": 3,
  "flagDelivery": { "mode": "exec", "service": "bot", "command": [], "user": "" },
  "services": [
    { "name": "bot", "image": "sha256:...", "user": "...", "healthcheck": {}, "resources": {} }
  ]
}
```

- The current single-container form stays valid: the top level is the entry
  service, and `services` holds up to three more. Existing manifests, Welcome
  included, don't change.
- Service names match `^[a-z][a-z0-9]{1,15}$` and become network aliases, such
  as `http://metadata:8080`. They are not `app` and are unique.
- Sidecars get the same fixed security defaults as the entry: read-only,
  `CapDrop: ALL`, `no-new-privileges`, non-root, limits and the internal network.
  They have no published ports and no route.
- The flag goes to exactly one service by exec, with `service` defaulting to the
  entry.
- The worker spawns sidecars and waits for them to be healthy, then starts the
  entry, delivers the flag, and only then writes the route. Any failure removes
  everything, as today.

### 3. Inventory, status and cleanup

- Containers are named `cr-<id>` (entry) and `cr-<id>-<service>`, with a new
  `cyber-range.service` label. The name and label check extends to that pattern
  and still fails closed on anything ambiguous.
- `ManagedRuntimeAllocation.containerId` becomes `containerIds: string[]`.
  `instances.container_id` keeps the entry; sidecars are found by labels, which
  inventory already trusts.
- `runtimeStatus` is healthy only when every service is healthy and on exactly
  the one instance network. Losing any service marks the instance unhealthy, so
  the existing reconcile path fails and cleans it up.
- Cleanup validates every container before deleting anything, as today.

### 4. Capacity

- `slotWeight` (1 to 8, default 1) in the manifest. The worker records it on the
  instance (`instances.slot_weight`, a new column with default 1), and
  `prepareSpawn` sums weights instead of counting instances.

### 5. Admin bot base image

- `challenges/_bot/`: Alpine Chromium plus `puppeteer-core` at a pinned version,
  in the image only, not a backend dependency.
- The bot is idle until the app calls `POST http://bot:8080/visit` with a ticket
  path. It then launches headless Chromium for a single visit of up to 10 seconds,
  then exits, so memory is used only during a visit. It serves one visit at a
  time and returns 429 while busy.
- Chromium runs with `--no-sandbox`, because the container is the sandbox, and
  with no egress. A browser exploit would land inside a container with no
  network, no credentials and no route out. This is recorded as an accepted risk.
- The admin session exists only inside that instance's app. No real credentials
  are used.

### 6. Shared check harness

`scripts/lab-check.mjs` currently rebuilds Docker options as CLI flags. It
switches to driving the real `DockerOrchestrator` with an in-memory router, so
multi-service labs get the exact production options and the copy disappears.
Solvers reach targets on the internal network as now.

## Steps and commits

| # | Step | Commit scope |
|---|---|---|
| 1 | DNS-safe route keys, host-rule routes, `LAB_PUBLIC_HOST`, drained switch-over | `feat(orchestrator)`, `test` |
| 2 | `services`, `slotWeight` and per-service flag target in the manifest schema | `feat(orchestrator)` |
| 3 | `slot_weight` migration and weighted capacity | `feat(db)`, `feat(lifecycle)` |
| 4 | Multi-container spawn, status, inventory and cleanup | `security(orchestrator)`, `test` |
| 5 | `lab-check` on the real adapter | `test(labs)` |
| 6 | Bot base image | `feat(labs)` |
| 7 | Support Desk and Link Preview packages, solvers and walkthroughs | `feat(catalog)` |
| 8 | Frontend: no change expected beyond showing the new URL. Check that the target link and BFF accept host-based URLs | frontend `fix` only if needed |
| 9 | VM evidence, docs and pause | `docs` |

## Tests

- Unit tests: route rendering and parsing for host rules, rejecting old-format
  files without a drained node, manifest validation (duplicate or reserved
  service names, flag delivery to an unknown service, weight limits), and weighted
  capacity refusal.
- Adapter fakes: spawn order, rollback when a sidecar fails, inventory with
  sidecars, refusal of ambiguous names, status when one service dies, and cleanup
  of a partial allocation.
- Integration: weighted capacity with real PostgreSQL.
- VM:
  - `lab-check` for all labs.
  - Full-stack driver for both new labs with two users.
  - Cross-origin probe: a page on A runs `fetch(B)` and reads `document.cookie`,
    and both fail.
  - Kill one sidecar, then confirm failure and cleanup.
  - Delete a database row to leave an orphan, then confirm the reaper clears it.
  - Regression on Welcome, Phase 1 and Phase 2.

## Decisions needed

1. **VM size.** Support Desk with its bot needs about 600 MB per instance, so the
   VM fits one comfortably and two only just. The two-user cross-origin check
   needs two at once. Can you free host memory and raise the VM to 3 GiB for the
   test runs? If not, I'll run the two-user check with Link Preview, which is
   smaller, and Support Desk with one user.
2. **The bot's `--no-sandbox` risk.** This is acceptable inside a no-egress
   container. A stricter option, gVisor, waits for Phase 4.
3. **Breaking config change.** `LAB_PUBLIC_BASE_URL` becomes `LAB_PUBLIC_HOST`,
   and the hosted Render API docs need updating to match.

## Not in this phase

Browser terminal, pwn, privilege-escalation profiles, production lab domain and
TLS, and per-user artifact generation.
