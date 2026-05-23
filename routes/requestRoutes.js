import express from 'express';
import {
  submitRequest, getSingleRequest, getAllRequests,
  updateRequest, deleteRequest,
} from '../controllers/requestController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.post('/submit',  auth(),       submitRequest);
router.get('/',         auth(true),   getAllRequests);
router.get('/:id',      auth(),       getSingleRequest); // was wrongly mapped to getAllRequests
router.put('/:id',      auth(true),   updateRequest);
router.delete('/:id',   auth(true),   deleteRequest);

export default router;