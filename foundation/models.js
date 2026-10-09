// The only model layer used by the Phase 1 API; legacy models are not mounted.
export const agentDTO = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  phone: row.phone,
  role: row.role,
  accountStatus: row.account_status,
  applicationStatus: row.application_status,
  mainAgentId: row.main_agent_id ?? null,
  createdAt: new Date(row.created_at).toISOString(),
});
export const requestDTO = (row) => ({
  id: row.id,
  subAgentId: row.sub_agent_id,
  mainAgentId: row.main_agent_id,
  sourceNetwork: row.source_network,
  destinationNetwork: row.destination_network,
  amountTzs: String(row.amount_tzs),
  currency: row.currency,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
});
export async function findAgent(db, id) {
  return (
    await db.query(
      `SELECT a.*, m.main_agent_id FROM ss_v1.agents a
    LEFT JOIN ss_v1.main_agent_assignments m ON m.sub_agent_id=a.id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
}
