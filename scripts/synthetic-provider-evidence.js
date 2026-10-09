// TEST ONLY. Not imported by API/worker/native runtime. No HTTP/SDK/network calls.
// This models evidence handling, not any provider's wire format or guarantees.
import { randomUUID, createHash } from "node:crypto";
import { ApiError, invalid, uuid, allowFields } from "../foundation/errors.js";
const conflict = (code) => new ApiError(409, code, code);
const fields = [
  "provider",
  "scope",
  "eventKey",
  "reference",
  "requestId",
  "legId",
  "amountTzs",
  "currency",
  "networkCode",
  "fromAccountId",
  "toAccountId",
  "status",
];
const statuses = ["acknowledged", "confirmed", "failed", "unknown", "reversed"];

export function syntheticEvidenceHarness(db) {
  if (db.syntheticOnly !== true)
    throw new Error("Embedded synthetic database required.");
  return {
    // Consume a live preparation claim atomically BEFORE a simulated external effect.
    // A crash after commit leaves an unknown obligation, never a reclaimable dispatch.
    async prepare(claim) {
      if (![claim?.id, claim?.requestId, claim?.claimToken].every(uuid))
        throw invalid("Invalid claim.");
      return db.transaction(async (tx) => {
        const r = (
          await tx.query(
            "SELECT * FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE",
            [claim.requestId],
          )
        ).rows[0];
        const j = (
          await tx.query(
            "SELECT *,lease_until>clock_timestamp() live FROM ss_v1.exchange_jobs WHERE id=$1 FOR UPDATE",
            [claim.id],
          )
        ).rows[0];
        if (
          !r ||
          !j ||
          j.request_id !== r.id ||
          j.status !== "claimed" ||
          !j.live ||
          j.claim_token !== claim.claimToken
        )
          throw conflict("STALE_CLAIM");
        const participants = (
          await tx.query(
            `SELECT 1 FROM ss_v1.agents s JOIN ss_v1.main_agent_assignments m ON m.sub_agent_id=s.id
          JOIN ss_v1.agents a ON a.id=m.main_agent_id WHERE s.id=$1 AND a.id=$2 AND s.account_status='active'
          AND a.account_status='active' AND s.application_status='approved' AND a.application_status='approved'`,
            [r.sub_agent_id, r.main_agent_id],
          )
        ).rows;
        const held = (
          await tx.query(
            "SELECT 1 FROM ss_v1.exchange_reservations WHERE request_id=$1 AND status='held' AND amount_tzs=$2",
            [r.id, String(r.amount_tzs)],
          )
        ).rows;
        const accounts = (
          await tx.query(
            "SELECT id FROM ss_v1.network_accounts WHERE id IN ($1,$2,$3,$4) AND verification_status='synthetic_fixture' AND verification_source='synthetic_fixture'",
            [
              r.source_account_id,
              r.collection_account_id,
              r.payout_account_id,
              r.destination_account_id,
            ],
          )
        ).rows;
        const leg = (
          await tx.query(
            "SELECT * FROM ss_v1.transaction_legs WHERE request_id=$1 AND leg_type='origin_in' FOR UPDATE",
            [r.id],
          )
        ).rows[0];
        if (
          r.status !== "awaiting_source" ||
          !participants.length ||
          !held.length ||
          accounts.length !== 4 ||
          leg?.status !== "not_started"
        )
          throw conflict("ATTEMPT_INELIGIBLE");
        const id = randomUUID(),
          reference = "synthetic_" + id;
        const attempt = (
          await tx.query(
            `INSERT INTO ss_v1.provider_attempts
          (id,leg_id,request_id,provider,scope,reference,idempotency_key,amount_tzs,currency,network_code,from_account_id,to_account_id,claim_token)
          VALUES($1,$2,$3,'synthetic_fixture','embedded_test',$4,$4,$5,'TZS',$6,$7,$8,$9) RETURNING *`,
            [
              id,
              leg.id,
              r.id,
              reference,
              String(r.amount_tzs),
              r.source_network,
              r.source_account_id,
              r.collection_account_id,
              claim.claimToken,
            ],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO ss_v1.provider_evidence_state(attempt_id,status) VALUES($1,'unknown')",
          [id],
        );
        await tx.query(
          "UPDATE ss_v1.transaction_legs SET status='unknown' WHERE id=$1",
          [leg.id],
        );
        await tx.query(
          "UPDATE ss_v1.transfer_requests SET status='needs_attention',version=version+1 WHERE id=$1",
          [r.id],
        );
        await tx.query(
          "UPDATE ss_v1.exchange_jobs SET status='reconciliation',claim_token=NULL,lease_until=NULL,last_error='SYNTHETIC_EVIDENCE_ONLY' WHERE id=$1",
          [j.id],
        );
        await tx.query(
          "INSERT INTO ss_v1.exchange_history(request_id,event,reason) VALUES($1,'synthetic_attempt_prepared','Synthetic fixture only; no provider called. Reservation retained; actual settlement unverified.')",
          [r.id],
        );
        return attempt;
      });
    },
    // Durable intake is separate from application. An unprocessed event survives a crash.
    async receive(event) {
      allowFields(event, fields);
      if (
        fields.some((k) => typeof event[k] !== "string") ||
        fields.some((k) => event[k].length > 128) ||
        !event.eventKey ||
        !event.reference ||
        ![
          event.requestId,
          event.legId,
          event.fromAccountId,
          event.toAccountId,
        ].every(uuid) ||
        !/^[1-9]\d{0,18}$/.test(event.amountTzs) ||
        BigInt(event.amountTzs) > 9223372036854775807n ||
        !statuses.includes(event.status)
      )
        throw invalid("Invalid synthetic event.");
      // Explicit fixture origin, never inferred from a signature/header supplied by an app.
      if (
        event.provider !== "synthetic_fixture" ||
        event.scope !== "embedded_test"
      )
        throw invalid("Wrong synthetic provider scope.");
      const payload = Object.fromEntries(fields.map((k) => [k, event[k]]));
      const hash = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      return db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO ss_v1.provider_event_inbox(id,provider,scope,event_key,payload_hash,payload)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,scope,event_key) DO NOTHING`,
          [
            randomUUID(),
            event.provider,
            event.scope,
            event.eventKey,
            hash,
            JSON.stringify(payload),
          ],
        );
        const row = (
          await tx.query(
            "SELECT * FROM ss_v1.provider_event_inbox WHERE provider=$1 AND scope=$2 AND event_key=$3",
            [event.provider, event.scope, event.eventKey],
          )
        ).rows[0];
        if (row.payload_hash !== hash) throw conflict("EVENT_KEY_CONFLICT");
        return row.id;
      });
    },
    async apply(eventId) {
      if (!uuid(eventId)) throw invalid("Invalid event ID.");
      return db.transaction(async (tx) => {
        const event = (
          await tx.query(
            "SELECT * FROM ss_v1.provider_event_inbox WHERE id=$1",
            [eventId],
          )
        ).rows[0];
        if (!event) throw invalid("Unknown event.");
        const p = event.payload;
        const a = (
          await tx.query(
            "SELECT * FROM ss_v1.provider_attempts WHERE provider=$1 AND scope=$2 AND reference=$3",
            [p.provider, p.scope, p.reference],
          )
        ).rows[0];
        // Shared request-first locking serializes different events for the same exchange.
        if (a)
          await tx.query(
            "SELECT id FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE",
            [a.request_id],
          );
        await tx.query(
          "SELECT id FROM ss_v1.provider_event_inbox WHERE id=$1 FOR UPDATE",
          [eventId],
        );
        const previous = (
          await tx.query(
            "SELECT * FROM ss_v1.provider_event_results WHERE event_id=$1",
            [eventId],
          )
        ).rows[0];
        if (previous) return previous;
        let disposition = "rejected",
          reason = "REFERENCE_NOT_FOUND";
        if (a) {
          const matches =
            p.requestId === a.request_id &&
            p.legId === a.leg_id &&
            p.amountTzs === String(a.amount_tzs) &&
            p.currency === a.currency &&
            p.networkCode === a.network_code &&
            p.fromAccountId === a.from_account_id &&
            p.toAccountId === a.to_account_id;
          reason = "TERMS_MISMATCH";
          if (matches) {
            const state = (
              await tx.query(
                "SELECT status FROM ss_v1.provider_evidence_state WHERE attempt_id=$1 FOR UPDATE",
                [a.id],
              )
            ).rows[0].status;
            // No clock/order guarantee is assumed. A reversal dominates; terminal contradictions require review.
            let next = state;
            disposition = "ignored";
            reason = "DUPLICATE_OR_OLDER_EVIDENCE";
            if (p.status === "reversed" && state !== "reversed") {
              next = "reversed";
              disposition = "applied";
            } else if (state === "reversed") {
              /* never re-confirm reversed evidence */
            } else if (
              (state === "confirmed" && p.status === "failed") ||
              (state === "failed" && p.status === "confirmed")
            ) {
              disposition = "conflict";
              reason = "CONTRADICTORY_TERMINAL_EVIDENCE";
            } else if (
              !["confirmed", "failed"].includes(state) &&
              p.status !== state
            ) {
              next = p.status;
              disposition = "applied";
            }
            if (disposition === "applied") {
              reason = "SYNTHETIC_EVIDENCE_ONLY";
              await tx.query(
                "UPDATE ss_v1.provider_evidence_state SET status=$2,updated_at=now() WHERE attempt_id=$1",
                [a.id, next],
              );
              if (["confirmed", "reversed"].includes(next))
                await tx.query(
                  `INSERT INTO ss_v1.provider_evidence_effects(attempt_id,effect,event_id)
                VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
                  [
                    a.id,
                    next === "confirmed"
                      ? "synthetic_confirmation"
                      : "synthetic_reversal",
                    eventId,
                  ],
                );
            }
            if (["applied", "conflict"].includes(disposition))
              await tx.query(
                "INSERT INTO ss_v1.exchange_history(request_id,event,reason) VALUES($1,'synthetic_evidence',$2)",
                [
                  a.request_id,
                  `Synthetic ${p.status}: ${disposition}. No actual settlement or hold release.`,
                ],
              );
          }
        }
        return (
          await tx.query(
            "INSERT INTO ss_v1.provider_event_results(event_id,attempt_id,disposition,reason) VALUES($1,$2,$3,$4) RETURNING *",
            [eventId, a?.id || null, disposition, reason],
          )
        ).rows[0];
      });
    },
  };
}
