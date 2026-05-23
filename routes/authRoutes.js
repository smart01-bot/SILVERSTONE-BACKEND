import express from 'express';
import { login, register, me, forgotPassword, resetPassword, setPin, logout } from '../controllers/authController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.post('/login',           login);
router.post('/register',        register);
router.get('/me',               auth(), me);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);
router.post('/set-pin',         auth(), setPin);
router.post('/logout',          auth(), logout);

export default router;