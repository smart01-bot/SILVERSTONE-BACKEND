import { getAllTransactions, getTransactionById } from '../models/transaction.js';
import { uuid } from './requestController.js';
export const handleTransfer = (req, res) => res.status(503).json({ error: 'Payment execution is unavailable during service restoration' });
export const updateTransfer = handleTransfer;
export const deleteTransfer = handleTransfer;
export const getAllTransfers = async (req, res, next) => {
  try { res.json(await getAllTransactions(req.user)); } catch (error) { next(error); }
};
export const getSingleTransfer = async (req, res, next) => {
  try {
    if (!uuid(req.params.id)) return res.status(400).json({ error: 'Invalid transfer ID' });
    const transfer = await getTransactionById(req.params.id, req.user);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });
    res.json([transfer]);
  } catch (error) { next(error); }
};
