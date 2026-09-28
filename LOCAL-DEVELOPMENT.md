# Phase 6 local verification

Use synthetic/disposable environments only. Run existing npm tests/builds and all four actual-client HTTP scripts. Backend `node --test tests/foundation/operations.test.js` performs an in-memory embedded snapshot restore, with no file backup or external connection. See canonical OPERATIONS.md for exact scope and limits. Unresolved filters and held amounts use existing authorized records. No operations role, pause, real alert, reconciliation settlement or production backup configured. No new migration/dependency. New API responses are no-store. Native acceptance and D16–D20 remain open; nothing pushed.

# Phase 5 local verification

Use the existing isolated synthetic preview only. Backend runtime/migrations unchanged. Run frontend npm test and build:check with the isolated API URL; backend npm test/build and all four scripts documented below. My Requests refresh now performs a real read; failures remain visible. To inspect stale review: open one synthetic submission twice, decide one, then try the older view; input is retained and explicit reload shows current status. UI/native acceptance remains unverified; see canonical Phase 5 handoff. Nothing pushed.

# Phase 4 local boundary — provider unavailable

Apply additive migration 004 only through the existing isolated/disposable setup. Normal preview creates no attempts and executes no provider operation. Request detail shows unknown provider charges separately from Silverstone fee TZS 0. Real callback, payout, reconciliation/manual confirmation and settlement remain disabled.

Run the existing checks and, from backend, `SILVERSTONE_FRONTEND_PATH=../frontend node scripts/provider-client-integration.js` for the additional synthetic evidence HTTP journey. `scripts/synthetic-provider-evidence.js` is embedded-test-only, not a worker/provider implementation; never mount it in API routes. Its simulated confirmation deliberately retains actual unknown status and hold. See the canonical frontend `docs/silverstone/PROVIDER-EVIDENCE.md` and Phase 4 handoff. No external credentials are required or accepted.

# Phase 3 local exchanges

npm run dev:isolated applies migration 003 and seeds labelled test accounts plus 1,000,000 TZS synthetic capacity on each seeded main-agent account. This is not a balance lookup or phone/account verification. No provider/manual settlement runs.

Verification: npm test; npm run build; SILVERSTONE_FRONTEND_PATH=../frontend node scripts/client-integration.js; same prefix with scripts/onboarding-client-integration.js and scripts/exchange-client-integration.js.

For an explicitly configured guarded native local database, after explicit migration/authorized synthetic fixture preparation, node scripts/exchange-worker.js drains eligible preparation records into provider-disabled blocked state. It uses SILVERSTONE_DATABASE_URL and only permits localhost silverstone_dev/test. It never calls a provider. The isolated in-memory preview does not share that database and does not auto-start a worker. Embedded tests exercise recovery/token fencing without timers. See frontend docs/silverstone/handoffs/PHASE-03-HANDOFF.md.

# Silverstone backend — Phase 2 onboarding

Use development, local-only. npm run dev:isolated applies 001/002 to fresh embedded PostgreSQL and seeds the fixed synthetic roster. main@example.test gets an explicit reviewer grant; pending@example.test is assigned to it and gets source=synthetic_fixture phone proof (NOT real OTP). Password: Synthetic-only-password-2026!. Production/native startup does not import these test seeders; no public grant/assignment/verification mutation exists.

New checks:

```sh
npm test
npm run build
SILVERSTONE_FRONTEND_PATH=../frontend node scripts/client-integration.js
SILVERSTONE_FRONTEND_PATH=../frontend node scripts/onboarding-client-integration.js
```

Drafts, private PNG/JPEG bytes, immutable submissions and scoped review are implemented in foundation/onboarding.js and additive 002-onboarding.sql. Phone delivery stays 503 and ordinary submission requires trusted verification; no adapter is configured. File storage is private test-database bytea, not production Supabase storage. No PDF support. No provider, live data or payment execution. See canonical frontend Phase 2 handoff for tests, contract, limits and manual device checklist.

Full acceptance remains partial: SMS/provider, production evidence/storage/retention/bootstrap policy, native PostgreSQL and native Android gates are open. Prototype field requirements are not legal/compliance verification. No destructive rollback: discard only disposable preview data. Migration 002 preserves existing ss_v1 Phase 1 accounts/sessions and leaves legacy/public data untouched in tests.

## Historical Phase 1 setup (onboarding unavailability superseded above)

# Silverstone Phase 1 — local development

Use `development`. This foundation does not connect to Firebase, live databases, Redis or payment providers. No deployment is authorized.

## Reproducible isolated preview

Requires Node 22 or newer (verified with Node 24.19.0) and npm. From this backend checkout:

```sh
npm ci
npm test
npm run build
npm run dev:isolated
```

The isolated API uses a fresh, in-memory PGlite PostgreSQL engine each run. It applies the checked-in SQL migrations and seeds synthetic accounts. No existing environment database URL is read. The server binds only to `127.0.0.1:8800`; stopping it discards its data.

Synthetic login accounts: `pending@example.test`, `sub@example.test`, `main@example.test`. Password for these local fixtures only: `Synthetic-only-password-2026!`. These are not live credentials. Registration through `/api/v1/auth/register` creates a pending draft account, never a privileged or approved account.

From the frontend checkout, copy `.env.example` to `.env`, run `npm ci`, then `npm start`. `10.0.2.2` is for an Android emulator on the same computer as this API. A physical device needs an explicitly configured reachable test environment; the loopback-only server is not a remote preview. Do not point the app at the old production API.

## Native PostgreSQL alternative (not executed in this environment)

```sh
docker compose up -d --wait
# Copy .env.example to .env and set a randomly generated JWT secret (32+ characters).
npm run db:migrate
npm start
```

The Docker database uses temporary storage and localhost port 55432. `SILVERSTONE_DATABASE_URL` accepts only localhost databases named `silverstone_dev` or `silverstone_test`; ordinary `DATABASE_URL` is deliberately ignored. Do not use live credentials. Migrations are explicit, transactional and checksum tracked, in the separate `ss_v1` schema. Unknown schema/migration versions stop execution. They do not alter legacy/public tables. Simultaneous first-time migration processes are not supported; run a single migrator.

## Verification

```sh
npm test
npm run build
SILVERSTONE_FRONTEND_PATH=../frontend node scripts/client-integration.js
```

The integration command uses the actual frontend API client over local HTTP to Express and embedded PostgreSQL. It verifies registration, login, `/me`, pending denial, restoration and logout. It is not an Android-device test. The npm test entry point never executes the old `tests/*.test.js` suite, which contains unsafe broad cleanup.

## Runtime boundary and future work

`index.js` imports only `foundation/`. The old `controllers/`, `routes/`, `models/`, `services/`, `middleware/`, `config/` and `migration.sql` remain historical, unmounted source. Their missing legacy imports are not restored with mock models. Do not run old modules/tests or mount their payment routes. Active foundation models and migrations are aligned; port/remove legacy code deliberately in later phases.

All exchange writes, transfers and application review are unavailable. Password recovery returns 503 until a real delivery mechanism is implemented; it never exposes reset credentials. Public applicant submission, evidence storage and approvals belong to Phase 2. Request creation, full network-account records, legs/ledger/reservations/jobs belong to Phase 3. No provider executes in this phase.

Access tokens last 15 minutes and must have the access purpose, issuer, audience and HS256 algorithm. Server sessions expire after seven days; logout revokes them. Refresh tokens rotate and only their hashes are stored. Reuse revokes the session. Current account status is checked on every authenticated call. Rate limiting is process-local and suitable only for this isolated foundation, not a multi-instance production deployment.

## Migration/rollback

The migration test verifies empty setup, re-run, checksum drift, unknown schema rejection, constraints, rollback and coexistence with a synthetic legacy public table. It does not prove migration of an actual legacy installation. No user/data migration is included. For disposable local rollback, stop the preview (or remove the temporary Docker container). No destructive down-migration or automatic production cutover is supplied.
