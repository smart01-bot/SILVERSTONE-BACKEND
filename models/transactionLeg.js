import db from '../config/database.js';

// transaction_legs holds the two physical money movements per transfer request:
//   'origin_in'        — client sends funds to the main agent on the origin network
//   'destination_out'  — main agent sends funds to the client on the destination network
// UNIQUE (request_id, leg_type) means at most one row of each type per request.
//
// network_id is passed straight through as given. Resolving a network *name*
// (e.g. 'Vodacom') to its UUID happens one layer up, in models/transferRequest.js's
// resolveNetworkId() — the caller will already have the transfer_request row loaded
// (and therefore origin_network_id / destination_network_id) before it ever needs
// to touch this table, so there's no need to duplicate that lookup here.
//
// Linking a confirmed leg to a float_ledger entry (crediting/debiting the main
// agent's balance) is business logic that belongs in services/transferService.js,
// not here — this model only knows about its own table.

const createTransactionLeg = async (requestId, legType, networkId, amount, momoReference = null, receiptUrl = null) => {
  if (!['origin_in', 'destination_out'].includes(legType)) {
    return Promise.reject({ status: 400, message: `Invalid leg_type: ${legType}` });
  }
  try {
    return await db.one(
      `INSERT INTO transaction_legs (request_id, leg_type, network_id, amount, momo_reference, receipt_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [requestId, legType, networkId, amount, momoReference, receiptUrl]
    );
  } catch (err) {
    // 23505 = unique_violation — a leg of this type already exists for this request.
    // Clean 409 instead of a raw Postgres constraint error bubbling up.
    if (err.code === '23505') {
      return Promise.reject({ status: 409, message: `A '${legType}' leg already exists for request ${requestId}` });
    }
    throw err;
  }
};

const getTransactionLegById = (id) =>
  db.oneOrNone('SELECT * FROM transaction_legs WHERE id = $1', [id]);

// A request has at most 2 legs (one per leg_type) — this is the equivalent of the
// old getTransactionByRequestId(), pluralized because the new schema can have two rows.
const getTransactionLegsByRequestId = (requestId) =>
  db.manyOrNone('SELECT * FROM transaction_legs WHERE request_id = $1 ORDER BY created_at ASC', [requestId]);

// Convenience lookup for the existing-leg guard the old code did with
// getTransactionByRequestId() in transferService.js (checked before processing,
// to avoid double-creating a transaction for the same request). Returns null if
// that specific leg hasn't been created yet for this request.
const getTransactionLegByRequestAndType = (requestId, legType) =>
  db.oneOrNone(
    'SELECT * FROM transaction_legs WHERE request_id = $1 AND leg_type = $2',
    [requestId, legType]
  );

const getAllTransactionLegs = () =>
  db.manyOrNone('SELECT * FROM transaction_legs ORDER BY created_at DESC');

// Joined read for list/detail endpoints — network_id alone isn't display-ready,
// and request_id alone doesn't carry the sub-agent/main-agent identity. Same
// reasoning as getAllRequestsWithDetails() in models/transferRequest.js (file 2).
const getAllTransactionLegsWithDetails = () =>
  db.manyOrNone(`
    SELECT
      tl.*,
      n.name AS network_name,
      n.code AS network_code,
      tr.sub_agent_id,
      tr.main_agent_id,
      tr.status AS request_status
    FROM transaction_legs tl
    JOIN networks n ON n.id = tl.network_id
    JOIN transfer_requests tr ON tr.id = tl.request_id
    ORDER BY tl.created_at DESC
  `);

const getTransactionLegByIdWithDetails = (id) =>
  db.oneOrNone(`
    SELECT
      tl.*,
      n.name AS network_name,
      n.code AS network_code,
      tr.sub_agent_id,
      tr.main_agent_id,
      tr.status AS request_status
    FROM transaction_legs tl
    JOIN networks n ON n.id = tl.network_id
    JOIN transfer_requests tr ON tr.id = tl.request_id
    WHERE tl.id = $1
  `, [id]);

// Confirms a leg: records the MoMo reference / receipt and stamps confirmed_at.
// Intentionally narrower than the old updateTransaction() — under the new schema,
// amount/network shouldn't change after a leg is created (the leg IS the record
// of what physically happened), so this only ever moves a leg from "pending" to
// "confirmed," it doesn't let any field be rewritten after the fact.
const confirmTransactionLeg = (id, { momoReference = null, receiptUrl = null } = {}) => {
  const updates = ['confirmed_at = now()'];
  const values = [id];
  let index = 2;

  if (momoReference !== null) {
    updates.push(`momo_reference = $${index++}`);
    values.push(momoReference);
  }
  if (receiptUrl !== null) {
    updates.push(`receipt_url = $${index++}`);
    values.push(receiptUrl);
  }

  return db.one(
    `UPDATE transaction_legs SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
};

const deleteTransactionLeg = (id) =>
  db.none('DELETE FROM transaction_legs WHERE id = $1', [id]);

export {
  createTransactionLeg,
  getTransactionLegById,
  getTransactionLegsByRequestId,
  getTransactionLegByRequestAndType,
  getAllTransactionLegs,
  getAllTransactionLegsWithDetails,
  getTransactionLegByIdWithDetails,
  confirmTransactionLeg,
  deleteTransactionLeg,
};