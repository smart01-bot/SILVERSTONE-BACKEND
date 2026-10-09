# Phase 1 authentication activation

Date: 8 October 2026
Status: **REOPENED / NOT ACCEPTED** until the installed Android APK passes the hosted login journey.

## Target architecture

Silverstone keeps the approved application boundary:

`Expo APK -> Render Express API -> Supabase PostgreSQL`

Upstash/Redis supports shared rate limiting and other ephemeral coordination. It is not the identity database, the application database, or the PIN store.

The device PIN remains local to the Android installation. Email/password authentication and revocable server sessions remain owned by the Express API and stored in the `ss_v1` schema inside Supabase PostgreSQL.

## Live inspection findings

### Supabase

Target project: `Silverstone Database` (`nwcwncrxhuotpbugnifm`).

At inspection time:

- PostgreSQL is healthy.
- The `ss_v1` schema does not exist yet.
- The older `public.agents`, `public.agent_documents`, `public.agent_network_accounts`, `public.agent_float_balances`, `public.transfer_requests`, `public.transaction_legs`, `public.float_ledger`, `public.audit_log`, `public.networks` and `public.verification_codes` tables exist.
- The old `public.agents` table is empty and models phone/PIN authentication rather than the approved Phase 1 email/password contract.
- The inspected operational `public` tables are empty.
- One unrelated/existing Supabase Auth identity exists; Phase 1 activation does not migrate, delete or depend on it.
- No Supabase migration history is recorded for the older public schema.
- RLS is disabled on the inspected Silverstone public tables and no public policies are present. These legacy tables must not become an APK data path and require a separate security/deprecation decision before production release.

The activation plan therefore creates `ss_v1` additively beside the legacy public schema. It does not rename, delete, migrate or reinterpret legacy rows.

### Render

Existing service: `SILVERSTONE-BACKEND` (`srv-d8997c99rddc7392vf2g`).

At inspection time it auto-deploys `fix/render-live-startup`, not `development`. That branch contains an older restoration implementation using `public.agents` phone/PIN authentication and is not the Phase 1-6 authority.

`development` has diverged ahead with the foundation/onboarding/exchange/provider/operations work. Do not merge the old live phone/PIN authentication path back into `development`.

### Upstash

Existing Render logs show the configured Upstash Redis endpoint has connected successfully after transient DNS failures. Hosted `development` now uses Redis for shared authentication/document-upload rate limiting when configured, and falls back to process-local limiting if Redis is temporarily unavailable.

## Database activation

`development` contains ordered additive migrations:

1. `001-foundation.sql`
2. `002-onboarding.sql`
3. `003-exchanges.sql`
4. `004-provider-evidence.sql`
5. `005-operations.sql`

The migrator creates a private/custom `ss_v1` schema with a checksummed migration ledger and refuses unknown migration versions or checksum drift. `ss_v1` must not be added to the Supabase Data API exposed-schema list. The APK talks to Render; Render connects directly to PostgreSQL.

Remote database access and remote migrations are disabled by default. An intentional hosted migration requires both the reviewed Supabase connection string and the explicit migration opt-in documented in `.env.example`.

## First main-agent activation

The first approved reviewer cannot be created through the ordinary applicant workflow because no approved reviewer exists yet. `npm run bootstrap:main-agent` is a one-time, non-HTTP bootstrap command.

It:

- requires explicit remote bootstrap opt-in;
- validates email, name, E.164 phone and password;
- bcrypt-hashes the password;
- takes a PostgreSQL advisory transaction lock;
- refuses to run if a main-agent already exists;
- creates one `active` + `approved` main-agent and its reviewer grant;
- creates no fixture verification, provider result or public bypass route.

After a successful remote bootstrap, disable `SILVERSTONE_ALLOW_REMOTE_BOOTSTRAP` and remove all bootstrap credential environment values.

## Intended user journey

1. A new applicant registers with email/password and completes the existing onboarding wizard.
2. Express stores the pending account, password hash and application data in Supabase `ss_v1`.
3. The assigned approved main-agent reviews the submitted application.
4. Approval atomically changes the applicant to `account_status=active` and `application_status=approved`.
5. The approved agent signs in with email/password through the APK and Render.
6. On the first approved login on that installation, the APK asks the agent to create and confirm a four-digit local PIN.
7. A retained valid server session restores to the PIN screen after app restart instead of asking for email/password again.
8. The in-app sign-out/lock action returns to the PIN screen while retaining the current account session.
9. `Not {firstName}?` performs true server logout/session revocation and returns to email/password so another account can sign in.
10. Pending, rejected, suspended and closed states fail closed according to the existing account/application routing rules.

## Completion gate

Phase 1 is not complete until all of the following are observed against the hosted environment:

- `ss_v1` migrations applied successfully to the intended Supabase project;
- Render runs the reviewed `development` implementation against that database;
- the first approved main-agent is created through the guarded bootstrap path;
- a real applicant registration persists to hosted Supabase;
- main-agent review and approval activate that applicant;
- installed Android APK logs in over HTTPS using email/password;
- first approved login performs PIN create + confirm;
- app restart restores the account to PIN without requiring email/password;
- PIN unlock reaches the role-appropriate application;
- in-app lock returns to PIN;
- `Not {name}?` revokes the server session and returns to email/password;
- invalid credentials, pending, rejected, suspended and closed accounts receive the intended response/routing;
- no fixture/mock authentication path is reachable in the hosted build;
- Upstash-backed shared rate limiting is active, with safe local degradation on transient Redis failure;
- legacy public tables are not exposed as a production client data path;
- Android device testing records the actual Render URL/build/version used.

Until this gate passes, later Phase 2-6 code is preserved but Phase 1 remains reopened.
