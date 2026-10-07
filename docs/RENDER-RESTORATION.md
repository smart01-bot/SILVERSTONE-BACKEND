# Render live restoration candidate

Target branch: fix/render-live-startup, based on main 17f7276.
The development branch's foundation/ss_v1 work is preserved separately.

Deployment uses npm ci && npm run build, npm start, the Render-provided PORT, and a listener on
0.0.0.0. Health check path: /health. Startup must pass PostgreSQL SELECT 1 and
Redis PING before reporting ready. Do not run SQL migrations in the build or
start command. Keep ENABLE_QUEUE_WORKER unset/false during restoration.

Configure DATABASE_URL, JWT_SECRET, REDIS_HOST, REDIS_PORT, REDIS_USERNAME,
and REDIS_PASSWORD privately in Render. This branch uses the original variable
names, not SILVERSTONE_DATABASE_MODE or SILVERSTONE_JWT_SECRET.
Use a PostgreSQL session-pooler URI when direct endpoint transport is unavailable.
TLS certificate verification stays enabled. If a trusted CA is required, mount a
PEM as a Render secret file and set DATABASE_SSL_CA_FILE to its path.

The active API is aligned with the supplied public schema metadata. Isolated
fixtures use those columns/checks/foreign keys and do not include obsolete legacy
tables. Full live index/trigger/RLS behavior and PIN-hash formats remain unverified.
Only bcrypt PIN hashes are supported; email/password login and privileged public
registration are not substituted for the real phone/PIN design. Unimplemented
credential changes, administration and payments return 503. Financial records and
legacy queues are never migrated, consumed or falsely completed by restoration.
Live read-only connection checks remain blocked in this cloud environment.

After the reviewed commit is published, select this exact branch under Render's
service Settings, deploy the new commit, and confirm the deployment source SHA.
The old main commit 17f7276 and the synthetic development branch are not the
restoration deployment target. Do not point the Firebase frontend at this API
without a separately tested identity/data integration.

## Render steps

1. Settings -> Build & Deploy -> Branch: fix/render-live-startup.
2. Build command: npm ci && npm run build. Start command: npm start.
3. Health check path: /health. NODE_ENV: production. Node engine: 24.x.
4. Leave ENABLE_QUEUE_WORKER unset/false. Do not add a migration command.
5. Before the production restart, run npm run check:connectivity from an authorized
   environment with the actual service credentials configured securely. Expected:
   verified PostgreSQL TLS, read-only SELECT 1 and public-column metadata, Redis PING.
6. Deploy the published candidate SHA. Confirm the source SHA on Render, inspect
   sanitized stage logs, then check /health returns 200. A TLS/schema failure means
   stop and resolve that specific configuration; never disable certificate checks.
7. Native/live authentication should be verified only with an authorized test
   account. No production account was created or modified by this work.

Public RLS/grants and Supabase Data API exposure were not changed or verified.
A passing health check is service readiness, not financial or frontend readiness.
