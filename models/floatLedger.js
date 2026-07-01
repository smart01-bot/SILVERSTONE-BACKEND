import db from '../config/database.js';

// float_ledger is an append-only audit trail of every change to a main agent's
// float. balance_after is computed by a BEFORE INSERT trigger
// (fn_compute_balance_after) -- never set it or calculate it here. A second
// AFTER INSERT trigger (fn_sync_float_balance) keeps agent_float_balances (the
// fast-read cache) in sync automatically. App code should never write to
// agent_float_balances directly -- only ever insert into float_ledger.

const createLedgerEntry = (mainAgentId, networkId, direction, amount, transactionLegId = null) =>
  db.one(
    `INSERT INTO float_ledger (main_agent_id, network_id, transaction_leg_id, direction, amount)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [mainAgentId, networkId, transactionLegId, direction, amount]
  );

const getLedgerForAgent = (mainAgentId, networkId) =>
  db.manyOrNone(
    'SELECT * FROM float_ledger WHERE main_agent_id = $1 AND network_id = $2 ORDER BY created_at DESC',
    [mainAgentId, networkId]
  );

// Reads from the fast-read cache table, not by summing the ledger.
const getCurrentBalance = (mainAgentId, networkId) =>
  db.oneOrNone(
    'SELECT balance FROM agent_float_balances WHERE main_agent_id = $1 AND network_id = $2',
    [mainAgentId, networkId]
  );

const getAllBalancesForAgent = (mainAgentId) =>
  db.manyOrNone(
    'SELECT * FROM agent_float_balances WHERE main_agent_id = $1',
    [mainAgentId]
  );

export { createLedgerEntry, getLedgerForAgent, getCurrentBalance, getAllBalancesForAgent };