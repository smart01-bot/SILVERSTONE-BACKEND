import jwt from 'jsonwebtoken';
import { getAgent } from '../models/agent.js';

export default function auth(mainAgentOnly = false) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.accessToken;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'], issuer: 'silverstone-live-api', audience: 'silverstone-live-client',
      });
      if (decoded.purpose !== 'access' || typeof decoded.id !== 'string') throw new Error();
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
    try {
      const agent = await getAgent(decoded.id);
      if (!agent || ['suspended', 'rejected'].includes(agent.status)) return res.status(401).json({ error: 'Account unavailable' });
      req.user = { id: agent.id, role: agent.role, status: agent.status, tokenExpiresAt: decoded.exp * 1000 };
      if (mainAgentOnly && agent.role !== 'main-agent') return res.status(403).json({ error: 'Main-agent access required' });
      next();
    } catch (error) { next(error); }
  };
}
export const approved = (req, res, next) => req.user.status === 'approved'
  ? next() : res.status(403).json({ error: 'Approved account required' });
