import db from '../config/database.js';

export const getAgent = id => db.oneOrNone('SELECT * FROM public.agents WHERE id = $1', [id]);
export const getAgentByPhone = phone => db.oneOrNone('SELECT * FROM public.agents WHERE phone_number = $1', [phone]);
export const safeAgent = agent => Object.fromEntries(
  ['id', 'role', 'phone_number', 'full_name', 'status', 'business_name', 'business_location', 'created_at', 'updated_at']
    .map(key => [key, agent[key]])
);
export const getVisibleAgents = user => user.role === 'main-agent'
  ? db.manyOrNone(`SELECT DISTINCT a.id, a.role, a.phone_number, a.full_name, a.status
      FROM public.agents a LEFT JOIN public.transfer_requests r ON r.sub_agent_id = a.id
      WHERE a.id = $1 OR r.main_agent_id = $1 LIMIT 200`, [user.id])
  : db.manyOrNone('SELECT id, role, phone_number, full_name, status FROM public.agents WHERE id = $1', [user.id]);
export const canReadAgent = async (user, id) => {
  if (user.id === id) return true;
  if (user.role !== 'main-agent') return false;
  return !!await db.oneOrNone('SELECT id FROM public.transfer_requests WHERE sub_agent_id = $1 AND main_agent_id = $2 LIMIT 1', [id, user.id]);
};
