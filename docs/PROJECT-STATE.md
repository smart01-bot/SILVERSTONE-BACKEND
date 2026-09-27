## Mandatory branch policy — all phases

Confirmed by the user on 27 September 2026: all Silverstone phases must be implemented on `development` in BOTH `smart01-bot/SILVERSTONE-FRONTEND` and `smart01-bot/SILVERSTONE-BACKEND`. All phase code, fixes, tests, documentation and handoffs belong on those branches. Any authorized publication of phase work must target `development` only.

Never implement on, commit to, push to or merge into `main` under phase authority. A later main-branch release requires separate explicit user authorization. Keep `feat/registration-wizard` as a donor reference; do not use it as the continuing implementation branch. Fetch the latest `development` refs and compare with the preceding handoff before every phase; never reset newer work to historical main pins.

This policy selects the implementation branches; it does not start a phase or independently authorize deployment, live data changes or real payments. Historical proposed-branch wording is superseded by this confirmed rule. Include it in every future phase initiating message and handoff.

# Backend project state

Working branch: development, created from main 17f7276198af5593fd277f940e7212768a8d0ddd with Phase 0 documentation only.

Read [SILVERSTONE-CONTEXT.md](SILVERSTONE-CONTEXT.md) for verified findings and the canonical frontend context. Phase 1 has not started; no source, database or deployment changes were made. Main is not an implementation target. Read the live branch ref for this documentation commit SHA.
