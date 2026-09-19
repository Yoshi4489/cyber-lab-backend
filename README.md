# Cyber Range Backend

The backend service for the Cyber Range frontend. It owns the application API,
authentication boundary, database access, scoring, and the privileged lab
orchestrator boundary.

This repository is separate from the frontend repository:

- Frontend: `C:\Users\win\Downloads\Projects\WebApps\cyber-range`
- Backend: `C:\Users\win\Downloads\Projects\WebApps\cyber-range-backend`

## Current status

The service is scaffolded with Fastify, TypeScript, Zod, security headers,
rate limiting, CORS, health checks, and a versioned API namespace. Domain
features and Docker lifecycle workers are added in the phases in `PLAN.md`.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
# Replace BACKEND_SERVICE_TOKEN_SECRET with a generated value (32+ characters).
npm run dev
```

The API listens on `http://127.0.0.1:4000` by default. Run `npm run build`,
`npm run typecheck`, and `npm test` to verify the scaffold. Database and queue
connections are added in later phases; lifecycle routes currently return 501
after authentication and request validation.

## Documentation

- `AGENTS.md` — backend-specific rules and security boundaries.
- `PLAN.md` — implementation order and frontend integration contract.
- `ARCHITECTURE.md` — service topology and request flows.
- `SECURITY.md` — backend threat model and launch controls.

## Frontend connection

The frontend calls this service through `NEXT_PUBLIC_BACKEND_URL`, for example
`http://localhost:4000`. Browser requests are allowed only from the configured
`FRONTEND_ORIGIN`. The frontend never receives Docker credentials and never
connects directly to Redis, Postgres, or a lab node.
"# cyber-lab-backend" 
