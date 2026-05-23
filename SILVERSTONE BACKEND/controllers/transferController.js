import { check, validationResult } from 'express-validator';
import { processTransfer } from '../services/transferService.js';
import { deleteTransaction, getAllTransactions, getTransactionById, updateTransaction } from '../models/transaction.js';

const handleTransfer = async (req, res, next) => {
  try {
    const { requestId } = req.body;
    await check('requestId').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const result = await processTransfer(requestId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getSingleTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transfer = await getTransactionById(id);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found' });

    res.status(200).json([transfer]);
  } catch (error) {
    next(error);
  }
};

const getAllTransfers = async (req, res, next) => {
  try {
    const transfers = await getAllTransactions();
    res.status(200).json(transfers);
  } catch (error) {
    next(error);
  }
};

const updateTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status } = req.body;

    await Promise.all([
      check('id').isUUID().run(req),
      check('amount').optional().isFloat({ min: 0 }).run(req),
      check('source_network').optional().isString().isIn(['Vodacom', 'Tigo', 'Halotel']).run(req),
      check('destination_network').optional().isString().isIn(['Vodacom', 'Tigo', 'Halotel']).run(req),
      check('destination_phoneNumber').optional().isString().run(req),
      check('source_phoneNumber').optional().isString().run(req),
      check('status').optional().isIn(['pending', 'completed', 'rejected']).run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updatedTransfer = await updateTransaction(id, amount, source_network, destination_network, destination_phoneNumber, source_phoneNumber, status);

    res.status(200).json([updatedTransfer]);
  } catch (error) {
    next(error);
  }
};

const deleteTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;
    await check('id').isUUID().run(req);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    await deleteTransaction(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export { handleTransfer, getSingleTransfer, getAllTransfers, updateTransfer, deleteTransfer };