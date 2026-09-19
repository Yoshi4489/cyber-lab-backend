# Backend Architecture

## Responsibility split

```text
Player browser
    |
    v
Cyber Range frontend (Next.js on Vercel)
    |  server-side HTTPS calls with short-lived signed service token
    v
Cyber Range backend (Fastify on a separate service)
    |\
    | \-- Neon PostgreSQL: catalog, users, scores, instances, audit data
    |\
    |  \-- Redis/BullMQ: durable spawn, destroy, reap, reconcile jobs
    |
    \---- Docker Engine over mTLS: lab-node lifecycle only
                   |
                   v
          Disposable lab nodes + Traefik
                   |
                   v
             Hostile target instances
```

The browser never talks directly to Docker, Redis, Postgres, or a lab node.
The frontend server authenticates the user, issues a short-lived service token,
and calls the backend. The backend trusts the verified token subject as the
user identity.

## Service layout

```text
backend/
├── src/
│   ├── auth/                 Service-token verification
│   ├── db/                   Database client and future schema access
│   ├── routes/               HTTP routes and boundary validation
│   ├── app.ts                Fastify composition
│   ├── config.ts             Environment validation
│   └── server.ts             Process entry point
├── tests/                    Contract and unit tests
├── Dockerfile                Non-root production image
├── .env.example              Local configuration template
└── PLAN.md                   Implementation order
```

## Token flow

1. A player signs in through the frontend's auth system.
2. A frontend server action checks the session and selects the requested
   operation.
3. The frontend signs a short-lived HS256 token with `sub=userId`, issuer,
   audience, and a narrow scope.
4. The backend verifies signature, issuer, audience, expiry, algorithm, and
   scope before handling the request.
5. Ownership checks use the verified `sub` claim and the instance id from the
   URL. A request body cannot select another user.

The token secret is shared only between the frontend server and backend. It is
never sent to the browser or a target container.

## Instance lifecycle boundary

The backend will store intent in Postgres and enqueue idempotent jobs. A worker
will perform the following sequence:

1. Validate the challenge manifest and user quota.
2. Select a healthy lab node with capacity.
3. Create one network for the instance.
4. Start the pinned image with security and resource defaults.
5. Configure the Traefik route.
6. Poll the declared health check.
7. Mark the instance running only after the check succeeds.
8. Reap expired instances and reconcile database intent with Docker reality.

The Docker adapter will accept a typed internal runtime specification, not raw
HTTP input. It will reject privileged mode, socket mounts, host networking,
host PID/IPC namespaces, and unapproved capabilities.
