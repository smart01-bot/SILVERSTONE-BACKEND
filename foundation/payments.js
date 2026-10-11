import { randomUUID, createHash } from "node:crypto";
import express from "express";
import { ApiError } from "./errors.js";
import { operationGate } from "./operations.js";
import { configuredProvider, paymentProviders } from "./payment-providers.js";

const unavailable = () =>
  new ApiError(
    503,
    "PAYMENT_PROVIDER_UNAVAILABLE",
    "Payment connection is not configured. Your request remains available for review.",
  );
const conflict = (code, message) => new ApiError(409, code, message);
export const realPayment = (row) => row.account_snapshot?.mode === "payment";
export async function paymentSchema(db) {
  if (
    !(await db.query("SELECT to_regclass('ss_v1.payment_tasks') AS ready"))
      .rows[0].ready
  )
    throw new ApiError(
      503,
      "PAYMENT_SETUP_REQUIRED",
      "Transaction setup is being updated. Your saved request can be retried.",
    );
}
const event = (tx, task, name, details = {}) =>
  tx.query(
    "INSERT INTO ss_v1.payment_events(task_id,event,details) VALUES($1,$2,$3)",
    [task, name, JSON.stringify(details)],
  );
const history = (tx, id, name) =>
  tx.query(
    "INSERT INTO ss_v1.exchange_history(request_id,event,reason) VALUES($1,$2,$3)",
    [id, name, name.replaceAll("_", " ")],
  );
const setStatus = (tx, id, status) =>
  tx.query(
    "UPDATE ss_v1.transfer_requests SET status=$2,version=version+1 WHERE id=$1",
    [id, status],
  );

export async function paymentDetail(tx, row) {
  const hold = (
    await tx.query(
      "SELECT status,amount_tzs FROM ss_v1.payment_holds WHERE request_id=$1",
      [row.id],
    )
  ).rows[0];
  const tasks = (
    await tx.query(
      "SELECT kind,status,last_code FROM ss_v1.payment_tasks WHERE request_id=$1 ORDER BY kind",
      [row.id],
    )
  ).rows;
  const messages = {
    awaiting_review:
      "Awaiting main-agent review. Payment connection and funding are required before approval.",
    awaiting_source:
      "Awaiting approval and confirmation on the originating wallet.",
    payout_pending: "Collection confirmed. Destination payout is processing.",
    completed: "Collection and destination payout confirmed.",
    needs_attention:
      "Payment outcome requires reconciliation. Do not submit another payment.",
    cancelled: "Request cancelled before payment.",
    rejected: "Request rejected before payment.",
    expired: "Collection did not complete. No payout was initiated.",
  };
  return {
    nextAction: messages[row.status] || "Review transaction status.",
    reservation: hold
      ? { status: hold.status, amountTzs: String(hold.amount_tzs) }
      : null,
    payment: { mode: "real", tasks, connectionRequired: tasks.length === 0 },
    provider: { executionEnabled: tasks.length > 0, chargesKnown: false },
    providerEvidence: [],
    providerExecutionEnabled: tasks.length > 0,
  };
}

// Called inside the existing authorized, versioned approval transaction.
export async function reservePayment(tx, row, providers = paymentProviders) {
  await paymentSchema(tx);
  const { source, destination } = row.account_snapshot;
  const accounts = (
    await tx.query(
      "SELECT verification_status FROM ss_v1.network_accounts WHERE id IN ($1,$2) FOR SHARE",
      [row.source_account_id, row.destination_account_id],
    )
  ).rows;
  if (
    accounts.length !== 2 ||
    accounts.some(
      (a) => !["unverified", "verified"].includes(a.verification_status),
    )
  )
    throw conflict(
      "ACCOUNT_UNAVAILABLE",
      "An endpoint is no longer available. Create a request with current account details.",
    );
  const routes = (
    await tx.query(
      `SELECT p.*, f.provider,f.scope,f.main_agent_id FROM ss_v1.payment_routes p
    JOIN ss_v1.payment_funding f ON f.id=p.funding_id WHERE f.main_agent_id=$1 AND f.enabled AND p.enabled
    AND p.source_network=$2 AND p.destination_network=$3 AND p.source_type=$4 AND p.destination_type=$5
    ORDER BY p.id FOR SHARE OF p`,
      [
        row.main_agent_id,
        source.networkCode,
        destination.networkCode,
        source.identifierType,
        destination.identifierType,
      ],
    )
  ).rows;
  if (routes.length !== 1) throw unavailable();
  const route = routes[0],
    adapter = configuredProvider(providers, route.provider);
  if (
    !adapter ||
    adapter.supports({
      source,
      destination,
      currency: "TZS",
      scope: route.scope,
    }) !== true
  )
    throw unavailable();
  const amount = BigInt(row.amount_tzs),
    reserve = amount + BigInt(route.max_fee_tzs);
  if (reserve > 9223372036854775807n)
    throw conflict("AMOUNT_LIMIT", "Amount exceeds the supported limit.");
  const held = await tx.query(
    `UPDATE ss_v1.payment_funding SET held_tzs=held_tzs+$2
    WHERE id=$1 AND enabled AND verified_at>clock_timestamp()-interval '5 minutes'
    AND balance_tzs-held_tzs >= $2 RETURNING id`,
    [route.funding_id, String(reserve)],
  );
  if (!held.rows.length)
    throw conflict(
      "FUNDING_UNAVAILABLE",
      "Verified agency funding is unavailable or insufficient. No collection was started.",
    );
  await tx.query(
    "INSERT INTO ss_v1.payment_holds(request_id,funding_id,amount_tzs,status) VALUES($1,$2,$3,'held')",
    [row.id, route.funding_id, String(reserve)],
  );
  const terms = {
    source,
    destination,
    amountTzs: String(amount),
    currency: "TZS",
    maxFeeTzs: String(route.max_fee_tzs),
  };
  await tx.query(
    `INSERT INTO ss_v1.payment_tasks(id,request_id,kind,provider,scope,terms) VALUES($1,$2,'collect',$3,$4,$5)`,
    [randomUUID(), row.id, route.provider, route.scope, JSON.stringify(terms)],
  );
}
export async function closePayment(tx, row) {
  if (!["awaiting_review", "awaiting_source"].includes(row.status))
    throw conflict(
      "PAYMENT_IN_PROGRESS",
      "Payment outcome must be resolved before closing.",
    );
  const tasks = (
    await tx.query(
      "SELECT * FROM ss_v1.payment_tasks WHERE request_id=$1 FOR UPDATE",
      [row.id],
    )
  ).rows;
  if (tasks.some((t) => t.dispatched_at || t.claim_token))
    throw conflict(
      "PAYMENT_IN_PROGRESS",
      "Payment may already be in progress. Its funding remains reserved.",
    );
  if (tasks.length) await release(tx, row.id, false);
  await tx.query(
    "UPDATE ss_v1.payment_tasks SET status='cancelled' WHERE request_id=$1",
    [row.id],
  );
}
async function release(tx, requestId, consumed) {
  const h = (
    await tx.query(
      "UPDATE ss_v1.payment_holds SET status=$2 WHERE request_id=$1 AND status='held' RETURNING *",
      [requestId, consumed ? "consumed" : "released"],
    )
  ).rows[0];
  if (!h)
    throw conflict(
      "RESERVATION_MISSING",
      "Payment reservation requires reconciliation.",
    );
  // Consume the entire fee ceiling conservatively. Only a verified balance refresh recovers the unused part.
  await tx.query(
    "UPDATE ss_v1.payment_funding SET held_tzs=held_tzs-$2,balance_tzs=balance_tzs-$3 WHERE id=$1",
    [h.funding_id, String(h.amount_tzs), consumed ? String(h.amount_tzs) : "0"],
  );
}

// Funding is server provisioned, scoped to the agency and refreshed only via authenticated provider balance.
export async function refreshFunding(db, id, providers = paymentProviders) {
  return db.transaction(async (tx) => {
    const f = (
      await tx.query(
        "SELECT * FROM ss_v1.payment_funding WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    const adapter = f && configuredProvider(providers, f.provider);
    if (!adapter) throw unavailable();
    if (BigInt(f.held_tzs) !== 0n)
      throw conflict(
        "FUNDING_BUSY",
        "Resolve held payments before refreshing funding.",
      );
    const balance = await adapter.balance({
      scope: f.scope,
      currency: "TZS",
      signal: AbortSignal.timeout(15000),
    });
    if (
      balance?.scope !== f.scope ||
      balance.currency !== "TZS" ||
      !/^\d{1,18}$/.test(balance.availableTzs) ||
      balance.verified !== true
    )
      throw conflict(
        "BALANCE_UNVERIFIED",
        "Provider balance could not be verified.",
      );
    await tx.query(
      "UPDATE ss_v1.payment_funding SET balance_tzs=$2,verified_at=clock_timestamp() WHERE id=$1",
      [id, balance.availableTzs],
    );
  });
}
async function participantsReady(tx, row) {
  const agents = (
    await tx.query(
      "SELECT * FROM ss_v1.agents WHERE id IN ($1,$2) ORDER BY id FOR SHARE",
      [row.sub_agent_id, row.main_agent_id],
    )
  ).rows;
  const assignment = (
    await tx.query(
      "SELECT main_agent_id FROM ss_v1.main_agent_assignments WHERE sub_agent_id=$1 FOR SHARE",
      [row.sub_agent_id],
    )
  ).rows[0];
  return (
    agents.length === 2 &&
    agents.every(
      (a) =>
        a.account_status === "active" && a.application_status === "approved",
    ) &&
    assignment?.main_agent_id === row.main_agent_id
  );
}
export async function claimPayment(db, providers = paymentProviders) {
  return db.transaction(async (tx) => {
    const candidate = (
      await tx.query(`SELECT r.* FROM ss_v1.transfer_requests r JOIN ss_v1.payment_tasks t ON t.request_id=r.id
      WHERE (t.status IN ('ready','pending') OR t.verification_due) AND t.next_at<=clock_timestamp()
      AND (t.lease_until IS NULL OR t.lease_until<clock_timestamp()) ORDER BY t.next_at,t.id LIMIT 1`)
    ).rows[0];
    if (!candidate) return null;
    const ready = await participantsReady(tx, candidate);
    const r = (
      await tx.query(
        "SELECT * FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE SKIP LOCKED",
        [candidate.id],
      )
    ).rows[0];
    if (!r) return null;
    const task = (
      await tx.query(
        `SELECT * FROM ss_v1.payment_tasks WHERE request_id=$1
      AND (status IN ('ready','pending') OR verification_due) AND next_at<=clock_timestamp()
      AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY next_at,id LIMIT 1 FOR UPDATE`,
        [r.id],
      )
    ).rows[0];
    if (!task) return null;
    const adapter = configuredProvider(providers, task.provider);
    if (!adapter) {
      await tx.query(
        "UPDATE ss_v1.payment_tasks SET next_at=clock_timestamp()+interval '60 seconds',last_code='PROVIDER_UNAVAILABLE' WHERE id=$1",
        [task.id],
      );
      return null;
    }
    const lookupOnly = !!task.dispatched_at;
    if (!lookupOnly) {
      const accounts = (
        await tx.query(
          "SELECT verification_status FROM ss_v1.network_accounts WHERE id IN ($1,$2) FOR SHARE",
          [r.source_account_id, r.destination_account_id],
        )
      ).rows;
      let allowed =
        ready &&
        accounts.length === 2 &&
        accounts.every((a) =>
          ["unverified", "verified"].includes(a.verification_status),
        );
      try {
        await operationGate(tx, r.main_agent_id, "preparation");
      } catch (e) {
        if (e.code !== "OPERATIONS_PAUSED") throw e;
        allowed = false;
      }
      const funding = (
        await tx.query(
          `SELECT f.enabled,h.status FROM ss_v1.payment_holds h JOIN ss_v1.payment_funding f ON f.id=h.funding_id WHERE h.request_id=$1`,
          [r.id],
        )
      ).rows[0];
      allowed =
        allowed &&
        funding?.enabled &&
        funding.status === "held" &&
        adapter.supports({ ...task.terms, scope: task.scope }) === true;
      if (task.kind === "payout")
        allowed =
          allowed &&
          (
            await tx.query(
              "SELECT 1 FROM ss_v1.payment_tasks WHERE request_id=$1 AND kind='collect' AND status='confirmed'",
              [r.id],
            )
          ).rows.length === 1;
      if (!allowed) {
        await tx.query(
          "UPDATE ss_v1.payment_tasks SET next_at=clock_timestamp()+interval '60 seconds',last_code='EXECUTION_PAUSED' WHERE id=$1",
          [task.id],
        );
        return null;
      }
    }
    const token = randomUUID();
    await tx.query(
      `UPDATE ss_v1.payment_tasks SET claim_token=$2,lease_until=clock_timestamp()+interval '45 seconds',
      dispatched_at=coalesce(dispatched_at,clock_timestamp()),checks=checks+1,verification_due=false WHERE id=$1`,
      [task.id, token],
    );
    await event(
      tx,
      task.id,
      lookupOnly ? "lookup_claimed" : "dispatch_committed",
    );
    return { ...task, claim_token: token, lookupOnly };
  });
}
const matches = (result, task) => {
  const t = task.terms,
    endpoint = task.kind === "collect" ? t.source : t.destination;
  return (
    result?.verified === true &&
    result.reference === task.id &&
    result.scope === task.scope &&
    result.currency === t.currency &&
    result.amountTzs === t.amountTzs &&
    result.kind === task.kind &&
    result.endpoint?.networkCode === endpoint.networkCode &&
    result.endpoint?.identifierType === endpoint.identifierType &&
    result.endpoint?.identifier === endpoint.identifier &&
    typeof result.providerReference === "string" &&
    result.providerReference.length > 0 &&
    result.providerReference.length <= 200 &&
    (!task.provider_reference ||
      task.provider_reference === result.providerReference) &&
    typeof result.feeTzs === "string" &&
    /^\d{1,18}$/.test(result.feeTzs) &&
    BigInt(result.feeTzs) <= BigInt(t.maxFeeTzs)
  );
};
export async function finishPayment(db, claim, result) {
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT id FROM ss_v1.transfer_requests WHERE id=$1 FOR UPDATE",
      [claim.request_id],
    );
    const task = (
      await tx.query(
        "SELECT *,lease_until>clock_timestamp() AS lease_valid FROM ss_v1.payment_tasks WHERE id=$1 FOR UPDATE",
        [claim.id],
      )
    ).rows[0];
    if (!task || task.claim_token !== claim.claim_token || !task.lease_valid)
      return false;
    let status = "pending",
      code = "AWAITING_VERIFICATION";
    // Only authenticated status lookup may settle. A submission response/callback alone never settles money.
    if (claim.lookupOnly) {
      if (!matches(result, task)) {
        status = "attention";
        code = "UNVERIFIED_OUTCOME";
      } else if (["confirmed", "failed"].includes(result.status)) {
        status = result.status;
        code = null;
      } else if (result.status !== "pending") {
        status = "attention";
        code = "UNKNOWN_OUTCOME";
      }
      if (result?.transportError) {
        status = task.checks < 120 ? "pending" : "attention";
        code = "STATUS_UNAVAILABLE";
      }
    }
    if (task.checks >= 120 && status === "pending") {
      status = "attention";
      code = "RECONCILIATION_REQUIRED";
    }
    const terminal = ["confirmed", "failed", "attention"].includes(task.status);
    if (terminal) {
      // A late contradictory callback/status never repeats accounting or sends a second payout.
      if (status !== task.status) {
        await setStatus(tx, task.request_id, "needs_attention");
        await history(tx, task.request_id, "late_provider_discrepancy");
        status = "attention";
        code = "LATE_DISCREPANCY";
      }
    }
    if (status === "confirmed" && task.kind === "payout" && !terminal) {
      const collection = (
        await tx.query(
          "SELECT status FROM ss_v1.payment_tasks WHERE request_id=$1 AND kind='collect'",
          [task.request_id],
        )
      ).rows[0];
      if (collection?.status !== "confirmed") {
        status = "attention";
        code = "COLLECTION_NOT_CONFIRMED";
      }
    }
    await tx.query(
      `UPDATE ss_v1.payment_tasks SET status=$2,last_code=$3,claim_token=NULL,lease_until=NULL,
      next_at=clock_timestamp()+interval '15 seconds',provider_reference=coalesce(provider_reference,$4) WHERE id=$1`,
      [
        task.id,
        status,
        code,
        matches(result, task) ? result.providerReference : null,
      ],
    );
    await event(tx, task.id, "provider_observation", {
      status,
      code,
      providerReference: matches(result, task)
        ? result.providerReference
        : null,
    });
    if (terminal) return true;
    const leg = task.kind === "collect" ? "origin_in" : "destination_out";
    await tx.query(
      "UPDATE ss_v1.transaction_legs SET status=$3 WHERE request_id=$1 AND leg_type=$2",
      [
        task.request_id,
        leg,
        {
          pending: "submitted",
          attention: "unknown",
          confirmed: "confirmed",
          failed: "failed",
        }[status],
      ],
    );
    if (status === "confirmed" && task.kind === "collect") {
      await tx.query(
        `INSERT INTO ss_v1.payment_tasks(id,request_id,kind,provider,scope,terms)
        VALUES($1,$2,'payout',$3,$4,$5) ON CONFLICT(request_id,kind) DO NOTHING`,
        [
          randomUUID(),
          task.request_id,
          task.provider,
          task.scope,
          JSON.stringify({
            ...task.terms,
            maxFeeTzs: String(
              BigInt(task.terms.maxFeeTzs) - BigInt(result.feeTzs),
            ),
          }),
        ],
      );
      await setStatus(tx, task.request_id, "payout_pending");
      await history(tx, task.request_id, "collection_confirmed");
    } else if (status === "confirmed") {
      await release(tx, task.request_id, true);
      await setStatus(tx, task.request_id, "completed");
      await history(tx, task.request_id, "payout_confirmed");
    } else if (
      status === "failed" &&
      task.kind === "collect" &&
      result.feeTzs === "0"
    ) {
      await release(tx, task.request_id, false);
      await setStatus(tx, task.request_id, "expired");
      await history(tx, task.request_id, "collection_failed");
    } else if (["failed", "attention"].includes(status)) {
      await setStatus(tx, task.request_id, "needs_attention");
      await history(tx, task.request_id, "payment_reconciliation_required");
    }
    return true;
  });
}
export async function runPaymentOnce(db, providers = paymentProviders) {
  const claim = await claimPayment(db, providers);
  if (!claim) return false;
  const adapter = configuredProvider(providers, claim.provider);
  let result;
  try {
    result = await adapter[claim.lookupOnly ? "lookup" : claim.kind]({
      ...claim.terms,
      kind: claim.kind,
      scope: claim.scope,
      reference: claim.id,
      idempotencyKey: claim.id,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    result = { transportError: true };
  }
  await finishPayment(db, claim, result);
  return true;
}
export function mountPaymentWebhooks(app, db, providers = paymentProviders) {
  app.post(
    "/api/v1/payment-events/:provider",
    express.raw({ type: "*/*", limit: "32kb" }),
    async (req, res) => {
      const adapter = configuredProvider(providers, req.params.provider);
      if (!adapter) throw unavailable();
      if (!Buffer.isBuffer(req.body))
        throw new ApiError(400, "RAW_BODY_REQUIRED", "Invalid callback body.");
      let proof;
      try {
        proof = await adapter.verifyWebhook({
          rawBody: req.body,
          headers: req.headers,
        });
      } catch {
        /* fail closed */
      }
      if (
        proof?.verified !== true ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(proof.eventId || "") ||
        typeof proof.scope !== "string" ||
        !/^[0-9a-f-]{36}$/.test(proof.reference || "")
      )
        throw new ApiError(
          401,
          "CALLBACK_UNVERIFIED",
          "Callback could not be verified.",
        );
      const hash = createHash("sha256").update(req.body).digest("hex");
      await db.transaction(async (tx) => {
        const task = (
          await tx.query(
            "SELECT * FROM ss_v1.payment_tasks WHERE id=$1 AND provider=$2 AND scope=$3",
            [proof.reference, req.params.provider, proof.scope],
          )
        ).rows[0];
        if (!task || !task.dispatched_at)
          throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
        const inserted = await tx.query(
          `INSERT INTO ss_v1.payment_webhooks(provider,scope,event_id,task_id,payload_hash)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id`,
          [task.provider, task.scope, proof.eventId, task.id, hash],
        );
        const existing = (
          await tx.query(
            "SELECT payload_hash,task_id FROM ss_v1.payment_webhooks WHERE provider=$1 AND scope=$2 AND event_id=$3",
            [task.provider, task.scope, proof.eventId],
          )
        ).rows[0];
        if (existing.payload_hash !== hash || existing.task_id !== task.id)
          throw conflict("CALLBACK_CONFLICT", "Callback identity conflict.");
        if (inserted.rows.length) {
          await tx.query(
            "UPDATE ss_v1.payment_tasks SET verification_due=true,next_at=clock_timestamp() WHERE id=$1",
            [task.id],
          );
          await event(tx, task.id, "verified_callback_received");
        }
      });
      res.status(202).json({ data: { received: true } });
    },
  );
}
