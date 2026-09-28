> Phase 1 local update: Approved architecture and active source boundary are recorded in PROJECT-STATE.md and LOCAL-DEVELOPMENT.md. The canonical Phase 1 docs are currently in the local frontend development checkout and have NOT been pushed. Remote links below still show Phase 0 until separately authorized publication.

## Mandatory branch policy — all phases

Confirmed by the user on 27 September 2026: all Silverstone phases must be implemented on `development` in BOTH `smart01-bot/SILVERSTONE-FRONTEND` and `smart01-bot/SILVERSTONE-BACKEND`. All phase code, fixes, tests, documentation and handoffs belong on those branches. Any authorized publication of phase work must target `development` only.

Never implement on, commit to, push to or merge into `main` under phase authority. A later main-branch release requires separate explicit user authorization. Keep `feat/registration-wizard` as a donor reference; do not use it as the continuing implementation branch. Fetch the latest `development` refs and compare with the preceding handoff before every phase; never reset newer work to historical main pins.

This policy selects the implementation branches; it does not start a phase or independently authorize deployment, live data changes or real payments. Historical proposed-branch wording is superseded by this confirmed rule. Include it in every future phase initiating message and handoff.

# Silverstone backend — project context pointer

Updated 27 September 2026. Working branch: development. Main must remain unchanged.

The user authorized development branch creation and publication of Phase 0 findings. This documentation-only branch is based on backend main 17f7276198af5593fd277f940e7212768a8d0ddd. No backend source fix, build, migration, deployment or live payment was performed.

## Canonical shared documentation

Read [frontend shared context](https://github.com/smart01-bot/SILVERSTONE-FRONTEND/tree/development/docs/silverstone) and its current state before starting any phase. Verified initial publication commit: [dbde9da13f4151f559e18ce5161806e695cc49f8](https://github.com/smart01-bot/SILVERSTONE-FRONTEND/tree/dbde9da13f4151f559e18ce5161806e695cc49f8/docs/silverstone).

Start with PROJECT-STATE.md, PROJECT-CONTEXT.md, DECISIONS.md, API-CONTRACT.md, KNOWN-ISSUES.md, PERMISSIONS-AND-DEPENDENCIES.md, DESIGN-GUIDELINES.md, IMPLEMENTATION-PLAN.md and handoffs/PHASE-00-HANDOFF.md. EVIDENCE.md contains the audit source references. Read any applicable AGENTS.md as well. Keep one shared context, not independently edited copies.

## Backend Phase 0 findings

- Active imports target absent models/request.js and models/transaction.js; newer transfer/leg/ledger models coexist with old services and migrations.
- A complete reproducible schema bootstrap is missing; live schema is unknown.
- Public registration accepts privileged role/verification inputs; operational approval, ownership and assignment checks need repair.
- Password recovery token purpose checks, delivery and session revocation need repair.
- Queue priority/claim/removal/recovery behavior is unsafe for dependable processing.
- Provider payment calls are mocked/commented out; no payment capability was demonstrated.
- Tests connect eagerly and perform broad cleanup; isolate them before execution. No tests/builds were run in Phase 0.
- Amount totals are misleadingly labelled revenue despite zero Silverstone service fee.

These are source-review findings, not proof of deployed behavior. Full evidence and qualifications are canonical in frontend KNOWN-ISSUES.md.

## Next phase

Phase 1 has not started. Main-based development branches and documentation publication are authorized; other architecture proposals remain proposals. Fetch both live development tips, reconcile with the latest handoff and establish Phase 1 authority before implementation. Preserve the frontend registration wizard and adapt donor changes selectively. Do not merge the donor branch automatically. No authority for future implementation pushes, main merges, production changes or payments is implied by this setup.
