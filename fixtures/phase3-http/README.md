# Disposable Phase 3 HTTP target

This fixture exercises the real Docker lifecycle for the published
`sample-web-a` challenge (`11111111-1111-4111-8111-111111111111`). It is a
validation target, not a player challenge. The worker injects the derived flag
only when the container starts; the image contains no flag.

`GET /health` returns readiness without a flag. `GET /solve` returns the
runtime flag so an authorized test player can submit it through the API.
Neither route writes the flag to disk or logs it.

Build on the isolated Docker host, inspect the resulting image ID, and put
that `sha256:` ID in the worker-only runtime manifest. The final runtime image
must be pinned; `:local` is only a build label.

```sh
docker build -t cyber-range-phase3-http:local fixtures/phase3-http
docker image inspect cyber-range-phase3-http:local --format '{{.Id}}'
```

`runtime-manifest.vm.json` records the image ID built on the Ubuntu validation
VM on 2026-09-26. Rebuilds may produce a different ID; inspect the new image
and update the manifest before running preflight. The manifest uses port
`8080`, a `GET /health` check, and the bounded resources described in
`docs/LIFECYCLE.md`. Keep this fixture on disposable validation hosts.
