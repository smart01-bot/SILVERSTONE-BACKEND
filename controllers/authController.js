import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import jwt from 'jsonwebtoken';
import { check, validationResult } from 'express-validator';
import { createAgent, getAgentByEmail, getAgent } from '../models/agent.js';
import { ROLES, NETWORKS } from '../utils/constants.js';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  maxAge: 24 * 60 * 60 * 1000,
};

const makeToken = (agent, expiresIn = '24h') =>
  jwt.sign({ id: agent.id, role: agent.role }, process.env.JWT_SECRET, { expiresIn });

// Strip passwordhash from any agent object before sending to client
const safeAgent = (agent) => {
  const { passwordhash, ...rest } = agent;
  return rest;
};

// ── POST /api/auth/login ──────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    await Promise.all([
      check('email').isEmail().run(req),
      check('password').isString().notEmpty().run(req),
    ]);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const agent = await getAgentByEmail(email);
    if (!agent) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, agent.passwordhash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = makeToken(agent);

    // Cookie for web dashboard
    res.cookie('accessToken', token, COOKIE_OPTS);

    // Token in body for mobile app (stored in SecureStore)
    res.status(200).json({ token, agent: safeAgent(agent) });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/register ───────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const {
      username, name, email, phone, password,
      networks = [], agentPhoneNumbers = [],
      role = 'sub-agent',
      businessName, businessLocation, coordinates,
      regNo, tin, nida, floatCapacity,
      tinCertUrl, licenceCertUrl, selfieVerified = false,
    } = req.body;

    await Promise.all([
      check('username').isString().notEmpty().run(req),
      check('email').isEmail().run(req),
      check('phone').isString().notEmpty().run(req),
      check('password').isString().isLength({ min: 6 }).run(req),
      check('networks').isArray().run(req),
      check('role').isString().isIn(ROLES).run(req),
    ]);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const passwordHash = await bcrypt.hash(password, 10);
    const agent = await createAgent(
      username, name || username, email, phone,
      networks, agentPhoneNumbers, role, passwordHash,
      businessName, businessLocation, coordinates,
      regNo, tin, nida, floatCapacity,
      tinCertUrl, licenceCertUrl, selfieVerified
    );

    const token = makeToken(agent, '12h');
    res.cookie('accessToken', token, { ...COOKIE_OPTS, maxAge: 12 * 60 * 60 * 1000 });

    res.status(201).json({ token, agent: safeAgent(agent) });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/auth/me ──────────────────────────────────────────────────────
// Mobile app calls this on startup to validate stored token + refresh profile
const me = async (req, res, next) => {
  try {
    const agent = await getAgent(req.user.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.status(200).json({ agent: safeAgent(agent) });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/forgot-password ───────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    await check('email').isEmail().run(req);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    const agent = await getAgentByEmail(email);

    // Always return 200 — don't leak whether email exists
    if (!agent) return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });

    // TODO: integrate email provider (Resend / SendGrid) and send reset link
    // For now, return a temporary token the mobile app can use for reset
    const resetToken = jwt.sign(
      { id: agent.id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // In production: email this token. For now: return it (dev only)
    res.status(200).json({
      message: 'Reset token generated.',
      resetToken: process.env.NODE_ENV !== 'production' ? resetToken : undefined,
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/reset-password ────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    await Promise.all([
      check('resetToken').isString().notEmpty().run(req),
      check('newPassword').isString().isLength({ min: 6 }).run(req),
    ]);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { resetToken, newPassword } = req.body;
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.purpose !== 'reset') return res.status(401).json({ error: 'Invalid token purpose' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await import('../config/database.js').then(({ default: db }) =>
      db.none('UPDATE agents SET passwordhash = $1 WHERE id = $2', [passwordHash, decoded.id])
    );

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/set-pin ────────────────────────────────────────────────
const setPin = async (req, res, next) => {
  try {
    // PIN is stored device-side in SecureStore — backend just flips the pin_set flag
    await import('../config/database.js').then(({ default: db }) =>
      db.none('UPDATE agents SET pin_set = TRUE WHERE id = $1', [req.user.id])
    );
    res.status(200).json({ message: 'PIN set confirmed.' });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/auth/logout ─────────────────────────────────────────────────
const logout = async (req, res) => {
  res.clearCookie('accessToken', { httpOnly: true, secure: true, sameSite: 'none' });
  res.status(200).json({ message: 'Logged out' });
};

export { login, register, me, forgotPassword, resetPassword, setPin, logout };