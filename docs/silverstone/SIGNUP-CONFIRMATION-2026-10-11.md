# Hosted signup confirmation repair — 11 October 2026

## Evidence

The user confirmed successful login from the updated Android app. A later registration attempt showed `Authentication service temporarily unavailable.` Read-only Supabase inspection found the attempted email in Auth, unconfirmed, without a corresponding `ss_v1.agents` record. No live records were edited and no password from the screenshot was used or retained.

GoTrue's signup source returns either a token response or a bare user awaiting confirmation; it can also return an obfuscated bare user for an existing account. The old bridge required `payload.user.id` for both login and signup, falsely reporting a provider failure for bare-user responses. Source inspected: https://github.com/supabase/auth/blob/master/internal/api/signup.go (Signup response branches).

## Correction

- Recognize confirmation-only signup responses and return HTTP 202 `{data:{requiresEmailConfirmation:true}}`. Never insert an agent or issue an app session from a bare or obfuscated user ID.
- Require a token response for authenticated provider identities. Keep email confirmation, invalid credentials, weak password and rate-limit errors distinct.
- Registration first attempts password authentication so confirmed Supabase accounts missing their Silverstone record can finish registration. An unconfirmed account receives confirmation instructions. Invalid credentials never link an existing identity. Provider outages are not treated as an invitation to retry signup.
- Missing Silverstone record after successful login returns `REGISTRATION_REQUIRED`; closed accounts remain rejected.
- Frontend keeps the form open for confirmation, stores no empty tokens, and permits Save & continue again after email confirmation. Confirmation does not grant agent approval or dashboard access.
- ACCOUNT_CONFLICT explains that email or phone is already in use instead of the unrelated stale-record warning.

## Checks

- Backend hosted-auth and provider tests: 5 passed. Covers confirmation-only responses, obfuscated users, no premature records/sessions, confirmed partial-account recovery, invalid-password non-linking, phone conflicts and existing session/access restrictions.
- Frontend full suite: 52 passed; after adding UI/error regression cases, 14 affected tests passed (including both new cases).
- Backend build/import checks and frontend Android JS/Hermes export passed. No APK or physical-device signup acceptance claimed.

## Rollout and remaining work

Publish to `Development` in both repositories, preserving main. Render service `SILVERSTONE-BACKEND` still reports branch `development` (lowercase), so deployment of this fix is not established by a push. Its branch must be corrected to `Development` and the deployed commit verified before claiming hosted signup is fixed. The currently installed standalone APK also needs an updated preview build for confirmation messaging.

The existing partial account should confirm its email and finish registration with its own available phone number after rollout; do not delete it or bypass email confirmation. No confirmation email was resent by this investigation. If its password was exposed, replace it through recovery. Existing linked accounts keep their usual sign-in behavior.

Phone/SMS proof remains unavailable for final application submission. Role-selector restoration is a separate outstanding UI request, not part of this repair. No privileges, payments, live database schema or hosted settings were changed.
