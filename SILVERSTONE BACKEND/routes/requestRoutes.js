import express from 'express';
import { submitRequest, getAllRequests, updateRequest, deleteRequest } from '../controllers/requestController.js';
import auth from '../middleware/auth.js';

const router = express.Router();
router.post('/submit', auth(), submitRequest);
router.get('/:id', auth(), getAllRequests);
router.get('/', auth(true), getAllRequests);
router.put('/:id', auth(true), updateRequest);
router.delete('/:id', auth(true), deleteRequest);

export default router;