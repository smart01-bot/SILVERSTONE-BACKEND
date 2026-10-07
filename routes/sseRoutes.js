import express from 'express';
import auth, { approved } from '../middleware/auth.js';
import { getDashboardData } from '../controllers/dashboardController.js';
import { getAgent } from '../models/agent.js';
const router = express.Router();
router.get('/', auth(true), approved, async (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('event: connected\ndata: {"message":"Connected"}\n\n');
  let running = false;
  const interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() >= req.user.tokenExpiresAt) { res.end(); return; }
      const current = await getAgent(req.user.id);
      if (!current || current.status !== 'approved' || current.role !== 'main-agent') { res.end(); return; }
      const data = await getDashboardData(req.user);
      if (!res.writableEnded) res.write(`event: dashboard\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      if (!res.writableEnded) res.write('event: error\ndata: {"error":"Dashboard unavailable"}\n\n');
    } finally { running = false; }
  }, 2000);
  res.on('close', () => clearInterval(interval));
});
export default router;
