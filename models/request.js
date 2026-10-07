import db from '../config/database.js';
export const requestScope = (user, alias = '') => `${alias}${user.role === 'main-agent' ? 'main_agent_id' : 'sub_agent_id'} = $1`;
export const getRequestById = id => db.oneOrNone('SELECT * FROM public.transfer_requests WHERE id = $1', [id]);
export const getAllRequestsData = user => db.manyOrNone(
  `SELECT * FROM public.transfer_requests WHERE ${requestScope(user)} ORDER BY requested_at DESC LIMIT 200`, [user.id]);
export const canReadRequest = (user, request) => request && (request.sub_agent_id === user.id || request.main_agent_id === user.id);
export const resolveNetwork = value => db.oneOrNone(
  'SELECT id FROM public.networks WHERE (id::text = $1 OR name = $1 OR code = $1) AND is_active = TRUE', [value]);
export const createRequest = (agentId, amount, originId, originAccount, destinationId, destinationAccount) => db.one(
  `INSERT INTO public.transfer_requests (sub_agent_id, amount, origin_network_id, origin_account_identifier, destination_network_id, destination_account_identifier)
   VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [agentId, amount, originId, originAccount, destinationId, destinationAccount]);
