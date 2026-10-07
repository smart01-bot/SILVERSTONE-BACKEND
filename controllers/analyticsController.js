import { getDashboardData } from './dashboardController.js';
import { getAgentData } from './agentController.js';
export const getAgentAnalytics = (req, res, next) => {
  req.params.id = req.params.agentId;
  return getAgentData(req, res, next);
};
export const getTimeBasedAnalytics = async (req, res, next) => {
  try {
    const days = { daily: 1, weekly: 7, monthly: 30 }[req.query.period];
    if (!days) return res.status(400).json({ error: 'Choose daily, weekly or monthly' });
    const data = await getDashboardData(req.user);
    const cutoff = Date.now() - days * 86400000;
    res.json({
      requests: data.requests.filter(r => new Date(r.requested_at).getTime() >= cutoff),
      transactions: data.transactions.filter(t => new Date(t.created_at).getTime() >= cutoff),
      scope: 'authorized recent records', limitPerList: 200,
    });
  } catch (error) { next(error); }
};
export const getTimeBasedRequests = getTimeBasedAnalytics;
export const getTimeBasedTransactions = getTimeBasedAnalytics;
export const getTimeBasedRequestsMetrics = getTimeBasedAnalytics;
export const getTimeBasedTransactionsMetrics = getTimeBasedAnalytics;
