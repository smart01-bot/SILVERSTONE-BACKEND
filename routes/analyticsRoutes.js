import express from 'express';
import { getAgentAnalytics, getTimeBasedAnalytics, getTimeBasedRequests, getTimeBasedRequestsMetrics, getTimeBasedTransactions, getTimeBasedTransactionsMetrics } from '../controllers/analyticsController.js';
import auth, { approved } from '../middleware/auth.js';

const router = express.Router();
router.use(auth(), approved);
router.get('/agent/:agentId', auth(), getAgentAnalytics);
router.get('/time-based', auth(true), getTimeBasedAnalytics);
router.get('/time-based-requests', auth(true), getTimeBasedRequests);
router.get('/time-based-transactions', auth(true), getTimeBasedTransactions);
router.get('/time-based-requests-metrics', auth(true), getTimeBasedRequestsMetrics);
router.get('/time-based-transactions-metrics', auth(true), getTimeBasedTransactionsMetrics);

export default router;