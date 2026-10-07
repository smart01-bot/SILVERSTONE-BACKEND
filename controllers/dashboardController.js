import { getAllRequestsData } from '../models/request.js';
import { getAllTransactions } from '../models/transaction.js';

export async function getDashboardData(user) {
  const [requests, transactions] = await Promise.all([getAllRequestsData(user), getAllTransactions(user)]);
  return {
    requests, transactions,
    summary: {
      requestCount: requests.length, transactionLegCount: transactions.length,
      completedRequestCount: requests.filter(r => r.status === 'completed').length,
      pendingRequestCount: requests.filter(r => r.status.startsWith('pending')).length,
      confirmedLegCount: transactions.filter(t => t.confirmed_at).length,
      // No fee/revenue column exists. Both legs must not be counted as revenue.
      totalRevenue: null, scope: 'authorized recent records', limitPerList: 200,
    },
  };
}
export const getRevenueMetrics = async (req, res, next) => {
  try { res.json(await getDashboardData(req.user)); } catch (error) { next(error); }
};
export const getPerformanceMetrics = getRevenueMetrics;
export const getMonthlyCounts = async (req, res, next) => {
  try {
    const data = await getDashboardData(req.user);
    const months = new Map();
    for (const request of data.requests) {
      const month = new Date(request.requested_at).toISOString().slice(0, 7);
      months.set(month, (months.get(month) || 0) + 1);
    }
    res.json({ months: [...months].map(([month, count]) => ({ month, count })), scope: 'authorized recent records', limit: 200 });
  } catch (error) { next(error); }
};
export const getRequestsPerNetwork = async (req, res, next) => {
  try {
    const data = await getDashboardData(req.user);
    const networks = new Map();
    for (const request of data.requests) networks.set(request.destination_network_id, (networks.get(request.destination_network_id) || 0) + 1);
    res.json({ networks: [...networks].map(([networkId, count]) => ({ networkId, count })), scope: 'authorized recent records', limit: 200 });
  } catch (error) { next(error); }
};
export const getTopPerformingAgents = (req, res) => res.status(503).json({ error: 'Performance ranking is unavailable during service restoration' });
