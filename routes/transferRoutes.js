import express from 'express';
import { handleTransfer, getAllTransfers, updateTransfer, deleteTransfer, getSingleTransfer } from '../controllers/transferController.js';
import auth, { approved } from '../middleware/auth.js';

const router = express.Router();
router.use(auth(), approved);
router.post('/process', auth(), handleTransfer);
router.get('/:id', auth(), getSingleTransfer);
router.get('/', auth(), getAllTransfers);
router.put('/:id', auth(), updateTransfer);
router.delete('/:id', auth(), deleteTransfer);

export default router;