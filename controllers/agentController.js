import { getAgent as readAgent, safeAgent, getVisibleAgents, canReadAgent } from '../models/agent.js';
import { getAllRequestsData } from '../models/request.js';
import { getAllTransactions } from '../models/transaction.js';
import { uuid } from './requestController.js';
async function authorize(req, res) {
  if (!uuid(req.params.id)) { res.status(400).json({ error: 'Invalid agent ID' }); return false; }
  if (!await canReadAgent(req.user, req.params.id)) { res.status(404).json({ error: 'Agent not found' }); return false; }
  return true;
}
export const getAgent = async (req, res, next) => {
  try {
    if (!await authorize(req, res)) return;
    const agent = await readAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(safeAgent(agent));
  } catch (error) { next(error); }
};
export const getAllAgents = async (req, res, next) => {
  try { res.json(await getVisibleAgents(req.user)); } catch (error) { next(error); }
};
async function scopedHistory(req) {
  const requests = (await getAllRequestsData(req.user)).filter(r => r.sub_agent_id === req.params.id);
  const ids = new Set(requests.map(r => r.id));
  const transactions = (await getAllTransactions(req.user)).filter(t => ids.has(t.request_id));
  return { requests, transactions, limit: 200 };
}
export const getAgentData = async (req, res, next) => {
  try { if (await authorize(req, res)) res.json(await scopedHistory(req)); } catch (error) { next(error); }
};
export const getAgentRequests = async (req, res, next) => {
  try { if (await authorize(req, res)) res.json((await scopedHistory(req)).requests); } catch (error) { next(error); }
};
export const getAgentTransactions = async (req, res, next) => {
  try { if (await authorize(req, res)) res.json((await scopedHistory(req)).transactions); } catch (error) { next(error); }
};
export const updateAgent = (req, res) => res.status(503).json({ error: 'Agent administration is unavailable during service restoration' });
export const deleteAgent = updateAgent;
