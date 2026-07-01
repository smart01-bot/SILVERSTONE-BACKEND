import db from '../config/database.js';

// transfer_requests is the swap request a sub-agent submits. Lifecycle:
// pending_pin -> pending_origin_confirmation -> pending_approval -> approved -> completed
//                                                                 \-> rejected
// approved/completed can also fall through to 'failed' if the release leg fails.
// origin_network_id <> destination_network_id is enforced by a DB CHECK constraint
// (chk_different_networks), so same-network requests can never exist at this table.

const createTransferRequest = async (
  subAgentId,
  amount,
  originNetworkId,
  originAccountIdentifier,
  destinationNetworkId,
  destinationAccountIdentifier
) => {
  return db.one(
    `INSERT INTO transfer_requests (
       sub_agent_id, amount,
       origin_network_id, origin_account_identifier,
       destination_network_id, destination_account_identifier
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      subAgentId,
      amount,
      originNetworkId,
      originAccountIdentifier,
      destinationNetworkId,
      destinationAccountIdentifier,
    ]
  );
};

const getRequestById = (id) =>
  db.oneOrNone('SELECT * FROM transfer_requests WHERE id = $1', [id]);

const getAllRequests = () =>
  db.manyOrNone('SELECT * FROM transfer_requests ORDER BY requested_at DESC');

const getRequestsByStatus = (status) =>
  db.manyOrNone(
    'SELECT * FROM transfer_requests WHERE status = $1 ORDER BY requested_at DESC',
    [status]
  );

const getRequestsBySubAgent = (subAgentId) =>
  db.manyOrNone(
    'SELECT * FROM transfer_requests WHERE sub_agent_id = $1 ORDER BY requested_at DESC',
    [subAgentId]
  );

const getRequestsByMainAgent = (mainAgentId) =>
  db.manyOrNone(
    'SELECT * FROM transfer_requests WHERE main_agent_id = $1 ORDER BY requested_at DESC',
    [mainAgentId]
  );

// Plain status flip, no side fields. Used for terminal/transitional states
// that don't carry a decision (e.g. 'pending_origin_confirmation', 'failed').
const updateRequestStatus = (id, status) =>
  db.one(
    'UPDATE transfer_requests SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );

// Assigns the main agent acting as liquidity bridge for this request.
const assignMainAgent = (id, mainAgentId) =>
  db.one(
    'UPDATE transfer_requests SET main_agent_id = $1 WHERE id = $2 RETURNING *',
    [mainAgentId, id]
  );

// Records a main agent's approve/reject decision. This is the one place
// rejection_reason actually gets persisted -- the old schema/code never wrote
// it anywhere despite the frontend collecting it.
const recordDecision = (id, { status, decidedBy, rejectionReason = null }) =>
  db.one(
    `UPDATE transfer_requests
     SET status = $1, decided_by = $2, decided_at = now(), rejection_reason = $3
     WHERE id = $4
     RETURNING *`,
    [status, decidedBy, rejectionReason, id]
  );

const markCompleted = (id) =>
  db.one(
    `UPDATE transfer_requests
     SET status = 'completed', completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [id]
  );

const deleteRequest = (id) =>
  db.none('DELETE FROM transfer_requests WHERE id = $1', [id]);

export {
  createTransferRequest,
  getRequestById,
  getAllRequests,
  getRequestsByStatus,
  getRequestsBySubAgent,
  getRequestsByMainAgent,
  updateRequestStatus,
  assignMainAgent,
  recordDecision,
  markCompleted,
  deleteRequest,
};