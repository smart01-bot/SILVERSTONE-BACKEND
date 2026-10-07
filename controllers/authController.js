import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getAgentByPhone, getAgent, safeAgent } from '../models/agent.js';

const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 15 * 60 * 1000 });
// Cheap, bounded per-process limiter. Shared limits are a separate operational task.
const attempts = new Map();
const dummyHash = bcrypt.hashSync('synthetic-unusable-pin', 10);
export const login = async (req, res, next) => {
  try {
    const phone = req.body.phone_number ?? req.body.phone;
    const pin = req.body.pin;
    if (typeof phone !== 'string' || !phone.trim() || phone.length > 64 || typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
      return res.status(400).json({ error: 'Provide phone_number and a PIN as strings' });
    }
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip;
    const state = attempts.get(key) || { count: 0, until: now + 60000 };
    if (state.count >= 10 || attempts.size >= 10000 && !attempts.has(key)) return res.status(429).json({ error: 'Try again later' });
    state.count++; attempts.set(key, state);
    const agent = await getAgentByPhone(phone.trim());
    // Never guess how an unsupported hash was generated or treat PIN as password.
    const supported = agent && /^\$2[ab]\$\d\d\$/.test(agent.pin_hash);
    const valid = await bcrypt.compare(pin, supported ? agent.pin_hash : dummyHash);
    if (!supported || !valid || ['suspended', 'rejected'].includes(agent.status)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: agent.id, purpose: 'access' }, process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'silverstone-live-api', audience: 'silverstone-live-client', expiresIn: '15m' });
    res.cookie('accessToken', token, cookieOptions());
    res.json({ token, agent: safeAgent(agent) });
  } catch (error) { next(error); }
};
export const me = async (req, res, next) => {
  try { res.json({ agent: safeAgent(await getAgent(req.user.id)) }); } catch (error) { next(error); }
};
export const unavailable = (req, res) => res.status(503).json({ error: 'Verified onboarding and credential changes are unavailable during service restoration' });
export const register = unavailable;
export const forgotPassword = unavailable;
export const resetPassword = unavailable;
export const setPin = unavailable;
export const logout = (req, res) => {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie('accessToken', options);
  res.json({ message: 'Signed out locally; access tokens expire within 15 minutes' });
};
