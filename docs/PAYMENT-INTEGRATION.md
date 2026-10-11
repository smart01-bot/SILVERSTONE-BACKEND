# Real transaction integration

Implemented: immutable originating and receiving endpoints; main-agent approval; dedicated agency funding reservations; durable collection/payout tasks; signed-callback adapter boundary; independent provider status verification; idempotent requests; crash recovery without blind resend; append-only observations; status and exception presentation. No production payment adapter or fabricated balance is installed. No money moves merely by saving a request.

## Request contract

`POST /api/v1/requests` requires the existing authenticated approved agent session and stable `Idempotency-Key`.

```json
{
  "source": { "networkCode": "vodacom", "identifierType": "phone", "identifier": "+255700000001" },
  "destination": { "networkCode": "airtel", "identifierType": "agent", "identifier": "0012345" },
  "amountTzs": "10000",
  "currency": "TZS",
  "urgent": false
}
```

The above values illustrate the contract; they are not seeded or submitted by deployment. Wallet numbers accept Tanzania local/international forms, stored as E.164. Agent and till IDs preserve leading zeros. Network prefixes are not used to infer the chosen network. Accounts remain unverified unless separately verified; saving a request does not prove ownership or agent-float support. The prompt/consent mechanism belongs to the contracted provider. Main-agent funding and provider scope cannot be supplied by the app.

Source is the endpoint asked to authorize payment to Silverstone; destination is the endpoint credited from the assigned agency's configured funding scope. A provider must explicitly support both identifier types and the intended wallet/float product. No fallback converts agent/till identifiers into consumer wallet numbers.

## Provider adapter contract

Register reviewed code in `foundation/payment-providers.js`. Credentials belong in server environment variables/secret storage. The registry is empty intentionally; there is no arbitrary URL adapter or client-controlled routing. An aggregator adapter may cover both networks. Direct operator connections can be composed behind the same contract, but must implement both collection and payout, including agency funding attribution. Do not infer capabilities from the presence of a payment API.

- `supports({ source, destination, currency, scope })`: synchronous boolean for explicitly contracted networks, identifier types, amount/fee limits and this agency scope. Called before reservation and each first dispatch. The initial call does not include amount; per-request dispatch also includes `amountTzs` and `maxFeeTzs`.
- `balance({ scope, currency, signal })`: authenticated provider balance lookup. Return `{ verified: true, scope, currency: 'TZS', availableTzs: '<integer>' }`. Use a dedicated prefunded account; external debits invalidate local capacity accounting.
- `collect({ source, destination, amountTzs, currency, maxFeeTzs, scope, reference, idempotencyKey, kind, signal })`: request the source's approval to collect the specified amount. Merchant fee ceiling is reserved from agency funding; no undisclosed fee can be added to the source debit.
- `payout(sameArguments)`: credit the exact destination amount from that agency scope. `maxFeeTzs` is reduced by the verified collection fee. Reject unsupported/over-limit instructions before attempting movement.
- `lookup(sameArguments)`: authenticated authoritative status retrieval using the stable reference, including after a process crash before a response was recorded. Return `{ verified, reference, scope, kind, amountTzs, currency, endpoint, providerReference, feeTzs, status }`. Endpoint is source for collection, destination for payout. Money values are decimal integer strings. Status is `pending`, `confirmed` or definitively `failed`. Adapter must verify the provider's merchant/funding identity and finality; `not_found`, ambiguity or reversal must never be mapped to a definitive failure.
- `verifyWebhook({ rawBody, headers })`: verify provider signature over the original bytes, scope, timestamp/replay window and event identity. Return `{ verified:true, scope, reference, eventId }` only after verification. The integration must define provider-specific replay-window behavior. Callback at `POST /api/v1/payment-events/:provider` only schedules authoritative lookup; it never settles funds directly.

Respect the supplied abort signal and impose HTTP deadlines; never retry a money-creating HTTP call inside the adapter. Stable `reference`/`idempotencyKey` is the persisted task UUID. Submission responses do not authorize payout. Engine checks amount, currency, typed endpoint, funding scope, reference, provider reference stability and fee ceiling on lookup. Secrets, raw webhook content and full provider responses are not logged/persisted.

## Execution and recovery

Approval atomically reserves amount plus maximum agency fees from a fresh verified funding pool (five-minute freshness limit) and enqueues collection. Capacity is shared by provider + funding scope across routes, preventing separate network rows from double-counting the same balance. Task dispatch is durably recorded before network I/O. An expired claim can perform lookup only, even if no response was recorded. Unknown/not-found results enter reconciliation, retain funding and never trigger a second debit. Transient lookup errors are polled up to 120 checks; missing callbacks do not prevent polling.

Only confirmed collection queues one payout, enforced by a unique request/leg key. Confirmed payout consumes the reserved ceiling; a later verified balance refresh recovers unused fees. Definitively failed collection with zero fees releases funding. Failed payout, charged failure, mismatch or unknown result retains funding and enters `needs_attention`. Cancellation is permitted only before dispatch. Late contradictory evidence opens an exception without repeating payment/accounting. Financial resolution/refunds are deliberately manual until a provider-specific audited recovery procedure exists; do not edit status fields as a substitute.

Disabling a funding pool, revoking participant access, revoking endpoints, or pausing preparation prevents new dispatch. Status lookups continue to resolve already-started money movements. In-flight external calls cannot be recalled by a database pause.

## Deployment and activation

1. Apply additive `007-payment-orchestration.sql` using the existing project migration runner/ledger. It creates private RLS-protected tables with no client policies, funding or provider rows. Existing synthetic fixtures remain isolated.
2. Deploy API from `Development`. The new request route fails with `PAYMENT_SETUP_REQUIRED` if migration is missing; existing authentication continues working.
3. Once a provider is selected, implement its adapter and verify sandbox callbacks, lost responses, declines, fee rules, funding identity, identifier types and lookup finality against that provider. Review before enabling real payments.
4. Provision disabled `payment_funding` and typed `payment_routes` rows server-side for the approved main agent. No secrets go in these rows. Configure route fee ceilings from the contract. There is no public configuration endpoint.
5. Use `refreshFunding(db, fundingId, providers)` to obtain authenticated capacity; it rejects pools with outstanding holds. Enable only supported routes/funding after commissioning. Refresh when required; never seed a guessed balance.
6. Run a persistent worker with `node scripts/payment-worker.js`, the API's database configuration and the same reviewed adapter/secrets. It refuses to run with an empty registry. Use graceful SIGTERM shutdown. Keep the API and worker version aligned.
7. Build a new Android APK from frontend `Development` for the number-entry and review UI. Existing installed APKs do not acquire JavaScript changes automatically.

A live provider, provider credentials, verified funding setup and running worker are still required to send real payment prompts. The test adapter exists only inside automated tests against an isolated database.
