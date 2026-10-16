# Silverstone Backend

Silverstone Backend is the Express/PostgreSQL API for the Silverstone mobile-money float coordination platform.

## Current architecture

- Node.js / Express 5
- PostgreSQL
- Supabase-hosted PostgreSQL/auth integration
- Redis-backed shared rate limiting
- Revocable application sessions
- Manual agent approval
- Durable exchange reservations and jobs
- Payment/provider orchestration with reconciliation safeguards

The active server entry point is `index.js`. Runtime modules live under `foundation/`.

Legacy MVC controllers, routes, models, services and middleware have been removed from the active repository.

## Install

`npm ci`

## Environment

Copy `.env.example` and configure local values.
Remote database access should remain disabled during ordinary local development.

## Local database

Local PostgreSQL can be started with Docker when Docker is installed:

`docker compose up -d postgres`

Then run:

`npm run db:migrate`

Do not point migrations at a hosted or production database unless explicitly authorized.

## Run

`npm start`

Development mode:

`npm run dev`

## Verification

`npm test`
`npm run build`

On machines with limited memory:

`node --test --test-concurrency=1 tests/foundation/*.test.js`

## Safety

- Do not commit secrets or live credentials.
- Do not run hosted database migrations without explicit authorization.
- Payment/provider uncertainty must be reconciled rather than blindly retried.
- Manual settlement is not an automatic fallback.

See `LOCAL-DEVELOPMENT.md`, `docs/` and `migrations/` for detailed development and historical project information.
