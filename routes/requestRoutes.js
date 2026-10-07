import express from 'express';
import {
  submitRequest, getSingleRequest, getAllRequests,
  updateRequest, deleteRequest,
} from '../controllers/requestController.js';
import auth, { approved } from '../middleware/auth.js';

const router = express.Router();
router.use(auth(), approved);

router.post('/submit',  auth(),       submitRequest);
router.get('/',         auth(),   getAllRequests);
router.get('/:id',      auth(),       getSingleRequest); // was wrongly mapped to getAllRequests
router.put('/:id',      auth(),   updateRequest);
router.delete('/:id',   auth(),   deleteRequest);

export default router;