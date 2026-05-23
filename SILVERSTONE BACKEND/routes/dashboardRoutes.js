import express from 'express';
import { getRevenueMetrics, getMonthlyCounts, getPerformanceMetrics, getRequestsPerNetwork, getTopPerformingAgents } from '../controllers/dashboardController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.get('/revenue-metrics', auth(true), getRevenueMetrics); 
router.get('/monthly-counts', auth(true), getMonthlyCounts); 
router.get('/performance-metrics', auth(true), getPerformanceMetrics); 
router.get('/requests-per-network', auth(true), getRequestsPerNetwork); 
router.get('/top-agents', auth(true), getTopPerformingAgents); 

export default router