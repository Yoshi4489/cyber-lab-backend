# Backend Security Model

The backend is a control-plane component. A bug here can create containers,
expose targets, disclose flags, or let one player control another player's
instance.

## Required controls

### API and authorization

- Verify service-token signature, issuer, audience, expiry, algorithm, and
  scope.
- Derive user identity only from the verified token subject.
- Check instance ownership on every read, extend, reset, and destroy action.
- Validate all request bodies, parameters, query strings, and challenge
  manifests with Zod.
- Rate-limit authentication, catalog-sensitive, submission, and spawn routes.
- Return stable error codes without stack traces, tokens, flags, or internal
  network details.
- Use correlation ids for investigation without logging secrets.

### Docker boundary

- Keep Docker Engine credentials in the backend worker only.
- Use Docker Engine mTLS; never mount the Docker socket into the backend or a
  target when remote TLS is available.
- Construct container options from a trusted manifest parser and fixed defaults.
- Reject `privileged`, host networking, host PID/IPC, arbitrary devices, socket
  mounts, and unapproved capabilities.
- Apply user namespaces, dropped capabilities, no-new-privileges, seccomp,
  AppArmor, read-only root filesystems, tmpfs, CPU, memory, PID, and storage
  limits.

### Network boundary

- Keep the backend and lab nodes on separate hosts or trust zones.
- Deny target access to private ranges, metadata services, the backend, and the
  frontend control plane.
- Default-deny target egress.
- Use unguessable instance routes and do not return another user's URL.

### Data and flags

- Store only flag hashes or key references.
- Derive dynamic flags at runtime and verify them server side.
- Never include flags in API responses, logs, client bundles, or images.
- Append failed submissions and destructive actions to an audit log.

## Launch gates

Public signup remains closed until the controls above are implemented and
reviewed. A health endpoint and scaffolded `501` lifecycle routes do not mean
the platform is ready to host hostile targets.
