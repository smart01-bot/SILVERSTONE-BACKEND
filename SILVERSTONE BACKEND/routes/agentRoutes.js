import express from 'express';
import { getAgent, getAllAgents, updateAgent, deleteAgent, getAgentRequests, getAgentTransactions, getAgentData } from '../controllers/agentController.js';
import auth from '../middleware/auth.js';

const router = express.Router();
router.get('/:id', auth(), getAgent);
router.get('/', auth(true), getAllAgents);
router.put('/:id', auth(true), updateAgent);
router.delete('/:id', auth(true), deleteAgent);
router.get('/:id/data', auth(), getAgentData);
router.get('/:id/requests', auth(), getAgentRequests);
router.get('/:id/transactions', auth(), getAgentTransactions);

export default router;