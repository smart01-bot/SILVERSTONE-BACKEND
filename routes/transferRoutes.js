import express from 'express';
import { handleTransfer, getAllTransfers, updateTransfer, deleteTransfer, getSingleTransfer } from '../controllers/transferController.js';
import auth from '../middleware/auth.js';

const router = express.Router();
router.post('/process', auth(), handleTransfer);
router.get('/:id', auth(), getSingleTransfer);
router.get('/', auth(true), getAllTransfers);
router.put('/:id', auth(true), updateTransfer);
router.delete('/:id', auth(true), deleteTransfer);

export default router;