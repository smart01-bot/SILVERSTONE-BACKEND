import { randomUUID } from "node:crypto";
import { active } from "./auth.js";
import { ApiError, allowFields, invalid, uuid } from "./errors.js";

const missing = () =>
  new ApiError(404, "NOT_FOUND", "Operational resource not found.");
const conflict = () =>
  new ApiError(
    409,
    "OPERATIONS_CHANGED",
    "Refresh the operational record before acting.",
  );
const ready = (a) =>
  a?.role === "main-agent" &&
  a.account_status === "active" &&
  a.application_status === "approved";
const iso = (value) => (value ? new Date(value).toISOString() : null);
const unresolved = `r.status='needs_attention' OR EXISTS(SELECT 1 FROM ss_v1.transaction_legs l WHERE l.request_id=r.id AND l.status='unknown') OR EXISTS(SELECT 1 FROM ss_v1.provider_evidence_state p JOIN ss_v1.provider_attempts a ON a.id=p.attempt_id WHERE a.request_id=r.id AND p.reconciliation_required)`;
// Stored responsibility is separate from currently usable authority.
const eligibleOwner = (field) =>
  `EXISTS(SELECT 1 FROM ss_v1.agents o WHERE o.id=${field} AND o.role='main-agent' AND o.account_status='active' AND o.application_status='approved' AND EXISTS(SELECT 1 FROM ss_v1.operations_grants g WHERE g.actor_id=o.id AND g.main_agent_id=r.main_agent_id AND g.capability='cases.own' AND g.revoked_at IS NULL) AND EXISTS(SELECT 1 FROM ss_v1.operations_grants g WHERE g.actor_id=o.id AND g.main_agent_id=r.main_agent_id AND g.capability='cases.read' AND g.revoked_at IS NULL))`;
function reason(value) {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.length > 1000
  )
    throw invalid("Enter a reason of 3–1000 characters.");
  return value.trim();
}
function version(value) {
  if (!Number.isInteger(value) || value < 0)
    throw invalid("A current version is required.");
}
async function authorize(tx, actor, scope, capability) {
  if (!uuid(scope)) throw invalid("Invalid main-agent scope.");
  // Lock current identity/scope then grant. Revocation and suspension never rely on JWT roles.
  const agents = (
    await tx.query(
      "SELECT * FROM ss_v1.agents WHERE id IN ($1,$2) ORDER BY id FOR SHARE",
      [actor, scope],
    )
  ).rows;
  if (
    !ready(agents.find((a) => a.id === actor)) ||
    agents.find((a) => a.id === scope)?.role !== "main-agent"
  )
    throw missing();
  const grant = (
    await tx.query(
      "SELECT 1 FROM ss_v1.operations_grants WHERE actor_id=$1 AND main_agent_id=$2 AND capability=$3 AND revoked_at IS NULL FOR SHARE",
      [actor, scope, capability],
    )
  ).rows;
  if (!grant.length) throw missing();
}
async function scopedRequest(tx, scope, id) {
  if (!uuid(id)) throw invalid("Invalid request ID.");
  const row = (
    await tx.query(
      "SELECT * FROM ss_v1.transfer_requests WHERE id=$1 AND main_agent_id=$2 FOR UPDATE",
      [id, scope],
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
async function audit(tx, scope, requestId, actor, event, why, details = {}) {
  await tx.query(
    "INSERT INTO ss_v1.operations_events(main_agent_id,request_id,actor_id,event,reason,details) VALUES($1,$2,$3,$4,$5,$6)",
    [scope, requestId, actor, event, why, JSON.stringify(details)],
  );
}
const controlsDTO = (row, scope) => ({
  mainAgentId: scope,
  requestsPaused: row?.requests_paused ?? false,
  acceptancePaused: row?.acceptance_paused ?? false,
  preparationPaused: row?.preparation_paused ?? false,
  version: row?.version ?? 0,
  reason: row?.reason ?? null,
  changedAt: iso(row?.changed_at),
  providerExecutionEnabled: false,
});

// Exchange participants already hold the scope's agent lock. The shared control lock
// also fences preparation claims; cancellation and evidence intake never use this gate.
export async function operationGate(tx, scope, action) {
  await tx.query(
    "INSERT INTO ss_v1.operations_controls(main_agent_id) VALUES($1) ON CONFLICT DO NOTHING",
    [scope],
  );
  const row = (
    await tx.query(
      "SELECT * FROM ss_v1.operations_controls WHERE main_agent_id=$1 FOR SHARE",
      [scope],
    )
  ).rows[0];
  if (row[`${action}_paused`])
    throw new ApiError(
      423,
      "OPERATIONS_PAUSED",
      "This operation is paused. Existing records and reservations are retained.",
    );
}
export function mountOperations(app, db) {
  app.get("/api/v1/operations/scopes", active, async (req, res) => {
    if (req.agent.role !== "main-agent") throw missing();
    const rows = (
      await db.query(
        "SELECT main_agent_id,capability FROM ss_v1.operations_grants WHERE actor_id=$1 AND revoked_at IS NULL ORDER BY main_agent_id,capability",
        [req.agent.id],
      )
    ).rows;
    const scopes = new Map();
    for (const row of rows) {
      if (!scopes.has(row.main_agent_id))
        scopes.set(row.main_agent_id, {
          mainAgentId: row.main_agent_id,
          capabilities: [],
        });
      scopes.get(row.main_agent_id).capabilities.push(row.capability);
    }
    res.json({ data: [...scopes.values()] });
  });
  const base = "/api/v1/operations/scopes/:scopeId";
  const run = (capability, fn) => async (req, res) => {
    const result = await db.transaction(async (tx) => {
      await authorize(tx, req.agent.id, req.params.scopeId, capability);
      return fn(tx, req);
    });
    res.json(result);
  };
  app.get(
    base + "/cases",
    active,
    run("cases.read", async (tx, req) => {
      const limit =
          req.query.limit === undefined ? 50 : Number(req.query.limit),
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
        await tx.query(
          `SELECT r.*,c.owner_id,c.backup_id,c.due_at,c.version AS case_version, ${eligibleOwner("c.owner_id")} AS owner_available, ${eligibleOwner("c.backup_id")} AS backup_available FROM ss_v1.transfer_requests r LEFT JOIN ss_v1.exception_cases c ON c.request_id=r.id WHERE r.main_agent_id=$1 AND r.queue_sequence>$2 AND (${unresolved}) ORDER BY r.queue_sequence LIMIT $3`,
          [req.params.scopeId, cursor, limit + 1],
        )
      ).rows;
      const data = rows.slice(0, limit).map((r) => ({
        requestId: r.id,
        supportReference: r.id,
        mainAgentId: r.main_agent_id,
        amountTzs: String(r.amount_tzs),
        currency: r.currency,
        status: r.status,
        createdAt: iso(r.created_at),
        ownerId: r.owner_id ?? null,
        backupId: r.backup_id ?? null,
        ownerAvailable: r.owner_available,
        backupAvailable: r.backup_available,
        dueAt: iso(r.due_at),
        escalationDue: !!r.due_at && new Date(r.due_at) <= new Date(),
        version: r.case_version ?? 0,
        financialResolutionAvailable: false,
      }));
      return {
        data,
        page: {
          nextCursor:
            rows.length > limit ? String(rows[limit - 1].queue_sequence) : null,
        },
      };
    }),
  );
  app.get(
    base + "/diagnostics",
    active,
    run("cases.read", async (tx, req) => {
      const row = (
        await tx.query(
          `SELECT count(*)::int AS unresolved_count, count(*) FILTER(WHERE NOT (${eligibleOwner("c.owner_id")}))::int AS unassigned_count, count(*) FILTER(WHERE c.due_at<=clock_timestamp())::int AS escalation_due_count, min(r.created_at) AS oldest_created_at FROM ss_v1.transfer_requests r LEFT JOIN ss_v1.exception_cases c ON c.request_id=r.id WHERE r.main_agent_id=$1 AND (${unresolved})`,
          [req.params.scopeId],
        )
      ).rows[0];
      const held = (
        await tx.query(
          "SELECT coalesce(sum(h.amount_tzs),0)::text AS amount FROM ss_v1.exchange_reservations h JOIN ss_v1.transfer_requests r ON r.id=h.request_id WHERE r.main_agent_id=$1 AND h.status='held'",
          [req.params.scopeId],
        )
      ).rows[0].amount;
      const expired = (
        await tx.query(
          "SELECT count(*)::int n FROM ss_v1.exchange_jobs j JOIN ss_v1.transfer_requests r ON r.id=j.request_id WHERE r.main_agent_id=$1 AND j.status='claimed' AND j.lease_until<=clock_timestamp()",
          [req.params.scopeId],
        )
      ).rows[0].n;
      return {
        data: {
          unresolvedCount: row.unresolved_count,
          unassignedCount: row.unassigned_count,
          escalationDueCount: row.escalation_due_count,
          oldestRequestCreatedAt: iso(row.oldest_created_at),
          reservedCapacityTzs: held,
          expiredPreparationClaims: expired,
          providerExecutionEnabled: false,
          realAlertsConfigured: false,
          financialLedgerAvailable: false,
        },
      };
    }),
  );
  app.get(
    base + "/owners",
    active,
    run("cases.manage", async (tx, req) => ({
      data: (
        await tx.query(
          "SELECT a.id,a.name FROM ss_v1.operations_grants g JOIN ss_v1.agents a ON a.id=g.actor_id WHERE g.main_agent_id=$1 AND g.capability='cases.own' AND g.revoked_at IS NULL AND a.role='main-agent' AND a.account_status='active' AND a.application_status='approved' AND EXISTS(SELECT 1 FROM ss_v1.operations_grants v WHERE v.actor_id=a.id AND v.main_agent_id=g.main_agent_id AND v.capability='cases.read' AND v.revoked_at IS NULL) ORDER BY a.id",
          [req.params.scopeId],
        )
      ).rows,
    })),
  );
  app.post(
    base + "/cases/:id/assign",
    active,
    run("cases.manage", async (tx, req) => {
      allowFields(req.body, [
        "expectedVersion",
        "ownerId",
        "backupId",
        "dueAt",
        "reason",
      ]);
      const { expectedVersion, ownerId, backupId, dueAt = null } = req.body;
      version(expectedVersion);
      const why = reason(req.body.reason);
      if (!uuid(ownerId) || !uuid(backupId) || ownerId === backupId)
        throw invalid("Choose distinct eligible owner and backup.");
      if (
        dueAt !== null &&
        (typeof dueAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(dueAt) ||
          !Number.isFinite(Date.parse(dueAt)) ||
          new Date(dueAt) <= new Date())
      )
        throw invalid("Choose a future UTC deadline or leave it unconfigured.");
      const r = await scopedRequest(tx, req.params.scopeId, req.params.id);
      if (
        !(
          await tx.query(
            `SELECT 1 FROM ss_v1.transfer_requests r WHERE r.id=$1 AND (${unresolved})`,
            [r.id],
          )
        ).rows.length
      )
        throw conflict();
      const current = (
        await tx.query(
          "SELECT * FROM ss_v1.exception_cases WHERE request_id=$1 FOR UPDATE",
          [r.id],
        )
      ).rows[0];
      if ((current?.version ?? 0) !== expectedVersion) throw conflict();
      for (const id of [ownerId, backupId].sort()) {
        await authorize(tx, id, r.main_agent_id, "cases.own");
        await authorize(tx, id, r.main_agent_id, "cases.read");
      }
      await tx.query(
        "INSERT INTO ss_v1.exception_cases(request_id,owner_id,backup_id,due_at,version) VALUES($1,$2,$3,$4,1) ON CONFLICT(request_id) DO UPDATE SET owner_id=$2,backup_id=$3,due_at=$4,version=ss_v1.exception_cases.version+1,updated_at=now()",
        [r.id, ownerId, backupId, dueAt],
      );
      await audit(
        tx,
        r.main_agent_id,
        r.id,
        req.agent.id,
        "case_assigned",
        why,
        {
          ownerId,
          backupId,
          dueAt,
          previousOwnerId: current?.owner_id ?? null,
          version: expectedVersion + 1,
        },
      );
      return {
        data: {
          requestId: r.id,
          ownerId,
          backupId,
          dueAt,
          version: expectedVersion + 1,
          financialResolutionAvailable: false,
        },
      };
    }),
  );
  app.get(
    base + "/controls",
    active,
    run("cases.read", async (tx, req) => ({
      data: controlsDTO(
        (
          await tx.query(
            "SELECT * FROM ss_v1.operations_controls WHERE main_agent_id=$1",
            [req.params.scopeId],
          )
        ).rows[0],
        req.params.scopeId,
      ),
    })),
  );
  app.post(
    base + "/controls",
    active,
    run("pause.manage", async (tx, req) => {
      allowFields(req.body, [
        "expectedVersion",
        "requestsPaused",
        "acceptancePaused",
        "preparationPaused",
        "reason",
      ]);
      version(req.body.expectedVersion);
      const why = reason(req.body.reason);
      for (const field of [
        "requestsPaused",
        "acceptancePaused",
        "preparationPaused",
      ])
        if (typeof req.body[field] !== "boolean")
          throw invalid("Provide all pause flags as booleans.");
      await tx.query(
        "INSERT INTO ss_v1.operations_controls(main_agent_id) VALUES($1) ON CONFLICT DO NOTHING",
        [req.params.scopeId],
      );
      const r = (
        await tx.query(
          "SELECT * FROM ss_v1.operations_controls WHERE main_agent_id=$1 FOR UPDATE",
          [req.params.scopeId],
        )
      ).rows[0];
      if (r.version !== req.body.expectedVersion) throw conflict();
      const row = (
        await tx.query(
          "UPDATE ss_v1.operations_controls SET requests_paused=$2,acceptance_paused=$3,preparation_paused=$4,version=version+1,reason=$5,changed_by=$6,changed_at=now() WHERE main_agent_id=$1 RETURNING *",
          [
            r.main_agent_id,
            req.body.requestsPaused,
            req.body.acceptancePaused,
            req.body.preparationPaused,
            why,
            req.agent.id,
          ],
        )
      ).rows[0];
      await audit(
        tx,
        r.main_agent_id,
        null,
        req.agent.id,
        "scope_controls_changed",
        why,
        {
          requestsPaused: row.requests_paused,
          acceptancePaused: row.acceptance_paused,
          preparationPaused: row.preparation_paused,
          version: row.version,
        },
      );
      return { data: controlsDTO(row, r.main_agent_id) };
    }),
  );
  app.get(
    base + "/cases/:id/evidence",
    active,
    run("cases.read", async (tx, req) => {
      const r = await scopedRequest(tx, req.params.scopeId, req.params.id);
      const legs = (
        await tx.query(
          "SELECT id,leg_type,status FROM ss_v1.transaction_legs WHERE request_id=$1 ORDER BY leg_type",
          [r.id],
        )
      ).rows;
      const observations = (
        await tx.query(
          "SELECT * FROM ss_v1.reconciliation_observations WHERE request_id=$1 ORDER BY created_at,id",
          [r.id],
        )
      ).rows;
      const reservation = (
        await tx.query(
          "SELECT status,amount_tzs FROM ss_v1.exchange_reservations WHERE request_id=$1",
          [r.id],
        )
      ).rows[0];
      return {
        data: {
          requestId: r.id,
          amountTzs: String(r.amount_tzs),
          currency: r.currency,
          accounts: r.account_snapshot,
          legs: legs.map((l) => ({
            id: l.id,
            type: l.leg_type,
            status: l.status,
          })),
          reservation: reservation
            ? {
                status: reservation.status,
                amountTzs: String(reservation.amount_tzs),
              }
            : null,
          observations: observations.map((o) => ({
            id: o.id,
            legId: o.leg_id,
            source: o.source,
            reference: o.reference,
            amountTzs: String(o.amount_tzs),
            currency: o.currency,
            fromAccountId: o.from_account_id,
            toAccountId: o.to_account_id,
            matchesTerms: o.matches_terms,
            observedAt: iso(o.observed_at),
            recordedBy: o.actor_id,
            verification: "unverified",
          })),
          actualSettlementVerified: false,
          financialResolutionAvailable: false,
        },
      };
    }),
  );
  app.post(
    base + "/cases/:id/evidence",
    active,
    run("evidence.record", async (tx, req) => {
      allowFields(req.body, [
        "legId",
        "source",
        "reference",
        "amountTzs",
        "currency",
        "fromAccountId",
        "toAccountId",
        "observedAt",
        "reason",
      ]);
      const b = req.body,
        why = reason(b.reason);
      if (
        !uuid(b.legId) ||
        !["synthetic_fixture", "submitted_statement"].includes(b.source) ||
        typeof b.reference !== "string" ||
        !/^[A-Za-z0-9_.:/-]{3,128}$/.test(b.reference) ||
        typeof b.amountTzs !== "string" ||
        !/^[1-9]\d{0,18}$/.test(b.amountTzs) ||
        BigInt(b.amountTzs) > 9223372036854775807n ||
        b.currency !== "TZS" ||
        !uuid(b.fromAccountId) ||
        !uuid(b.toAccountId) ||
        typeof b.observedAt !== "string" ||
        !Number.isFinite(Date.parse(b.observedAt)) ||
        new Date(b.observedAt) > new Date()
      )
        throw invalid(
          "Provide a bounded statement reference, leg/account IDs, exact amount and past observation time.",
        );
      const r = await scopedRequest(tx, req.params.scopeId, req.params.id);
      const leg = (
        await tx.query(
          "SELECT * FROM ss_v1.transaction_legs WHERE id=$1 AND request_id=$2",
          [b.legId, r.id],
        )
      ).rows[0];
      if (!leg) throw missing();
      const previous = (
        await tx.query(
          "SELECT * FROM ss_v1.reconciliation_observations WHERE request_id=$1 AND leg_id=$2 AND source=$3 AND reference=$4",
          [r.id, b.legId, b.source, b.reference],
        )
      ).rows[0];
      if (previous) {
        if (
          String(previous.amount_tzs) !== b.amountTzs ||
          previous.currency !== b.currency ||
          previous.from_account_id !== b.fromAccountId ||
          previous.to_account_id !== b.toAccountId ||
          iso(previous.observed_at) !== new Date(b.observedAt).toISOString()
        )
          throw new ApiError(
            409,
            "EVIDENCE_CONFLICT",
            "This reference was recorded with different terms.",
          );
        return {
          data: {
            id: previous.id,
            matchesTerms: previous.matches_terms,
            verification: "unverified",
            actualSettlementVerified: false,
          },
        };
      }
      const origin = leg.leg_type === "origin_in";
      const matches =
        String(r.amount_tzs) === b.amountTzs &&
        r.currency === b.currency &&
        b.fromAccountId ===
          (origin ? r.source_account_id : r.payout_account_id) &&
        b.toAccountId ===
          (origin ? r.collection_account_id : r.destination_account_id);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO ss_v1.reconciliation_observations(id,request_id,leg_id,actor_id,source,reference,amount_tzs,currency,from_account_id,to_account_id,matches_terms,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          id,
          r.id,
          b.legId,
          req.agent.id,
          b.source,
          b.reference,
          b.amountTzs,
          b.currency,
          b.fromAccountId,
          b.toAccountId,
          matches,
          b.observedAt,
        ],
      );
      await audit(
        tx,
        r.main_agent_id,
        r.id,
        req.agent.id,
        "evidence_recorded",
        why,
        {
          observationId: id,
          matchesTerms: matches,
          verification: "unverified",
        },
      );
      return {
        data: {
          id,
          matchesTerms: matches,
          verification: "unverified",
          actualSettlementVerified: false,
        },
      };
    }),
  );
  app.get(
    base + "/audit",
    active,
    run("audit.read", async (tx, req) => {
      const cursor = req.query.cursor || "0",
        limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
      if (
        !/^\d{1,19}$/.test(cursor) ||
        BigInt(cursor) > 9223372036854775807n ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw invalid("Invalid pagination.");
      const rows = (
        await tx.query(
          "SELECT * FROM ss_v1.operations_events WHERE main_agent_id=$1 AND id>$2 ORDER BY id LIMIT $3",
          [req.params.scopeId, cursor, limit + 1],
        )
      ).rows;
      return {
        data: rows.slice(0, limit).map((e) => ({
          id: String(e.id),
          requestId: e.request_id,
          actorId: e.actor_id,
          event: e.event,
          reason: e.reason,
          details: e.details,
          createdAt: iso(e.created_at),
        })),
        page: {
          nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null,
        },
      };
    }),
  );
}
