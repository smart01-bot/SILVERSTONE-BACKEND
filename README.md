# Silverstone backend — Render live restoration

Branch `fix/render-live-startup` restores startup and a limited API against the
reviewed existing Supabase **public** schema. It is based on main `17f7276`.
The separate development branch's foundation/ss_v1 design is not merged or deployed.
No migrations, fixture seeding, or production data conversions run during startup.

## Runtime

Node 22 or newer is recommended. Run `npm ci`, `npm run build`, then `npm start`.
Render build command: `npm ci && npm run build`. Start command: `npm start`.
The server binds `0.0.0.0` using Render's `PORT` (8800 fallback).
Health path: `/health`. Startup verifies PostgreSQL TLS/query, required public
columns and Redis TLS/PING before listening. Failures have sanitized stage names.

Privately configure `DATABASE_URL`, `JWT_SECRET`, `REDIS_HOST`, `REDIS_PORT`,
`REDIS_USERNAME`, `REDIS_PASSWORD`, and `NODE_ENV=production`.
These are the legacy variable names: SILVERSTONE_DATABASE_MODE and
SILVERSTONE_JWT_SECRET belong to the other development runtime and are unused here.
Use the actual PostgreSQL session-pooler connection URI where necessary.
A trusted PEM CA can be mounted as a Render secret file and selected with
`DATABASE_SSL_CA_FILE`. TLS certificate verification is enabled for both services;
PostgreSQL URL SSL settings cannot disable it. No credential values belong in Git.

Keep `ENABLE_QUEUE_WORKER` unset/false. Setting it true fails startup explicitly:
the old queue worker cannot safely operate this public transfer lifecycle.
`npm run check:connectivity` uses read-only SELECT 1/schema metadata and Redis PING,
never queue removal/FLUSHALL or business-row reads. It honors managed network policy.

## Supported restoration API

- `POST /api/auth/login`: `phone_number` (or `phone`) and string `pin` (4–12 digits).
  Supports existing bcrypt `$2a$`/`$2b$` PIN hashes. Other formats fail authentication
  without changing credentials. Live hash format has not been verified by reading
  account data. Email/password credentials are not part of the live schema.
- `GET /api/auth/me`: current safe profile. PIN hashes and NIN values are omitted.
- `POST /api/auth/logout`: clears the cookie. Bearer tokens remain valid until their
  15-minute expiry; no fabricated server-side revocation is claimed.
- Requests and transfers require current approved status. JWT role claims do not
  grant authority; every authenticated request reloads the database account.
- `POST /api/requests/submit`: sub-agent only. Supply `amount`, `origin_network_id`,
  `destination_network_id`, `origin_account_identifier`, `destination_account_identifier`.
  Legacy source/requested network names and phoneNumber fields are accepted as aliases.
  JWT identity supplies the owner. Networks must be distinct and active. Urgency is
  unsupported. The row retains the database default `pending_pin`; no payment or
  queue operation is initiated and no queue position is fabricated.
- Request/transaction lists and detail reads are scoped to the owner or assigned
  main-agent. Transactions return actual transaction-leg rows, not legacy transactions.
- Agent profile/history reads require ownership or an assigned main-agent relationship.
- Dashboard/analytics return authorized recent snapshots (at most 200 records per
  list), not global/all-time financial totals. Revenue is unknown (`null`), never the
  sum of both financial legs. Monthly/network summaries also describe this bounded
  snapshot. Performance ranking returns 503.
- Dashboard SSE is scoped, rechecks main-agent status and never reflects arbitrary
  CORS origins. API responses and field names differ from the obsolete legacy client
  contract. Default CORS permits the existing dashboard and localhost Expo origins.

## Explicitly unavailable

Registration, OTP/credential recovery/PIN changes, agent administration/deletion,
request lifecycle mutation/deletion, financial leg mutation/deletion and real payment
execution return 503. They need separately verified workflows. The old mocked
processor no longer marks transfers completed or consumes production queue entries.
This is a startup/authentication/read/request-submission restoration, not proof of
end-to-end payments or a complete product cutover. Redis connectivity is checked but
no active queue processing runs. Phone/PIN login has a bounded process-local limiter;
shared rate limits and fully revocable sessions remain operational follow-up work.

The Firebase frontend does not automatically connect to this API. The development
frontend's versioned API contract is also different. Neither integration is claimed.

## Verification and data safety

`npm test` runs isolated ESM Jest tests. Database/Redis modules are mocked before app
imports. The disposable pg-mem fixture is generated from the user-provided public
schema metadata; there are no legacy requests/transactions tables to mask query
mismatches. No test uses configured service credentials or remote table cleanup.
Metadata lacks full index/composite-constraint, precision, trigger and grant definitions;
these tests do not replace native/live validation. No RLS/grant changes are included.

See `docs/RENDER-RESTORATION.md` for branch selection and live read-only verification.
Live Supabase/Redis access is blocked in this managed workspace. Passing isolated tests
is not a claim that Render's credentials, TLS chain or connectivity have been verified.
