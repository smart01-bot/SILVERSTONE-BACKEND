import { randomUUID, createHash } from "node:crypto";
import { ApiError, invalid, allowFields, uuid } from "./errors.js";
import { active } from "./auth.js";
import { requestDTO } from "./models.js";
import { providerBoundary, providerEvidenceDTO } from "./provider-boundary.js";
const conflict = (message, code = "EXCHANGE_CHANGED") =>
  new ApiError(409, code, message);
const deny = () =>
  new ApiError(
    403,
    "EXCHANGE_FORBIDDEN",
    "An approved active account and current assignment are required.",
  );
const missing = () => new ApiError(404, "NOT_FOUND", "Exchange not found.");
const ready = (a) =>
  a && a.account_status === "active" && a.application_status === "approved";
const accountDTO = (a) => ({
  id: a.id,
  networkCode: a.network_code,
  identifierType: a.identifier_type,
  identifier: a.identifier,
  verificationStatus: a.verification_status,
  verificationSource: a.verification_source,
});
const synthetic = (a) =>
  a?.verification_status === "synthetic_fixture" &&
  a.verification_source === "synthetic_fixture";
async function history(tx, id, actor, event, reason) {
  await tx.query(
    "INSERT INTO ss_v1.exchange_history(request_id,actor_id,event,reason) VALUES($1,$2,$3,$4)",
    [id, actor, event, reason],
  );
}
// Lock live participants and assignment in every mutation. Request assignment is immutable.
async function participants(tx, subId, mainId, actor) {
  const rows = (
    await tx.query(
      "SELECT * FROM ss_v1.agents WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
      [subId, mainId],
    )
  ).rows;
  const sub = rows.find((a) => a.id === subId),
    main = rows.find((a) => a.id === mainId);
  const assignment = (
    await tx.query(
      "SELECT * FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1 FOR UPDATE",
      [subId],
    )
  ).rows[0];
  if (
    !ready(sub) ||
    !ready(main) ||
    sub.role !== "sub-agent" ||
    main.role !== "main-agent" ||
    assignment?.main_agent_id !== mainId ||
    ![subId, mainId].includes(actor)
  )
    throw deny();
}
async function command(tx, actor, operation, key, payload, fn) {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw invalid("A stable Idempotency-Key of 16–128 characters is required.");
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  await tx.query(
    "INSERT INTO ss_v1.exchange_commands(actor_id,operation,key,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [actor, operation, key, hash],
  );
  const row = (
    await tx.query(
      "SELECT * FROM ss_v1.exchange_commands WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE",
      [actor, operation, key],
    )
  ).rows[0];
  if (row.payload_hash !== hash)
    throw conflict(
      "This key was already used with different details.",
      "IDEMPOTENCY_CONFLICT",
    );
  if (row.response) return row.response;
  const result = await fn();
  await tx.query(
    "UPDATE ss_v1.exchange_commands SET response=$4 WHERE actor_id=$1 AND operation=$2 AND key=$3",
    [actor, operation, key, JSON.stringify(result)],
  );
  return result;
}
async function detail(tx, row) {
  const legs = (
    await tx.query(
      "SELECT id,leg_type,status FROM ss_v1.transaction_legs WHERE request_id=$1 ORDER BY leg_type",
      [row.id],
    )
  ).rows;
  const events = (
    await tx.query(
      "SELECT actor_id,event,reason,created_at FROM ss_v1.exchange_history WHERE request_id=$1 ORDER BY id",
      [row.id],
    )
  ).rows;
  const reservation = (
    await tx.query(
      "SELECT status,amount_tzs FROM ss_v1.exchange_reservations WHERE request_id=$1",
      [row.id],
    )
  ).rows[0];
  return {
    ...requestDTO(row),
    version: row.version,
    urgent: row.urgent,
    queueSequence: String(row.queue_sequence),
    accounts: row.account_snapshot,
    legs: legs.map((l) => ({ id: l.id, type: l.leg_type, status: l.status })),
    history: events.map((e) => ({
      actorId: e.actor_id,
      event: e.event,
      reason: e.reason,
      createdAt: new Date(e.created_at).toISOString(),
    })),
    reservation: reservation
      ? {
          status: reservation.status,
          amountTzs: String(reservation.amount_tzs),
        }
      : null,
    nextAction:
      row.status === "awaiting_review"
        ? "Awaiting main-agent review"
        : row.status === "awaiting_source"
          ? "Capacity reserved. Provider execution disabled; do not send funds."
          : row.status === "needs_attention"
            ? "Reconciliation required; reservation retained."
            : "No payment action available.",
    provider: providerBoundary(),
    providerEvidence: await providerEvidenceDTO(tx, row.id),
    silverstoneFeeTzs: "0",
    providerExecutionEnabled: false,
  };
}
async function scoped(db, actor, id) {
  if (!uuid(id)) throw invalid("Invalid request ID.");
  const row = (
    await db.query(
      `SELECT r.* FROM ss_v1.transfer_requests r JOIN ss_v1.main_agent_assignments a ON a.sub_agent_id=r.sub_agent_id AND a.main_agent_id=r.main_agent_id
 WHERE r.id=$1 AND (r.sub_agent_id=$2 OR r.main_agent_id=$2)`,
      [id, actor],
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
export function mountExchanges(app, db) {
  app.get("/api/v1/me/accounts", active, async (req, res) => {
    const rows = (
      await db.query(
        "SELECT * FROM ss_v1.network_accounts WHERE agent_id=$1 ORDER BY network_code,id",
        [req.agent.id],
      )
    ).rows;
    res.json({ data: rows.map(accountDTO) });
  });
  app.post("/api/v1/me/accounts", active, async (req, res) => {
    allowFields(req.body, ["networkCode", "identifierType", "identifier"]);
    const { networkCode, identifierType, identifier } = req.body;
    if (
      !["vodacom", "airtel", "yas", "halotel"].includes(networkCode) ||
      !["phone", "agent", "till", "account"].includes(identifierType) ||
      typeof identifier !== "string" ||
      !identifier.trim() ||
      identifier.length > 64 ||
      !/^[A-Za-z0-9+_-]+$/.test(identifier) ||
      (identifierType === "phone" && !/^\+[1-9]\d{7,14}$/.test(identifier))
    )
      throw invalid("Enter a supported network and typed identifier.");
    const row = await db.transaction(async (tx) => {
      const a = (
        await tx.query("SELECT * FROM ss_v1.agents WHERE id=$1 FOR UPDATE", [
          req.agent.id,
        ])
      ).rows[0];
      if (!ready(a)) throw deny();
      if (
        (
          await tx.query(
            "SELECT count(*)::int n FROM ss_v1.network_accounts WHERE agent_id=$1",
            [a.id],
          )
        ).rows[0].n >= 30
      )
        throw invalid("Account limit reached.");
      return (
        await tx.query(
          "INSERT INTO ss_v1.network_accounts(id,agent_id,network_code,identifier_type,identifier) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [randomUUID(), a.id, networkCode, identifierType, identifier],
        )
      ).rows[0];
    });
    res.status(201).json({ data: accountDTO(row) });
  });
  app.post("/api/v1/requests", active, async (req, res) => {
    allowFields(req.body, [
      "sourceAccountId",
      "destinationAccountId",
      "amountTzs",
      "currency",
      "urgent",
    ]);
    const {
      sourceAccountId,
      destinationAccountId,
      amountTzs,
      currency,
      urgent = false,
    } = req.body;
    if (
      !uuid(sourceAccountId) ||
      !uuid(destinationAccountId) ||
      typeof amountTzs !== "string" ||
      !/^[1-9]\d{0,18}$/.test(amountTzs) ||
      BigInt(amountTzs) > 9223372036854775807n ||
      currency !== "TZS" ||
      typeof urgent !== "boolean"
    )
      throw invalid(
        "Use owned account IDs and a positive whole-TZS amount string.",
      );
    if (req.agent.role !== "sub-agent" || !req.agent.main_agent_id)
      throw deny();
    const result = await db.transaction(async (tx) => {
      await participants(
        tx,
        req.agent.id,
        req.agent.main_agent_id,
        req.agent.id,
      );
      return command(
        tx,
        req.agent.id,
        "create",
        req.get("Idempotency-Key"),
        { sourceAccountId, destinationAccountId, amountTzs, currency, urgent },
        async () => {
          const accounts = (
            await tx.query(
              "SELECT * FROM ss_v1.network_accounts WHERE agent_id IN ($1,$2) ORDER BY id FOR UPDATE",
              [req.agent.id, req.agent.main_agent_id],
            )
          ).rows;
          const source = accounts.find(
              (a) => a.id === sourceAccountId && a.agent_id === req.agent.id,
            ),
            dest = accounts.find(
              (a) =>
                a.id === destinationAccountId && a.agent_id === req.agent.id,
            );
          if (!synthetic(source) || !synthetic(dest))
            throw conflict(
              "Only explicitly synthetic verified test accounts can exchange in this phase.",
              "ACCOUNT_VERIFICATION_REQUIRED",
            );
          if (source.network_code === dest.network_code)
            throw invalid("Select different source and destination networks.");
          const collection = accounts.filter(
            (a) =>
              a.agent_id === req.agent.main_agent_id &&
              a.network_code === source.network_code &&
              synthetic(a),
          );
          const payout = accounts.filter(
            (a) =>
              a.agent_id === req.agent.main_agent_id &&
              a.network_code === dest.network_code &&
              synthetic(a),
          );
          if (collection.length !== 1 || payout.length !== 1)
            throw conflict(
              "Assigned main-agent requires one unambiguous synthetic account per network.",
              "ACCOUNT_CONFIGURATION_REQUIRED",
            );
          const id = randomUUID();
          const snapshot = {
            source: accountDTO(source),
            destination: accountDTO(dest),
            collection: accountDTO(collection[0]),
            payout: accountDTO(payout[0]),
          };
          const row = (
            await tx.query(
              `INSERT INTO ss_v1.transfer_requests(id,sub_agent_id,main_agent_id,source_network,destination_network,amount_tzs,currency,status,source_account_id,destination_account_id,collection_account_id,payout_account_id,account_snapshot,urgent)
     VALUES($1,$2,$3,$4,$5,$6,'TZS','awaiting_review',$7,$8,$9,$10,$11,$12) RETURNING *`,
              [
                id,
                req.agent.id,
                req.agent.main_agent_id,
                source.network_code,
                dest.network_code,
                amountTzs,
                source.id,
                dest.id,
                collection[0].id,
                payout[0].id,
                JSON.stringify(snapshot),
                urgent,
              ],
            )
          ).rows[0];
          for (const type of ["origin_in", "destination_out"])
            await tx.query(
              "INSERT INTO ss_v1.transaction_legs(id,request_id,leg_type) VALUES($1,$2,$3)",
              [randomUUID(), id, type],
            );
          await history(
            tx,
            id,
            req.agent.id,
            "created",
            "Request recorded; no funds moved.",
          );
          return detail(tx, row);
        },
      );
    });
    res.status(201).json({ data: result });
  });
  app.get("/api/v1/requests", active, async (req, res) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit),
      cursor = req.query.cursor || "0";
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !/^\d{1,19}$/.test(cursor) ||
      BigInt(cursor) > 9223372036854775807n
    )
      throw invalid("Invalid pagination.");
    const rows = (
      await db.query(
        `SELECT r.* FROM ss_v1.transfer_requests r JOIN ss_v1.main_agent_assignments a ON a.sub_agent_id=r.sub_agent_id AND a.main_agent_id=r.main_agent_id
   WHERE (r.sub_agent_id=$1 OR r.main_agent_id=$1) AND r.queue_sequence>$2 ORDER BY r.queue_sequence LIMIT $3`,
        [req.agent.id, cursor, limit + 1],
      )
    ).rows;
    const data = [];
    for (const row of rows.slice(0, limit)) data.push(await detail(db, row));
    res.json({
      data,
      page: {
        nextCursor:
          rows.length > limit ? String(rows[limit - 1].queue_sequence) : null,
      },
    });
  });
  app.get("/api/v1/requests/:id", active, async (req, res) =>
    res.json({
      data: await detail(db, await scoped(db, req.agent.id, req.params.id)),
    }),
  );
  for (const action of ["accept", "reject", "cancel"])
    app.post(`/api/v1/requests/:id/${action}`, active, async (req, res) => {
      allowFields(req.body, ["expectedVersion", "reason"]);
      const { expectedVersion, reason = "" } = req.body;
      if (
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1 ||
        typeof reason !== "string" ||
        reason.length > 1000 ||
        (action === "reject" && reason.trim().length < 3)
      )
        throw invalid("A current version and rejection reason are required.");
      const base = await scoped(db, req.agent.id, req.params.id);
      if (
        (action === "cancel" ? base.sub_agent_id : base.main_agent_id) !==
        req.agent.id
      )
        throw deny();
      const result = await db.transaction(async (tx) => {
        await participants(
          tx,
          base.sub_agent_id,
          base.main_agent_id,
          req.agent.id,
        );
        return command(
          tx,
          req.agent.id,
          `${action}:${base.id}`,
          req.get("Idempotency-Key"),
          { expectedVersion, reason: reason.trim() },
          async () => {
            const row = (
              await tx.query(
                "SELECT * FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE",
                [base.id],
              )
            ).rows[0];
            if (row.version !== expectedVersion)
              throw conflict("Refresh this request before acting.");
            if (!row.source_account_id)
              throw conflict(
                "Historical request requires reconciliation; cannot process automatically.",
              );
            if (action === "accept") {
              if (row.status !== "awaiting_review")
                throw conflict(
                  "Only requests awaiting review can be accepted.",
                );
              const accounts = (
                await tx.query(
                  "SELECT * FROM ss_v1.network_accounts WHERE id IN ($1,$2,$3,$4) ORDER BY id FOR UPDATE",
                  [
                    row.source_account_id,
                    row.destination_account_id,
                    row.collection_account_id,
                    row.payout_account_id,
                  ],
                )
              ).rows;
              if (accounts.length !== 4 || !accounts.every(synthetic))
                throw conflict("Account verification changed.");
              const capacity = await tx.query(
                `UPDATE ss_v1.exchange_capacity SET held_tzs=held_tzs+$2 WHERE account_id=$1 AND source='synthetic_fixture' AND total_tzs-held_tzs >= $2 RETURNING account_id`,
                [row.payout_account_id, String(row.amount_tzs)],
              );
              if (!capacity.rows.length)
                throw conflict(
                  "Insufficient available synthetic capacity.",
                  "INSUFFICIENT_CAPACITY",
                );
              await tx.query(
                "INSERT INTO ss_v1.exchange_reservations(request_id,account_id,amount_tzs,status) VALUES($1,$2,$3,'held')",
                [row.id, row.payout_account_id, String(row.amount_tzs)],
              );
              await tx.query(
                "INSERT INTO ss_v1.exchange_jobs(id,request_id,kind,status) VALUES($1,$2,'prepare_collection','ready')",
                [randomUUID(), row.id],
              );
            } else {
              if (!["awaiting_review", "awaiting_source"].includes(row.status))
                throw conflict("This request cannot safely be closed.");
              const legs = (
                await tx.query(
                  "SELECT status FROM ss_v1.transaction_legs WHERE request_id=$1 FOR UPDATE",
                  [row.id],
                )
              ).rows;
              if (
                legs.length !== 2 ||
                legs.some((l) => l.status !== "not_started")
              )
                throw conflict(
                  "Payment outcome needs reconciliation; reservation retained.",
                );
              const job = (
                await tx.query(
                  "SELECT * FROM ss_v1.exchange_jobs WHERE request_id=$1 FOR UPDATE",
                  [row.id],
                )
              ).rows[0];
              if (job?.status === "claimed" || job?.status === "reconciliation")
                throw conflict("Processing claim must resolve before closing.");
              const held = (
                await tx.query(
                  "UPDATE ss_v1.exchange_reservations SET status='released' WHERE request_id=$1 AND status='held' RETURNING *",
                  [row.id],
                )
              ).rows[0];
              if (held)
                await tx.query(
                  "UPDATE ss_v1.exchange_capacity SET held_tzs=held_tzs-$2 WHERE account_id=$1",
                  [held.account_id, String(held.amount_tzs)],
                );
              await tx.query(
                "UPDATE ss_v1.exchange_jobs SET status='cancelled',claim_token=NULL,lease_until=NULL WHERE request_id=$1",
                [row.id],
              );
            }
            const status = {
              accept: "awaiting_source",
              reject: "rejected",
              cancel: "cancelled",
            }[action];
            const updated = (
              await tx.query(
                "UPDATE ss_v1.transfer_requests SET status=$2,version=version+1 WHERE id=$1 RETURNING *",
                [row.id, status],
              )
            ).rows[0];
            await history(
              tx,
              row.id,
              req.agent.id,
              action,
              reason.trim() ||
                (action === "accept"
                  ? "Synthetic capacity reserved; provider disabled."
                  : "Cancelled before any movement."),
            );
            return detail(tx, updated);
          },
        );
      });
      res.json({ data: result });
    });
}

// Internal local worker primitives. No HTTP claim/settlement endpoint or provider adapter.
export async function claimExchangeJob(db, { leaseSeconds = 30 } = {}) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300)
    throw invalid("Invalid lease.");
  return db.transaction(async (tx) => {
    // Request first is the lock order shared by commands and worker completion.
    const row = (
      await tx.query(`SELECT r.* FROM ss_v1.transfer_requests r JOIN ss_v1.exchange_jobs j ON j.request_id=r.id
   WHERE r.status='awaiting_source' AND ((j.status='ready' AND j.available_at<=clock_timestamp()) OR (j.status='claimed' AND j.lease_until<=clock_timestamp()))
   ORDER BY r.queue_sequence FOR UPDATE OF r SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!row) return null;
    // Do not acquire participant write locks after request locks (avoids inverse lock order).
    const eligible = (
      await tx.query(
        `SELECT 1 FROM ss_v1.agents s JOIN ss_v1.main_agent_assignments a ON a.sub_agent_id=s.id JOIN ss_v1.agents m ON m.id=a.main_agent_id
   WHERE s.id=$1 AND m.id=$2 AND s.account_status='active' AND s.application_status='approved' AND m.account_status='active' AND m.application_status='approved'`,
        [row.sub_agent_id, row.main_agent_id],
      )
    ).rows.length;
    const reservation = (
      await tx.query(
        "SELECT 1 FROM ss_v1.exchange_reservations WHERE request_id=$1 AND status='held'",
        [row.id],
      )
    ).rows.length;
    if (!eligible || !reservation) {
      await tx.query(
        "UPDATE ss_v1.exchange_jobs SET status='blocked',last_error='ACCOUNT_OR_RESERVATION_BLOCKED',claim_token=NULL,lease_until=NULL WHERE request_id=$1",
        [row.id],
      );
      await history(
        tx,
        row.id,
        null,
        "job_blocked",
        "Account or reservation requires review; no execution.",
      );
      return null;
    }
    const token = randomUUID();
    const job = (
      await tx.query(
        `UPDATE ss_v1.exchange_jobs SET status='claimed',claim_token=$2,lease_until=clock_timestamp()+$3*interval '1 second',attempts=attempts+1 WHERE request_id=$1 RETURNING *`,
        [row.id, token, leaseSeconds],
      )
    ).rows[0];
    await history(
      tx,
      row.id,
      null,
      "job_claimed",
      `Preparation claim attempt ${job.attempts}; no provider execution.`,
    );
    return {
      id: job.id,
      requestId: row.id,
      claimToken: token,
      attempts: job.attempts,
    };
  });
}
export async function finishExchangeJob(
  db,
  claim,
  outcome = "provider_disabled",
) {
  if (!["provider_disabled", "retry", "unknown"].includes(outcome))
    throw invalid("Settlement and provider execution are disabled.");
  if (!uuid(claim?.id) || !uuid(claim?.requestId) || !uuid(claim?.claimToken))
    throw invalid("Invalid claim.");
  return db.transaction(async (tx) => {
    const row = (
      await tx.query(
        "SELECT * FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE",
        [claim.requestId],
      )
    ).rows[0];
    const job = (
      await tx.query(
        "SELECT *,lease_until>clock_timestamp() AS live FROM ss_v1.exchange_jobs WHERE id=$1 FOR UPDATE",
        [claim.id],
      )
    ).rows[0];
    if (
      !row ||
      !job ||
      job.request_id !== row.id ||
      job.status !== "claimed" ||
      job.claim_token !== claim.claimToken ||
      !job.live
    )
      throw conflict(
        "The processing claim expired or was replaced.",
        "STALE_CLAIM",
      );
    // Unknown never requeues and never releases the hold, regardless of participant status.
    const status = {
      provider_disabled: "blocked",
      retry: "ready",
      unknown: "reconciliation",
    }[outcome];
    await tx.query(
      "UPDATE ss_v1.exchange_jobs SET status=$2,claim_token=NULL,lease_until=NULL,last_error=$3,available_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",
      [job.id, status, outcome],
    );
    if (outcome === "unknown") {
      await tx.query(
        "UPDATE ss_v1.transaction_legs SET status='unknown' WHERE request_id=$1 AND leg_type='origin_in'",
        [row.id],
      );
      await tx.query(
        "UPDATE ss_v1.transfer_requests SET status='needs_attention',version=version+1 WHERE id=$1",
        [row.id],
      );
    }
    await history(
      tx,
      row.id,
      null,
      `job_${status}`,
      outcome === "unknown"
        ? "Unknown outcome; retain reservation pending reconciliation."
        : "Preparation only; provider execution disabled.",
    );
    return { status, providerExecutionEnabled: false };
  });
}
